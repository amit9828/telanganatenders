// Conversational document generation, with the server holding the state machine.
//
// The old generator was a form: pick a type, press Generate, hope the right facts were on
// file. This route runs an interview instead — the model asks for what is missing, shows
// an outline of exactly what it will write, and only renders after the officer approves
// that specific outline.
//
// gathering -> outline_pending -> confirmed -> rendered
//
// Two rules make it trustworthy rather than merely conversational:
//
//   1. VALIDATION IS SERVER-SIDE. The model returns the slots it thinks it filled; every
//      one is looked up against the real client, tender and letterhead records before it
//      counts. A hallucinated client email simply never validates.
//
//   2. THE GATE IS HASHED. Confirmation carries the hash of the outline that was on
//      screen. If the outline changed underneath, the hash no longer matches and the
//      officer is asked to re-approve, so the document produced is always the one shown.

import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getDb } from '@/lib/db';
import { ObjectId } from 'mongodb';
import { requireDashboardStaff } from '@/lib/staff-auth';
import { findTenderByAnyId, suggestSimilarTenders } from '@/lib/tender-lookup';
import { parseAIJson } from '@/lib/ai-extraction';
import { generateContent } from '@/lib/gemini';
import { DOC_TYPES, findDocType, PACKAGE_100X_TYPES } from '@/lib/document-templates';
import { LETTERHEAD_COLLECTION } from '@/lib/letterhead-compose';
import { LANGUAGES, languageContract, resolveAnswerLanguage } from '@/lib/language';
import {
  PHASE,
  emptySession,
  loadSession,
  missingSlots,
  newSessionId,
  publicSession,
  renderTranscript,
  saveSession,
} from '@/lib/doc-session';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const INTERVIEW_PROMPT = `
You are the interviewer for a tender consultancy's document desk. You are collecting the
facts needed to draft a formal bid document, then proposing an outline for approval.

You NEVER write the document itself. You gather, you confirm, you outline.

Slots you are collecting:
- doc_type      (required) one of the document type ids listed below
- client_email  (required) the bidder this document is for
- letterhead_id (required) which stored letterhead template to print on
- tender_id     (optional but strongly preferred) the bid this document relates to
- instructions  (optional) anything specific the officer wants said

Behaviour:
- Ask for ONE missing thing at a time, in plain language. Never present a wall of questions.
- When the officer names something loosely ("the Ramesh account", "that GeM bid"), put your
  best interpretation in the slot. The server verifies it against real records and will
  tell you on the next turn if it did not resolve — do not claim it is confirmed yourself.
- Offer quick_replies whenever a small set of concrete choices exists.
- Never state a fact about the client, the tender or the bid as though you had checked it.
  You have not. Only the VERIFIED CONTEXT block below is confirmed.
- Once every required slot is verified, produce the outline and set phase to
  "outline_pending". The outline lists each section, the facts that will be used, and
  every placeholder the draft cannot fill from real data.
- Do not set phase to "confirmed" or "rendered". Only the officer's explicit approval can
  do that, and the server handles it.

Return ONLY this JSON, no markdown fence and no commentary:
{
  "phase": "gathering" | "outline_pending",
  "reply": "What you say to the officer, one short paragraph",
  "slots": { "doc_type": "...", "client_email": "...", "tender_id": "...", "letterhead_id": "...", "instructions": "..." },
  "quick_replies": ["short option", "short option"],
  "outline": {
    "title": "Document title",
    "sections": [{ "heading": "...", "content": "One line on what this section will say" }],
    "facts_used": [{ "label": "Company name", "value": "..." }],
    "placeholders": ["Facts the draft will leave blank for the officer to fill"]
  }
}

Set "outline" to null while still gathering. Include only the slots you actually learned;
omit the rest rather than sending empty strings.
`.trim();

/**
 * Fingerprint of the outline the officer is being asked to approve.
 *
 * Generation only fires when the hash sent back with the confirm action still matches, so
 * an outline cannot change between approval and render — what was signed off is what gets
 * produced.
 */
function hashOutline(outline) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(outline ?? null))
    .digest('hex')
    .slice(0, 32);
}

