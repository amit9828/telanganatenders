// Reusable chunk → embed → upsert pipeline for the shared vector store.
//
// The nightly GeM rules sync had this logic inline. The per-bid dossier ingestion needs
// exactly the same behaviour, so it lives here once. Chunk ids are deterministic, which
// is what makes a re-ingest overwrite in place instead of duplicating a document.

import {
  chunkText,
  embedTexts,
  normaliseWhitespace,
  VECTOR_COLLECTION,
} from './gem-embeddings.js';

/**
 * Replaces a document's vectors.
 *
 * @param {import('mongodb').Db} db
 * @param {object}  doc
 * @param {string}  doc.documentId  Stable id; re-ingesting the same id overwrites.
 * @param {string}  doc.title
 * @param {string}  doc.text
 * @param {string} [doc.sourceUrl]
 * @param {string} [doc.bidNo]      Scopes the chunk to one bid for filtered retrieval.
 * @param {string} [doc.docType]    SOW / ATC / BOQ / BID_DOCUMENT / CORRIGENDUM.
 * @returns {Promise<{chunks: number}>}
 */
export async function ingestDocumentVectors(db, { documentId, title, text, sourceUrl = null, bidNo = null, docType = null }) {
  const clean = normaliseWhitespace(text);
  const chunks = chunkText(clean);
  if (chunks.length === 0) return { chunks: 0 };

  const collection = db.collection(VECTOR_COLLECTION);
  const vectors = await embedTexts(chunks, 'RETRIEVAL_DOCUMENT');
  const timestamp = new Date();

  const operations = chunks.map((chunk, index) => ({
    updateOne: {
      filter: { chunk_id: `${documentId}::${index}` },
      update: {
        $set: {
          chunk_id: `${documentId}::${index}`,
          document_id: documentId,
          document_title: title,
          source_url: sourceUrl,
          bid_no: bidNo,
          doc_type: docType,
          chunk_index: index,
          text: chunk,
          embedding: vectors[index],
          timestamp,
        },
      },
      upsert: true,
    },
  }));

  await collection.bulkWrite(operations, { ordered: false });

  // Drop chunks left over from a previous, longer version of this document.
  await collection.deleteMany({ document_id: documentId, chunk_index: { $gte: chunks.length } });

  return { chunks: chunks.length };
}

/** Deterministic vector id for one document of one bid. */
export function bidDocumentId(bidNo, docType, index = 0) {
  const slug = String(bidNo || 'unknown').toUpperCase().replace(/[^A-Z0-9]+/g, '-');
  return `bid::${slug}::${String(docType || 'DOC').toUpperCase()}::${index}`;
}

export async function deleteBidVectors(db, bidNo) {
  if (!bidNo) return { deleted: 0 };
  const result = await db.collection(VECTOR_COLLECTION).deleteMany({ bid_no: bidNo });
  return { deleted: result.deletedCount || 0 };
}
