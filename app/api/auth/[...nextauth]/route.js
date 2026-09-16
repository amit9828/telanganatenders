import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';
import {
  callerCanBypass,
  findEmployeeForBypass,
  impersonateCaller,
  originalIdentityFromCaller,
  pickOriginalIdentity,
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
             { emp_id: new RegExp(`^${identifier}$`, 'i') }
           ],
           password: credentials.password,
           deleted: { $ne: true },
           active: { $ne: false },
        });
        
        if (employee) {
          return staffJwtFromEmployee(employee, { isBypass: false });
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

        let currentToken = null;
        try {
          const { getStaffToken } = await import('@/lib/staff-auth');
          currentToken = await getStaffToken(req);
        } catch (_) { /* caller snapshot is optional */ }
        const original = originalIdentityFromCaller(currentToken, caller.kind);

        const db = await getDb();
        const isStaffTarget = String(credentials?.target || '').toLowerCase() === 'staff'
          || Boolean(String(credentials?.emp_id || '').trim());

        if (isStaffTarget) {
          const emp = await findEmployeeForBypass(db, credentials);
          if (!emp || !callerCanBypass(caller, emp)) return null;
          return staffJwtFromEmployee(emp, { isBypass: true, original });
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
        if (emp && callerCanBypass(caller, emp)) {
          return staffJwtFromEmployee(emp, { isBypass: true, original });
        }

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
         const preserved = pickOriginalIdentity(token)
           || pickOriginalIdentity(user)
           || (user.is_bypass && (token.role || token.emp_id)
             ? originalIdentityFromCaller(token, token.role === 'MD' ? 'MD' : null)
             : null);

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

         if (user.is_bypass && preserved?.originalRole) {
           token.originalRole = preserved.originalRole;
           token.originalEmail = preserved.originalEmail || null;
           token.originalName = preserved.originalName || null;
           token.originalEmpId = preserved.originalEmpId || null;
           token.originalDesignation = preserved.originalDesignation ?? null;
           token.originalTeamId = preserved.originalTeamId ?? null;
         } else if (!user.is_bypass) {
           delete token.originalRole;
           delete token.originalEmail;
           delete token.originalName;
           delete token.originalEmpId;
           delete token.originalDesignation;
           delete token.originalTeamId;
         }
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
         session.user.originalRole = token.originalRole || null;
         session.user.originalEmail = token.originalEmail || null;
         session.user.originalEmpId = token.originalEmpId || null;
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
