// Pre-flight requirement analysis for a selected tender.
//
// Document generation used to start from a dropdown: the officer guessed which
// undertakings the bid wanted and the AI drafted whatever was picked, working only from
// the handful of fields typed into the tender record. Anything the document actually
// demanded but nobody remembered was simply never produced, and the omission only
// surfaced after the bid was rejected.
//
// This route inverts that. It reads the bid document itself and answers "what must this
// bidder submit?" — each item quoting the clause it came from — so the checklist shown
// to the officer is derived from the tender, not from memory.

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireDashboardStaff } from '@/lib/staff-auth';
import { findTenderByAnyId, rememberBidNoAlias, suggestSimilarTenders } from '@/lib/tender-lookup';
import { fetchTenderPDFBuffer, isValidPDFBuffer } from '@/lib/cloudflare-r2';
import { searchCopilotKnowledge } from '@/lib/gem-copilot-knowledge';
import { parseAIJson } from '@/lib/ai-extraction';
import { generateContent } from '@/lib/gemini';
import { DOC_TYPES, findDocType } from '@/lib/document-templates';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const ANALYSIS_PROMPT = `
You are a Senior Tender Compliance Officer at an Indian government procurement consultancy.
You are reading an actual bid document from the Government e-Marketplace (GeM) or a state
e-procurement portal.

Your job is to tell the bidding officer EXACTLY what has to be submitted with this bid.
Be exhaustive and be literal — an omission here causes technical rejection.

Return STRICTLY one JSON object, no markdown fences and no commentary:

{
  "bid_no": "The bid/tender number printed in the document itself, or 'N/A'",
  "buyer": "Buying organisation / department, or 'N/A'",
  "bid_end_date": "Bid submission end date as printed, or 'N/A'",
  "emd_amount": "EMD amount in INR digits only, or 'N/A'",
  "emd_exemption_allowed": true/false,
  "mse_exemption_allowed": true/false,
  "summary": "Three sentences at most: what is being procured, who is buying, what stands out as risky or unusual.",
  "undertakings": [
    {
      "title": "Name of the undertaking/declaration exactly as the document calls it",
      "why": "One sentence: which requirement makes this mandatory",
      "clause": "The clause number, ATC point, or section heading it comes from, or 'N/A'",
      "mandatory": true/false,
      "confidence": "high" | "medium" | "low",
      "on_letterhead": true/false,
      "notarised": true/false
    }
  ],
  "supporting_documents": [
    {
      "title": "Name of the certificate/proof to attach (e.g. 'GST registration certificate')",
      "why": "One sentence on the requirement it satisfies",
      "clause": "Clause or section reference, or 'N/A'",
      "mandatory": true/false,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "eligibility": [
    "Each eligibility condition as a single sentence (turnover, past experience, OEM tie-up, registration, etc.)"
  ],
  "watch_outs": [
    "Anything that commonly causes rejection in this specific bid — unusual ATC clauses, short delivery windows, restrictive make-in-India levels, etc."
  ]
}

RULES
- Read the whole document, including the Additional Terms & Conditions (ATC) and any annexures.
- Only list what the document actually requires. Never pad the list with generic GeM boilerplate
  that is not present.
- Set confidence to "low" when you are inferring rather than quoting, and say so in "why".
- Quote the real clause reference where one exists. Never invent clause numbers.
- If the document is unreadable, return the JSON with empty arrays and explain in "summary".
`;

/** Maps a free-text requirement to a document type we can actually draft. */
const DOC_TYPE_HINTS = [
  { id: 'bid_undertaking', match: /\bbid\b.*undertaking|undertaking.*\bbid\b/i },
  { id: 'emd_exemption', match: /emd.*(exempt|waiver)|exempt.*emd/i },
  { id: 'oem_authorization', match: /\boem\b|manufacturer.*(authoris|authoriz)|\bmaf\b/i },
  { id: 'technical_compliance', match: /technical.*(compliance|specification)|compliance.*(sheet|statement|matrix)/i },
  { id: 'delivery_undertaking', match: /delivery|warrant|after[- ]sales|installation/i },
  { id: 'compliance_declaration', match: /compliance|gfr|gtc|integrity pact|code of integrity/i },
  { id: 'declaration', match: /blacklist|debar|self[- ]declaration|declaration|affidavit|undertaking/i },
  { id: 'cover_letter', match: /cover(ing)? letter|forwarding letter/i },
];

