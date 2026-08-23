import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';
import { google } from 'googleapis'; // 🚀 NEW: Google API Import

// 🚀 STRICT RULES: భవిష్యత్తులో ఎప్పుడూ డేటా కాష్ (Cache) అవ్వకుండా కఠినమైన సెట్టింగ్స్
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

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

// 🚀 STRICT RULE 3: ప్రతీ API రెస్పాన్స్ కి No-Cache హెడర్స్ పంపడం
function json(data, status = 200) {
  return NextResponse.json(data, { 
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    }
  });
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
      // 🔥 FIX: Count only properly pending users for Admin Dashboard
      const usersCount = await db.collection('users').countDocuments({ status: 'pending', is_approved: { $ne: true } });
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

    // 7. GET TICKETS (SLA System)
    if (path === 'tickets' || path === 'api/tickets') {
      const email = searchParams.get('email');
      const role = searchParams.get('role'); // admin can see all
      let query = {};
      if (email && role !== 'admin') query.client_email = email.toLowerCase();
      
      const tickets = await db.collection('tickets').find(query).sort({ created_at: -1 }).toArray();
      return json({ tickets });
    }

    // 8. GET PENDING USERS (For Admin Approvals)
    if (path === 'users/pending' || path === 'api/users/pending') {
      const users = await db.collection('users')
         .find({ status: 'pending', is_approved: { $ne: true } })
         .sort({ created_at: -1 })
         .toArray();
      return json({ users });
    }

    // 🚀 NEW 9. CLIENT REQUESTS (For MD/Employee Dashboard)
    if (path === 'client-requests' || path === 'api/client-requests') {
      const email = searchParams.get('email');
      let query = {};
      if (email) query.client_email = email.toLowerCase(); // Fetch specific client requests if email is passed
      
      const requests = await db.collection('client_requests').find(query).sort({ created_at: -1 }).toArray();
      return json({ requests });
    }

    // 🚀 NEW 10. MD DISPATCHES (Alerts & Tasks)
    if (path === 'dispatches' || path === 'api/dispatches') {
      const targetId = searchParams.get('target_id');
      let query = {};
      if (targetId) query.target_id = { $regex: new RegExp(`^${targetId}$`, 'i') }; 
      
      const dispatches = await db.collection('dispatches').find(query).sort({ created_at: -1 }).toArray();
      return json({ dispatches });
    }

    // 🚀 NEW 11. GOVT OFFICERS DIRECTORY
    if (path === 'gov-officers' || path === 'api/gov-officers') {
      const officers = await db.collection('gov_officers').find({}).sort({ created_at: -1 }).toArray();
      return json({ officers });
    }

    // 🚀 NEW 12. ACTIVE BIDS TRACKER
    if (path === 'bids' || path === 'api/bids') {
      const clientEmail = searchParams.get('client_email');
      let query = {};
      if (clientEmail) query.client_email = clientEmail.toLowerCase();
      
      const bids = await db.collection('bids').find(query).sort({ created_at: -1 }).toArray();
      return json({ bids });
    }

    // 13. MY ACCOUNT DATA (/api/me)
    if (path === 'me' || path === 'api/me') {
      const email = searchParams.get('email');
      if (!email) return json({ error: 'Email required' }, 400);

      const user = await db.collection('users').findOne({ email: email.toLowerCase() });
      if (!user) return json({ subscription: null, unlocked_tenders: [], payments: [], profile: null, is_approved: false });

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

      // Load their specific requests and bids directly into the /me endpoint
      const custom_requests = await db.collection('client_requests').find({ client_email: email.toLowerCase() }).sort({ created_at: -1 }).toArray();
      const active_bids = await db.collection('bids').find({ client_email: email.toLowerCase() }).sort({ created_at: -1 }).toArray();
      const action_alerts = await db.collection('dispatches').find({ target_type: 'client_alert', target_id: user.email }).sort({ created_at: -1 }).toArray();

      return json({
        subscription: user.subscription || null,
        unlocked_tenders: unlocked_tenders,
        payments: payments,
        auto_renew: user.auto_renew !== false,
        onboarding_complete: user.onboarding_complete || false,
        is_approved: user.is_approved || false,
        profile: {
          company_type: user.company_type || '',
          has_gst: user.has_gst || false,
          has_msme: user.has_msme || false,
          has_iso: user.has_iso || false,
          client_name: user.client_name || '',
          company_name: user.company_name || '',
          phone: user.phone || '',
          address: user.address || '',
          service_category: user.service_category || '',
          documents: user.documents || {},
          profile_score: user.profile_score || 0
        },
        action_alerts: action_alerts || [],
        emd_ledger: user.emd_ledger || [],
        tender_workspaces: user.tender_workspaces || [],
        custom_requests: custom_requests || [],
        active_bids: active_bids || [],
        officer_queries: user.officer_queries || [],
        pending_payments: user.pending_payments || []
      });
    }

    return json({ error: 'GET endpoint not found', path }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: 'Server Error' }, 500);
  }
}

