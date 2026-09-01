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
  try {
    const client = getR2Client();
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    const { pdf_url, pdf_filename, pdf_r2_key } = refs;
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

    if (pdf_filename) {
      keys.push(`tenders/${sanitizeFileName(pdf_filename)}`);
    }

    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    for (const key of uniqueKeys) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
        const bytes = await out.Body.transformToByteArray();
        return Buffer.from(bytes);
      } catch (err) {
        console.warn('[cloudflare-r2] GetObject miss for', key, err?.name || err?.message);
      }
    }

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
        return Buffer.from(bytes);
      }
    }

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
