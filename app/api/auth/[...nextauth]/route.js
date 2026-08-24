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
        // పాస్‌వర్డ్ అడగకుండా, టోకెన్ తో చెక్ చేసి కచ్చితమైన క్లయింట్ డేటాను డేటాబేస్ నుండి తెచ్చుకోవడం
        if (credentials.adminToken === 'admin_success' || credentials.adminToken === process.env.ADMIN_TOKEN) {
           const db = await getDb();
           const user = await db.collection('users').findOne({ email: credentials.email.toLowerCase() });
           
           if (user) {
              return { id: user._id.toString(), email: user.email, name: user.name, client_id: user.client_id };
           }
           // ఒకవేళ యూజర్ ఇంకా పూర్తిగా సేవ్ అవ్వకపోయినా ఈమెయిల్ తో లాగిన్ అవ్వడానికి
           return { id: credentials.email, email: credentials.email };
        }
        return null;
      }
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  callbacks: {
    async signIn({ user, account }) {
      // 🚀 NEW FIX: ఎంప్లాయీ/ఎండీ బైపాస్ లాగిన్ ద్వారా వెళ్లినప్పుడు క్లయింట్ ప్రొఫైల్ సేఫ్ గా ఉంచడానికి
      if (account?.provider === 'impersonate') {
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
      if (user?.email) {
         token.email = user.email.toLowerCase();
         // 🚀 NEW FIX: టోకెన్ లోనే క్లయింట్ ఐడీ సేవ్ చేయడం వల్ల ఏ అకౌంట్ తారుమారు అవ్వదు
         if (user.client_id) token.client_id = user.client_id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.email) {
         session.user.email = token.email;
         if (token.client_id) session.user.client_id = token.client_id;
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
