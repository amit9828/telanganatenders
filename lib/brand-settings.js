import { isR2Configured, isPubliclyServableUrl, uploadBrandAsset } from '@/lib/cloudflare-r2';

export const MAX_BRAND_IMAGE_BYTES = 2 * 1024 * 1024;
const BRAND_KEY_RE = /^brand\/[A-Za-z0-9._-]+$/;

function isPublicUrl(value) {
  const str = String(value || '');
  return /^https?:\/\//i.test(str) || (str.startsWith('/') && !str.startsWith('data:'));
}

export function brandObjectKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let candidate = raw;
  if (raw.startsWith('/api/brand/file')) {
    try {
      candidate = new URL(raw, 'http://local.invalid').searchParams.get('key') || '';
    } catch {
      const m = raw.match(/[?&]key=([^&]+)/);
      candidate = m ? decodeURIComponent(m[1]) : '';
    }
  } else if (/^https?:\/\//i.test(raw)) {
    try {
      candidate = decodeURIComponent(new URL(raw).pathname);
    } catch {
      candidate = raw;
    }
  }

  const idx = candidate.indexOf('brand/');
  if (idx < 0) return '';
  const key = candidate.slice(idx).split('?')[0].replace(/^\/+/, '');
  return BRAND_KEY_RE.test(key) ? key : '';
}

export function browserBrandSrc(value) {
  const str = String(value || '').trim();
  if (!str) return '';
  if (str.startsWith('data:')) return str;
  if (isPubliclyServableUrl(str)) return str;
  const key = brandObjectKey(str);
  if (key) return `/api/brand/file?key=${encodeURIComponent(key)}`;
  return str;
}

function storedBrandHref(uploaded) {
  if (!uploaded) return '';
  if (uploaded.url && isPubliclyServableUrl(uploaded.url)) return uploaded.url;
  if (uploaded.key && BRAND_KEY_RE.test(String(uploaded.key))) {
    return `/api/brand/file?key=${encodeURIComponent(uploaded.key)}`;
  }
  const key = brandObjectKey(uploaded.url || uploaded.key || '');
  if (key) return `/api/brand/file?key=${encodeURIComponent(key)}`;
  return uploaded.url || '';
}

function rewriteImageList(list) {
  if (!Array.isArray(list)) return list;
  return list.map((item) => {
    if (typeof item === 'string') return browserBrandSrc(item);
    if (item && typeof item === 'object') {
      const next = { ...item };
      if (next.image != null) next.image = browserBrandSrc(next.image);
      if (next.src != null) next.src = browserBrandSrc(next.src);
      return next;
    }
    return item;
  });
}

export function sanitizeSettingsForBrowser(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const next = { ...settings };
  next.logo = browserBrandSrc(settings.logo);
  next.gem_logo = browserBrandSrc(settings.gem_logo);
  next.md_signature = browserBrandSrc(settings.md_signature);
  if (Array.isArray(settings.banners)) next.banners = rewriteImageList(settings.banners);
  if (Array.isArray(settings.leaders)) next.leaders = rewriteImageList(settings.leaders);
  if (Array.isArray(settings.clients)) next.clients = rewriteImageList(settings.clients);
  return next;
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
  if (isPublicUrl(str)) return browserBrandSrc(str);
  // data: URLs are only accepted when copied from an existing DB row (__keep__),
  // never from the client JSON body.
  const parsed = parseDataUrl(str);
  if (!parsed?.buffer?.length) return '';
  if (isR2Configured()) {
    const uploaded = await uploadBrandAsset(parsed.buffer, fileName, parsed.mime);
    const href = storedBrandHref(uploaded);
    if (href) return href;
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
    const href = storedBrandHref(uploaded);
    if (href) return href;
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
