import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';
import { google } from 'googleapis'; // 🚀 Google Drive Integration

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

// 🚀 STRICT RULE: ప్రతీ API రెస్పాన్స్ కి No-Cache హెడర్స్ పంపడం
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

// 🚀 FIX: CORS మరియు Preflight ఇష్యూస్ ని బ్లాక్ చేయడానికి OPTIONS మెథడ్
export async function OPTIONS(request) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
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
    if (path === 'admin/stats' || path === 'api/admin/stats') {
      const tendersCount = await db.collection('tenders').countDocuments();
      const usersCount = await db.collection('users').countDocuments({ is_approved: { $ne: true }, onboarding_complete: true });
      const paymentsCount = await db.collection('payments').countDocuments({ status: 'SUCCESS' });
      const successfulPayments = await db.collection('payments').find({ status: 'SUCCESS' }).toArray();
      const totalRevenue = successfulPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      return json({ tenders: tendersCount, users: usersCount, payments: paymentsCount, revenue: totalRevenue });
    }

    if (path === 'settings' || path === 'api/settings') {
      const settings = await db.collection('settings').findOne({ id: 'brand' });
      return json({ settings: settings || { name: 'Telangana Tenders', logo: null } });
    }

    if (path === 'tenders' || path === 'api/tenders') {
      const district = searchParams.get('district');
      const month = searchParams.get('month');
      const year = searchParams.get('year');
      const scope = searchParams.get('scope');
      const q = searchParams.get('q');

      let query = {};
      if (district && district !== 'all') query.district = district;
      if (q) query.title = { $regex: q,$options: 'i' };

      // 🚀 FIX: Auto-Hide/Delete Expired Tenders from interface
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let allTenders = await db.collection('tenders')
        .find(query)
        .project({ pdf_base64: 0 }) 
        .sort({ last_date: -1 })
        .toArray();

      let tenders = allTenders.filter(t => {
          if (!t.last_date) return true;
          return new Date(t.last_date).getTime() >= today.getTime();
      });

      if (month && year && scope !== 'all') {
        tenders = tenders.filter(t => {
          if (!t.last_date) return false;
          const d = new Date(t.last_date);
          return d.getMonth() + 1 === parseInt(month) && d.getFullYear() === parseInt(year);
        });
      }
      return json({ tenders });
    }

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

    if (pathArray.length === 3 && (pathArray[0] === 'tenders' || pathArray[0] === 'api') && pathArray[2] === 'pdf') {
      const tenderId = pathArray[1];
      const email = searchParams.get('email');
      const role = searchParams.get('role');
      const format = searchParams.get('format'); 

      if (!email) return json({ error: 'Email required' }, 400);

      const user = await db.collection('users').findOne({ email: email.toLowerCase() });
      
      let hasSubscription = false;
      const now = new Date();
      if (user?.subscription?.status === 'active' && user?.subscription?.expires_at) {
          const expiry = new Date(user.subscription.expires_at);
          if (expiry > now) hasSubscription = true;
      }
      
      const hasBoughtSingle = user?.purchases?.includes(tenderId);

      // 🚀 FIX: Give free access to Clients as well
      if (role === 'client' || role === 'employee' || role === 'admin' || email === 'employee@tgtenders.in' || email === process.env.ADMIN_EMAIL) {
          hasSubscription = true; 
      }

      if (!hasSubscription && !hasBoughtSingle) return json({ error: 'Payment required' }, 402);

      const tender = await db.collection('tenders').findOne({ _id: new ObjectId(tenderId) });
      if (!tender || !tender.pdf_base64) return json({ error: 'PDF not found' }, 404);

      if (format === 'json') {
          return json({
             pdf_base64: tender.pdf_base64,
             pdf_filename: tender.pdf_filename || 'tender_document.pdf',
             title: tender.title,
             watermarked: true
          });
      } else {
          try {
             const pdfBuffer = Buffer.from(tender.pdf_base64, 'base64');
             return new NextResponse(pdfBuffer, {
                 status: 200,
                 headers: {
                     'Content-Type': 'application/pdf',
                     'Content-Disposition': `inline; filename="${tender.pdf_filename || 'tender_document.pdf'}"`,
                     'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
                 }
             });
          } catch(err) {
             return json({ error: 'Failed to parse PDF Data' }, 500);
          }
      }
    }

    if (path === 'tickets' || path === 'api/tickets') {
      const email = searchParams.get('email');
      const role = searchParams.get('role');
      let query = {};
      if (email && role !== 'admin') query.client_email = email.toLowerCase();
      
      const tickets = await db.collection('tickets').find(query).sort({ created_at: -1 }).toArray();
      return json({ tickets });
    }

    // 🚀 FIX: Fetch Guest Queries Database
    if (path === 'guest-queries' || path === 'api/guest-queries') {
      const queries = await db.collection('guest_queries').find({}).sort({ created_at: -1 }).toArray();
      return json({ queries });
    }

    if (path === 'users/pending' || path === 'api/users/pending') {
      const users = await db.collection('users')
         .find({ is_approved: { $ne: true }, onboarding_complete: true })
         .sort({ created_at: -1 })
         .toArray();
      return json({ users });
    }

    if (path === 'users/approved' || path === 'api/users/approved') {
      const users = await db.collection('users')
         .find({ is_approved: true })
         .sort({ created_at: -1 })
         .toArray();
      return json({ users });
    }

    if (path === 'client-requests' || path === 'api/client-requests') {
      const email = searchParams.get('email');
      let query = {};
      if (email) query.client_email = email.toLowerCase(); 
      const requests = await db.collection('client_requests').find(query).sort({ created_at: -1 }).toArray();
      return json({ requests });
    }

    if (path === 'dispatches' || path === 'api/dispatches') {
      const targetId = searchParams.get('target_id');
      let query = {};
      if (targetId) query.target_id = { $regex: new RegExp(`^${targetId}$`, 'i') }; 
      const dispatches = await db.collection('dispatches').find(query).sort({ created_at: -1 }).toArray();
      return json({ dispatches });
    }

    if (path === 'gov-officers' || path === 'api/gov-officers') {
      const officers = await db.collection('gov_officers').find({}).sort({ created_at: -1 }).toArray();
      return json({ officers });
    }

    if (path === 'bids' || path === 'api/bids') {
      const clientEmail = searchParams.get('client_email');
      let query = {};
      if (clientEmail) query.client_email = clientEmail.toLowerCase();
      const bids = await db.collection('bids').find(query).sort({ created_at: -1 }).toArray();
      return json({ bids });
    }

    if (path === 'employees' || path === 'api/employees') {
      const team = await db.collection('employees').find({}).sort({ created_at: -1 }).toArray();
      return json({ team });
    }

    if (path === 'finance/ledger' || path === 'api/finance/ledger') {
      const transactions = await db.collection('finance_ledger').find({}).sort({ created_at: -1 }).toArray();
      const totalCredit = transactions.filter(t => t.type === 'CREDIT').reduce((sum, t) => sum + Number(t.amount), 0);
      const totalDebit = transactions.filter(t => t.type === 'DEBIT').reduce((sum, t) => sum + Number(t.amount), 0);
      return json({ transactions, balance: totalCredit - totalDebit });
    }

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

      const custom_requests = await db.collection('client_requests').find({ client_email: email.toLowerCase() }).sort({ created_at: -1 }).toArray();
      const active_bids = await db.collection('bids').find({ client_email: email.toLowerCase() }).sort({ created_at: -1 }).toArray();
      const action_alerts = await db.collection('dispatches').find({ target_type: 'client_alert', target_id: user.email }).sort({ created_at: -1 }).toArray();

       // 🚀 FIX: Calculate Contract Values and add to Total Revenue
       const won_bids = active_bids.filter(b => b.status === 'Won');
       const won_contracts_value = won_bids.reduce((sum, b) => {
           const val = Number(String(b.contract_value || '0').replace(/[^0-9.-]+/g,""));
           return sum + val;
       }, 0);
       const total_revenue = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) + won_contracts_value;

       const calculatedStats = {
          recommended: action_alerts.filter(a => a.subject.includes('Suggestion') && a.status !== 'Completed').length,
          participated: active_bids.length,
          ongoing: active_bids.filter(b => b.status !== 'Won' && b.status !== 'Lost').length,
          won: won_bids.length,
          lost: active_bids.filter(b => b.status === 'Lost').length,
          revenue: total_revenue
       };
      
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
        pending_payments: user.pending_payments || [],
        vault_docs: user.vault_docs || [], 
        stats: calculatedStats 
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
        let updateFields = { ...body, updated_at: new Date() };
        delete updateFields._id; 

        await db.collection('tenders').updateOne(
           { _id: new ObjectId(tenderId) },
           { $set: updateFields }
        );
        return json({ success: true, message: 'Tender Updated' });
     }

     if (path === 'client-requests/reply' || path === 'api/client-requests/reply') {
        const { req_id, status, reply } = body;
        await db.collection('client_requests').updateOne(
           { _id: new ObjectId(req_id) },
           { $set: { status, reply, updated_at: new Date() } }
        );
        return json({ success: true, message: 'Request Updated' });
     }

     if (path === 'client-requests/assign' || path === 'api/client-requests/assign') {
        const { req_id, emp_id, emp_name, status, reply } = body;
        
        await db.collection('client_requests').updateOne(
           { _id: new ObjectId(req_id) },
           { $set: { status: `Assigned to ${emp_name} (${emp_id})`, reply, updated_at: new Date() } }
        );

        const reqData = await db.collection('client_requests').findOne({ _id: new ObjectId(req_id) });
        if (reqData) {
            await db.collection('dispatches').insertOne({
                target_type: 'employee_task',
                target_id: emp_id, 
                subject: `Assigned Task: Client ${reqData.client_email}`,
                message: reply || reqData.description,
                status: 'Sent',
                priority: 'High',
                created_at: new Date()
            });
        }
        return json({ success: true, message: 'Assigned successfully' });
     }

     if (path === 'bids/update' || path === 'api/bids/update') {
        const { bid_id, status, bid_no, description, contract_value, validity } = body;
        let updateData = { updated_at: new Date() };
        if (status) updateData.status = status;
        if (bid_no !== undefined) updateData.bid_no = bid_no;
        if (description !== undefined) updateData.description = description;
        if (contract_value !== undefined) updateData.contract_value = contract_value;
        if (validity !== undefined) updateData.validity = validity;

        await db.collection('bids').updateOne(
           { _id: new ObjectId(bid_id) },
           { $set: updateData }
        );
        return json({ success: true });
     }

     if (path === 'dispatches/complete' || path === 'api/dispatches/complete') {
        const { task_id } = body;
        await db.collection('dispatches').updateOne(
           { _id: new ObjectId(task_id) },
           { $set: { status: 'Completed', completed_at: new Date() } }
        );
        return json({ success: true });
     }

     if (path === 'dispatches/update' || path === 'api/dispatches/update') {
        const { task_id, status, reply } = body;
        let updateData = { status: status, updated_at: new Date() };
        if(reply) updateData.client_reply = reply;

        await db.collection('dispatches').updateOne(
           { _id: new ObjectId(task_id) },
           { $set: updateData }
        );
        return json({ success: true, message: `Dispatch status updated to ${status}` });
     }

     // 🚀 FIX: Vault Document Approval + Auto Google Drive Sync
     if (path === 'vault/verify' || path === 'api/vault/verify') {
        const { email, docId, status, reject_reason } = body;
        const targetEmail = email.toLowerCase();
        
        await db.collection('users').updateOne(
            { email: targetEmail, "vault_docs.id": docId },
            { $set: { 
                "vault_docs.$.status": status,
                "vault_docs.$.reject_reason": reject_reason || null 
              } 
            }
        );

        // Push Document to Google Drive
        if (status === 'verified') {
            const user = await db.collection('users').findOne({ email: targetEmail });
            const doc = user?.vault_docs?.find(d => d.id === docId);
            
            if (user?.drive_folder_id && doc?.file_base64 && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
               try {
                   const auth = new google.auth.JWT(
                       process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, null,
                       process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                       ['https://www.googleapis.com/auth/drive.file']
                   );
                   const drive = google.drive({ version: 'v3', auth });
                   
                   const buffer = Buffer.from(doc.file_base64, 'base64');
                   const stream = require('stream');
                   const bufferStream = new stream.PassThrough();
                   bufferStream.end(buffer);

                   await drive.files.create({
                       requestBody: { name: doc.file_name || `${doc.name}.pdf`, parents: [user.drive_folder_id] },
                       media: { mimeType: 'application/pdf', body: bufferStream },
                       fields: 'id'
                   });
               } catch(err) {
                   console.error("Drive upload failed silently:", err);
               }
            }
        }
        return json({ success: true });
     }

     if (path === 'finance/ledger' || path === 'api/finance/ledger') {
        const { id, ...updateFields } = body;
        if (!id) return json({ error: 'Missing Transaction ID' }, 400);
        await db.collection('finance_ledger').updateOne(
            { _id: new ObjectId(id) },
            { $set: { ...updateFields, updated_at: new Date() } }
        );
        return json({ success: true, message: 'Ledger Entry Updated' });
     }

     if (path === 'payments/offline' || path === 'api/payments/offline') {
        const { id, amount, reason, client_id } = body;
        
        if (id) {
            await db.collection('payments').updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: 'SUCCESS_OFFLINE', paid_at: new Date() } }
            );
        }
        
        await db.collection('finance_ledger').insertOne({
            type: 'CREDIT',
            amount: Number(amount),
            reason: reason || 'Offline Payment Collected',
            client_id: client_id || 'N/A',
            payment_mode: 'OFFLINE',
            proof_base64: null,
            created_at: new Date()
        });
        
        return json({ success: true, message: 'Marked as Paid Offline and Added to Ledger' });
     }

     return json({ error: 'PUT endpoint not found' }, 404);
  } catch(e) {
     return json({ error: 'Server Error' }, 500);
  }
}