function suggestDocType(title) {
  const text = String(title || '');
  const hit = DOC_TYPE_HINTS.find((h) => h.match.test(text));
  return hit ? findDocType(hit.id) : null;
}

function normaliseRequirement(raw, kind) {
  const text = (value) => {
    const str = String(value ?? '').trim();
    return str && str.toUpperCase() !== 'N/A' ? str : '';
  };
  const title = text(raw?.title);
  if (!title) return null;

  const docType = kind === 'undertaking' ? suggestDocType(title) : null;
  const confidence = ['high', 'medium', 'low'].includes(String(raw?.confidence).toLowerCase())
    ? String(raw.confidence).toLowerCase()
    : 'medium';

  return {
    kind,
    title,
    why: text(raw?.why),
    clause: text(raw?.clause),
    mandatory: raw?.mandatory !== false,
    confidence,
    on_letterhead: Boolean(raw?.on_letterhead),
    notarised: Boolean(raw?.notarised),
    // Present only when this consultancy can actually draft the item — the UI turns
    // these into one-click generate buttons and leaves the rest as a manual checklist.
    doc_type: docType ? { id: docType.id, label: docType.label } : null,
  };
}

export async function POST(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => null);
    const tenderId = String(body?.tender_id || '').trim();
    const refresh = Boolean(body?.refresh);
    if (!tenderId) return NextResponse.json({ error: 'tender_id is required.' }, { status: 400 });

    const db = await getDb();
    const tender = await findTenderByAnyId(db, tenderId);
    if (!tender) {
      const suggestions = await suggestSimilarTenders(db, tenderId);
      return NextResponse.json({
        error: suggestions.length
          ? `No tender is recorded under ${tenderId}. Closest matches on file: `
            + `${suggestions.map((s) => s.bid_no || s.id).join(', ')}.`
          : `No tender is recorded under ${tenderId}.`,
        suggestions,
      }, { status: 404 });
    }

    // Reading a full bid PDF on the Pro model is slow and costs real money, and the
    // requirements of a published tender do not change. Serve the cached analysis unless
    // the officer explicitly asks for a re-read.
    if (!refresh && tender.requirements?.items?.length) {
      const cached = tender.requirements;
      return NextResponse.json({
        ...cached,
        tender_id: String(tender._id),
        recorded_bid_no: tender.bid_no || null,
        bid_no_mismatch: Boolean(
          cached.bid_no && tender.bid_no && cached.bid_no.toUpperCase().trim() !== tender.bid_no.toUpperCase().trim(),
        ),
        available_doc_types: DOC_TYPES.map((t) => ({ id: t.id, label: t.label })),
        cached: true,
      });
    }

    const pdfBuffer = await fetchTenderPDFBuffer({
      pdf_url: tender.pdf_url,
      pdf_filename: tender.pdf_filename,
      pdf_r2_key: tender.pdf_r2_key,
    });

    let document = pdfBuffer && isValidPDFBuffer(pdfBuffer) ? pdfBuffer : null;
    if (!document && typeof tender.pdf_base64 === 'string') {
      const legacy = Buffer.from(tender.pdf_base64.replace(/^data:[^;,]*(;base64)?,/, ''), 'base64');
      document = isValidPDFBuffer(legacy) ? legacy : null;
    }

    if (!document) {
      return NextResponse.json({
        error: 'The bid document for this tender could not be opened, so its requirements cannot be '
          + 'determined from the source. Re-upload the PDF on the tender record and try again.',
      }, { status: 422 });
    }

    // Official GeM/GFR rules already harvested into the knowledge base, so the model can
    // name the correct statutory basis instead of guessing at clause numbers.
    const knowledge = await searchCopilotKnowledge(
      db,
      `${tender.title || ''} ${tender.category || ''} bid undertaking declaration mandatory documents GeM GTC`,
      { limit: 3 },
    );
    const knowledgeBlock = knowledge.length
      ? `\n\nOFFICIAL GeM/GFR REFERENCE MATERIAL (use for correct terminology and statutory basis only — `
        + `the bid document above always wins):\n`
        + knowledge.map((d) => `### ${d.title}\n${String(d.content_text || '').slice(0, 2500)}`).join('\n\n')
      : '';

    const contextHeader =
      `TENDER RECORD ON FILE (may be incomplete or mistyped — trust the attached document over this):\n`
      + `Recorded bid number: ${tender.bid_no || 'not recorded'}\n`
      + `Title: ${tender.title || 'not recorded'}\n`
      + `Department: ${tender.department || 'not recorded'}\n`
      + `Closing date: ${tender.last_date || 'not recorded'}\n`
      + `EMD: ${tender.emd_amount || 'not recorded'}`
      + knowledgeBlock;

    let parsed;
    let modelUsed;
    try {
      const result = await generateContent({
        tier: 'pro',
        parts: [
          ANALYSIS_PROMPT,
          contextHeader,
          { inlineData: { data: document.toString('base64'), mimeType: 'application/pdf' } },
        ],
      });
      modelUsed = result.model;
      parsed = parseAIJson(result.text);
    } catch (aiError) {
      console.error('[tenders/requirements] Gemini call failed:', aiError?.message || aiError);
      return NextResponse.json(
        { error: `The AI could not read the bid document: ${aiError?.message || 'unknown error'}` },
        { status: aiError?.status || 502 },
      );
    }

    if (!parsed) {
      return NextResponse.json({ error: 'The AI returned an unreadable analysis. Please retry.' }, { status: 502 });
    }

    const items = [
      ...(Array.isArray(parsed.undertakings) ? parsed.undertakings : [])
        .map((r) => normaliseRequirement(r, 'undertaking')),
      ...(Array.isArray(parsed.supporting_documents) ? parsed.supporting_documents : [])
        .map((r) => normaliseRequirement(r, 'document')),
    ].filter(Boolean);

    const text = (value) => {
      const str = String(value ?? '').trim();
      return str && str.toUpperCase() !== 'N/A' ? str : '';
    };

    const requirements = {
      bid_no: text(parsed.bid_no) || tender.bid_no || null,
      buyer: text(parsed.buyer) || tender.department || null,
      bid_end_date: text(parsed.bid_end_date) || tender.last_date || null,
      emd_amount: text(parsed.emd_amount).replace(/[^\d]/g, '') || null,
      emd_exemption_allowed: Boolean(parsed.emd_exemption_allowed),
      mse_exemption_allowed: Boolean(parsed.mse_exemption_allowed),
      summary: text(parsed.summary),
      items,
      eligibility: (Array.isArray(parsed.eligibility) ? parsed.eligibility : []).map(text).filter(Boolean),
      watch_outs: (Array.isArray(parsed.watch_outs) ? parsed.watch_outs : []).map(text).filter(Boolean),
      generated_at: new Date(),
      generated_by: auth.email || auth.actor,
      model: modelUsed,
    };

    await db.collection('tenders').updateOne(
      { _id: tender._id },
      { $set: { requirements } },
    ).catch((err) => console.warn('[tenders/requirements] could not cache result:', err?.message));

    // The number the AI read off the document is the one staff will type into chat later;
    // the record's own bid_no is frequently a mistyped variant of it.
    const alias = await rememberBidNoAlias(db, tender._id, requirements.bid_no);

    return NextResponse.json({
      ...requirements,
      tender_id: String(tender._id),
      recorded_bid_no: tender.bid_no || null,
      // Surfaced so the officer can correct the record when the two disagree.
      bid_no_mismatch: Boolean(alias && tender.bid_no && alias !== tender.bid_no.toUpperCase().trim()),
      knowledge_used: knowledge.map((d) => d.title),
      available_doc_types: DOC_TYPES.map((t) => ({ id: t.id, label: t.label })),
      cached: false,
    });
  } catch (error) {
    console.error('[tenders/requirements] fatal error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}
