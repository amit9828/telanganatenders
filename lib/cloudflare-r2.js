import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

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
 * Uploads a PDF buffer to the Cloudflare R2 bucket and returns its public URL.
 *
 * @param {Buffer} fileBuffer - The PDF file contents.
 * @param {string} fileName - Desired file name (will be sanitized and namespaced).
 * @returns {Promise<string|null>} The public URL of the uploaded file, or null on failure.
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

    return buildPublicUrl(key);
  } catch (error) {
    console.error('[cloudflare-r2] uploadTenderPDF failed:', error?.message || error);
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
