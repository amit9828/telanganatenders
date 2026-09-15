import { google } from 'googleapis';
import { Readable } from 'stream';

function sniffContentType(buffer, fileName = '') {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 5) {
    if (/\.pdf$/i.test(fileName)) return 'application/pdf';
    return 'application/octet-stream';
  }
  const head = Buffer.from(buffer.subarray(0, 12));
  const hex = head.toString('hex');
  if (head.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('504b0304')) {
    if (/\.docx$/i.test(fileName)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (/\.xlsx$/i.test(fileName)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return 'application/zip';
  }
  if (/\.pdf$/i.test(fileName)) return 'application/pdf';
  return 'application/octet-stream';
}

function getDriveClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google Drive keys missing in environment variables');
  }
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/drive.file']
  );
  return google.drive({ version: 'v3', auth });
}

export function isDriveConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

export async function createDriveFolder({ folderName, parentId } = {}) {
  const drive = getDriveClient();
  const fileMetadata = {
    name: folderName || 'Untitled Folder',
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) fileMetadata.parents = [parentId];

  const folder = await drive.files.create({
    resource: fileMetadata,
    fields: 'id, webViewLink',
  });

  await drive.permissions.create({
    fileId: folder.data.id,
    requestBody: { role: 'writer', type: 'anyone' },
  });

  return { folderId: folder.data.id, folderLink: folder.data.webViewLink };
}

export async function uploadDriveFile({ buffer, fileName, mimeType, parentId }) {
  if (!buffer || !parentId) throw new Error('buffer and parentId are required');
  const drive = getDriveClient();
  const stream = Readable.from(buffer);
  const result = await drive.files.create({
    requestBody: { name: fileName || 'document.pdf', parents: [parentId] },
    media: {
      mimeType: mimeType || sniffContentType(buffer, fileName),
      body: stream,
    },
    fields: 'id',
  });
  return { fileId: result.data.id };
}

async function withRetries(fn, { retries = 3, delayMs = 800 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.error(`[drive] attempt ${attempt}/${retries} failed:`, err?.message || err);
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  throw lastErr;
}

export async function uploadBidPackToClientDrive({ clientFolderId, folderName, files }) {
  if (!clientFolderId) throw new Error('Client Drive folder is missing');
  return withRetries(async () => {
    const child = await createDriveFolder({ folderName, parentId: clientFolderId });
    const uploaded = [];
    for (const file of files || []) {
      if (!file?.buffer) continue;
      const out = await uploadDriveFile({
        buffer: file.buffer,
        fileName: file.name,
        mimeType: file.mimeType,
        parentId: child.folderId,
      });
      uploaded.push({ name: file.name, fileId: out.fileId });
    }
    return { folderId: child.folderId, folderLink: child.folderLink, uploaded };
  });
}

export async function ensureEntityDriveFolder({ db, collection, query, folderName, email }) {
  const col = db.collection(collection);
  const existing = await col.findOne(query);
  if (existing?.drive_folder_id) {
    return { folderId: existing.drive_folder_id, folderLink: existing.drive_folder_link, created: false };
  }
  if (!isDriveConfigured()) {
    return { folderId: null, folderLink: null, created: false, skipped: true };
  }
  const folder = await createDriveFolder({ folderName: folderName || `Folder - ${email || ''}` });
  await col.updateOne(query, {
    $set: { drive_folder_id: folder.folderId, drive_folder_link: folder.folderLink },
  });
  return { ...folder, created: true };
}
