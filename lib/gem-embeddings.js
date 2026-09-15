// Embedding + chunking utilities for the GeM Co-Pilot knowledge base.
//
// These call the Generative Language REST API directly rather than going through
// @google/generative-ai. The installed SDK (0.1.3) is pinned to API `v1`, which does not
// expose `text-embedding-004`; hitting `v1beta` ourselves keeps the dependency untouched
// and lets us batch requests and set taskType, which the old SDK cannot do.

import { getGeminiApiKey } from './env.js';

const EMBEDDING_MODEL = 'text-embedding-004';
export const EMBEDDING_DIMENSIONS = 768;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// The API rejects oversized batches; 100 inputs per call is comfortably inside the limit.
const EMBED_BATCH_SIZE = 100;

// ~1000 tokens. English averages ~4 characters per token, and the overlap keeps a rule
// that straddles a boundary retrievable from either chunk.
const CHUNK_CHARS = 4000;
const CHUNK_OVERLAP_CHARS = 400;

export const VECTOR_COLLECTION = 'gem_knowledge_vectors';
export const VECTOR_INDEX_NAME = 'gem_vector_index';

// Collapses the whitespace soup that comes out of HTML and PDF extraction, which
// otherwise wastes a large share of every chunk's token budget.
export function normaliseWhitespace(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Splits text into overlapping chunks, preferring paragraph then sentence boundaries so
// a chunk rarely ends mid-rule.
export function chunkText(text, { chunkChars = CHUNK_CHARS, overlap = CHUNK_OVERLAP_CHARS } = {}) {
  const clean = normaliseWhitespace(text);
  if (!clean) return [];
  if (clean.length <= chunkChars) return [clean];

  const chunks = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + chunkChars, clean.length);

    if (end < clean.length) {
      // Look for a clean break in the last quarter of the window.
      const windowStart = start + Math.floor(chunkChars * 0.75);
      const paragraphBreak = clean.lastIndexOf('\n\n', end);
      const sentenceBreak = clean.lastIndexOf('. ', end);
      if (paragraphBreak > windowStart) end = paragraphBreak;
      else if (sentenceBreak > windowStart) end = sentenceBreak + 1;
    }

    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);

    if (end >= clean.length) break;
    // Always advance, even if the overlap would otherwise put us back where we started.
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function requireApiKey() {
  const key = getGeminiApiKey();
  if (!key) throw new Error('GEMINI_API_KEY is not configured on this server.');
  return key;
}

/**
 * Embeds a list of strings.
 *
 * @param {string[]} texts
 * @param {'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'} taskType
 *   Document and query embeddings are asymmetric in this model family — using the wrong
 *   taskType measurably degrades retrieval quality.
 * @returns {Promise<number[][]>}
 */
export async function embedTexts(texts, taskType = 'RETRIEVAL_DOCUMENT') {
  const inputs = (texts || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (inputs.length === 0) return [];

  const apiKey = requireApiKey();
  const vectors = [];

  for (let i = 0; i < inputs.length; i += EMBED_BATCH_SIZE) {
    const batch = inputs.slice(i, i + EMBED_BATCH_SIZE);

    const res = await fetch(`${API_BASE}/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          taskType,
        })),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Embedding request failed (${res.status}): ${detail.slice(0, 300)}`);
    }

    const data = await res.json();
    const batchVectors = (data?.embeddings || []).map((e) => e?.values).filter(Array.isArray);
    if (batchVectors.length !== batch.length) {
      throw new Error(`Embedding API returned ${batchVectors.length} vectors for ${batch.length} inputs.`);
    }
    vectors.push(...batchVectors);
  }

  return vectors;
}

export async function embedQuery(query) {
  const [vector] = await embedTexts([query], 'RETRIEVAL_QUERY');
  if (!vector) throw new Error('Failed to embed the query.');
  return vector;
}

// Used by the in-memory retrieval fallback when the Atlas vector index is unavailable.
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// `bid_no` scopes a query to one bid's dossier so a question about GEM/2026/B/123 cannot
// retrieve a clause from an unrelated tender; `doc_type` narrows to SOW or ATC when the
// question names one.
const VECTOR_INDEX_DEFINITION = {
  fields: [
    { type: 'vector', path: 'embedding', numDimensions: EMBEDDING_DIMENSIONS, similarity: 'cosine' },
    { type: 'filter', path: 'document_id' },
    { type: 'filter', path: 'bid_no' },
    { type: 'filter', path: 'doc_type' },
  ],
};

/** Filter paths present in an existing index, for comparing against the definition above. */
function indexFilterPaths(index) {
  const fields = index?.latestDefinition?.fields || index?.definition?.fields || [];
  return new Set(fields.filter((f) => f.type === 'filter').map((f) => f.path));
}

