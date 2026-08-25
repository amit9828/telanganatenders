import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials'; 
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';

// 🚀 SERVERLESS MONGODB CONNECTION POOLING
let _client;
async function getDb() {
  if (!_client) {
    if (!process.env.MONGO_URL) throw new Error('MONGO_URL missing in environment variables.');
    _client = new MongoClient(process.env.MONGO_URL, {
       useNewUrlParser: true,
       useUnifiedTopology: true,
    });
    await _client.connect();
  }
  return _client.db(process.env.DB_NAME || 'tender_portal');
}

const handler = NextAuth({
  providers: [
    // 1. STANDARD GOOGLE LOGIN FOR CLIENTS
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: { 
          prompt: 'consent select_account', 
          access_type: 'offline',
          response_type: 'code'
        },
      },
    }),
    
    // 2. 🚀 EMPLOYEE LOGIN PROVIDER (Supports EMP-XXXX ID or Email)
    CredentialsProvider({
      id: 'employee-login',
      name: 'Employee Login',
      credentials: {
        email: { label: "Email or Employee ID", type: "text" }, 
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        const db = await getDb();
        const identifier = (credentials?.email || '').trim();
        
        const employee = await db.collection('employees').findOne({ 
           $or: [
             { email: identifier.toLowerCase() },
             { emp_id: new RegExp(`^${identifier}$`, 'i') } // Matches EMP-XXXX exactly
           ],
           password: credentials.password 
        });
        
        if (employee) {
          return { 
             id: employee._id.toString(), 
             email: employee.email, 
             name: employee.name, 
             emp_id: employee.emp_id, 
             role: employee.role || 'Employee' 
          };
        }
        return null; // Invalid credentials
      }
    }),

    // 3. 🚀 IMPERSONATE LOGIN PROVIDER (For MD/Employee to bypass locks)
    CredentialsProvider({
      id: 'impersonate',
      name: 'Impersonate',
      credentials: {
        email: { label: "Email or ID", type: "text" },
        adminToken: { label: "Token", type: "text" }
      },
      async authorize(credentials) {
        // Validate the internal security token
        if (credentials.adminToken === 'admin_success' || credentials.adminToken === process.env.ADMIN_TOKEN) {
           const db = await getDb();
           const searchStr = credentials.email.trim();
           const searchEmail = searchStr.toLowerCase();
           
           // A. Check if it's a Client (by Email or CLI-XXXX)
           const user = await db.collection('users').findOne({
             $or: [
               { email: searchEmail },
               { client_id: new RegExp(`^${searchStr}$`, 'i') }
             ]
           });

           if (user) {
              return { 
                 id: user._id.toString(), 
                 email: user.email, 
                 name: user.name, 
                 client_id: user.client_id, 
                 role: 'Client',
                 // 🚀 BUG FIX INCLUDED: Force bypass flags to skip verification holding screens
                 is_approved: true,
                 is_bypass: true
              };
           }

           // B. If not client, check if it's an Employee (by Email or EMP-XXXX)
           const emp = await db.collection('employees').findOne({
             $or: [
               { email: searchEmail },
               { emp_id: new RegExp(`^${searchStr}$`, 'i') }
             ]
           });

           if (emp) {
              return { 
                 id: emp._id.toString(), 
                 email: emp.email, 
                 name: emp.name, 
                 emp_id: emp.emp_id, 
                 role: emp.role || 'Employee',
                 is_bypass: true
              };
           }

           // C. Fallback for completely new/unsaved users
           return { id: credentials.email, email: credentials.email, role: 'Client', is_approved: true, is_bypass: true };
        }
        return null; // Token failed
      }
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  callbacks: {
    // RUNS WHEN USER PRESSES LOGIN
    async signIn({ user, account }) {
      // SAFEGUARD: Bypass internal logins so they don't override Google Profile data
      if (account?.provider === 'impersonate' || account?.provider === 'employee-login') {
        return true; 
      }

      try {
        const db = await getDb();
        const email = (user.email || '').toLowerCase();
        if (!email) return false;
        
        const existing = await db.collection('users').findOne({ email });
        
        if (!existing) {
          // Register new Google User
          await db.collection('users').insertOne({
            id: uuidv4(),
            email,
            name: user.name || '',
            image: user.image || '',
            provider: 'google',
            created_at: new Date(),
          });
        } else if (!existing.name || !existing.image) {
          // Backfill missing profile picture or name
          await db.collection('users').updateOne(
            { email },
            { $set: { name: user.name || existing.name, image: user.image || existing.image } }
          );
        }
      } catch (e) {
        console.error('[NEXTAUTH signIn Error]', e?.message || e);
      }
      return true;
    },
    
    // ATTACH DATABASE FLAGS TO THE SECURE JWT TOKEN
    async jwt({ token, user }) {
      if (user) {
         token.email = user.email?.toLowerCase();
         if (user.client_id) token.client_id = user.client_id;
         if (user.emp_id) token.emp_id = user.emp_id; 
         if (user.role) token.role = user.role;
         
         // Secure Bypass Flags
         if (user.is_approved !== undefined) token.is_approved = user.is_approved;
         if (user.is_bypass) token.is_bypass = user.is_bypass;
      }
      return token;
    },
    
    // SEND JWT FLAGS TO THE FRONTEND SESSION (useSession)
    async session({ session, token }) {
      if (token?.email) {
         session.user.email = token.email;
         if (token.client_id) session.user.client_id = token.client_id;
         if (token.emp_id) session.user.emp_id = token.emp_id; 
         if (token.role) session.user.role = token.role; 
         
         // Make Bypass Flags visible to the UI Components
         if (token.is_approved !== undefined) session.user.is_approved = token.is_approved;
         if (token.is_bypass) session.user.is_bypass = token.is_bypass;
      }
      return session;
    },
  },
  pages: {
    signIn: '/',
    error: '/',
  },
});

export { handler as GET, handler as POST };
