import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/db';
import { fetchTenderPDFBuffer, isValidPDFBuffer } from '@/lib/cloudflare-r2';
import { searchCopilotKnowledge } from '@/lib/gem-copilot-knowledge';
import {
  cosineSimilarity,
  embedQuery,
  VECTOR_COLLECTION,
  VECTOR_INDEX_NAME,
} from '@/lib/gem-embeddings';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const TOP_K = 3;
const MAX_QUERY_CHARS = 2000;
// Safety valve for the in-memory retrieval fallback: pulling more 768-float vectors than
// this into a serverless function risks the memory limit.
const FALLBACK_SCAN_LIMIT = 2000;

const SYSTEM_PROMPT = `
You are a Senior GeM (Government e-Marketplace) Bidding Expert advising the procurement
team of a professional tender consultancy.

Rules you must follow:
- Answer STRICTLY using the CONTEXT provided below. It is your only source of truth.
- If the context does not contain the answer, say so plainly and state what document or
  detail would be needed. Never fill the gap with general knowledge or guesswork.
- Never invent figures, fee amounts, percentages, clause numbers or dates. Quote them
  only if they appear in the context.
- Be concise and practical. Lead with the direct answer, then the supporting detail.
- Where the context gives a specific rule, threshold or timeline, state it explicitly.
- Write in plain professional English suitable for a bidding officer.
`;

// --- Retrieval -------------------------------------------------------------

