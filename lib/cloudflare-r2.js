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
