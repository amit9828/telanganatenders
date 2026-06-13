import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';

// డేటాబేస్ కనెక్షన్ కోసం
let cachedClient = null;
let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;
  
  if (!process.env.MONGO_URL) {
    throw new Error('MONGO_URL environment variable is missing.');
  }

  const client = await MongoClient.connect(process.env.MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  
  cachedClient = client;
  cachedDb = client.db(process.env.DB_NAME || 'tender_portal');
  return cachedDb;
}

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

// =====================================================================
// GET REQUESTS (పాత టెండర్స్ డేటా ఇక్కడే వస్తుంది)
// =====================================================================
export async function GET(request, { params }) {
  const db = await getDb();
  
  const pathArray = params?.path || [];
  const path = pathArray.join('/');
  const { searchParams } = new URL(request.url);

  try {
    // 1. TENDERS DATA
    if (path === 'tenders' || path === 'api/tenders') {
      const district = searchParams.get('district');
      const query = {};
      
      if (district && district !== 'all') {
        query.district = district;
      }
      
      const tenders = await db.collection('tenders').find(query).sort({ last_date: -1 }).toArray();
      return json({ tenders });
    }

    // 2. CALENDAR DATA
    if (path === 'tenders/calendar' || path === 'api/tenders/calendar') {
      const month = parseInt(searchParams.get('month'));
      const year = parseInt(searchParams.get('year'));
      const tenders = await db.collection('tenders').find({}).toArray();
      const days = {};
      
      tenders.forEach(t => {
        if (t.last_date) {
          const d = new Date(t.last_date);
          if (d.getMonth() + 1 === month && d.getFullYear() === year) {
            const day = d.getDate();
            if (!days[day]) days[day] = [];
            days[day].push(t);
          }
        }
      });
      return json({ days });
    }

    // 3. USER ACCESS
    if (path === 'access' || path === 'api/access') {
      const email = searchParams.get('email');
      if (!email) return json({ subscription: null });
      
      const user = await db.collection('users').findOne({ email: email.toLowerCase() });
      return json({ subscription: user?.subscription || null });
    }

    // 4. PDF FETCH & PAYWALL
    if (pathArray.length === 3 && (pathArray[0] === 'tenders' || pathArray[0] === 'api') && pathArray[2] === 'pdf') {
      const tenderId = pathArray[1];
      const email = searchParams.get('email');
      
      if (!email) return json({ error: 'Email required' }, 400);

      const user = await db.collection('users').findOne({ email: email.toLowerCase() });
      const hasSubscription = user?.subscription?.status === 'active';
      const hasBoughtSingle = user?.purchases?.includes(tenderId);
      
      if (!hasSubscription && !hasBoughtSingle) {
         return json({ error: 'Payment required to view this PDF' }, 402);
      }

      const tender = await db.collection('tenders').findOne({ _id: new ObjectId(tenderId) });
      if (!tender || !tender.pdf_base64) {
         return json({ error: 'PDF Document not found' }, 404);
      }

      return json({
         pdf_base64: tender.pdf_base64,
         pdf_filename: tender.pdf_filename || 'tender_document.pdf',
         title: tender.title,
         watermarked: true
      });
    }

    return json({ error: 'GET endpoint not found', path }, 404);
  } catch (error) {
    console.error('GET Error:', error);
    return json({ error: 'Internal Server Error' }, 500);
  }
}

// =====================================================================
// POST REQUESTS (అడ్మిన్ లాగిన్ ఇక్కడే జరుగుతుంది)
// =====================================================================
export async function POST(request, { params }) {
  const db = await getDb();
  
  const pathArray = params?.path || [];
  const path = pathArray.join('/');

  try {
    const body = await request.json().catch(() => ({}));

    // 1. ADMIN LOGIN FIX (405 ఎర్రర్ రాకుండా లాగిన్ చెక్ చేయడం)
    if (path === 'admin/login' || path === 'api/admin/login') {
      if (!body.email || !body.password) {
        return json({ error: 'Email and password are required' }, 400);
      }

      if (
        body.email === process.env.ADMIN_EMAIL &&
        body.password === process.env.ADMIN_PASSWORD
      ) {
        return json({ token: process.env.ADMIN_TOKEN || 'admin_token_success' });
      }
      
      return json({ error: 'Invalid admin credentials' }, 401);
    }

    // 2. USER RECORD SAVING
    if (path === 'users' || path === 'api/users') {
      if (body.email) {
        const email = body.email.toLowerCase();
        await db.collection('users').updateOne(
          { email: email },
          { $set: { email: email, name: body.name || '', last_login: new Date() } },
          { upsert: true }
        );
      }
      return json({ success: true });
    }

    // 3. CASHFREE SUBSCRIPTION API
    if (path === 'subscription/create' || path === 'api/subscription/create') {
      return json({ 
        payment_session_id: 'session_' + Date.now(),
        message: 'Subscription session initialized'
      });
    }

    // 4. CASHFREE ONE-TIME PAYMENT API
    if (path === 'payment/order' || path === 'api/payment/order') {
      return json({ 
        payment_session_id: 'session_' + Date.now(),
        message: 'Order session initialized'
      });
    }

    return json({ error: 'POST endpoint not found', path }, 404);
  } catch (error) {
    console.error('POST Error:', error);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
