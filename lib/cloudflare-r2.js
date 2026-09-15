import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

// 🚀 Cloudflare R2 (S3-compatible) client — cached across invocations so we don't
// re-authenticate on every request in the Next.js serverless/edge runtime.
let cachedClient = null;

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getR2Client() {
  if (cachedClient) return cachedClient;

  const accessKeyId = getRequiredEnv('CLOUDFLARE_R2_ACCESS_KEY_ID');
  const secretAccessKey = getRequiredEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
  const endpoint = getRequiredEnv('CLOUDFLARE_R2_ENDPOINT');

  cachedClient = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  return cachedClient;
}

function sanitizeFileName(fileName) {
  return String(fileName).trim().replace(/[^a-zA-Z0-9._-]/g, '_');
}

// 🚀 FIX (blank PDF viewer): `https://<account>.r2.cloudflarestorage.com/...` is the
// *private* S3 API endpoint — it only answers SigV4-signed requests, so redirecting a
// browser there returns a 401 XML body that the PDF viewer renders as a blank page.
// Only a configured public bucket domain (r2.dev or a custom domain) is safe to hand
// straight to the browser; anything else must be streamed through our own API.
export function isPubliclyServableUrl(url) {
  const trimmed = String(url || '').trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;

  const publicBase = process.env.CLOUDFLARE_R2_PUBLIC_URL;
  if (publicBase && trimmed.startsWith(publicBase.replace(/\/+$/, ''))) return true;

  try {
    return !/\.r2\.cloudflarestorage\.com$/i.test(new URL(trimmed).hostname);
  } catch {
    return false;
  }
}

// 🚀 `Buffer.from(str, 'base64')` NEVER throws — invalid or truncated input silently
// yields garbage bytes, which we were happily serving as a 200 `application/pdf`.
// The browser then shows an empty viewer with nothing in the console. Verify the
// magic header so a corrupt record fails loudly instead of looking like a blank PDF.
export function isValidPDFBuffer(buffer) {
  if (!buffer || buffer.length < 5) return false;
  return Buffer.from(buffer.subarray(0, 5)).toString('latin1') === '%PDF-';
}

// Every R2 object key a tender record could plausibly point at, most specific first.
export function buildTenderPDFKeys({ pdf_url, pdf_filename, pdf_r2_key } = {}) {
  const keys = [];

  if (pdf_r2_key) keys.push(String(pdf_r2_key).replace(/^\/+/, ''));

  if (pdf_url) {
    try {
      const pathname = decodeURIComponent(new URL(pdf_url).pathname).replace(/^\/+/, '');
      const idx = pathname.indexOf('tenders/');
      keys.push(idx >= 0 ? pathname.slice(idx) : pathname);
    } catch {
      const idx = String(pdf_url).indexOf('tenders/');
      if (idx >= 0) keys.push(String(pdf_url).slice(idx).split('?')[0]);
    }
  }

  if (pdf_filename) keys.push(`tenders/${sanitizeFileName(pdf_filename)}`);

  return [...new Set(keys.filter(Boolean))];
}

export function isR2Configured() {
  return Boolean(
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID &&
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY &&
    process.env.CLOUDFLARE_R2_ENDPOINT &&
    process.env.CLOUDFLARE_R2_BUCKET_NAME
  );
}

// 🚀 Builds the public URL for an uploaded object. Prefer a custom/public domain
// (CLOUDFLARE_R2_PUBLIC_URL) if configured — R2 objects are NOT publicly reachable
// via the private S3 API endpoint alone unless a public bucket domain is set up.
function buildPublicUrl(key) {
  const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
  const publicBase = process.env.CLOUDFLARE_R2_PUBLIC_URL;

  if (publicBase) {
    return `${publicBase.replace(/\/+$/, '')}/${key}`;
  }

  console.warn(
    '[cloudflare-r2] CLOUDFLARE_R2_PUBLIC_URL is not set. Falling back to a URL derived from ' +
    'CLOUDFLARE_R2_ENDPOINT, which may not be publicly accessible. Configure a public bucket ' +
    'domain in Cloudflare R2 and set CLOUDFLARE_R2_PUBLIC_URL for production use.'
  );
  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT.replace(/\/+$/, '');
  return `${endpoint}/${bucketName}/${key}`;
}