/** Model-facing catalogue, so it proposes an id the generator actually accepts. */
function docTypeCatalogue() {
  return DOC_TYPES.map((t) => `- ${t.id}: ${t.label} — ${t.description}`).join('\n');
}

// --- Slot validation -------------------------------------------------------

async function validateDocType(value) {
  const type = findDocType(value);
  if (!type) {
    return { ok: false, reason: `"${value}" is not a document type we produce.` };
  }
  return { ok: true, value: type.id, label: type.label };
}

async function validateClient(db, value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, reason: 'No client named yet.' };

  const query = raw.includes('@')
    ? { email: raw.toLowerCase() }
    : {
      // Officers refer to clients by CLI-code or company name far more often than email.
      $or: [
        { client_id: { $regex: `^${escapeRegex(raw)}$`, $options: 'i' } },
        { company_name: { $regex: escapeRegex(raw), $options: 'i' } },
      ],
    };

  const client = await db.collection('users').findOne(query, {
    projection: { email: 1, client_id: 1, company_name: 1, client_name: 1, gstin: 1, udyam: 1, address: 1 },
  });

  if (!client) return { ok: false, reason: `No client on file matches "${raw}".` };

  return {
    ok: true,
    value: client.email,
    label: client.company_name || client.client_name || client.email,
    detail: {
      client_id: client.client_id || null,
      company_name: client.company_name || null,
      gstin: client.gstin || null,
      udyam: client.udyam || null,
      address: client.address || null,
    },
  };
}

async function validateTender(db, value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, reason: 'No tender selected.', optional: true };

  const tender = await findTenderByAnyId(db, raw, {
    projection: { bid_no: 1, title: 1, department: 1, last_date: 1, emd_amount: 1, district: 1, category: 1, supply_details: 1 },
  });

  if (!tender) {
    const suggestions = await suggestSimilarTenders(db, raw);
    return {
      ok: false,
      optional: true,
      reason: suggestions.length
        ? `No tender matches "${raw}". Closest on file: ${suggestions.map((s) => s.bid_no || s.id).join(', ')}.`
        : `No tender matches "${raw}".`,
    };
  }

  return {
    ok: true,
    value: String(tender._id),
    label: `${tender.bid_no || 'No bid no'} — ${(tender.title || 'Untitled').slice(0, 60)}`,
    detail: {
      bid_no: tender.bid_no || null,
      title: tender.title || null,
      department: tender.department || null,
      last_date: tender.last_date || null,
      emd_amount: tender.emd_amount || null,
    },
  };
}

async function validateLetterhead(db, value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, reason: 'No letterhead chosen.' };

  const col = db.collection(LETTERHEAD_COLLECTION);
  const doc = ObjectId.isValid(raw)
    ? await col.findOne({ _id: new ObjectId(raw) }, { projection: { name: 1, kind: 1 } })
    // The model will echo back the name it was offered rather than the id.
    : await col.findOne({ name: { $regex: escapeRegex(raw), $options: 'i' } }, { projection: { name: 1, kind: 1 } });

  if (!doc) return { ok: false, reason: `No stored letterhead matches "${raw}".` };
  return { ok: true, value: String(doc._id), label: doc.name };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Re-validates every slot against live data.
 *
 * Runs on every turn rather than once at fill time, because a record can be edited or
 * deleted mid-interview and an outline built on a stale lookup would render a document
 * for something that no longer exists.
 */
async function validateSlots(db, slots) {
  const [docType, client, tender, letterhead] = await Promise.all([
    slots.doc_type ? validateDocType(slots.doc_type) : Promise.resolve({ ok: false, reason: 'No document type chosen.' }),
    slots.client_email ? validateClient(db, slots.client_email) : Promise.resolve({ ok: false, reason: 'No client named yet.' }),
    slots.tender_id ? validateTender(db, slots.tender_id) : Promise.resolve({ ok: false, optional: true, reason: 'No tender selected.' }),
    slots.letterhead_id ? validateLetterhead(db, slots.letterhead_id) : Promise.resolve({ ok: false, reason: 'No letterhead chosen.' }),
  ]);

  return { doc_type: docType, client_email: client, tender_id: tender, letterhead_id: letterhead };
}

