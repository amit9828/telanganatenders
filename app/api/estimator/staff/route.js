import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/staff-auth';
import { findTenderByAnyId, normaliseBidNo } from '@/lib/tender-lookup';
import { uploadTenderPDF } from '@/lib/cloudflare-r2';
import { scoreMatch, estimateTenderValue, parseIndianAmount } from '@/lib/matchmaking';
import { stateForDistrict } from '@/lib/regions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function scoreClient(tender, client) {
  const base = scoreMatch(tender, client, 0);
  const reasons = [...base.reasons];
  let score = base.score;
  const budget = parseIndianAmount(client.budget) || Number(client.budget) || 0;
  const value = estimateTenderValue(tender);
  if (budget > 0 && value) {
    if (value <= budget) {
      score += 10;
      reasons.push('Within the stated budget');
    } else {
      reasons.push('Above the stated budget');
    }
  }
  const states = String(client.serviceable_states || '').split(/[,/|]/).map((item) => item.trim().toUpperCase()).filter(Boolean);
  const tenderState = stateForDistrict(tender.district);
  if (states.length && tenderState && states.includes(tenderState)) {
    score += 5;
    reasons.push('State is in the client service area');
  }
  return { score: Math.min(100, Math.round(score)), reasons };
}

export async function GET(request) {
  const auth = await requireStaff(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'extract';
  const db = await getDb();

  if (action === 'extract') {
    const bidNo = String(url.searchParams.get('bid_no') || '').trim();
    if (!bidNo) return json({ error: 'A bid number is required.' }, 400);
    const key = normaliseBidNo(bidNo) || bidNo.toUpperCase();
    const extract = await db.collection('estimator_extracts').findOne({ bid_key: key });
    if (!extract) return json({ extract: null });
    const { _id, ...rest } = extract;
    return json({ extract: { ...rest, id: String(_id) } });
  }

  const tenders = await db.collection('tenders').find(
    { deleted: { $ne: true } },
    { projection: { bid_no: 1, title: 1, category: 1, department: 1, district: 1, supply_details: 1, estimated_value: 1, emd_amount: 1 } },
  ).limit(200).toArray();
  const clients = await db.collection('users').find(
    { onboarding_complete: true, account_kind: { $ne: 'visitor' } },
    { projection: { email: 1, company_name: 1, client_name: 1, service_category: 1, district: 1, address: 1, budget: 1, serviceable_states: 1, documents: 1 } },
  ).limit(200).toArray();

  const rows = clients.map((client) => {
    const matches = tenders.map((tender) => ({
      bid_no: tender.bid_no || '',
      title: tender.title || '',
      tender_id: String(tender._id),
      ...scoreClient(tender, client),
    })).filter((item) => item.score >= 45).sort((a, b) => b.score - a.score).slice(0, 8);
    return {
      email: client.email,
      name: client.company_name || client.client_name || client.email,
      matches,
    };
  }).filter((row) => row.matches.length);
  return json({ clients: rows });
}

export async function POST(request) {
  const auth = await requireStaff(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const db = await getDb();
  const contentType = String(request.headers.get('content-type') || '');

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    const bidNo = String(form.get('bid_no') || '').trim();
    if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'A file is required.' }, 400);
    const buffer = Buffer.from(await file.arrayBuffer());
    const name = String(file.name || 'master');
    if (/\.xlsx?$/i.test(name) || buffer.slice(0, 2).toString() === 'PK') {
      const book = XLSX.read(buffer, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' });
      let saved = 0;
      for (const row of rows) {
        const number = normaliseBidNo(row.bid_no || row.BidNo || row['Bid Number'] || '') || String(row.bid_no || row.BidNo || '').trim();
        if (!number) continue;
        await db.collection('tenders').updateOne(
          { bid_no: number },
          { $set: {
            bid_no: number,
            title: String(row.title || row.Title || row.description || 'Master tender'),
            department: String(row.department || row.Department || ''),
            district: String(row.district || row.District || ''),
            category: String(row.category || row.Category || ''),
            estimated_value: String(row.estimated_value || row.Value || row.budget || ''),
            source: 'master_upload',
            updated_at: new Date(),
          }, $setOnInsert: { created_at: new Date(), deleted: false } },
          { upsert: true },
        );
        saved += 1;
      }
      return json({ saved });
    }
    const key = normaliseBidNo(bidNo);
    if (!key) return json({ error: 'A bid number is required for a PDF upload.' }, 400);
    const stored = await uploadTenderPDF(buffer, name.endsWith('.pdf') ? name : `${key}.pdf`);
    await db.collection('tenders').updateOne(
      { bid_no: key },
      { $set: {
        bid_no: key,
        title: String(form.get('title') || name),
        pdf_url: stored?.url || '',
        pdf_r2_key: stored?.key || '',
        pdf_filename: name,
        source: 'master_upload',
        updated_at: new Date(),
      }, $setOnInsert: { created_at: new Date(), deleted: false } },
      { upsert: true },
    );
    return json({ saved: 1, bid_no: key });
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);
  if (body.action === 'suggest') {
    const clientEmail = String(body.client_email || '').trim().toLowerCase();
    const bidNo = String(body.bid_no || '').trim();
    if (!clientEmail || !bidNo) return json({ error: 'Client and bid number are required.' }, 400);
    const tender = await findTenderByAnyId(db, bidNo);
    await db.collection('dispatches').insertOne({
      target_type: 'client_alert',
      target_id: clientEmail,
      subject: `Suggested tender ${tender?.bid_no || bidNo}`,
      message: tender?.title || bidNo,
      tender_id: tender ? String(tender._id) : '',
      status: 'Sent',
      created_at: new Date(),
    });
    return json({ success: true });
  }
  return json({ error: 'Unknown action.' }, 400);
}