/**
 * Uploads a PDF buffer to the Cloudflare R2 bucket and returns its public URL and object key.
 *
 * @param {Buffer} fileBuffer - The PDF file contents.
 * @param {string} fileName - Desired file name (will be sanitized and namespaced).
 * @returns {Promise<{url: string, key: string}|null>}
 */
export async function uploadTenderPDF(fileBuffer, fileName) {
  try {
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new Error('fileBuffer must be a valid Buffer.');
    }
    if (!fileName || typeof fileName !== 'string') {
      throw new Error('fileName must be a non-empty string.');
    }

    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    const key = `tenders/${sanitizeFileName(fileName)}`;

    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: 'application/pdf',
    }));

    return { url: buildPublicUrl(key), key };
  } catch (error) {
    console.error('[cloudflare-r2] uploadTenderPDF failed:', error?.message || error);
    return null;
  }
}

/**
 * Uploads a GeM Co-Pilot knowledge asset under the gem_copilot_knowledge/ R2 prefix.
 * @returns {Promise<{url: string, key: string}|null>}
 */
export async function uploadCopilotKnowledge(fileBuffer, fileName, contentType = 'application/pdf') {
  try {
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new Error('fileBuffer must be a valid Buffer.');
    }
    if (!fileName || typeof fileName !== 'string') {
      throw new Error('fileName must be a non-empty string.');
    }

    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    const key = `gem_copilot_knowledge/${sanitizeFileName(fileName)}`;

    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType || 'application/octet-stream',
    }));

    return { url: buildPublicUrl(key), key };
  } catch (error) {
    console.error('[cloudflare-r2] uploadCopilotKnowledge failed:', error?.message || error);
    return null;
  }
}

export async function uploadWorkflowDocument(fileBuffer, fileName, { jobId, contentType } = {}) {
  try {
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) throw new Error('fileBuffer must be a valid Buffer.');
    if (!fileName || typeof fileName !== 'string') throw new Error('fileName must be a non-empty string.');
    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    const folder = sanitizeFileName(String(jobId || 'unassigned'));
    const key = `workflow/${folder}/${Date.now()}-${sanitizeFileName(fileName)}`;
    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType || 'application/octet-stream',
    }));
    return { url: buildPublicUrl(key), key };
  } catch (error) {
    console.error('[cloudflare-r2] uploadWorkflowDocument failed:', error?.message || error);
    return null;
  }
}

export async function deleteR2Key(key) {
  if (!key) return false;
  try {
    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: String(key).replace(/^\/+/, '') }));
    return true;
  } catch (error) {
    console.error('[cloudflare-r2] deleteR2Key failed:', error?.message || error);
    return false;
  }
}

export async function fetchR2Buffer(key) {
  if (!key) return null;
  try {
    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    const out = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: String(key).replace(/^\/+/, '') }));
    const chunks = [];
    for await (const chunk of out.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (error) {
    console.error('[cloudflare-r2] fetchR2Buffer failed:', error?.message || error);
    return null;
  }
}

/**
 * Stores one document of a bid's Co-Pilot dossier under `bid_dossier/<bid>/`.
 *
 * Portal links expire and often sit behind a session, so a document that was fetched
 * once is kept here permanently rather than re-downloaded on every re-ingest.
 *
 * @returns {Promise<{url: string, key: string}|null>}
 */
export async function uploadBidDossierDocument(fileBuffer, { bidNo, docType, contentType = 'application/pdf' }) {
  try {
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new Error('fileBuffer must be a valid Buffer.');
    }

    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    const bidSlug = sanitizeFileName(String(bidNo || 'unknown-bid'));
    const key = `bid_dossier/${bidSlug}/${sanitizeFileName(`${docType || 'DOC'}-${Date.now()}.pdf`)}`;

    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    }));

    return { url: buildPublicUrl(key), key };
  } catch (error) {
    console.error('[cloudflare-r2] uploadBidDossierDocument failed:', error?.message || error);
    return null;
  }
}

/**
 * Downloads a tender PDF from R2 as a Buffer. Tries pdf_url path, then
 * tenders/{filename}, then a prefix listing match on the original filename.
 *
 * @param {{ pdf_url?: string|null, pdf_filename?: string|null }} refs
 * @returns {Promise<Buffer|null>}
 */
