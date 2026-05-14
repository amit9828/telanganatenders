import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
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
        params: { prompt: 'select_account', access_type: 'offline' },
      },
    }),
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
