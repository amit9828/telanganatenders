import { isR2Configured, uploadBrandAsset } from '@/lib/cloudflare-r2';

export const MAX_BRAND_IMAGE_BYTES = 2 * 1024 * 1024;

function isPublicUrl(value) {
  const str = String(value || '');
  return /^https?:\/\//i.test(str) || (str.startsWith('/') && !str.startsWith('data:'));
}

function keepIndex(value) {
  const m = String(value || '').match(/^__keep__:(\d+)$/);
  return m ? Number(m[1]) : null;
}

function assertFileSize(file) {
  if (!file || typeof file === 'string') return;
  if (typeof file.size === 'number' && file.size > MAX_BRAND_IMAGE_BYTES) {
    const err = new Error('Image size must be under 2MB');
    err.status = 413;
    throw err;
  }
}

function parseDataUrl(value) {
  const m = String(value || '').match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}

export async function persistBrandImage(value, fileName) {
  if (value == null || value === '') return '';
  const str = String(value);
  if (isPublicUrl(str)) return str;
  // data: URLs are only accepted when copied from an existing DB row (__keep__),
  // never from the client JSON body.
  const parsed = parseDataUrl(str);
  if (!parsed?.buffer?.length) return '';
  if (isR2Configured()) {
    const uploaded = await uploadBrandAsset(parsed.buffer, fileName, parsed.mime);
    if (uploaded?.url) return uploaded.url;
  }
  return str;
}

export async function persistUploadedFile(file, fileName) {
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return '';
  assertFileSize(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.length) return '';
  const name = file.name || fileName || 'asset.png';
  const mime = file.type || 'image/png';
  if (isR2Configured()) {
    const uploaded = await uploadBrandAsset(buffer, name, mime);
    if (uploaded?.url) return uploaded.url;
  }
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function persistImageList(list, prefix) {
  if (!Array.isArray(list)) return [];
  return Promise.all(list.map(async (item, i) => persistBrandImage(item, `${prefix}-${i}.png`)));
}

async function persistObjectImages(list, prefix) {
  if (!Array.isArray(list)) return [];
  return Promise.all(list.map(async (item, i) => {
    const row = item && typeof item === 'object' ? { ...item } : { image: item };
    row.image = await persistBrandImage(row.image, `${prefix}-${i}.png`);
    return row;
  }));
}

export async function persistBrandPayload(fields = {}) {
  const $set = { updated_at: new Date() };
  if (fields.name != null) $set.name = String(fields.name);
  if (fields.tagline != null) $set.tagline = String(fields.tagline);
  if (fields.vision_text != null) $set.vision_text = String(fields.vision_text);
  if (fields.logo != null) $set.logo = await persistBrandImage(fields.logo, 'logo.png');
  if (fields.gem_logo != null) $set.gem_logo = await persistBrandImage(fields.gem_logo, 'gem-logo.png');
  if (fields.md_signature != null) $set.md_signature = await persistBrandImage(fields.md_signature, 'md-signature.png');
  if (fields.banners != null) $set.banners = await persistImageList(fields.banners, 'banner');
  if (fields.leaders != null) $set.leaders = await persistObjectImages(fields.leaders, 'leader');
  if (fields.clients != null) $set.clients = await persistObjectImages(fields.clients, 'client');
  return $set;
}

function resolveKept(value, existingList) {
  const idx = keepIndex(value);
  if (idx == null) return value;
  const prev = existingList?.[idx];
  if (typeof prev === 'string') return prev;
  if (prev && typeof prev === 'object') return prev.image || prev.src || '';
  return '';
}

export async function brandFieldsFromForm(form, existing = {}) {
  const parseJson = (key, fallback) => {
    const raw = form.get(key);
    if (raw == null || raw === '') return fallback;
    try { return JSON.parse(String(raw)); } catch { return fallback; }
  };

  const fields = {
    name: form.get('name'),
    tagline: form.get('tagline'),
    vision_text: form.get('vision_text'),
    logo: resolveKept(form.get('logo_url') || '', [existing.logo]),
    gem_logo: resolveKept(form.get('gem_logo_url') || '', [existing.gem_logo]),
    md_signature: resolveKept(form.get('md_signature_url') || '', [existing.md_signature]),
    banners: (parseJson('banners', []) || []).map((src) => resolveKept(src, existing.banners)),
    leaders: parseJson('leaders', []) || [],
    clients: parseJson('clients', []) || [],
  };

  const logoFile = form.get('logo');
  if (logoFile && typeof logoFile !== 'string') fields.logo = await persistUploadedFile(logoFile, 'logo.png');
  const gemFile = form.get('gem_logo');
  if (gemFile && typeof gemFile !== 'string') fields.gem_logo = await persistUploadedFile(gemFile, 'gem-logo.png');
  const sigFile = form.get('md_signature');
  if (sigFile && typeof sigFile !== 'string') fields.md_signature = await persistUploadedFile(sigFile, 'md-signature.png');

  for (const file of form.getAll('banner_files')) {
    const url = await persistUploadedFile(file, file?.name || 'banner.png');
    if (url) fields.banners.push(url);
  }

  fields.leaders = await Promise.all((fields.leaders || []).map(async (row, i) => {
    const next = row && typeof row === 'object' ? { ...row } : { image: row };
    const file = form.get(`leader_image_${i}`);
    if (file && typeof file !== 'string') {
      next.image = await persistUploadedFile(file, file.name || `leader-${i}.png`);
    } else {
      next.image = resolveKept(next.image, (existing.leaders || []).map((l) => (typeof l === 'string' ? l : l?.image)));
    }
    return next;
  }));

  fields.clients = await Promise.all((fields.clients || []).map(async (row, i) => {
    const next = row && typeof row === 'object' ? { ...row } : { image: row };
    const file = form.get(`client_image_${i}`);
    if (file && typeof file !== 'string') {
      next.image = await persistUploadedFile(file, file.name || `client-${i}.png`);
    } else {
      next.image = resolveKept(next.image, (existing.clients || []).map((c) => (typeof c === 'string' ? c : c?.image)));
    }
    return next;
  }));

  return persistBrandPayload(fields);
}
