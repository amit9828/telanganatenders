import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { generateContent } from '@/lib/gemini';
import { fetchTenderPDFBuffer, isValidPDFBuffer } from '@/lib/cloudflare-r2';
import { searchCopilotKnowledge, isUsableCopilotText } from '@/lib/gem-copilot-knowledge';
import { findTenderByAnyId, suggestSimilarTenders } from '@/lib/tender-lookup';
import { appendTurn, listConversations, loadConversation, renderHistory } from '@/lib/copilot-memory';
import { requireStaff } from '@/lib/staff-auth';
import { embedTexts, searchVectors } from '@/lib/gem-embeddings';
import { LANGUAGES, languageContract, resolveAnswerLanguage } from '@/lib/language';
import { translateQueryToEnglish } from '@/lib/language-server';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const TOP_K = 3;
// The bid's own SOW/ATC deserve a wider window than the global rule base: this is the
// material the question is actually about.
const BID_TOP_K = 6;
const MAX_QUERY_CHARS = 2000;
const MAX_CHUNK_CHARS = 4000;

const SYSTEM_PROMPT = `
You are a Senior GeM (Government e-Marketplace) Bidding Expert advising the procurement
team of a professional tender consultancy.

Rules you must follow:
- Answer STRICTLY using the CONTEXT provided below. It is your only source of truth.
- If the context does not contain the answer, say so plainly and state what document or
  detail would be needed. Never fill the gap with general knowledge or guesswork.
- Never invent figures, fee amounts, percentages, clause numbers or dates. Quote them
  only if they appear in the context.
- When the context is labelled with a source (for example [S2] Scope of Work), cite that
  label inline after the statement it supports, like this: "EMD is Rs 50,000 [S2]."
- Where a bid document and the general GeM rules disagree, the bid document wins — say so
  explicitly rather than averaging the two.
- Be concise and practical. Lead with the direct answer, then the supporting detail.
`.trim();

// --- Retrieval -------------------------------------------------------------

/**
 * Embeds the question, plus its English translation when the question is in Telugu.
 *
 * The corpus is English, so a Telugu query embedded on its own retrieves poorly. We
 * translate the QUERY (never the documents — translating the corpus would compound
 * translation error into every future retrieval) and search with both vectors.
 */
async function buildQueryVectors(query, englishQuery) {
  const texts = englishQuery && englishQuery !== query ? [query, englishQuery] : [query];
  const vectors = await embedTexts(texts, 'RETRIEVAL_QUERY');
  if (!vectors.length) throw new Error('Failed to embed the query.');
  return vectors;
}

/** Runs every query vector and keeps each chunk once, at its best score. */
async function multiVectorSearch(db, queryVectors, options) {
  const best = new Map();
  let strategy = null;

  for (const vector of queryVectors) {
    const result = await searchVectors(db, vector, options);
    strategy = result.strategy;
    for (const chunk of result.results) {
      const key = chunk.document_id ? `${chunk.document_id}::${chunk.chunk_index}` : chunk.text?.slice(0, 120);
      const existing = best.get(key);
      if (!existing || (chunk.score || 0) > (existing.score || 0)) best.set(key, chunk);
    }
  }

  const results = [...best.values()]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, options.limit);

  return { results, strategy };
}

/**
 * Prefer the Sunday-harvested `gem_copilot_knowledge` store (local memory + R2)
 * before spending Atlas vector / live embedding quota.
 */
async function retrieveCopilotMemory(db, query, limit) {
  try {
    const docs = await searchCopilotKnowledge(db, query, { limit });
    if (!docs.length) return null;

    const results = docs
      // 🚀 FIX: searchCopilotKnowledge already excludes extraction_ok:false docs,
      // but this is a defense-in-depth belt-and-suspenders check — a doc with no
      // usable text (legacy record predating the extraction_ok flag, etc.) must
      // never be handed to Gemini as "context", or it reports empty/missing
      // extractions instead of correctly falling through to the vector KB below.
      .filter((d) => isUsableCopilotText(d.content_text))
      .map((d) => ({
        text: String(d.content_text || '').slice(0, 6000),
        document_title: d.title || 'GeM Co-Pilot knowledge',
        source_url: d.r2_url || d.source_url || null,
        score: Number(d.score || 1),
        type: 'copilot_memory',
      }));

    if (!results.length) return null;

    return { results, strategy: 'gem_copilot_knowledge' };
  } catch (err) {
    console.warn('[ai/chat] gem_copilot_knowledge lookup failed:', err?.message || err);
    return null;
  }
}

