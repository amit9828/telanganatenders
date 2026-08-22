import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';

// Forces dynamic rendering to prevent stale cache data
export const dynamic = 'force-dynamic';

let cachedClient = null;
let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;
  if (!process.env.MONGO_URL) throw new Error('MONGO_URL environment variable is missing.');

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
// GET REQUESTS
// =====================================================================
export async function GET(request, { params }) {
  const db = await getDb();
  const pathArray = params?.path || [];
  const path = pathArray.join('/');
  const { searchParams } = new URL(request.url);

  try {
    // 1. ADMIN STATS
    if (path === 'admin/stats' || path === 'api/admin/stats') {
      const tendersCount = await db.collection('tenders').countDocuments();
      const usersCount = await db.collection('users').countDocuments();
      const paymentsCount = await db.collection('payments').countDocuments({ status: 'SUCCESS' });
      const successfulPayments = await db.collection('payments').find({ status: 'SUCCESS' }).toArray();
      const totalRevenue = successfulPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      return json({ tenders: tendersCount, users: usersCount, payments: paymentsCount, revenue: totalRevenue });
    }

    // 2. BRAND SETTINGS (Logo & Name)
    if (path === 'settings' || path === 'api/settings') {
      const settings = await db.collection('settings').findOne({ id: 'brand' });
      return json({ settings: settings || { name: 'Telangana Tenders', logo: null } });
    }

    // 3. TENDERS
    if (path === 'tenders' || path === 'api/tenders') {
      const district = searchParams.get('district');
      const month = searchParams.get('month');
      const year = searchParams.get('year');
      const scope = searchParams.get('scope');
      const q = searchParams.get('q');

      let query = {};
      if (district && district !== 'all') query.district = district;
      if (q) query.title = { $regex: q, $options: 'i' };

      let tenders = await db.collection('tenders')
        .find(query)
        .project({ pdf_base64: 0 }) 
        .sort({ last_date: -1 })
        .toArray();

      if (month && year && scope !== 'all') {
        tenders = tenders.filter(t => {
          if (!t.last_date) return false;
          const d = new Date(t.last_date);
          return d.getMonth() + 1 === parseInt(month) && d.getFullYear() === parseInt(year);
        });
      }
      return json({ tenders });
    }

    // 4. CALENDAR
    if (path === 'tenders/calendar' || path === 'api/tenders/calendar') {
      const month = parseInt(searchParams.get('month'));
      const year = parseInt(searchParams.get('year'));
      const tenders = await db.collection('tenders').find({}).project({ pdf_base64: 0 }).toArray();
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

    // 5. ACCESS CHECK
    if (path === 'access' || path === 'api/access') {
      const email = searchParams.get('email');
      if (!email) return json({ subscription: null });
      const user = await db.collection('users').findOne({ email: email.toLowerCase() });
      
      const now = new Date();
      if (user?.subscription?.status === 'active' && user?.subscription?.expires_at) {
         const expiry = new Date(user.subscription.expires_at);
         if (expiry < now) user.subscription.status = 'expired';
      }
      return json({ subscription: user?.subscription || null });
    }

    // 6. PDF FETCH
    if (pathArray.length === 3 && (pathArray[0] === 'tenders' || pathArray[0] === 'api') && pathArray[2] === 'pdf') {
      const tenderId = pathArray[1];
      const email = searchParams.get('email');
      if (!email) return json({ error: 'Email required' }, 400);

      const user = await db.collection('users').findOne({ email: email.toLowerCase() });
      
      let hasSubscription = false;
      const now = new Date();
      if (user?.subscription?.status === 'active' && user?.subscription?.expires_at) {
          const expiry = new Date(user.subscription.expires_at);
          if (expiry > now) hasSubscription = true;
      }
      
      const hasBoughtSingle = user?.purchases?.includes(tenderId);
      if (!hasSubscription && !hasBoughtSingle) return json({ error: 'Payment required' }, 402);

      const tender = await db.collection('tenders').findOne({ _id: new ObjectId(tenderId) });
      if (!tender || !tender.pdf_base64) return json({ error: 'PDF not found' }, 404);

      return json({
         pdf_base64: tender.pdf_base64,
         pdf_filename: tender.pdf_filename || 'tender_document.pdf',
         title: tender.title,
         watermarked: true
      });
    }

    // 7. GET TICKETS (SLA System) --> NEWLY ADDED
    if (path === 'tickets' || path === 'api/tickets') {
      const email = searchParams.get('email');
      const role = searchParams.get('role'); // admin can see all
      let query = {};
      if (email && role !== 'admin') query.client_email = email.toLowerCase();
      
      const tickets = await db.collection('tickets').find(query).sort({ created_at: -1 }).toArray();
      return json({ tickets });
    }

    // 8. MY ACCOUNT DATA FIX (/api/me) --> UPDATED WITH PROFILE FIELDS
    if (path === 'me' || path === 'api/me') {
      const email = searchParams.get('email');
      if (!email) return json({ error: 'Email required' }, 400);

      const user = await db.collection('users').findOne({ email: email.toLowerCase() });
      if (!user) return json({ subscription: null, unlocked_tenders: [], payments: [], profile: null });

      let unlocked_tenders = [];
      if (user.purchases && user.purchases.length > 0) {
        const objectIds = user.purchases.map(id => {
          try { return new ObjectId(id); } catch(e) { return id; }
        });
        
        const tendersData = await db.collection('tenders')
          .find({ _id: { $in: objectIds } })
          .project({ title: 1, department: 1, district: 1 })
          .toArray();
        
        unlocked_tenders = tendersData.map(t => ({
          id: t._id.toString(),
          title: t.title,
          department: t.department,
          district: t.district
        }));
      }

      const payments = await db.collection('payments')
        .find({ email: email.toLowerCase(), status: 'SUCCESS' })
        .sort({ paid_at: -1 })
        .toArray();

      return json({
        subscription: user.subscription || null,
        unlocked_tenders: unlocked_tenders,
        payments: payments,
        auto_renew: user.auto_renew !== false,
        profile: {
          service_category: user.service_category || '',
          documents: user.documents || [],
          profile_score: user.profile_score || 0
        }
      });
    }

    return json({ error: 'GET endpoint not found', path }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: 'Server Error' }, 500);
  }
}