export async function fetchTenderPDFBuffer(refs = {}) {
  if (!isR2Configured()) {
    console.error(
      '[cloudflare-r2] fetchTenderPDFBuffer skipped: R2 credentials are not configured in this ' +
      'environment (CLOUDFLARE_R2_ACCESS_KEY_ID / SECRET_ACCESS_KEY / ENDPOINT / BUCKET_NAME). ' +
      'Tenders whose PDF only lives in R2 cannot be served here.'
    );
    return null;
  }

  try {
    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    const { pdf_filename } = refs;

    const candidateKeys = buildTenderPDFKeys(refs);
    for (const key of candidateKeys) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
        const bytes = await out.Body.transformToByteArray();
        console.log('[cloudflare-r2] served tender PDF from key', key);
        return Buffer.from(bytes);
      } catch (err) {
        console.warn('[cloudflare-r2] GetObject miss for', key, err?.name || err?.message);
      }
    }

    // Last resort: the stored filename lost its `${Date.now()}-` prefix, so scan the
    // prefix for an object ending in that name.
    if (pdf_filename) {
      const suffix = sanitizeFileName(pdf_filename);
      const listed = await client.send(new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: 'tenders/',
        MaxKeys: 1000,
      }));
      const match = (listed.Contents || []).find((obj) => {
        const name = obj.Key || '';
        return name === `tenders/${suffix}` || name.endsWith(`-${suffix}`);
      });
      if (match?.Key) {
        const out = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: match.Key }));
        const bytes = await out.Body.transformToByteArray();
        console.log('[cloudflare-r2] served tender PDF via prefix scan', match.Key);
        return Buffer.from(bytes);
      }
    }

    console.error('[cloudflare-r2] no R2 object matched any candidate key:', candidateKeys);
    return null;
  } catch (error) {
    console.error('[cloudflare-r2] fetchTenderPDFBuffer failed:', error?.message || error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Client vault documents
//
// Vault files used to be base64-encoded into the `users` document, which pushed some
// records past 1.5MB and made every query that touched a user slow. They now live in R2
// under a per-client prefix, with MongoDB holding only the pointer.
// ---------------------------------------------------------------------------

const VAULT_PREFIX = 'vault';

/** Per-client folder. The email is sanitized because it becomes part of the object key. */
function vaultFolder(email) {
  return `${VAULT_PREFIX}/${sanitizeFileName(String(email || 'unknown').toLowerCase())}`;
}

/** Every R2 key a vault document could plausibly live under, most specific first. */
export function buildVaultKeys({ file_r2_key, file_url, file_name, email } = {}) {
  const keys = [];

  if (file_r2_key) keys.push(String(file_r2_key).replace(/^\/+/, ''));

  if (file_url) {
    try {
      const pathname = decodeURIComponent(new URL(file_url).pathname).replace(/^\/+/, '');
      const idx = pathname.indexOf(`${VAULT_PREFIX}/`);
      keys.push(idx >= 0 ? pathname.slice(idx) : pathname);
    } catch {
      const idx = String(file_url).indexOf(`${VAULT_PREFIX}/`);
      if (idx >= 0) keys.push(String(file_url).slice(idx).split('?')[0]);
    }
  }

  if (email && file_name) keys.push(`${vaultFolder(email)}/${sanitizeFileName(file_name)}`);

  return [...new Set(keys.filter(Boolean))];
}

/**
 * Uploads any client vault document (PDF, scan, spreadsheet) to R2.
 *
 * Unlike uploadTenderPDF this preserves the caller's content type, because vault uploads
 * are routinely JPEG/PNG scans rather than PDFs.
 *
 * @param {Buffer} fileBuffer
 * @param {string} fileName
 * @param {{ email: string, contentType?: string }} options
 * @returns {Promise<{url: string, key: string}|null>}
 */
export async function uploadVaultDocument(fileBuffer, fileName, { email, contentType } = {}) {
  try {
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new Error('fileBuffer must be a valid Buffer.');
    }
    if (!fileName || typeof fileName !== 'string') {
      throw new Error('fileName must be a non-empty string.');
    }

    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    // The timestamp keeps re-uploads of the same document name from overwriting the
    // previous version, so a rejected file remains retrievable for audit.
    const key = `${vaultFolder(email)}/${Date.now()}-${sanitizeFileName(fileName)}`;

    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType || 'application/octet-stream',
    }));

    return { url: buildPublicUrl(key), key };
  } catch (error) {
    console.error('[cloudflare-r2] uploadVaultDocument failed:', error?.message || error);
    return null;
  }
}