/** Portal-wide GeM rules, policies and GTC — not specific to any one bid. */
async function retrieveGemKnowledge(db, query, queryVectors, limit = TOP_K) {
  const memory = await retrieveCopilotMemory(db, query, limit);
  if (memory?.results?.length) return memory;

  const vectors = queryVectors || (await buildQueryVectors(query, null));
  // Over-fetch, then drop bid-scoped chunks: a clause from someone else's tender is not a
  // GeM rule. Filtering here rather than in the query keeps rule chunks written before
  // `bid_no` existed (where the field is absent, not null) retrievable.
  const { results, strategy } = await multiVectorSearch(db, vectors, { limit: limit * 3 });
  return { results: results.filter((r) => !r.bid_no).slice(0, limit), strategy };
}

/** Everything this consultancy has read out of one bid's own document set. */
async function retrieveBidDossier(db, bidNo, queryVectors) {
  if (!bidNo) return { results: [], strategy: null };
  try {
    return await multiVectorSearch(db, queryVectors, { limit: BID_TOP_K, bidNo });
  } catch (err) {
    console.warn('[ai/chat] bid dossier retrieval failed:', err?.message || err);
    return { results: [], strategy: null };
  }
}

// --- Tender-scoped context -------------------------------------------------

async function loadTenderContext(db, tenderId) {
  // 🚀 FIX: this used to match only `_id`/`id`, so a bid number typed into the chat
  // ("GEM/2026/B/7938430") could never resolve and every such question died on
  // "That tender could not be found." findTenderByAnyId also matches bid numbers,
  // ignoring case and separator noise, plus the aliases the AI reads off the PDF.
  const tender = await findTenderByAnyId(db, tenderId, {
    projection: {
      title: 1, department: 1, bid_no: 1, bid_no_aliases: 1, last_date: 1, district: 1,
      category: 1, emd_amount: 1, supply_details: 1, bid_dossier: 1,
      pdf_url: 1, pdf_r2_key: 1, pdf_filename: 1, pdf_base64: 1,
    },
  });
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
    id: String(tender._id),
    title: tender.title || tender.bid_no || 'Selected tender',
    bidNo: tender.bid_dossier?.bid_no || tender.bid_no || null,
    dossier: tender.bid_dossier || null,
    summary,
    pdfBuffer: pdfBuffer && isValidPDFBuffer(pdfBuffer) ? pdfBuffer : null,
  };
}

/** Numbered context block plus the matching citation list the UI renders. */
function buildCitedContext(groups) {
  const lines = [];
  const sources = [];
  let index = 0;

  for (const group of groups) {
    for (const chunk of group.chunks) {
      index += 1;
      const label = `S${index}`;
      const title = chunk.document_title || group.label;
      lines.push(`--- [${label}] ${group.label}: ${title} ---\n${String(chunk.text || '').slice(0, MAX_CHUNK_CHARS)}`);
      sources.push({
        label,
        title,
        url: chunk.source_url || null,
        doc_type: chunk.doc_type || null,
        score: Number(chunk.score?.toFixed?.(4) ?? chunk.score ?? 0),
        type: group.type,
      });
    }
  }

  return { context: lines.join('\n\n'), sources };
}

// --- Handler ---------------------------------------------------------------

/**
 * Restores a saved thread so reopening the Co-Pilot does not start from a blank page.
 * With no `conversation_id`, returns the caller's recent conversations.
 */
