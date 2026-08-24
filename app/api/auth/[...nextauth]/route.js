import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials'; // 🚀 NEW: Added for Impersonation (Bypass)
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
        // 🔴 FIX: Added 'consent' to strictly force Google to ask for account selection every time
        params: { 
          prompt: 'consent select_account', 
          access_type: 'offline',
          response_type: 'code'
        },
      },
    }),
    // 🚀 NEW: IMPERSONATE LOGIN PROVIDER (MD / Employee Bypass Client Login)
    CredentialsProvider({
      id: 'impersonate',
      name: 'Impersonate',
      credentials: {
        email: { label: "Email", type: "text" },
        adminToken: { label: "Token", type: "text" }
      },
      async authorize(credentials) {
        // పాస్‌వర్డ్ అడగకుండా, సిస్టమ్ జనరేట్ చేసిన టోకెన్ తో క్లయింట్ అకౌంట్ లోకి లాగిన్ అవ్వడానికి
        if (credentials.adminToken === 'admin_success' || credentials.adminToken === process.env.ADMIN_TOKEN) {
           return { id: credentials.email, email: credentials.email };
        }
        return null;
      }
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  callbacks: {
    async signIn({ user }) {
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
      if (user?.email) token.email = user.email.toLowerCase();
      return token;
    },
    async session({ session, token }) {
      if (token?.email) session.user.email = token.email;
      return session;
    },
  },
  pages: {
    signIn: '/',
    error: '/',
  },
});

export { handler as GET, handler as POST };