/**
 * Downloads a vault document from R2.
 *
 * @param {{ file_r2_key?: string, file_url?: string, file_name?: string, email?: string }} refs
 * @returns {Promise<Buffer|null>}
 */
export async function fetchVaultDocumentBuffer(refs = {}) {
  if (!isR2Configured()) {
    console.error('[cloudflare-r2] fetchVaultDocumentBuffer skipped: R2 is not configured.');
    return null;
  }

  const candidateKeys = buildVaultKeys(refs);
  if (candidateKeys.length === 0) return null;

  try {
    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');

    for (const key of candidateKeys) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
        const bytes = await out.Body.transformToByteArray();
        return Buffer.from(bytes);
      } catch (err) {
        console.warn('[cloudflare-r2] vault GetObject miss for', key, err?.name || err?.message);
      }
    }

    // The stored name lost its `${Date.now()}-` prefix — scan the client's folder.
    if (refs.email && refs.file_name) {
      const suffix = sanitizeFileName(refs.file_name);
      const listed = await client.send(new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: `${vaultFolder(refs.email)}/`,
        MaxKeys: 1000,
      }));
      const match = (listed.Contents || [])
        .filter((obj) => (obj.Key || '').endsWith(`-${suffix}`) || (obj.Key || '').endsWith(`/${suffix}`))
        .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified))[0];

      if (match?.Key) {
        const out = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: match.Key }));
        const bytes = await out.Body.transformToByteArray();
        return Buffer.from(bytes);
      }
    }

    console.error('[cloudflare-r2] no vault object matched:', candidateKeys);
    return null;
  } catch (error) {
    console.error('[cloudflare-r2] fetchVaultDocumentBuffer failed:', error?.message || error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Client stationery (letterhead backgrounds and signature/stamp images)
//
// Unlike vault documents these are *meant* to be readable by the browser: they are
// rendered as an <img> inside generated documents. They therefore need a public bucket
// domain (CLOUDFLARE_R2_PUBLIC_URL) to be genuinely useful — isStationeryUsable() below
// reports whether that is the case so the UI can warn instead of silently rendering a
// broken image.
// ---------------------------------------------------------------------------

export const STATIONERY_KINDS = ['letterhead', 'signature'];

/**
 * Uploads a letterhead background or signature/stamp image.
 *
 * @param {Buffer} fileBuffer
 * @param {string} fileName
 * @param {{ email: string, kind: 'letterhead'|'signature', contentType?: string }} options
 * @returns {Promise<{url: string, key: string}|null>}
 */
export async function uploadStationeryAsset(fileBuffer, fileName, { email, kind, contentType } = {}) {
  try {
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new Error('fileBuffer must be a valid Buffer.');
    }
    if (!STATIONERY_KINDS.includes(kind)) {
      throw new Error(`kind must be one of: ${STATIONERY_KINDS.join(', ')}`);
    }

    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    const folder = sanitizeFileName(String(email || 'unknown').toLowerCase());
    const key = `stationery/${folder}/${kind}-${Date.now()}-${sanitizeFileName(fileName || `${kind}.png`)}`;

    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType || 'image/png',
      // Stationery changes rarely and is re-fetched on every document render.
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    return { url: buildPublicUrl(key), key };
  } catch (error) {
    console.error('[cloudflare-r2] uploadStationeryAsset failed:', error?.message || error);
    return null;
  }
}

/**
 * Company letterhead templates used by the AI document generator (not per-client KYC stationery).
 * Stored under letterheads/ so they can be selected independently of a client profile.
 */
export async function uploadLetterheadTemplate(fileBuffer, fileName, contentType) {
  try {
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new Error('fileBuffer must be a valid Buffer.');
    }
    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    const key = `letterheads/${Date.now()}-${sanitizeFileName(fileName || 'letterhead')}`;

    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType || 'application/octet-stream',
      CacheControl: 'private, max-age=31536000',
    }));

    return { url: buildPublicUrl(key), key };
  } catch (error) {
    console.error('[cloudflare-r2] uploadLetterheadTemplate failed:', error?.message || error);
    return null;
  }
}