// =====================================================================
// PUT REQUESTS (Updating Data)
// =====================================================================
export async function PUT(request, { params }) {
  const db = await getDb();
  const pathArray = params?.path || [];
  const path = pathArray.join('/');
  
  try {
     const body = await request.json().catch(() => null);
     if (!body) return json({ error: 'Invalid JSON body' }, 400);

     if (pathArray.length === 2 && (pathArray[0] === 'tenders' || pathArray[0] === 'api')) {
        const tenderId = pathArray[1];
        await db.collection('tenders').updateOne(
           { _id: new ObjectId(tenderId) },
           { $set: { l1_price: body.l1_price, l1_winner: body.l1_winner } }
        );
        return json({ success: true, message: 'L1 Price Updated' });
     }

     // 🚀 NEW: Update Client Request Status (MD / Employee updating Client Request)
     if (path === 'client-requests/reply' || path === 'api/client-requests/reply') {
        const { req_id, status, reply } = body;
        await db.collection('client_requests').updateOne(
           { _id: new ObjectId(req_id) },
           { $set: { status, reply, updated_at: new Date() } }
        );
        return json({ success: true, message: 'Request Updated' });
     }

     // 🚀 NEW: Update Bid Status (Employee updating Kanban)
     if (path === 'bids/update' || path === 'api/bids/update') {
        const { bid_id, status } = body;
        await db.collection('bids').updateOne(
           { _id: new ObjectId(bid_id) },
           { $set: { status, updated_at: new Date() } }
        );
        return json({ success: true });
     }

     // 🚀 NEW: Update Task Status (Employee marking MD task as Done)
     if (path === 'dispatches/complete' || path === 'api/dispatches/complete') {
        const { task_id } = body;
        await db.collection('dispatches').updateOne(
           { _id: new ObjectId(task_id) },
           { $set: { status: 'Completed', completed_at: new Date() } }
        );
        return json({ success: true });
     }

     return json({ error: 'PUT endpoint not found' }, 404);
  } catch(e) {
     return json({ error: 'Server Error' }, 500);
  }
}

