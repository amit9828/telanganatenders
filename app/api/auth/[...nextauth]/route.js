import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials'; 
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';

let _client;
async function getDb() {
  if (!_client) {
    _client = new MongoClient(process.env.MONGO_URL);
    await _client.connect();
  }
  return _client.db(process.env.DB_NAME || 'tender_portal');
}

const handler = NextAuth({
  providers: [
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
    
    // 🚀 EMPLOYEE LOGIN PROVIDER
    CredentialsProvider({
      id: 'employee-login',
      name: 'Employee Login',
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        const db = await getDb();
        const employee = await db.collection('employees').findOne({ 
           email: credentials.email.toLowerCase(), 
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

    // 🚀 UPDATED: IMPERSONATE LOGIN PROVIDER (MD Bypass)
    CredentialsProvider({
      id: 'impersonate',
      name: 'Impersonate',
      credentials: {
        email: { label: "Email", type: "text" },
        adminToken: { label: "Token", type: "text" }
      },
      async authorize(credentials) {
        if (credentials.adminToken === 'admin_success' || credentials.adminToken === process.env.ADMIN_TOKEN) {
           const db = await getDb();
           const searchEmail = credentials.email.toLowerCase();
           
           // 1. First check if it's a Client
           const user = await db.collection('users').findOne({ email: searchEmail });
           if (user) {
              return { 
                 id: user._id.toString(), 
                 email: user.email, 
                 name: user.name, 
                 client_id: user.client_id, 
                 role: 'Client',
                 // 🚀 BUG FIX: Force bypass and approval flag to skip verification lock screen
                 is_approved: true,
                 is_bypass: true
              };
           }

           // 2. If not client, check if it's an Employee (MD bypassing into employee account)
           const emp = await db.collection('employees').findOne({ email: searchEmail });
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

           // 3. Fallback for unsaved users
           return { id: credentials.email, email: credentials.email, role: 'Client', is_approved: true, is_bypass: true };
        }
        return null;
      }
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  callbacks: {
    async signIn({ user, account }) {
      // 🚀 SAFEGUARD: Bypass login & Employee login doesn't override Google Profile
      if (account?.provider === 'impersonate' || account?.provider === 'employee-login') {
        return true; 
      }

      try {
        const db = await getDb();
        const email = (user.email || '').toLowerCase();
        if (!email) return false;
        const existing = await db.collection('users').findOne({ email });
        if (!existing) {
          await db.collection('users').insertOne({
            id: uuidv4(),
            email,
            name: user.name || '',
            image: user.image || '',
            provider: 'google',
            created_at: new Date(),
          });
        } else if (!existing.name || !existing.image) {
          // backfill profile fields
          await db.collection('users').updateOne(
            { email },
            { $set: { name: user.name || existing.name, image: user.image || existing.image } }
          );
        }
      } catch (e) {
        console.error('[NEXTAUTH signIn]', e?.message || e);
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
         token.email = user.email?.toLowerCase();
         if (user.client_id) token.client_id = user.client_id;
         if (user.emp_id) token.emp_id = user.emp_id; 
         if (user.role) token.role = user.role;
         
         // 🚀 BUG FIX: Map Bypass Flags to Token
         if (user.is_approved !== undefined) token.is_approved = user.is_approved;
         if (user.is_bypass) token.is_bypass = user.is_bypass;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.email) {
         session.user.email = token.email;
         if (token.client_id) session.user.client_id = token.client_id;
         if (token.emp_id) session.user.emp_id = token.emp_id; 
         if (token.role) session.user.role = token.role; 
         
         // 🚀 BUG FIX: Pass Bypass Flags to Frontend Session
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