// =====================================================================
// DELETE REQUESTS 
// =====================================================================
export async function DELETE(request, { params }) {
  const db = await getDb();
  const pathArray = params?.path || [];
  const path = pathArray.join('/');
  const { searchParams } = new URL(request.url);
  
  try {
    if (path === 'users' || path === 'api/users') {
       const email = searchParams.get('email');
       if (!email) return json({ error: 'Missing Client Email' }, 400);

       const targetEmail = email.toLowerCase();

       await db.collection('users').deleteOne({ email: targetEmail });
       await db.collection('bids').deleteMany({ client_email: targetEmail });
       await db.collection('client_requests').deleteMany({ client_email: targetEmail });
       await db.collection('tickets').deleteMany({ client_email: targetEmail });
       await db.collection('dispatches').deleteMany({ target_id: targetEmail });
       
       return json({ success: true, message: 'Client and all associated data permanently wiped out.' });
    }

    // 🚀 FIX: Guest Queries Deletion Route
    if (path === 'guest-queries' || path === 'api/guest-queries') {
       const id = searchParams.get('id');
       if (!id) return json({ error: 'Missing ID' }, 400);
       await db.collection('guest_queries').deleteOne({ _id: new ObjectId(id) });
       return json({ success: true, message: 'Query resolved and deleted' });
    }

    if (pathArray.length === 2 && (pathArray[0] === 'tenders' || pathArray[0] === 'api')) {
      const id = pathArray[1];
      if (!id) return json({ error: 'Missing Tender ID' }, 400);

      const collection = db.collection('tenders');
      let result = null;

      if (ObjectId.isValid(id)) result = await collection.deleteOne({ _id: new ObjectId(id) });
      if (!result || result.deletedCount === 0) result = await collection.deleteOne({ _id: id });
      if (!result || result.deletedCount === 0) result = await collection.deleteOne({ id: id });

      if (result && result.deletedCount > 0) return json({ success: true, message: 'Tender deleted successfully' });
      else return json({ error: 'Tender not found in database' }, 404);
    }

    if (path === 'bids' || path === 'api/bids') {
      const id = searchParams.get('id');
      if (!id) return json({ error: 'Missing Bid ID' }, 400);

      const collection = db.collection('bids');
      let result = null;

      if (ObjectId.isValid(id)) result = await collection.deleteOne({ _id: new ObjectId(id) });
      if (!result || result.deletedCount === 0) result = await collection.deleteOne({ _id: id });
      if (!result || result.deletedCount === 0) result = await collection.deleteOne({ id: id });

      if (result && result.deletedCount > 0) return json({ success: true, message: 'Bid tracking removed' });
      else return json({ error: 'Bid not found' }, 404);
    }

    if (path === 'tickets' || path === 'api/tickets') {
      const id = searchParams.get('id');
      if (!id) return json({ error: 'Missing Ticket ID' }, 400);
      let result = null;
      if (ObjectId.isValid(id)) result = await db.collection('tickets').deleteOne({ _id: new ObjectId(id) });
      if (!result || result.deletedCount === 0) result = await db.collection('tickets').deleteOne({ _id: id });
      if (result && result.deletedCount > 0) return json({ success: true, message: 'Ticket deleted' });
      return json({ error: 'Ticket not found' }, 404);
    }

    if (path === 'employees' || path === 'api/employees') {
      const id = searchParams.get('id');
      if (!id) return json({ error: 'Missing Employee ID' }, 400);
      let result = null;
      if (ObjectId.isValid(id)) result = await db.collection('employees').deleteOne({ _id: new ObjectId(id) });
      if (!result || result.deletedCount === 0) result = await db.collection('employees').deleteOne({ _id: id });
      return json({ success: true, message: 'Employee Deleted' });
    }

    if (path === 'finance/ledger' || path === 'api/finance/ledger') {
       const id = searchParams.get('id');
       if (!id) return json({ error: 'Missing Transaction ID' }, 400);
       await db.collection('finance_ledger').deleteOne({ _id: new ObjectId(id) });
       return json({ success: true, message: 'Transaction Deleted' });
    }

    if (path === 'client-requests' || path === 'api/client-requests') {
       const id = searchParams.get('id');
       if (!id) return json({ error: 'Missing Request ID' }, 400);
       await db.collection('client_requests').deleteOne({ _id: new ObjectId(id) });
       return json({ success: true, message: 'Request Deleted Permanently' });
    }

    if (path === 'dispatches' || path === 'api/dispatches') {
       const id = searchParams.get('id');
       if (!id) return json({ error: 'Missing Dispatch ID' }, 400);
       await db.collection('dispatches').deleteOne({ _id: new ObjectId(id) });
       return json({ success: true, message: 'Dispatch Task Deleted' });
    }
    
    return json({ error: 'DELETE endpoint not found' }, 404);
  } catch (error) {
    console.error('Delete API Error:', error);
    return json({ error: 'Server Error', details: error.message }, 500);
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
    if (path === 'vault/upload' || path === 'api/vault/upload') {
       try {
         const formData = await request.formData();
         const file = formData.get('file');
         const docId = formData.get('docId');
         const email = formData.get('email');

         if (!file || !email || !docId) return json({ error: 'Missing data' }, 400);

         const arrayBuffer = await file.arrayBuffer();
         const buffer = Buffer.from(arrayBuffer);
         const base64 = buffer.toString('base64');

         const newDoc = {
             id: docId,
             name: docId.replace(/_/g, ' ').toUpperCase(),
             file_name: file.name,
             file_base64: base64,
             status: 'uploaded', // This tells MD it's under review
             upload_date: new Date().toLocaleDateString()
         };

         await db.collection('users').updateOne(
             { email: email.toLowerCase() },
             { $pull: { vault_docs: { id: docId } } }
         );
         await db.collection('users').updateOne(
             { email: email.toLowerCase() },
             { $push: { vault_docs: newDoc } }
         );

         return json({ success: true, message: "File processed and saved successfully." });
       } catch(e) {
         return json({ error: 'File upload failed' }, 500);
       }
    }

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

    // 🚀 FIX: Guest Queries POST Route
    if (path === 'guest-queries' || path === 'api/guest-queries') {
       const result = await db.collection('guest_queries').insertOne({ ...body, created_at: new Date() });
       return json({ success: true, id: result.insertedId });
    }

    if (path === 'subscription/cancel' || path === 'api/subscription/cancel') {
      if (!body.email) return json({ error: 'Email required' }, 400);
      await db.collection('users').updateOne(
        { email: body.email.toLowerCase() },
        { $set: { 'subscription.status': 'cancelled_pending', auto_renew: false } }
      );
      return json({ success: true, message: 'Auto-renewal cancelled successfully.' });
    }

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
      const userEmail = email.toLowerCase();
      
      const existingUser = await db.collection('users').findOne({ email: userEmail });
      let finalClientId = existingUser?.client_id;
      
      if (!finalClientId) {
          const count = await db.collection('users').countDocuments({ client_id: { $exists: true } });
          finalClientId = `CLI-${1000 + count + 1}`;
      }

      await db.collection('users').updateOne(
        { email: userEmail },
        { $set: { is_approved: true, status: 'approved', client_id: finalClientId } }
      );
      return json({ success: true, client_id: finalClientId });
    }

    if (path === 'users/request-payment' || path === 'api/users/request-payment') {
       const { email, amount, reason } = body;
       await db.collection('users').updateOne(
         { email: email.toLowerCase() },
         { $push: { pending_payments: { amount, reason, date: new Date(), status: 'UNPAID' } } }
       );
       return json({ success: true });
    }

    if (path === 'client-requests' || path === 'api/client-requests') {
       const { client_email, client_id, link_or_id, description } = body;
       const result = await db.collection('client_requests').insertOne({
          client_email: client_email.toLowerCase(), client_id, link_or_id, description,
          status: 'Pending Officer Review', reply: '', created_at: new Date()
       });
       return json({ success: true, id: result.insertedId });
    }

    if (path === 'dispatches' || path === 'api/dispatches') {
       const { target_type, target_id, subject, message } = body;
       const result = await db.collection('dispatches').insertOne({
          target_type, target_id, subject, message, status: 'Sent', created_at: new Date()
       });
       return json({ success: true, id: result.insertedId });
    }

    if (path === 'gov-officers' || path === 'api/gov-officers') {
       const result = await db.collection('gov_officers').insertOne({
          ...body, created_at: new Date()
       });
       return json({ success: true, id: result.insertedId });
    }

    if (path === 'bids' || path === 'api/bids') {
       const status = body.status || 'Doc Preparation';
       const result = await db.collection('bids').insertOne({
          ...body, status: status, created_at: new Date()
       });
       return json({ success: true, id: result.insertedId });
    }

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

    if (path === 'queries/send' || path === 'api/queries/send') {
      const { client_email, subject, message } = body;
      const queryId = new ObjectId().toString();
      await db.collection('users').updateOne(
        { email: client_email.toLowerCase() },
        { $push: { officer_queries: { id: queryId, subject, message, created_at: new Date() } } }
      );
      return json({ success: true });
    }

    if (path === 'queries/reply' || path === 'api/queries/reply') {
      const { queryId, email } = body;
      await db.collection('users').updateOne(
        { email: email.toLowerCase() },
        { $pull: { officer_queries: { id: queryId } } }
      );
      return json({ success: true });
    }

    if (path === 'finance/ledger' || path === 'api/finance/ledger') {
        const newTxn = {
            type: body.type, 
            amount: Number(body.amount),
            reason: body.reason,
            client_id: body.client_id || 'N/A',
            payment_mode: body.payment_mode || 'OFFLINE',
            proof_base64: body.proof_base64 || null,
            created_at: new Date()
        };
        await db.collection('finance_ledger').insertOne(newTxn);
        return json({ success: true, message: 'Transaction Added' });
    }

    if (path === 'employees' || path === 'api/employees') {
        const count = await db.collection('employees').countDocuments();
        const newEmpId = `EMP-${1000 + count + 1}`; 
        const newEmployee = { 
            emp_id: newEmpId, 
            name: body.name, 
            email: body.email.toLowerCase(), 
            password: body.password, 
            role: body.role || 'Employee',
            created_at: new Date() 
        };
        const result = await db.collection('employees').insertOne(newEmployee);
        return json({ success: true, emp_id: newEmpId, id: result.insertedId });
    }

    if (path === 'drive/create-folder' || path === 'api/drive/create-folder') {
       const { folderName, email } = body;
       
       if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
          return json({ error: 'Google Drive Keys missing in Vercel Environment Variables' }, 500);
       }

       try {
          const auth = new google.auth.JWT(
             process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
             null,
             process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
             ['https://www.googleapis.com/auth/drive.file']
          );
          const drive = google.drive({ version: 'v3', auth });
          
          const fileMetadata = {
             name: folderName || `Client - ${email}`,
             mimeType: 'application/vnd.google-apps.folder',
          };
          
          const folder = await drive.files.create({
             resource: fileMetadata,
             fields: 'id, webViewLink'
          });

          await drive.permissions.create({
             fileId: folder.data.id,
             requestBody: {
                role: 'writer',
                type: 'anyone'
             }
          });
          
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
            // 🚀 FIX: This line now redirects them back to the Finance Dashboard
            order_meta: { return_url: "https://www.tgtenders.in/client?tab=finance" }
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

    if (path === 'payment/webhook' || path === 'api/payment/webhook') {
       try {
         const orderId = body?.data?.order?.order_id;
         const paymentStatus = body?.data?.payment?.payment_status;

         if (orderId && paymentStatus === 'SUCCESS') {
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