/**
 * True when stationery uploaded now would actually render in a browser, i.e. a public
 * bucket domain is configured. Without one the URL points at the private S3 API endpoint,
 * which returns 401 to an unsigned <img> request.
 */
export function isStationeryUsable() {
  return isR2Configured() && Boolean(process.env.CLOUDFLARE_R2_PUBLIC_URL);
}

/**
 * Downloads a stationery asset. Tries the stored R2 key, then the URL path.
 *
 * @param {{ file_r2_key?: string, file_url?: string }} refs
 * @returns {Promise<{buffer: Buffer, contentType: string}|null>}
 */
export async function fetchStationeryBuffer(refs = {}) {
  if (!isR2Configured()) return null;

  const keys = [];
  if (refs.file_r2_key) keys.push(String(refs.file_r2_key).replace(/^\/+/, ''));
  if (refs.file_url) {
    try {
      const pathname = decodeURIComponent(new URL(refs.file_url).pathname).replace(/^\/+/, '');
      const stationeryIdx = pathname.indexOf('stationery/');
      const letterheadIdx = pathname.indexOf('letterheads/');
      if (stationeryIdx >= 0) keys.push(pathname.slice(stationeryIdx));
      else if (letterheadIdx >= 0) keys.push(pathname.slice(letterheadIdx));
      else keys.push(pathname);
    } catch {
      const raw = String(refs.file_url);
      const stationeryIdx = raw.indexOf('stationery/');
      const letterheadIdx = raw.indexOf('letterheads/');
      if (stationeryIdx >= 0) keys.push(raw.slice(stationeryIdx).split('?')[0]);
      else if (letterheadIdx >= 0) keys.push(raw.slice(letterheadIdx).split('?')[0]);
    }
  }

  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return null;

  try {
    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');

    for (const key of unique) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
        const bytes = await out.Body.transformToByteArray();
        return {
          buffer: Buffer.from(bytes),
          contentType: out.ContentType || 'image/png',
        };
      } catch (err) {
        console.warn('[cloudflare-r2] stationery GetObject miss for', key, err?.name || err?.message);
      }
    }
    return null;
  } catch (error) {
    console.error('[cloudflare-r2] fetchStationeryBuffer failed:', error?.message || error);
    return null;
  }
}

/**
 * Generic single-key downloader for maintenance/cleanup scripts that already know
 * the exact R2 object key (e.g. re-extracting a gem_copilot_knowledge PDF whose
 * text extraction failed the first time around).
 *
 * @param {string} key
 * @returns {Promise<{buffer: Buffer, contentType: string}|null>}
 */
export async function fetchObjectByKey(key) {
  if (!isR2Configured() || !key) return null;
  try {
    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    const out = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    const bytes = await out.Body.transformToByteArray();
    return { buffer: Buffer.from(bytes), contentType: out.ContentType || 'application/octet-stream' };
  } catch (error) {
    console.warn('[cloudflare-r2] fetchObjectByKey miss for', key, error?.name || error?.message);
    return null;
  }
}

/**
 * Deletes a previously uploaded tender PDF from the Cloudflare R2 bucket.
 *
 * @param {string} fileName - The same file name passed to uploadTenderPDF.
 * @returns {Promise<boolean>} true if the delete request succeeded, false otherwise.
 */
export async function deleteExpiredPDF(fileName) {
  try {
    if (!fileName || typeof fileName !== 'string') {
      throw new Error('fileName must be a non-empty string.');
    }

    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    const key = `tenders/${sanitizeFileName(fileName)}`;

    await client.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    }));

    return true;
  } catch (error) {
    console.error('[cloudflare-r2] deleteExpiredPDF failed:', error?.message || error);
    return false;
  }
}

export async function listR2Keys(prefix) {
  const keys = [];
  try {
    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    let token;
    do {
      const out = await client.send(new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: String(prefix || ''),
        ContinuationToken: token,
      }));
      for (const obj of out.Contents || []) {
        if (obj.Key) keys.push({ key: obj.Key, lastModified: obj.LastModified });
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
  } catch (error) {
    console.error('[cloudflare-r2] listR2Keys failed:', error?.message || error);
  }
  return keys;
}
