import { isR2Configured, uploadBrandAsset } from '@/lib/cloudflare-r2';

function parseDataUrl(value) {
  const m = String(value || '').match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}

export async function persistBrandImage(value, fileName) {
  if (value == null || value === '') return '';
  const str = String(value);
  if (/^https?:\/\//i.test(str) || str.startsWith('/')) return str;
  const parsed = parseDataUrl(str);
  if (!parsed?.buffer?.length) return str;
  if (isR2Configured()) {
    const uploaded = await uploadBrandAsset(parsed.buffer, fileName, parsed.mime);
    if (uploaded?.url) return uploaded.url;
  }
  return str;
}

export async function persistUploadedFile(file, fileName) {
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return '';
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

export async function brandFieldsFromForm(form) {
  const parseJson = (key, fallback) => {
    const raw = form.get(key);
    if (raw == null || raw === '') return fallback;
    try { return JSON.parse(String(raw)); } catch { return fallback; }
  };

  const fields = {
    name: form.get('name'),
    tagline: form.get('tagline'),
    vision_text: form.get('vision_text'),
    logo: form.get('logo_url') || '',
    gem_logo: form.get('gem_logo_url') || '',
    md_signature: form.get('md_signature_url') || '',
    banners: parseJson('banners', []),
    leaders: parseJson('leaders', []),
    clients: parseJson('clients', []),
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

  return persistBrandPayload(fields);
}