// =====================================================================
// POST REQUESTS (Creating Data)
// =====================================================================
export async function POST(request, { params }) {
  const db = await getDb();
  const pathArray = params?.path || [];
  const path = pathArray.join('/');

  try {
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);

    if (path === 'admin/login' || path === 'api/admin/login') {
      if (!body.email || !body.password) return json({ error: 'Credentials required' }, 400);
      if (body.email === process.env.ADMIN_EMAIL && body.password === process.env.ADMIN_PASSWORD) {
        return json({ token: process.env.ADMIN_TOKEN || 'admin_success' });
      }
      return json({ error: 'Invalid credentials' }, 401);
    }

    if (path === 'tenders' || path === 'api/tenders' || path === 'admin/tenders' || path === 'api/admin/tenders') {
      const newTender = { ...body, created_at: new Date() };
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

    // SLA Ticketing System
    if (path === 'tickets' || path === 'api/tickets') {
      const { email, department, subject, message } = body;
      const createdAt = new Date();
      const deadline = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000); 
      
      const newTicket = {
        client_email: email.toLowerCase(), department, subject, message,
        status: 'OPEN', created_at: createdAt, sla_deadline: deadline, reply: null
      };
      const result = await db.collection('tickets').insertOne(newTicket);
      return json({ success: true, message: 'Ticket raised successfully.', id: result.insertedId });
    }

    if (path === 'tickets/reply' || path === 'api/tickets/reply') {
      const { ticket_id, reply, admin_email } = body;
      await db.collection('tickets').updateOne(
        { _id: new ObjectId(ticket_id) },
        { $set: { status: 'RESOLVED', reply: reply, replied_by: admin_email, replied_at: new Date() } }
      );
      return json({ success: true, message: 'Ticket Resolved.' });
    }

    // ONBOARDING SUBMIT
    if (path === 'users/profile' || path === 'api/users/profile') {
      const { 
        email, client_name, company_name, company_type, phone, address, 
        service_category, has_gst, has_msme, has_iso, documents, status 
      } = body;
      
      await db.collection('users').updateOne(
        { email: email.toLowerCase() },
        { $set: { 
            company_type, has_gst, has_msme, has_iso,
            client_name, company_name, phone, address, service_category, 
            documents: documents || {}, status: status || 'pending', 
            onboarding_complete: true, profile_score: 80 
          } 
        }, 
        { upsert: true }
      );
      return json({ success: true });
    }

    if (path === 'users/approve' || path === 'api/users/approve') {
      const { email } = body;
      await db.collection('users').updateOne(
        { email: email.toLowerCase() },
        { $set: { is_approved: true, status: 'approved' } }
      );
      return json({ success: true });
    }

    if (path === 'users/request-payment' || path === 'api/users/request-payment') {
       const { email, amount, reason } = body;
       await db.collection('users').updateOne(
         { email: email.toLowerCase() },
         { $push: { pending_payments: { amount, reason, date: new Date(), status: 'UNPAID' } } }
       );
       return json({ success: true });
    }

    // 🚀 NEW: Create Client Bid Request (Client -> MD)
    if (path === 'client-requests' || path === 'api/client-requests') {
       const { client_email, client_id, link_or_id, description } = body;
       const result = await db.collection('client_requests').insertOne({
          client_email: client_email.toLowerCase(), client_id, link_or_id, description,
          status: 'Pending Officer Review', reply: '', created_at: new Date()
       });
       return json({ success: true, id: result.insertedId });
    }

    // 🚀 NEW: Create Dispatch Task/Alert (MD -> Client/Employee)
    if (path === 'dispatches' || path === 'api/dispatches') {
       const { target_type, target_id, subject, message } = body;
       const result = await db.collection('dispatches').insertOne({
          target_type, target_id, subject, message, status: 'Sent', created_at: new Date()
       });
       return json({ success: true, id: result.insertedId });
    }

    // 🚀 NEW: Log Government Officer (Employee -> MD)
    if (path === 'gov-officers' || path === 'api/gov-officers') {
       const result = await db.collection('gov_officers').insertOne({
          ...body, created_at: new Date()
       });
       return json({ success: true, id: result.insertedId });
    }

    // 🚀 NEW: Create New Bid (Employee -> Client)
    if (path === 'bids' || path === 'api/bids') {
       const result = await db.collection('bids').insertOne({
          ...body, status: 'Doc Preparation', created_at: new Date()
       });
       return json({ success: true, id: result.insertedId });
    }

   // 🚀 NEW: Employee Activity & Attendance Logger
    if (path === 'employee/activity' || path === 'api/employee/activity') {
       const { email, action, details } = body;
       await db.collection('employee_logs').insertOne({
          email: email.toLowerCase(),
          action,
          details,
          timestamp: new Date()
       });
       return json({ success: true });
    }

    // 🚀 NEW: Google Drive Auto-Folder Creation
    if (path === 'drive/create-folder' || path === 'api/drive/create-folder') {
       const { folderName, email } = body;
       
       if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
          return json({ error: 'Google Drive Keys missing in Vercel Environment Variables' }, 500);
       }

       try {
          // 1. Google తో అథెంటికేట్ అవ్వడం
          const auth = new google.auth.JWT(
             process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
             null,
             process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Fix for .env newline characters
             ['https://www.googleapis.com/auth/drive.file'] // Scope for Drive access
          );
          const drive = google.drive({ version: 'v3', auth });
          
          // 2. ఫోల్డర్ సెటప్
          const fileMetadata = {
             name: folderName || `Client - ${email}`, // ఫోల్డర్ పేరు
             mimeType: 'application/vnd.google-apps.folder',
          };
          
          // 3. ఫోల్డర్ క్రియేట్ చేయడం
          const folder = await drive.files.create({
             resource: fileMetadata,
             fields: 'id, webViewLink'
          });
          
          // 4. డేటాబేస్ లో యూజర్ కి ఆ ఫోల్డర్ లింక్ సేవ్ చేయడం
          if (email) {
             await db.collection('users').updateOne(
                { email: email.toLowerCase() },
                { $set: { drive_folder_id: folder.data.id, drive_folder_link: folder.data.webViewLink } }
             );
          }

          return json({ success: true, folderId: folder.data.id, folderLink: folder.data.webViewLink });
       } catch (error) {
          console.error('Drive API Error:', error);
          return json({ error: 'Failed to create Google Drive folder' }, 500);
       }
    }

    // CASHFREE PAYMENT LOGIC
    if (path === 'payment/order' || path === 'api/payment/order') {
      const plan = body.plan;
      let amount = 12; 
      if (plan === 'month') amount = 14900;
      if (plan === 'year') amount = 149900;
      if (plan === 'single') amount = 1000;

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
            order_amount: amount/100, order_currency: 'INR', order_id: orderId,
            customer_details: { customer_id: customerId, customer_email: body.email || 'guest@example.com', customer_phone: '9999999999' },
            order_meta: { return_url: "https://www.tgtenders.in/payment-status?order_id={order_id}" }
          })
        });

        const data = await cashfreeResponse.json();
        if (data.payment_session_id) {
          await db.collection('payments').insertOne({
             order_id: orderId, email: body.email, amount: amount/100, plan: plan,
             tenderId: body.tenderId || null, status: 'PENDING', created_at: new Date()
          });
          return json({ payment_session_id: data.payment_session_id, order: { id: orderId, amount: amount } });
        } else {
          return json({ error: data.message || 'Rejected' }, 400);
        }
      } catch (err) {
        return json({ error: 'Cashfree Error' }, 500);
      }
    }

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
// 🚀 NEW: Cashfree Background Webhook Security
    if (path === 'payment/webhook' || path === 'api/payment/webhook') {
       try {
         // Cashfree సర్వర్ పంపే డేటాను రిసీవ్ చేసుకోవడం
         const orderId = body?.data?.order?.order_id;
         const paymentStatus = body?.data?.payment?.payment_status;

         if (orderId && paymentStatus === 'SUCCESS') {
            // ఆ ఆర్డర్ ఐడీ మన డేటాబేస్ లో ఉందో లేదో చెక్ చేయడం
            const paymentRecord = await db.collection('payments').findOne({ order_id: orderId });
            
            if (paymentRecord && paymentRecord.status !== 'SUCCESS') {
               // యూజర్ కి తెలియకుండానే బ్యాక్ గ్రౌండ్ లో పేమెంట్ సక్సెస్ చేయడం
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
         }
         return json({ success: true, message: 'Webhook Processed Successfully' });
       } catch (error) {
         console.error('Webhook processing error:', error);
         return json({ error: 'Webhook Error' }, 500);
       }
    }
    return json({ error: 'POST not found', path }, 404);
  } catch (error) {
    console.error('Server POST Error:', error);
    return json({ error: 'Server Error' }, 500);
  }
}
