import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { google } from 'googleapis'; // 🚀 Google Drive Integration
import { getDb } from '@/lib/db';
import { uploadTenderPDF } from '@/lib/cloudflare-r2';
// 🚀 SECURITY: Cashfree (Order/Verify/Webhook) + Offline Ledger logic now lives in
// app/api/payments/route.js. Only thin delegating calls remain below.
import { createCashfreeOrder, verifyCashfreeOrder, handleCashfreeWebhook, recordOfflineLedgerPayment } from '../payments/route';

// 🚀 STRICT RULES: భవిష్యత్తులో ఎప్పుడూ డేటా కాష్ (Cache) అవ్వకుండా కఠినమైన సెట్టింగ్స్
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

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

    // 🚀 FIX: Fetch Vault Document Instantly Without Lag
    if (path === 'vault/document' || path === 'api/vault/document') {
      const email = searchParams.get('email');
      const docId = searchParams.get('docId');
      const user = await db.collection('users').findOne({ email: email.toLowerCase() });
      const doc = user?.vault_docs?.find(d => d.id === docId);
      
      if (doc && doc.file_base64) {
          try {
              const cleanBase64 = doc.file_base64.replace(/^data:(.*,)?/, '');
              const buffer = Buffer.from(cleanBase64, 'base64');
              return new NextResponse(buffer, {
                  status: 200,
                  headers: { 
                     'Content-Type': 'application/pdf', 
                     'Content-Disposition': `inline; filename="${doc.file_name || 'document.pdf'}"` 
                  }
              });
          } catch(err) {
              return json({ error: 'Failed to parse PDF Data' }, 500);
          }
      }
      return json({ error: 'Document not found' }, 404);
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
             const cleanBase64 = tender.pdf_base64.replace(/^data:(.*,)?/, '');
             const pdfBuffer = Buffer.from(cleanBase64, 'base64');
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
         .project({ "vault_docs.file_base64": 0 }) // 🚀 FIX: Block heavy PDF loads
         .sort({ created_at: -1 })
         .toArray();
      return json({ users });
    }

    if (path === 'ai/drafts' || path === 'api/ai/drafts') {
       const drafts = await db.collection('ai_draft_tenders')
         .find({ status: 'Pending Verification' })
         .project({ pdf_base64: 0 }) // 🚀 FIX: Block heavy AI PDF loads
         .sort({ created_at: -1 })
         .toArray();
       return json({ drafts });
    }
    
    if (path === 'users/approved' || path === 'api/users/approved') {
      const users = await db.collection('users')
         .find({ is_approved: true })
         .project({ "vault_docs.file_base64": 0 }) // 🚀 FIX: Block heavy PDF loads
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
      const dispatches = await db.collection('dispatches')
         .find(query)
         .project({ file_base64: 0 }) // 🚀 FIX: Block heavy task attachment loads
         .sort({ created_at: -1 })
         .toArray();
      return json({ dispatches });
    }

    if (path === 'gov-officers' || path === 'api/gov-officers') {
      const officers = await db.collection('gov_officers').find({}).sort({ created_at: -1 }).toArray();
      return json({ officers });
    }

    // 🚀 Operator Docs GET
    if (path === 'operator/docs' || path === 'api/operator/docs') {
       const docs = await db.collection('operator_storage')
         .find({})
         .project({ file_base64: 0 }) // 🚀 FIX: Block heavy storage loads
         .sort({ created_at: -1 })
         .toArray();
       return json({ docs });
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
      // 🚀 FIX: Prevent ledger images from lagging the admin panel
      const transactions = await db.collection('finance_ledger').find({}).project({ proof_base64: 0 }).sort({ created_at: -1 }).toArray();
      const totalCredit = transactions.filter(t => t.type === 'CREDIT').reduce((sum, t) => sum + Number(t.amount), 0);
      const totalDebit = transactions.filter(t => t.type === 'DEBIT').reduce((sum, t) => sum + Number(t.amount), 0);
      return json({ transactions, balance: totalCredit - totalDebit });
    }

    if (path === 'me' || path === 'api/me') {
      const email = searchParams.get('email');
      if (!email) return json({ error: 'Email required' }, 400);

      // 🚀 FIX: Block Base64 to stop 3-minute lagging (Amazon Speed)
      const user = await db.collection('users').findOne(
        { email: email.toLowerCase() },
        { projection: { "vault_docs.file_base64": 0, "officer_queries.file_base64": 0 } }
      );
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
        // 👆 (పైన ఉండే కోడ్: "api/me" కి సంబంధించిన చివర భాగం ఇది)
        pending_payments: user.pending_payments || [],
        vault_docs: user.vault_docs || [], 
        stats: calculatedStats 
      });
    }
    // 🚀 FIX: Live Tracking GET route for Admin Dashboard
    if (path === 'payments/requests' || path === 'api/payments/requests') {
       const usersWithPayments = await db.collection('users').find({
           pending_payments: { $exists: true, $not: { $size: 0 } }
       }).toArray();

       let allRequests = [];
       usersWithPayments.forEach(user => {
           user.pending_payments.forEach(req => {
               if (req.status !== 'PAID') {
                   allRequests.push({
                       id: req.id,
                       db_id: req.id, 
                       client_id: user.email,
                       amount: req.amount,
                       reason: req.reason,
                       status: req.status === 'UNPAID' ? 'sent' : req.status,
                       sent_time: new Date(req.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
                       created_at: req.date
                   });
               }
           });
       });

       allRequests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
       return json({ requests: allRequests });
    }

    // ⬆️ ఇక్కడి వరకు పేస్ట్ చేయాలి ⬆️

    // 👇 (కింద ఉండే పాత కోడ్: GET ఫంక్షన్ ముగింపు ఇది)
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
        const { task_id, status, reply, file_name, file_base64 } = body;
        let updateData = { status: status, updated_at: new Date() };
        if(reply) updateData.client_reply = reply;
        
        // 🚀 FIX: ఫైల్ ని డేటాబేస్ లో సేవ్ చేయడం
        if(file_name) updateData.file_name = file_name;
        if(file_base64) updateData.file_base64 = file_base64;

        await db.collection('dispatches').updateOne(
           { _id: new ObjectId(task_id) },
           { $set: updateData }
        );
        return json({ success: true, message: `Dispatch status updated to ${status}` });
     }
     // 🚀 FIX: Vault Document Approval + Rename + Duplicate Check + Auto Google Drive Sync
     if (path === 'vault/verify' || path === 'api/vault/verify') {
        const { email, docId, status, reject_reason, custom_file_name, overwrite } = body;
        const targetEmail = email.toLowerCase();
        
        const user = await db.collection('users').findOne({ email: targetEmail });
        const doc = user?.vault_docs?.find(d => d.id === docId);

        let finalFileName = doc?.file_name || `${docId}.pdf`;
        
        if (status === 'verified' && custom_file_name) {
            finalFileName = custom_file_name.toLowerCase().endsWith('.pdf') 
                ? custom_file_name 
                : `${custom_file_name}.pdf`;
            
            const isDuplicate = user?.vault_docs?.some(d => d.id !== docId && d.file_name === finalFileName);
            if (isDuplicate && !overwrite) {
                return json({ 
                    error: 'Duplicate_Found', 
                    message: 'ఈ పేరుతో ఇప్పటికే ఫైల్ ఉంది. పాతదాన్ని రీప్లేస్ చేయాలా?' 
                }, 409);
            }
        }

        await db.collection('users').updateOne(
            { email: targetEmail, "vault_docs.id": docId },
            { $set: { 
                "vault_docs.$.status": status,
                "vault_docs.$.reject_reason": reject_reason || null,
                "vault_docs.$.file_name": finalFileName 
              } 
            }
        );

        if (status === 'verified') {
            if (user?.drive_folder_id && doc?.file_base64 && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
               try {
                   const auth = new google.auth.JWT(
                       process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, null,
                       process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                       ['https://www.googleapis.com/auth/drive.file']
                   );
                   const drive = google.drive({ version: 'v3', auth });
                   
                   const cleanBase64 = doc.file_base64.replace(/^data:(.*,)?/, '');
                   const buffer = Buffer.from(cleanBase64, 'base64');
                   const stream = require('stream');
                   const bufferStream = new stream.PassThrough();
                   bufferStream.end(buffer);

                   await drive.files.create({
                       requestBody: { name: finalFileName, parents: [user.drive_folder_id] },
                       media: { mimeType: 'application/pdf', body: bufferStream },
                       fields: 'id'
                   });
               } catch(err) {
                   console.error("Drive upload failed silently:", err);
               }
            }
        }
        return json({ success: true, saved_file_name: finalFileName });
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
        // 🚀 Extracted to app/api/payments/route.js (Offline Ledger logic)
        return await recordOfflineLedgerPayment(db, body);
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
      // 🚀 FIX: Offload PDF storage to Cloudflare R2 instead of MongoDB. Only the
      // resulting `pdf_url` is persisted, keeping tender documents lightweight.
      const { pdf_base64, ...tenderFields } = body;
      let pdf_url = tenderFields.pdf_url || null;

      if (pdf_base64) {
        try {
          const cleanBase64 = pdf_base64.replace(/^data:(.*,)?/, '');
          const fileBuffer = Buffer.from(cleanBase64, 'base64');
          const safeFileName = `${Date.now()}-${tenderFields.pdf_filename || 'tender.pdf'}`;

          const uploadedUrl = await uploadTenderPDF(fileBuffer, safeFileName);
          if (uploadedUrl) {
            pdf_url = uploadedUrl;
          } else {
            console.error('Tender PDF upload to Cloudflare R2 failed; publishing tender without a PDF.');
          }
        } catch (uploadError) {
          console.error('Failed to process tender PDF for upload:', uploadError);
        }
      }

      const newTender = { ...tenderFields, pdf_url, created_at: new Date() };
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

    // 🚀 FIX: Profile saving logic with mandatory fields
    if (path === 'users/profile' || path === 'api/users/profile') {
      const { 
        email, client_name, company_name, company_type, phone, address, 
        service_category, gstin, udyam, has_gst, has_msme, has_iso, documents, status, agreement_signed 
      } = body;
      
      const userEmail = email.toLowerCase();
      
      // అగ్రిమెంట్ కోసం స్పెషల్ చెక్
      if (agreement_signed) {
          await db.collection('users').updateOne(
            { email: userEmail },
            { $set: { agreement_signed: true, status: 'active' } }
          );
          return json({ success: true });
      }

      // మిగతా ప్రొఫైల్ డేటా సేవ్
      await db.collection('users').updateOne(
        { email: userEmail },
        { $set: { 
            company_type, has_gst, has_msme, has_iso,
            client_name, company_name, phone, address, service_category, 
            gstin: gstin ? gstin.toUpperCase() : '',
            udyam: udyam ? udyam.toUpperCase() : '',
            documents: documents || {}, 
            status: status || 'pending', 
            onboarding_complete: true, 
            profile_score: 100 
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
       const reqId = new ObjectId().toString(); // 🚀 FIX: Generate a unique ID

       await db.collection('users').updateOne(
         { email: email.toLowerCase() },
         { $push: { pending_payments: { id: reqId, amount, reason, date: new Date(), status: 'UNPAID' } } }
       );
       
       return json({ success: true, id: reqId }); // 🚀 FIX: Return ID to frontend
    }
    
    // 🚀 Delete AI Draft once Published
    if (path === 'ai/drafts' || path === 'api/ai/drafts') {
       const id = searchParams.get('id');
       if (!id) return json({ error: 'Missing Draft ID' }, 400);
       await db.collection('ai_draft_tenders').deleteOne({ _id: new ObjectId(id) });
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
    // 🚀 FIX: Delete Route to Cancel a Payment Request
    if (path === 'payments/requests' || path === 'api/payments/requests') {
       const id = searchParams.get('id');
       if (!id) return json({ error: 'Missing Request ID' }, 400);

       await db.collection('users').updateOne(
           { "pending_payments.id": id },
           { $pull: { pending_payments: { id: id } } }
       );
       return json({ success: true, message: 'Payment Request Cancelled' });
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

    // 🚀 FIX: Client submits reply (Updates query with data instead of deleting)
    if (path === 'queries/reply' || path === 'api/queries/reply') {
      const { queryId, email, description, fileName } = body;
      await db.collection('users').updateOne(
        { email: email.toLowerCase(), "officer_queries.id": queryId },
        { $set: { 
            "officer_queries.$.reply_submitted": true,
            "officer_queries.$.reply_text": description,
            "officer_queries.$.reply_file": fileName,
            "officer_queries.$.replied_at": new Date()
          } 
        }
      );
      return json({ success: true });
    }

   // 🚀 FIX: Admin/Employee closes the query (Moves to History instead of Delete)
    if (path === 'queries/close' || path === 'api/queries/close') {
      const { queryId, email } = body;
      await db.collection('users').updateOne(
        { email: email.toLowerCase(), "officer_queries.id": queryId },
        { $set: { "officer_queries.$.is_closed": true, "officer_queries.$.closed_at": new Date() } }
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
    // 🚀 Operator Docs POST (Store)
    if (path === 'operator/docs' || path === 'api/operator/docs') {
       const { name, file_base64, uploaded_by } = body;
       const result = await db.collection('operator_storage').insertOne({
          name, file_base64, uploaded_by, created_at: new Date()
       });
       return json({ success: true, id: result.insertedId });
    }

    // 🚀 Operator Share Doc with Client
    if (path === 'operator/share' || path === 'api/operator/share') {
       const { docId, client_email } = body;
       const doc = await db.collection('operator_storage').findOne({ _id: new ObjectId(docId) });
       if (!doc) return json({ error: 'Document not found' }, 404);

       const sharedQuery = {
          id: new ObjectId().toString(),
          subject: `Shared Proforma Document: ${doc.name}`,
          message: `Operations team has shared a reference document with you: ${doc.name}`,
          file_base64: doc.file_base64,
          file_name: doc.name,
          reply_submitted: false,
          created_at: new Date()
       };

       await db.collection('users').updateOne(
          { email: client_email.toLowerCase() },
          { $push: { officer_queries: sharedQuery } }
       );
       return json({ success: true });
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
      // 🚀 Extracted to app/api/payments/route.js (Cashfree Order Creation)
      return await createCashfreeOrder(db, body);
    }
    if (path === 'payment/verify' || path === 'api/payment/verify') {
      // 🚀 Extracted to app/api/payments/route.js (Cashfree Verification)
      return await verifyCashfreeOrder(db, body);
    }

    if (path === 'payment/webhook' || path === 'api/payment/webhook') {
      // 🚀 Extracted to app/api/payments/route.js (Cashfree Webhook)
      return await handleCashfreeWebhook(db, request, body);
    }
    
    // చివర్లో ఇది కచ్చితంగా ఉండాలి, లేకపోతే ఎర్రర్ వస్తుంది.
    return json({ error: 'POST not found', path }, 404);
  } catch (error) {
    console.error('Server POST Error:', error);
    return json({ error: 'Server Error' }, 500);
  }
}