/** Only what has actually been verified reaches the model as fact. */
function verifiedContextBlock(validated, letterheads) {
  const lines = [];

  lines.push(validated.doc_type.ok
    ? `Document type: CONFIRMED — ${validated.doc_type.label} (${validated.doc_type.value})`
    : `Document type: NOT CONFIRMED — ${validated.doc_type.reason}`);

  lines.push(validated.client_email.ok
    ? `Client: CONFIRMED — ${validated.client_email.label} <${validated.client_email.value}>`
      + (validated.client_email.detail?.gstin ? `, GSTIN ${validated.client_email.detail.gstin}` : '')
      + (validated.client_email.detail?.udyam ? `, Udyam ${validated.client_email.detail.udyam}` : '')
    : `Client: NOT CONFIRMED — ${validated.client_email.reason}`);

  lines.push(validated.tender_id.ok
    ? `Tender: CONFIRMED — ${validated.tender_id.label}`
      + (validated.tender_id.detail?.last_date ? `, closes ${validated.tender_id.detail.last_date}` : '')
      + (validated.tender_id.detail?.emd_amount ? `, EMD ${validated.tender_id.detail.emd_amount}` : '')
    : `Tender: NOT CONFIRMED — ${validated.tender_id.reason}`);

  lines.push(validated.letterhead_id.ok
    ? `Letterhead: CONFIRMED — ${validated.letterhead_id.label}`
    : `Letterhead: NOT CONFIRMED — ${validated.letterhead_id.reason}`);

  if (letterheads.length) {
    lines.push(`Letterheads available: ${letterheads.map((l) => `${l.name} (${l.id})`).join(', ')}`);
  } else {
    lines.push('Letterheads available: NONE — tell the officer to upload one in Letterhead Management.');
  }

  return lines.join('\n');
}

function normaliseOutline(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = (v) => String(v ?? '').trim();
  const title = text(raw.title);
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map((s) => ({ heading: text(s?.heading), content: text(s?.content) }))
    .filter((s) => s.heading || s.content);

  if (!title && !sections.length) return null;

  return {
    title: title || 'Document',
    sections,
    facts_used: (Array.isArray(raw.facts_used) ? raw.facts_used : [])
      .map((f) => ({ label: text(f?.label), value: text(f?.value) }))
      .filter((f) => f.label && f.value),
    placeholders: (Array.isArray(raw.placeholders) ? raw.placeholders : []).map(text).filter(Boolean),
  };
}

// A typed "yes" must not be a second route to generation — it is normalised into the same
// confirm action the button sends, so there is exactly one path to a rendered document.
const AFFIRMATIVE = /^(yes|yep|yeah|ok|okay|confirm|confirmed|approved?|go ahead|generate|proceed|do it|సరే|అవును)\b/i;

async function loadLetterheads(db) {
  const docs = await db.collection(LETTERHEAD_COLLECTION)
    .find({}, { projection: { name: 1, kind: 1 }, limit: 25 })
    .toArray()
    .catch(() => []);
  return docs.map((d) => ({ id: String(d._id), name: d.name, kind: d.kind }));
}

// --- Handler ---------------------------------------------------------------

