// Wraps a sanitized document body in the letterhead/signature chrome used by the
// workspace print preview. The wrapper is assembled here (not by the model) so a prompt
// injection cannot smuggle a second <img> or a javascript: URL.

const MAX_DATA_URL_CHARS = 1_200_000;

function isSafeImageSrc(src) {
  const value = String(src || '').trim();
  if (!value) return false;
  if (value.startsWith('data:image/png;base64,')) return true;
  if (value.startsWith('data:image/jpeg;base64,')) return true;
  if (value.startsWith('data:image/webp;base64,')) return true;
  if (value.startsWith('/api/users/stationery/file?')) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * @param {string} bodyHtml Already-sanitized inner HTML.
 * @param {{ letterheadSrc?: string|null, signatureSrc?: string|null }} assets
 */
export function wrapWithStationery(bodyHtml, { letterheadSrc = null, signatureSrc = null } = {}) {
  const letterhead = isSafeImageSrc(letterheadSrc) && String(letterheadSrc).length < MAX_DATA_URL_CHARS
    ? letterheadSrc
    : null;
  const signature = isSafeImageSrc(signatureSrc) && String(signatureSrc).length < MAX_DATA_URL_CHARS
    ? signatureSrc
    : null;

  const style = letterhead
    ? `background-image:url("${attr(letterhead)}");background-size:100% 100%;background-repeat:no-repeat;`
    : '';

  const stamp = signature
    ? `<p class="signature-stamp"><img src="${attr(signature)}" alt="Authorised signatory" /></p>`
    : '';

  return (
    `<div class="stationery-sheet"${style ? ` style="${style}"` : ''}>` +
    `<div class="a4-body stationery-body">${bodyHtml || ''}</div>` +
    stamp +
    `</div>`
  );
}

export function bufferToDataUrl(buffer, contentType) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  const mime = contentType || 'image/png';
  if (!/^image\/(png|jpeg|webp)$/.test(mime)) return null;
  const encoded = buffer.toString('base64');
  if (`data:${mime};base64,${encoded}`.length > MAX_DATA_URL_CHARS) return null;
  return `data:${mime};base64,${encoded}`;
}
