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

// Atlas Vector Search indexes are built asynchronously and can't be defined in a normal
// createIndex call, so the sync job bootstraps it here. Safe to call repeatedly.
export async function ensureVectorIndex(db) {
  const collection = db.collection(VECTOR_COLLECTION);

  try {
    const existing = await collection.listSearchIndexes().toArray();
    if (existing.some((idx) => idx.name === VECTOR_INDEX_NAME)) {
      return { created: false, reason: 'already exists' };
    }
  } catch (err) {
    // listSearchIndexes throws on deployments without Atlas Search (e.g. a local mongod).
    return { created: false, reason: `search indexes unavailable: ${err?.message || err}` };
  }

  try {
    await collection.createSearchIndex({
      name: VECTOR_INDEX_NAME,
      type: 'vectorSearch',
      definition: {
        fields: [
          { type: 'vector', path: 'embedding', numDimensions: EMBEDDING_DIMENSIONS, similarity: 'cosine' },
          { type: 'filter', path: 'document_id' },
        ],
      },
    });
    return { created: true, reason: 'index build started (takes ~1 minute to become queryable)' };
  } catch (err) {
    return { created: false, reason: `createSearchIndex failed: ${err?.message || err}` };
  }
}