export async function GET(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const sessionId = new URL(request.url).searchParams.get('session_id');
    if (!sessionId) return NextResponse.json({ error: 'session_id is required.' }, { status: 400 });

    const db = await getDb();
    const session = await loadSession(db, sessionId);
    if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });

    return NextResponse.json({ session: publicSession(session) });
  } catch (error) {
    console.error('[documents/session] load failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => null);
    const action = String(body?.action || 'message');
    const owner = auth.email || auth.actor || 'staff';

    const db = await getDb();

    let session = body?.session_id ? await loadSession(db, body.session_id) : null;
    if (!session) session = emptySession(newSessionId(), owner);

    if (action === 'reset') {
      session = emptySession(session.session_id, owner);
      await saveSession(db, session);
      return NextResponse.json({ session: publicSession(session) });
    }

    // Slots set directly by the UI pickers, which are already real ids — but they still go
    // through the same validation, because the UI is not the authority either.
    if (body?.slots && typeof body.slots === 'object') {
      session.slots = { ...session.slots, ...pickSlots(body.slots) };
      // Any change invalidates an outline the officer may already be looking at.
      if (session.phase === PHASE.OUTLINE_PENDING) {
        session.phase = PHASE.GATHERING;
        session.outline = null;
        session.outline_hash = null;
      }
    }

    if (action === 'confirm') {
      return confirmAndRender(db, session, body, request);
    }

    const userText = String(body?.message || '').trim().slice(0, 4000);
    if (userText) {
      // "Yes" while an outline is on screen means approval, not conversation.
      if (session.phase === PHASE.OUTLINE_PENDING && AFFIRMATIVE.test(userText)) {
        session.messages.push({ role: 'user', text: userText, at: new Date() });
        return confirmAndRender(db, session, { ...body, outline_hash: session.outline_hash }, request);
      }
      session.messages.push({ role: 'user', text: userText, at: new Date() });
    }

    const letterheads = await loadLetterheads(db);
    // Only one letterhead on file means there is nothing to ask about.
    if (!session.slots.letterhead_id && letterheads.length === 1) {
      session.slots.letterhead_id = letterheads[0].id;
    }

    let validated = await validateSlots(db, session.slots);
    const language = resolveAnswerLanguage(userText, body?.language || LANGUAGES.AUTO);

    const prompt = [
      INTERVIEW_PROMPT,
      `\nDOCUMENT TYPES AVAILABLE\n${docTypeCatalogue()}`,
      `\nVERIFIED CONTEXT (the only facts you may treat as established)\n${verifiedContextBlock(validated, letterheads)}`,
      `\nSLOTS RECORDED SO FAR\n${JSON.stringify(session.slots)}`,
      `\nSTILL MISSING: ${missingSlots(validated).join(', ') || 'nothing — produce the outline'}`,
      `\n${languageContract(language)}`,
      `\nCONVERSATION SO FAR\n${renderTranscript(session) || '(the officer has just opened the desk)'}`,
      userText ? `\nOFFICER'S LATEST MESSAGE: ${userText}` : '\nOpen the conversation.',
    ].join('\n');

    let parsed = null;
    try {
      const result = await generateContent({ parts: prompt, tier: 'pro' });
      parsed = parseAIJson(result.text);
    } catch (aiError) {
      console.error('[documents/session] Gemini call failed:', aiError?.message || aiError);
      return NextResponse.json(
        { error: `The AI service did not respond: ${aiError?.message || 'unknown error'}` },
        { status: aiError?.status || 502 },
      );
    }

    if (!parsed) {
      return NextResponse.json({ error: 'The AI returned an unreadable response. Please retry.' }, { status: 502 });
    }

    if (parsed.slots && typeof parsed.slots === 'object') {
      session.slots = { ...session.slots, ...pickSlots(parsed.slots) };
      validated = await validateSlots(db, session.slots);
    }
    session.validated = validated;

    const outline = normaliseOutline(parsed.outline);
    const stillMissing = missingSlots(validated);

    // The model asked to advance; the server decides whether it may. A missing required
    // slot keeps the session in gathering no matter how confident the model sounded.
    if (parsed.phase === PHASE.OUTLINE_PENDING && outline && stillMissing.length === 0) {
      session.phase = PHASE.OUTLINE_PENDING;
      session.outline = outline;
      session.outline_hash = hashOutline(outline);
    } else {
      session.phase = PHASE.GATHERING;
      session.outline = null;
      session.outline_hash = null;
    }

    const reply = String(parsed.reply || '').trim()
      || (stillMissing.length
        ? `I still need: ${stillMissing.join(', ')}.`
        : 'Ready when you are.');

    session.messages.push({
      role: 'assistant',
      text: reply,
      quick_replies: (Array.isArray(parsed.quick_replies) ? parsed.quick_replies : [])
        .map((q) => String(q).trim())
        .filter(Boolean)
        .slice(0, 5),
      at: new Date(),
    });

    session.owner = owner;
    await saveSession(db, session);

    return NextResponse.json({ session: publicSession(session), letterheads });
  } catch (error) {
    console.error('[documents/session] fatal error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

function pickSlots(raw) {
  const out = {};
  for (const key of ['doc_type', 'client_email', 'tender_id', 'letterhead_id', 'instructions']) {
    const value = raw?.[key];
    if (value === null) { out[key] = null; continue; }
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) out[key] = trimmed.slice(0, 2000);
  }
  return out;
}

/**
 * The confirmation gate, and the only path from an outline to a rendered document.
 *
 * Rendering itself is delegated to the existing generate-docs route, unchanged — this
 * function's job is to prove the request is allowed to reach it.
 */
async function confirmAndRender(db, session, body, request) {
  if (session.phase !== PHASE.OUTLINE_PENDING) {
    return NextResponse.json({
      error: 'There is no outline waiting for approval yet.',
      session: publicSession(session),
    }, { status: 409 });
  }

  const submittedHash = String(body?.outline_hash || '');
  if (!submittedHash || submittedHash !== session.outline_hash) {
    // The outline moved between display and approval — asking again is the honest option.
    return NextResponse.json({
      error: 'The outline changed since you approved it. Review the new version and confirm again.',
      session: publicSession(session),
    }, { status: 409 });
  }

  const validated = await validateSlots(db, session.slots);
  const stillMissing = missingSlots(validated);
  if (stillMissing.length) {
    session.phase = PHASE.GATHERING;
    session.validated = validated;
    session.outline = null;
    session.outline_hash = null;
    session.messages.push({
      role: 'system',
      text: `Something changed on file: ${stillMissing.join(', ')} no longer resolves. Let us fix that before generating.`,
      at: new Date(),
    });
    await saveSession(db, session);
    return NextResponse.json({
      error: `Cannot generate — ${stillMissing.join(', ')} no longer resolves.`,
      session: publicSession(session),
    }, { status: 409 });
  }

  session.phase = PHASE.CONFIRMED;
  session.validated = validated;
  await saveSession(db, session);

  const docTypeId = validated.doc_type.value;
  const typesToDraft = docTypeId === 'package_100x' ? PACKAGE_100X_TYPES : [docTypeId];

  const origin = new URL(request.url).origin;
  const forwardedAuth = request.headers.get('authorization');
  const cookie = request.headers.get('cookie');

  const files = [];
  const failures = [];
  let stationery = null;

  for (const type of typesToDraft) {
    const res = await fetch(`${origin}/api/tenders/generate-docs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(forwardedAuth ? { Authorization: forwardedAuth } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({
        doc_type: type,
        client_email: validated.client_email.value,
        tender_id: validated.tender_id.ok ? validated.tender_id.value : undefined,
        letterhead_id: validated.letterhead_id.value,
        format: 'pdf',
      }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      failures.push(data?.error || `Rendering failed (${res.status}).`);
      continue;
    }
    stationery = data.stationery || stationery;
    files.push(...(data.files || []));
  }

  if (!files.length) {
    session.phase = PHASE.OUTLINE_PENDING;
    session.messages.push({
      role: 'system',
      text: failures[0] || 'The document could not be rendered. Nothing was produced.',
      at: new Date(),
    });
    await saveSession(db, session);
    return NextResponse.json({
      error: failures[0] || 'The document could not be rendered.',
      session: publicSession(session),
    }, { status: 502 });
  }

  session.phase = PHASE.RENDERED;
  // The PDF bytes are handed to the browser in this response and never stored — a few MB
  // of base64 per document would push the session document at Mongo's 16MB ceiling.
  session.files = files.map(({ content_base64, ...rest }) => rest);
  session.messages.push({
    role: 'assistant',
    text: `Done — ${files.length} document(s) drafted on ${validated.letterhead_id.label}`
      + (failures.length ? `. ${failures.length} did not render: ${failures[0]}` : '.')
      + ' Download them from the canvas on the right.',
    at: new Date(),
  });
  await saveSession(db, session);

  return NextResponse.json({
    session: publicSession(session),
    // The base64 payloads stay out of the stored session; they are handed over once here.
    files,
    stationery,
    failures,
  });
}