// Atlas Vector Search indexes are built asynchronously and can't be defined in a normal
// createIndex call, so the sync job bootstraps it here. Safe to call repeatedly.
export async function ensureVectorIndex(db) {
  const collection = db.collection(VECTOR_COLLECTION);

  let existing = null;
  try {
    const indexes = await collection.listSearchIndexes().toArray();
    existing = indexes.find((idx) => idx.name === VECTOR_INDEX_NAME) || null;
  } catch (err) {
    // listSearchIndexes throws on deployments without Atlas Search (e.g. a local mongod).
    return { created: false, reason: `search indexes unavailable: ${err?.message || err}` };
  }

  if (existing) {
    // An index created before per-bid filtering existed cannot answer a filtered query —
    // Atlas rejects a filter on an unindexed path outright. Adding a field is an update,
    // not a create, so this branch is what migrates a live deployment.
    const wanted = VECTOR_INDEX_DEFINITION.fields.filter((f) => f.type === 'filter').map((f) => f.path);
    const present = indexFilterPaths(existing);
    const missing = wanted.filter((path) => !present.has(path));
    if (missing.length === 0) return { created: false, reason: 'already exists' };

    try {
      await collection.updateSearchIndex(VECTOR_INDEX_NAME, VECTOR_INDEX_DEFINITION);
      return {
        created: false,
        updated: true,
        reason: `added filter field(s): ${missing.join(', ')} — Atlas rebuilds the index in the background`,
      };
    } catch (err) {
      return { created: false, reason: `updateSearchIndex failed: ${err?.message || err}` };
    }
  }

  try {
    await collection.createSearchIndex({
      name: VECTOR_INDEX_NAME,
      type: 'vectorSearch',
      definition: VECTOR_INDEX_DEFINITION,
    });
    return { created: true, reason: 'index build started (takes ~1 minute to become queryable)' };
  } catch (err) {
    return { created: false, reason: `createSearchIndex failed: ${err?.message || err}` };
  }
}

// Safety valve for the in-memory fallback: pulling more 768-float vectors than this into
// a serverless function risks the memory limit.
const FALLBACK_SCAN_LIMIT = 2000;

const RESULT_PROJECTION = {
  _id: 0,
  text: 1,
  document_title: 1,
  document_id: 1,
  source_url: 1,
  bid_no: 1,
  doc_type: 1,
  chunk_index: 1,
};

/**
 * Semantic search over the chunk store, optionally scoped to one bid.
 *
 * Falls back to in-memory cosine scoring when $vectorSearch is unavailable — which is not
 * only the "no Atlas" case but also the window while Atlas rebuilds the index after a
 * definition change, when a filtered query on a not-yet-indexed path is rejected.
 *
 * @param {import('mongodb').Db} db
 * @param {number[]} queryVector
 * @param {{limit?: number, bidNo?: string|null, docTypes?: string[]|null, excludeBid?: boolean}} [options]
 * @returns {Promise<{results: object[], strategy: string}>}
 */
export async function searchVectors(db, queryVector, { limit = 5, bidNo = null, docTypes = null, excludeBid = false } = {}) {
  const collection = db.collection(VECTOR_COLLECTION);

  const filter = {};
  if (bidNo) filter.bid_no = excludeBid ? { $ne: bidNo } : bidNo;
  if (docTypes?.length) filter.doc_type = { $in: docTypes };

  try {
    const results = await collection.aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: 'embedding',
          queryVector,
          // Atlas recommends oversampling candidates well beyond the final limit.
          numCandidates: Math.max(limit * 20, 100),
          limit,
          ...(Object.keys(filter).length ? { filter } : {}),
        },
      },
      { $project: { ...RESULT_PROJECTION, score: { $meta: 'vectorSearchScore' } } },
    ]).toArray();

    return { results, strategy: 'atlas_vector_search' };
  } catch (err) {
    console.warn('[gem-embeddings] $vectorSearch unavailable, scoring in memory:', err?.message || err);

    const mongoFilter = {};
    if (bidNo) mongoFilter.bid_no = excludeBid ? { $ne: bidNo } : bidNo;
    if (docTypes?.length) mongoFilter.doc_type = { $in: docTypes };

    const chunks = await collection
      .find(mongoFilter, { projection: { ...RESULT_PROJECTION, embedding: 1 } })
      .limit(FALLBACK_SCAN_LIMIT)
      .toArray();

    const results = chunks
      .map(({ embedding, ...chunk }) => ({ ...chunk, score: cosineSimilarity(queryVector, embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return { results, strategy: 'in_memory_fallback' };
  }
}
