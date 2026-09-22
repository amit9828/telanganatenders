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

function driveOAuthEnv() {
  const clientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const refreshToken = String(process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN || '').trim();
  return { clientId, clientSecret, refreshToken };
}

export async function getDriveClient() {
  const { clientId, clientSecret, refreshToken } = driveOAuthEnv();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN.');
  }
  // Dynamic import keeps googleapis out of Edge/webpack graphs that only type-check
  // this module; Next traces it only for Node handlers that actually call Drive.
  // The refresh token belongs to the consumer Gmail that owns the client folders.
  const { google } = await import('googleapis');
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth });
}

export function isDriveConfigured() {
  const { clientId, clientSecret, refreshToken } = driveOAuthEnv();
  return Boolean(clientId && clientSecret && refreshToken);
}

export function clientDriveShareError() {
  return "Cannot access the client's Drive folder with the connected Gmail account. Confirm the folder link belongs to that account, or share the folder with that Gmail as an Editor.";
}

export function isDriveQuotaError(err) {
  const text = String(err?.message || err || '');
  return /storage quota|do not have storage quota|storageQuotaExceeded/i.test(text);
}

export async function createDriveFolder({ folderName, parentId } = {}) {
  if (!parentId) throw new Error(clientDriveShareError());
  const drive = await getDriveClient();
  const fileMetadata = {
    name: folderName || 'Untitled Folder',
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) fileMetadata.parents = [parentId];

  const folder = await drive.files.create({
    resource: fileMetadata,
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  await drive.permissions.create({
    fileId: folder.data.id,
    requestBody: { role: 'writer', type: 'anyone' },
    supportsAllDrives: true,
  });

  return { folderId: folder.data.id, folderLink: folder.data.webViewLink };
}

export async function uploadDriveFile({ buffer, fileName, mimeType, parentId }) {
  if (!buffer || !parentId) throw new Error('buffer and parentId are required');
  const drive = await getDriveClient();
  const stream = Readable.from(buffer);
  const result = await drive.files.create({
    requestBody: { name: fileName || 'document.pdf', parents: [parentId] },
    media: {
      mimeType: mimeType || sniffContentType(buffer, fileName),
      body: stream,
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  return { fileId: result.data.id };
}

export function folderIdFromDriveLink(link) {
  let raw = String(link || '').trim();
  if (!raw) return '';
  try { raw = decodeURIComponent(raw); } catch { /* keep the original string */ }
  raw = raw.split('#')[0].trim();
  const folderMatch = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const idMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
  return '';
}

export function folderIdFromClientRecord(client) {
  if (!client) return '';
  return folderIdFromDriveLink(client.drive_folder_link)
    || folderIdFromDriveLink(client.drive_link)
    || folderIdFromDriveLink(client.drive_folder_id);
}

async function findDriveFolder({ folderName, parentId } = {}) {
  const drive = await getDriveClient();
  const escaped = String(folderName || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  if (!escaped) return null;
  let q = `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  if (parentId) q += ` and '${parentId}' in parents`;
  const listed = await drive.files.list({
    q,
    fields: 'files(id, name, webViewLink)',
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return listed.data.files?.[0] || null;
}

export async function findOrCreateDriveFolder({ folderName, parentId } = {}) {
  const existing = await findDriveFolder({ folderName, parentId });
  if (existing?.id) {
    return { folderId: existing.id, folderLink: existing.webViewLink, created: false };
  }
  return { ...(await createDriveFolder({ folderName, parentId })), created: true };
}

async function driveFolderStillExists(folderId) {
  if (!folderId) return null;
  try {
    const drive = await getDriveClient();
    const meta = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, webViewLink, trashed',
      supportsAllDrives: true,
    });
    if (!meta.data?.id || meta.data.trashed) return null;
    return { folderId: meta.data.id, folderLink: meta.data.webViewLink };
  } catch {
    return null;
  }
}

export async function uploadBidPackToClientDrive({ clientFolderId, folderName, files }) {
  const parentId = folderIdFromDriveLink(clientFolderId);
  if (!parentId) throw new Error(clientDriveShareError());
  const live = await driveFolderStillExists(parentId);
  if (!live) throw new Error(clientDriveShareError());
  const child = await findOrCreateDriveFolder({ folderName, parentId });
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
}

export async function ensureEntityDriveFolder({ db, collection, query, folderName, email }) {
  const col = db.collection(collection);
  const existing = await col.findOne(query);
  const named = folderName || `Client - ${existing?.company_name || email || 'Folder'}`;
  const remembered = folderIdFromDriveLink(existing?.drive_folder_link)
    || folderIdFromDriveLink(existing?.drive_link)
    || folderIdFromDriveLink(existing?.drive_folder_id);
  const live = await driveFolderStillExists(remembered);
  if (live) {
    if (live.folderId !== existing?.drive_folder_id) {
      await col.updateOne(query, {
        $set: { drive_folder_id: live.folderId, drive_folder_link: live.folderLink },
      });
    }
    return { ...live, created: false };
  }
  const found = await findDriveFolder({ folderName: named });
  if (found?.id) {
    await col.updateOne(query, {
      $set: { drive_folder_id: found.id, drive_folder_link: found.webViewLink },
    });
    return { folderId: found.id, folderLink: found.webViewLink, created: false };
  }
  return { folderId: null, folderLink: null, created: false, skipped: !isDriveConfigured() };
}

export async function resolveClientDriveFolder({ db, client }) {
  if (!client) return { folderId: null, folderLink: null };
  const query = client._id ? { _id: client._id } : { email: client.email };
  return ensureEntityDriveFolder({
    db,
    collection: 'users',
    query,
    folderName: `Client - ${client.company_name || client.email}`,
    email: client.email,
  });
}