export async function GET(request) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversation_id');

    if (conversationId) {
      const conversation = await loadConversation(db, conversationId);
      if (!conversation) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
      return NextResponse.json({
        conversation_id: conversation.conversation_id,
        tender_id: conversation.tender_id || null,
        messages: (conversation.messages || []).map((m) => ({
          role: m.role,
          text: m.text,
          sources: m.sources || [],
          at: m.at,
        })),
      });
    }

    const auth = await requireStaff(request).catch(() => ({ ok: false }));
    const owner = auth.ok ? (auth.email || auth.actor || 'staff') : 'staff';
    return NextResponse.json({ conversations: await listConversations(db, owner) });
  } catch (error) {
    console.error('[ai/chat] history load failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const query = String(body?.query || '').trim().slice(0, MAX_QUERY_CHARS);
    const tenderId = body?.tender_id ? String(body.tender_id) : null;
    const conversationId = body?.conversation_id ? String(body.conversation_id) : null;
    const languagePreference = [LANGUAGES.ENGLISH, LANGUAGES.TELUGU, LANGUAGES.AUTO]
      .includes(body?.language) ? body.language : LANGUAGES.AUTO;

    if (!query) {
      return NextResponse.json({ error: 'Please enter a question.' }, { status: 400 });
    }

    const db = await getDb();

    // Identity is best-effort: the floating client-side Co-Pilot is unauthenticated, and
    // it only decides which transcript a turn is filed under.
    const auth = await requireStaff(request).catch(() => ({ ok: false }));
    const owner = auth.ok ? (auth.email || auth.actor || 'staff') : 'staff';

    // Prior turns of this conversation, so follow-ups like "and its EMD?" resolve.
    const conversation = await loadConversation(db, conversationId);
    const history = renderHistory(conversation);

    const answerLanguage = resolveAnswerLanguage(query, languagePreference);
    // Retrieval always runs in English because the corpus is English; only the reply is
    // written in the officer's language.
    const englishQuery = await translateQueryToEnglish(query);
    const retrievalQuery = englishQuery || query;

    const parts = [];
    let sources = [];
    let mode;
    let retrieval;
    let dossierStatus = null;

    if (tenderId) {
      // Context Logic A — the officer is asking about one specific bid.
      const tender = await loadTenderContext(db, tenderId);
      if (!tender) {
        // A bare "not found" hides the real cause, which is almost always a bid number
        // typed into the tender record that disagrees with the one printed on the PDF.
        const suggestions = await suggestSimilarTenders(db, tenderId);
        return NextResponse.json({
          error: suggestions.length
            ? `No tender is recorded under ${tenderId}. Closest matches on file: `
              + `${suggestions.map((s) => s.bid_no || s.id).join(', ')}.`
            : `No tender is recorded under ${tenderId}. Publish it, or open the tender in the dashboard and ask again.`,
          suggestions,
        }, { status: 404 });
      }

      mode = 'tender';

      let queryVectors = [];
      try {
        queryVectors = await buildQueryVectors(query, englishQuery);
      } catch (err) {
        console.warn('[ai/chat] query embedding failed, falling back to PDF-only context:', err?.message || err);
      }

      // Hybrid: the bid's own ingested SOW/ATC, then the portal-wide rules.
      const [bid, global] = await Promise.all([
        queryVectors.length ? retrieveBidDossier(db, tender.bidNo, queryVectors) : { results: [], strategy: null },
        queryVectors.length
          ? retrieveGemKnowledge(db, retrievalQuery, queryVectors, 2).catch(() => ({ results: [], strategy: null }))
          : { results: [], strategy: null },
      ]);

      retrieval = bid.strategy || global.strategy || 'inline_pdf_only';
      dossierStatus = {
        bid_no: tender.bidNo,
        ingested: tender.dossier?.summary?.ingested || 0,
        pending: (tender.dossier?.documents || []).filter((d) => d.status === 'pending').length,
        needs_local_agent: tender.dossier?.summary?.needs_local_agent || 0,
        chunks_matched: bid.results.length,
      };

      const cited = buildCitedContext([
        { label: 'Bid dossier', type: 'bid_document', chunks: bid.results },
        { label: 'GeM rules', type: 'gem_rule', chunks: global.results },
      ]);

      sources = [
        { label: 'S0', title: tender.title, type: 'tender', url: null },
        ...cited.sources,
      ];

      const dossierNote = bid.results.length
        ? `The extracts below come from this bid's own documents (${dossierStatus.ingested} document(s) ingested).`
        : tender.dossier
          ? 'This bid\'s linked documents have not all been ingested yet, so answer only from the attached PDF and say '
            + 'plainly when the answer would require the Scope of Work or buyer ATC.'
          : 'No document dossier has been built for this bid yet. Answer from the attached PDF alone and say plainly '
            + 'when the answer would require the Scope of Work or buyer ATC.';

      parts.push(
        `${SYSTEM_PROMPT}\n\n${languageContract(answerLanguage)}\n\n`
        + (history ? `EARLIER IN THIS CONVERSATION:\n${history}\n\n` : '')
        + `CONTEXT — the officer is asking about this specific live tender.\n\n`
        + `[S0] TENDER RECORD\n${tender.summary}\n\n`
        + (cited.context ? `${cited.context}\n\n` : '')
        + dossierNote + '\n'
        + (tender.pdfBuffer
          ? 'The primary bid document is attached in full. Read it directly for anything the extracts above do not cover.'
          : 'The source PDF could not be retrieved, so only the recorded fields and extracts above are available.')
        + `\n\nQUESTION (as asked by the officer): ${query}`
        + (englishQuery ? `\nENGLISH RENDERING OF THE QUESTION (for your comprehension only): ${englishQuery}` : '')
      );

      if (tender.pdfBuffer) {
        parts.push({
          inlineData: { data: tender.pdfBuffer.toString('base64'), mimeType: 'application/pdf' },
        });
      }
    } else {
      // Context Logic B — a general GeM question, answered from the rule base.
      mode = 'gem_knowledge';

      let queryVectors = [];
      try {
        queryVectors = await buildQueryVectors(query, englishQuery);
      } catch (err) {
        console.warn('[ai/chat] query embedding failed:', err?.message || err);
      }

      const knowledge = await retrieveGemKnowledge(db, retrievalQuery, queryVectors.length ? queryVectors : null);
      const { results, strategy } = knowledge;
      retrieval = strategy;

      if (results.length === 0) {
        return NextResponse.json({
          answer: answerLanguage === LANGUAGES.TELUGU
            ? 'నా GeM నాలెడ్జ్ బేస్ ఖాళీగా ఉంది, కాబట్టి సమాధానం ఇవ్వడానికి నా వద్ద ఆధార పత్రాలు లేవు. '
              + 'దయచేసి Sunday Co-Pilot harvest (/api/cron/gem-copilot-knowledge) లేదా daily GeM sync '
              + '(/api/cron/gem-sync) ఒకసారి రన్ చేసి మళ్ళీ ప్రయత్నించండి.'
            : 'My GeM knowledge base is empty, so I have no source material to answer from. '
              + 'Please run the Sunday Co-Pilot harvest (/api/cron/gem-copilot-knowledge) or the '
              + 'daily GeM sync (/api/cron/gem-sync) and try again.',
          sources: [],
          mode,
          retrieval: strategy,
          language: answerLanguage,
        });
      }

      const contextLabel = strategy === 'gem_copilot_knowledge'
        ? 'cached GeM Co-Pilot knowledge (local memory)'
        : 'GeM knowledge base';

      const cited = buildCitedContext([
        { label: contextLabel, type: 'gem_rule', chunks: results },
      ]);
      sources = cited.sources.map((s) => ({
        ...s,
        type: results[0]?.type === 'copilot_memory' ? 'copilot_memory' : 'gem_rule',
      }));

      parts.push(
        `${SYSTEM_PROMPT}\n\n${languageContract(answerLanguage)}\n\n`
        + (history ? `EARLIER IN THIS CONVERSATION:\n${history}\n\n` : '')
        + `CONTEXT — extracts from the ${contextLabel}:\n\n${cited.context}\n\n`
        + `QUESTION (as asked by the officer): ${query}`
        + (englishQuery ? `\nENGLISH RENDERING OF THE QUESTION (for your comprehension only): ${englishQuery}` : '')
      );
    }

    let answer;
    let model;
    try {
      // Pro tier: bid documents are legal text where a paraphrase is a wrong answer.
      const result = await generateContent({ parts, tier: 'pro' });
      answer = result.text;
      model = result.model;
    } catch (aiError) {
      console.error('[ai/chat] Gemini call failed:', aiError?.message || aiError);
      return NextResponse.json(
        { error: `The AI service did not respond: ${aiError?.message || 'unknown error'}` },
        { status: aiError?.status || 502 }
      );
    }

    const savedConversationId = await appendTurn(db, {
      conversationId,
      owner,
      tenderId,
      question: query,
      answer,
      sources,
      mode,
      model,
    });

    return NextResponse.json({
      answer,
      sources,
      mode,
      retrieval,
      model,
      language: answerLanguage,
      dossier: dossierStatus,
      conversation_id: savedConversationId,
    });
  } catch (error) {
    console.error('[ai/chat] fatal error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}
