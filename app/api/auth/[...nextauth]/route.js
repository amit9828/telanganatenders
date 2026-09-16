import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';
import { normalizeDesignation } from '@/lib/designations';
import {
  callerCanBypass,
  findEmployeeForBypass,
  impersonateCaller,
  staffJwtFromEmployee,
} from '@/lib/impersonate';

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
          // 🚀 RBAC: binary access role used for data-isolation filters (Bids /
          // Suggestions). Independent of `employee.role`, which stays a job-title
          // label ("Tender Officer" / "Data Entry Emp" / "Manager (MD)") used
          // elsewhere and is left untouched.
          const mdEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
          const isMD = Boolean(mdEmail) && String(employee.email || '').toLowerCase() === mdEmail;
          return { 
             id: employee._id.toString(), 
             email: employee.email, 
             name: employee.name, 
             emp_id: employee.emp_id, 
             role: isMD ? 'MD' : 'EMPLOYEE',
             designation: isMD ? null : normalizeDesignation(employee.designation),
             team_id: isMD ? null : (employee.team_id || null),
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
        email: { label: 'Email or ID', type: 'text' },
        adminToken: { label: 'Token', type: 'text' },
        emp_id: { label: 'Employee ID', type: 'text' },
        target: { label: 'Target', type: 'text' },
      },
      async authorize(credentials, req) {
        const caller = await impersonateCaller(credentials, req);
        if (!caller) return null;

        const db = await getDb();
        const isStaffTarget = String(credentials?.target || '').toLowerCase() === 'staff'
          || Boolean(String(credentials?.emp_id || '').trim());

        if (isStaffTarget) {
          const emp = await findEmployeeForBypass(db, credentials);
          if (!emp || !callerCanBypass(caller, emp)) return null;
          return staffJwtFromEmployee(emp);
        }

        const searchStr = String(credentials?.email || '').trim();
        if (!searchStr) return null;
        const searchEmail = searchStr.toLowerCase();

        const user = await db.collection('users').findOne({
          $or: [
            { email: searchEmail },
            { client_id: new RegExp(`^${escapeRegex(searchStr)}$`, 'i') },
          ],
        });
        if (user) {
          return {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            client_id: user.client_id,
            role: 'Client',
            is_approved: true,
            is_bypass: true,
          };
        }

        const emp = await findEmployeeForBypass(db, credentials);
        if (emp && callerCanBypass(caller, emp)) return staffJwtFromEmployee(emp);

        return null;
      },
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
         token.id = user.id || token.id;
         token.name = user.name || null;
         token.client_id = user.client_id || null;
         token.emp_id = user.emp_id || null;
         token.role = user.role || null;
         token.designation = user.designation ?? null;
         token.team_id = user.team_id ?? null;
         token.is_approved = user.is_approved;
         token.is_bypass = Boolean(user.is_bypass);
      }
      return token;
    },
    
    // SEND JWT FLAGS TO THE FRONTEND SESSION (useSession)
    async session({ session, token }) {
      if (token) {
         session.user = session.user || {};
         session.user.email = token.email || session.user.email;
         session.user.id = token.id || token.sub || session.user.id;
         session.user.name = token.name || session.user.name;
         session.user.client_id = token.client_id || null;
         session.user.emp_id = token.emp_id || null;
         session.user.role = token.role || null;
         session.user.designation = token.designation || null;
         session.user.team_id = token.team_id || null;
         session.user.is_approved = token.is_approved;
         session.user.is_bypass = Boolean(token.is_bypass);
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