// =====================================================================
// POST REQUESTS
// =====================================================================
export async function POST(request, { params }) {
  const db = await getDb();
  const pathArray = params?.path || [];
  const path = pathArray.join('/');

  try {
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON body or file too large' }, 400);

    if (path === 'admin/login' || path === 'api/admin/login') {
      if (!body.email || !body.password) return json({ error: 'Credentials required' }, 400);
      if (body.email === process.env.ADMIN_EMAIL && body.password === process.env.ADMIN_PASSWORD) {
        return json({ token: process.env.ADMIN_TOKEN || 'admin_success' });
      }
      return json({ error: 'Invalid credentials' }, 401);
    }

    if (path === 'tenders' || path === 'api/tenders' || path === 'admin/tenders' || path === 'api/admin/tenders') {
      const newTender = { 
        ...body, 
        created_at: new Date() 
      };
      const result = await db.collection('tenders').insertOne(newTender);
      return json({ success: true, message: 'Tender published successfully', id: result.insertedId });
    }

    if (path === 'settings' || path === 'api/settings') {
      await db.collection('settings').updateOne({ id: 'brand' }, { $set: { ...body, updated_at: new Date() } }, { upsert: true });
      return json({ success: true });
    }

    if (path === 'users' || path === 'api/users') {
      if (body.email) {
        const email = body.email.toLowerCase();
        await db.collection('users').updateOne({ email }, { $set: { email, name: body.name || '', last_login: new Date() } }, { upsert: true });
      }
      return json({ success: true });
    }

    if (path === 'subscription/cancel' || path === 'api/subscription/cancel') {
      if (!body.email) return json({ error: 'Email required' }, 400);
      await db.collection('users').updateOne(
        { email: body.email.toLowerCase() },
        { $set: { 'subscription.status': 'cancelled_pending', auto_renew: false } }
      );
      return json({ success: true, message: 'Auto-renewal cancelled successfully.' });
    }

    // NEWLY ADDED --> CREATE TICKET (SLA Ticketing System)
    if (path === 'tickets' || path === 'api/tickets') {
      const { email, department, subject, message } = body;
      const createdAt = new Date();
      const deadline = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000); // 24 Hours SLA Timer
      
      const newTicket = {
        client_email: email.toLowerCase(),
        department: department,
        subject: subject,
        message: message,
        status: 'OPEN', // OPEN, RESOLVED, ESCALATED
        created_at: createdAt,
        sla_deadline: deadline,
        reply: null,
        replied_by: null,
        replied_at: null
      };
      
      const result = await db.collection('tickets').insertOne(newTicket);
      return json({ success: true, message: 'Ticket raised successfully. Our team will reply within 24 hours.', id: result.insertedId });
    }

    // NEWLY ADDED --> REPLY TO TICKET (Admin action)
    if (path === 'tickets/reply' || path === 'api/tickets/reply') {
      const { ticket_id, reply, admin_email } = body;
      await db.collection('tickets').updateOne(
        { _id: new ObjectId(ticket_id) },
        { $set: { status: 'RESOLVED', reply: reply, replied_by: admin_email, replied_at: new Date() } }
      );
      return json({ success: true, message: 'Ticket Resolved.' });
    }

    // NEWLY ADDED --> UPDATE CLIENT PROFILE (Onboarding)
    if (path === 'users/profile' || path === 'api/users/profile') {
      const { email, service_category, document_name, expiry_date, file_url } = body;
      
      let score = 20; // Base score
      if (service_category) score += 30;
      
      let updateData = { service_category: service_category };
      
      if (document_name) {
        score += 50; 
        await db.collection('users').updateOne(
          { email: email.toLowerCase() },
          { 
            $push: { documents: { name: document_name, url: file_url, expiry: new Date(expiry_date) } },
            $set: { profile_score: score }
          }
        );
      } else {
        await db.collection('users').updateOne(
          { email: email.toLowerCase() },
          { $set: { ...updateData, profile_score: score } }
        );
      }
      return json({ success: true, message: 'Profile updated' });
    }

    // CASHFREE PAYMENT LOGIC (KEPT EXACTLY AS IT WAS)
    if (path === 'payment/order' || path === 'api/payment/order' || path === 'subscription/create' || path === 'api/subscription/create') {
      const plan = body.plan;
      let amount = 12; 
      if (plan === 'month') amount = 149;
      if (plan === 'year') amount = 1499;

      const orderId = 'order_' + Date.now();
      const customerId = body.email ? body.email.replace(/[^a-zA-Z0-9]/g, '').substring(0, 50) : 'cust_' + Date.now();
      const appId = process.env.CASHFREE_APP_ID;
      const secretKey = process.env.CASHFREE_SECRET_KEY;
      
      if (!appId || !secretKey) return json({ error: 'Keys missing' }, 500);

      try {
        const cashfreeResponse = await fetch('https://api.cashfree.com/pg/orders', {
          method: 'POST',
          headers: { 'x-client-id': appId, 'x-client-secret': secretKey, 'x-api-version': '2023-08-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_amount: amount, order_currency: 'INR', order_id: orderId,
            customer_details: { customer_id: customerId, customer_email: body.email || 'guest@example.com', customer_phone: '9999999999' },
            order_meta: { return_url: "https://www.tgtenders.in/payment-status?order_id={order_id}" }
          })
        });

        const data = await cashfreeResponse.json();
        if (data.payment_session_id) {
          await db.collection('payments').insertOne({
             order_id: orderId, email: body.email, amount: amount, plan: plan,
             tenderId: body.tenderId || null, status: 'PENDING', created_at: new Date()
          });
          return json({ payment_session_id: data.payment_session_id });
        } else {
          return json({ error: data.message || 'Rejected' }, 400);
        }
      } catch (err) {
        return json({ error: 'Cashfree Error' }, 500);
      }
    }

    // CASHFREE VERIFY LOGIC (KEPT EXACTLY AS IT WAS)
    if (path === 'payment/verify' || path === 'api/payment/verify') {
      const orderId = body.order_id;
      if (!orderId) return json({ error: 'Missing ID' }, 400);
      const appId = process.env.CASHFREE_APP_ID;
      const secretKey = process.env.CASHFREE_SECRET_KEY;

      try {
        const cfRes = await fetch(`https://api.cashfree.com/pg/orders/${orderId}`, {
          method: 'GET',
          headers: { 'x-client-id': appId, 'x-client-secret': secretKey, 'x-api-version': '2023-08-01' }
        });
        const cfData = await cfRes.json();

        if (cfData.order_status === 'PAID') {
          const paymentRecord = await db.collection('payments').findOne({ order_id: orderId });
          if (paymentRecord && paymentRecord.status !== 'SUCCESS') {
            await db.collection('payments').updateOne({ order_id: orderId }, { $set: { status: 'SUCCESS', paid_at: new Date() } });
            const email = paymentRecord.email.toLowerCase();
            
            if (paymentRecord.plan === 'single' && paymentRecord.tenderId) {
              await db.collection('users').updateOne({ email }, { $addToSet: { purchases: paymentRecord.tenderId } }, { upsert: true });
            } else if (paymentRecord.plan === 'month' || paymentRecord.plan === 'year') {
              const days = paymentRecord.plan === 'year' ? 365 : 30;
              const expireDate = new Date();
              expireDate.setDate(expireDate.getDate() + days);
              await db.collection('users').updateOne({ email }, { $set: { subscription: { status: 'active', plan: paymentRecord.plan, expires_at: expireDate } } }, { upsert: true });
            }
          }
          return json({ success: true, message: 'Verified', tenderId: paymentRecord?.tenderId });
        } else {
          return json({ success: false, error: 'Not paid' }, 400);
        }
      } catch (err) {
        return json({ error: 'Verify failed' }, 500);
      }
    }

    return json({ error: 'POST not found', path }, 404);
  } catch (error) {
    console.error('Server POST Error:', error);
    return json({ error: 'Server Error' }, 500);
  }
}