async function vectorSearch(db, queryVector) {
  const results = await db.collection(VECTOR_COLLECTION).aggregate([
    {
      $vectorSearch: {
        index: VECTOR_INDEX_NAME,
        path: 'embedding',
        queryVector,
        // Atlas recommends oversampling candidates well beyond the final limit.
        numCandidates: Math.max(TOP_K * 20, 100),
        limit: TOP_K,
      },
    },
    {
      $project: {
        _id: 0,
        text: 1,
        document_title: 1,
        source_url: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]).toArray();

  return results;
}

// Atlas vector indexes are built asynchronously and require an Atlas deployment, so
// $vectorSearch fails outright until the index exists. Rather than leaving the Co-Pilot
// dead in that window, score the chunks in memory. Slower, but correct and self-healing.
async function inMemorySearch(db, queryVector) {
  const chunks = await db.collection(VECTOR_COLLECTION)
    .find({}, { projection: { text: 1, document_title: 1, source_url: 1, embedding: 1, _id: 0 } })
    .limit(FALLBACK_SCAN_LIMIT)
    .toArray();

  return chunks
    .map((chunk) => ({
      text: chunk.text,
      document_title: chunk.document_title,
      source_url: chunk.source_url,
      score: cosineSimilarity(queryVector, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
}

/**
 * Prefer the Sunday-harvested `gem_copilot_knowledge` store (local memory + R2)
 * before spending Atlas vector / live embedding quota.
 */
async function retrieveCopilotMemory(db, query) {
  try {
    const docs = await searchCopilotKnowledge(db, query, { limit: TOP_K });
    if (!docs.length) return null;

    return {
      results: docs.map((d) => ({
        text: String(d.content_text || '').slice(0, 6000),
        document_title: d.title || 'GeM Co-Pilot knowledge',
        source_url: d.r2_url || d.source_url || null,
        score: Number(d.score || 1),
        type: 'copilot_memory',
      })),
      strategy: 'gem_copilot_knowledge',
    };
  } catch (err) {
    console.warn('[ai/chat] gem_copilot_knowledge lookup failed:', err?.message || err);
    return null;
  }
}

async function retrieveGemKnowledge(db, query) {
  // 1) Cached Co-Pilot memory first (Sunday scraper / weekly cron).
  const memory = await retrieveCopilotMemory(db, query);
  if (memory?.results?.length) return memory;

  // 2) Fall back to embedded vector KB (daily gem-sync).
  const queryVector = await embedQuery(query);

  try {
    const results = await vectorSearch(db, queryVector);
    if (results.length > 0) return { results, strategy: 'atlas_vector_search' };
    // An empty result from a healthy index means the KB is genuinely empty; fall through
    // so the caller can tell the user to run the sync job.
    return { results, strategy: 'atlas_vector_search' };
  } catch (err) {
    console.warn('[ai/chat] $vectorSearch unavailable, falling back to in-memory scoring:', err?.message || err);
    return { results: await inMemorySearch(db, queryVector), strategy: 'in_memory_fallback' };
  }
}

// --- Tender-scoped context -------------------------------------------------

async function loadTenderContext(db, tenderId) {
  const projection = {
    projection: {
      title: 1, department: 1, bid_no: 1, last_date: 1, district: 1,
      category: 1, emd_amount: 1, supply_details: 1,
      pdf_url: 1, pdf_r2_key: 1, pdf_filename: 1, pdf_base64: 1,
    },
  };

  const candidates = [];
  if (ObjectId.isValid(tenderId)) {
    try { candidates.push({ _id: new ObjectId(tenderId) }); } catch (_) { /* not an ObjectId */ }
  }
  candidates.push({ _id: tenderId }, { id: tenderId });

  let tender = null;
  for (const filter of candidates) {
    tender = await db.collection('tenders').findOne(filter, projection);
    if (tender) break;
  }
  if (!tender) return null;

  const summary = [
    `Bid Number: ${tender.bid_no || 'not recorded'}`,
    `Title: ${tender.title || 'not recorded'}`,
    `Department: ${tender.department || 'not recorded'}`,
    `Last Date: ${tender.last_date || 'not recorded'}`,
    `District: ${tender.district || 'not recorded'}`,
    `Category: ${tender.category || 'not recorded'}`,
    `EMD Amount: ${tender.emd_amount || 'not recorded'}`,
    tender.supply_details ? `Supply Details: ${tender.supply_details}` : null,
  ].filter(Boolean).join('\n');

  // Attach the source PDF so the model reads the actual document rather than only the
  // handful of fields we extracted from it. Gemini reads PDFs natively.
  let pdfBuffer = await fetchTenderPDFBuffer({
    pdf_url: tender.pdf_url,
    pdf_filename: tender.pdf_filename,
    pdf_r2_key: tender.pdf_r2_key,
  });

  if ((!pdfBuffer || !isValidPDFBuffer(pdfBuffer)) && typeof tender.pdf_base64 === 'string') {
    const legacy = Buffer.from(tender.pdf_base64.replace(/^data:[^;,]*(;base64)?,/, ''), 'base64');
    pdfBuffer = isValidPDFBuffer(legacy) ? legacy : null;
  }

  return {
    title: tender.title || tender.bid_no || 'Selected tender',
    summary,
    pdfBuffer: pdfBuffer && isValidPDFBuffer(pdfBuffer) ? pdfBuffer : null,
  };
}

// --- Handler ---------------------------------------------------------------

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const query = String(body?.query || '').trim().slice(0, MAX_QUERY_CHARS);
    const tenderId = body?.tender_id ? String(body.tender_id) : null;

    if (!query) {
      return NextResponse.json({ error: 'Please enter a question.' }, { status: 400 });
    }
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured on this server.' }, { status: 500 });
    }

    const db = await getDb();
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // 🚀 FIX: gemini-1.5-flash is retired; gemini-3.6-flash is what this account's
    // GEMINI_API_KEY is actually entitled to (verified live).
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const parts = [];
    let sources = [];
    let mode;
    let retrieval;

    if (tenderId) {
      // Context Logic A — strictly bounded to this one tender.
      const tender = await loadTenderContext(db, tenderId);
      if (!tender) {
        return NextResponse.json({ error: 'That tender could not be found.' }, { status: 404 });
      }

      mode = 'tender';
      sources = [{ title: tender.title, type: 'tender' }];

      parts.push(
        `${SYSTEM_PROMPT}\n\n` +
        `CONTEXT — the officer is asking about this specific live tender.\n\n` +
        `${tender.summary}\n\n` +
        (tender.pdfBuffer
          ? 'The full tender document is attached. Base your answer only on these details and that document.'
          : 'The source PDF could not be retrieved, so only the recorded fields above are available. ' +
            'Say so if the question needs detail from the document itself.') +
        `\n\nQUESTION: ${query}`
      );

      if (tender.pdfBuffer) {
        parts.push({
          inlineData: { data: tender.pdfBuffer.toString('base64'), mimeType: 'application/pdf' },
        });
      }
    } else {
      // Context Logic B — retrieve the most relevant GeM rules.
      mode = 'gem_knowledge';
      const knowledge = await retrieveGemKnowledge(db, query);
      const { results, strategy } = knowledge;
      retrieval = strategy;

      if (results.length === 0) {
        return NextResponse.json({
          answer:
            'My GeM knowledge base is empty, so I have no source material to answer from. ' +
            'Please run the Sunday Co-Pilot harvest (/api/cron/gem-copilot-knowledge) or the ' +
            'daily GeM sync (/api/cron/gem-sync) and try again.',
          sources: [],
          mode,
          retrieval: strategy,
        });
      }

      sources = results.map((r) => ({
        title: r.document_title,
        url: r.source_url || null,
        score: Number(r.score?.toFixed?.(4) ?? r.score ?? 0),
        type: r.type === 'copilot_memory' ? 'copilot_memory' : 'gem_rule',
      }));

      const contextLabel = strategy === 'gem_copilot_knowledge'
        ? 'cached GeM Co-Pilot knowledge (local memory)'
        : 'GeM knowledge base';

      const context = results
        .map((r, i) => `--- SOURCE ${i + 1}: ${r.document_title} ---\n${r.text}`)
        .join('\n\n');

      parts.push(
        `${SYSTEM_PROMPT}\n\n` +
        `CONTEXT — extracts from the ${contextLabel}:\n\n${context}\n\n` +
        `QUESTION: ${query}`
      );
    }

    let answer;
    try {
      const result = await model.generateContent(parts);
      answer = result.response.text();
    } catch (aiError) {
      console.error('[ai/chat] Gemini call failed:', aiError?.message || aiError);
      return NextResponse.json(
        { error: `The AI service did not respond: ${aiError?.message || 'unknown error'}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ answer, sources, mode, retrieval });
  } catch (error) {
    console.error('[ai/chat] fatal error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}
