import { isR2Configured, uploadCopilotKnowledge } from './cloudflare-r2.js';
import { ensureVectorIndex, VECTOR_COLLECTION } from './gem-embeddings.js';
import {
  COPILOT_KNOWLEDGE_COLLECTION,
  slugifyDocId,
  upsertCopilotKnowledgeDoc,
} from './gem-copilot-knowledge.js';
import { ingestDocumentVectors } from './rag-ingest.js';
import { extractPdfText, hashBuffer } from './pdf-text.js';

export function copilotVectorId(docId) {
  return `copilot::${docId}`;
}

/**
 * Store one training PDF: R2 mirror when configured, Mongo catalog row always,
 * and vector chunks when the text extract succeeded. An unchanged hash that is
 * already embedded is left alone.
 */
export async function ingestCopilotPdf(db, {
  doc_id,
  title,
  category,
  origin,
  uploaded_by,
  original_filename,
  source_url,
  buffer,
  contentType,
}) {
  const content_hash = hashBuffer(buffer);
  const col = db.collection(COPILOT_KNOWLEDGE_COLLECTION);
  const stableId = doc_id || slugifyDocId(source_url || title || original_filename);
  const existing = await col.findOne({
    $or: [
      { doc_id: stableId },
      ...(source_url ? [{ source_url }] : []),
    ],
  });

  if (
    existing?.content_hash === content_hash
    && existing.extraction_ok !== false
    && Number(existing.embedded_chunks) > 0
  ) {
    return { skipped: true, saved: existing, embedded_chunks: Number(existing.embedded_chunks) };
  }

  let uploaded = null;
  if (isR2Configured()) {
    const name = `${slugifyDocId(stableId)}.pdf`;
    uploaded = await uploadCopilotKnowledge(buffer, name, contentType || 'application/pdf');
  }

  const extraction = await extractPdfText(buffer);
  const saved = await upsertCopilotKnowledgeDoc(db, {
    doc_id: existing?.doc_id || stableId,
    title: title || existing?.title || stableId,
    category: category || existing?.category || 'manual_training',
    origin: origin || existing?.origin || 'scrape',
    uploaded_by: uploaded_by || existing?.uploaded_by || null,
    original_filename: original_filename || existing?.original_filename || null,
    source_url: source_url || existing?.source_url || null,
    r2_key: uploaded?.key || existing?.r2_key || null,
    r2_url: uploaded?.url || existing?.r2_url || null,
    content_type: 'application/pdf',
    content_text: extraction.ok ? extraction.text : '',
    extraction_ok: extraction.ok,
    extraction_error: extraction.ok ? null : (extraction.error || 'extract failed'),
    content_hash,
    embedded_chunks: 0,
  });

  if (!extraction.ok) {
    await db.collection(VECTOR_COLLECTION).deleteMany({ document_id: copilotVectorId(saved.doc_id) });
  }

  let embedded_chunks = 0;
  let embed_error = null;
  if (extraction.ok) {
    try {
      await ensureVectorIndex(db);
      const result = await ingestDocumentVectors(db, {
        documentId: copilotVectorId(saved.doc_id),
        title: saved.title,
        text: extraction.text,
        sourceUrl: saved.r2_url || saved.source_url,
        docType: 'GEM_RULE',
      });
      embedded_chunks = result.chunks || 0;
      await col.updateOne({ doc_id: saved.doc_id }, { $set: { embedded_chunks } });
      saved.embedded_chunks = embedded_chunks;
    } catch (err) {
      embed_error = err?.message || 'embedding failed';
      console.warn('[copilot-ingest] embed failed:', embed_error);
    }
  }

  return { skipped: false, saved, extraction, embedded_chunks, embed_error };
}
