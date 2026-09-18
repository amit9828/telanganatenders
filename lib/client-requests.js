import { ObjectId } from 'mongodb';
import { uploadWorkflowDocument, fetchR2Buffer, isR2Configured } from '@/lib/cloudflare-r2';

export const CLIENT_REQUEST_MAX_BYTES = 4 * 1024 * 1024;
export const PENDING_REQUEST_STATUS = 'Pending Officer Review';

function sniffKind(buffer, fileName = '') {
  const head = Buffer.from(buffer.subarray(0, 12));
  const hex = head.toString('hex');
  if (head.toString('latin1', 0, 5) === '%PDF-') return { ok: true, type: 'application/pdf' };
  if (hex.startsWith('504b0304')) {
    if (/\.zip$/i.test(fileName) || !/\.(docx|xlsx|pptx)$/i.test(fileName)) {
      return { ok: true, type: 'application/zip' };
    }
  }
  if (/\.pdf$/i.test(fileName)) return { ok: true, type: 'application/pdf' };
  if (/\.zip$/i.test(fileName)) return { ok: true, type: 'application/zip' };
  return { ok: false, type: 'application/octet-stream' };
}

export function hasClientRequestFile(doc) {
  if (!doc) return false;
  if (doc.has_file) return true;
  return Boolean(doc.file_r2_key || doc.file_url || doc.file_base64);
}

export function publicClientRequest(doc) {
  if (!doc) return null;
  const {
    file_base64,
    document_base64,
    file_url,
    file_r2_key,
    ...rest
  } = doc;
  return {
    ...rest,
    _id: String(doc._id),
    has_file: hasClientRequestFile(doc),
    file_name: doc.file_name || null,
  };
}

export async function persistClientRequestFile(file, requestId) {
  if (!file || typeof file.arrayBuffer !== 'function') return { error: null, fields: {} };
  if (file.size > CLIENT_REQUEST_MAX_BYTES) {
    return {
      error: `This file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The maximum upload size is ${CLIENT_REQUEST_MAX_BYTES / 1024 / 1024}MB.`,
      fields: {},
    };
  }
  if (file.size === 0) return { error: 'The selected file is empty.', fields: {} };

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = String(file.name || 'attachment.pdf');
  const kind = sniffKind(buffer, fileName);
  if (!kind.ok) {
    return { error: 'Please upload a PDF or ZIP file.', fields: {} };
  }

  const fields = {
    file_name: fileName,
    file_content_type: kind.type,
    has_file: true,
  };

  if (isR2Configured()) {
    const uploaded = await uploadWorkflowDocument(buffer, fileName, {
      jobId: `client-req-${requestId}`,
      contentType: kind.type,
    });
    if (uploaded?.key) {
      fields.file_r2_key = uploaded.key;
      fields.file_url = uploaded.url || null;
      return { error: null, fields };
    }
  }

  fields.file_base64 = buffer.toString('base64');
  return { error: null, fields };
}

export async function fetchClientRequestFileBuffer(doc) {
  if (!doc) return null;
  if (doc.file_r2_key) {
    const fromKey = await fetchR2Buffer(doc.file_r2_key);
    if (fromKey?.length) return fromKey;
  }
  if (doc.file_url) {
    const fromUrl = await fetchR2Buffer(doc.file_url);
    if (fromUrl?.length) return fromUrl;
  }
  const b64 = doc.file_base64 || doc.document_base64;
  if (b64) {
    const buf = Buffer.from(String(b64).replace(/^data:[^;,]*(;base64)?,/, ''), 'base64');
    if (buf.length) return buf;
  }
  return null;
}

export function asRequestObjectId(id) {
  const raw = String(id || '').trim();
  if (!raw || !ObjectId.isValid(raw)) return null;
  return new ObjectId(raw);
}
