// Allowlist sanitizer for AI-generated document HTML.
//
// The generated letters are rendered with dangerouslySetInnerHTML, so this is the only
// thing standing between a prompt-injected tender PDF and script execution in a logged-in
// client's browser. Treat it as a security boundary, not a formatting helper.
//
// Design: nothing from the input is ever passed through verbatim. Every tag is parsed,
// checked against the allowlist, and then *re-emitted from scratch* using only attributes
// we explicitly permit. An attribute we don't understand cannot survive, because it is
// never copied — a strictly safer posture than trying to strip known-bad patterns.

// Formatting tags a formal business letter legitimately needs.
const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr', 'div', 'span', 'section', 'article', 'header', 'footer',
  'strong', 'b', 'em', 'i', 'u', 'small', 'sub', 'sup', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
]);

const VOID_TAGS = new Set(['br', 'hr', 'col']);

// Per-tag attribute allowlist. Deliberately tiny: no href, no src, no id.
// - No href/src: a generated document has no business linking out, and dropping them
//   removes the javascript:/data: URL class of attack outright.
// - No id: prevents DOM clobbering of globals the dashboard relies on.
const ALLOWED_ATTRS = {
  '*': ['class', 'style'],
  th: ['colspan', 'rowspan', 'scope', 'align'],
  td: ['colspan', 'rowspan', 'align'],
  col: ['span'],
  colgroup: ['span'],
  table: ['border', 'cellpadding', 'cellspacing'],
};

// CSS properties safe for a print document. Anything that could position an element over
// the rest of the page, load a remote resource, or execute is absent by construction.
const ALLOWED_CSS_PROPS = new Set([
  'text-align', 'text-decoration', 'text-transform', 'text-indent',
  'font-weight', 'font-style', 'font-size', 'font-family', 'font-variant',
  'line-height', 'letter-spacing', 'word-spacing', 'white-space',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'border', 'border-top', 'border-bottom', 'border-left', 'border-right',
  'border-collapse', 'border-spacing', 'border-width', 'border-style', 'border-color',
  'width', 'min-width', 'max-width', 'height',
  'color', 'background-color',
  'vertical-align', 'list-style-type', 'page-break-before', 'page-break-after',
]);

// Elements whose *content* is dangerous too, so they are removed wholesale rather than
// unwrapped. (Unwrapping <script> would leave the JS as visible text; unwrapping <style>
// would leak CSS into the page.)
const DROP_WITH_CONTENT = [
  'script', 'style', 'iframe', 'object', 'embed', 'applet', 'noscript',
  'template', 'svg', 'math', 'form', 'input', 'button', 'select', 'textarea',
  'link', 'meta', 'base', 'title', 'head', 'frameset', 'frame',
];

function stripDangerousBlocks(html) {
  let out = html;

  // HTML comments can hide conditional-comment payloads and confuse the tag scanner.
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<!DOCTYPE[^>]*>/gi, '');
  out = out.replace(/<\?[\s\S]*?\?>/g, '');

  for (const tag of DROP_WITH_CONTENT) {
    // Paired form, including an unterminated trailing block (a truncated AI response
    // could end mid-<script>, and leaving that open would let the rest through).
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*$`, 'i'), '');
    // Self-closing / standalone form.
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '');
  }

  return out;
}

function sanitizeStyle(value) {
  const safe = [];

  for (const declaration of String(value).split(';')) {
    const idx = declaration.indexOf(':');
    if (idx === -1) continue;

    const prop = declaration.slice(0, idx).trim().toLowerCase();
    const val = declaration.slice(idx + 1).trim();

    if (!ALLOWED_CSS_PROPS.has(prop)) continue;
    if (!val) continue;
    // Belt and braces: even within allowed properties, reject anything that could fetch
    // a resource or invoke legacy CSS evaluation.
    if (/url\s*\(|expression\s*\(|javascript:|@import|[<>{}\\]/i.test(val)) continue;

    safe.push(`${prop}: ${val}`);
  }

  return safe.join('; ');
}

function sanitizeAttributes(tagName, rawAttrs) {
  const permitted = new Set([...(ALLOWED_ATTRS['*'] || []), ...(ALLOWED_ATTRS[tagName] || [])]);
  const rebuilt = [];

  // name="value" | name='value' | name=value | name
  const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  let match;
  while ((match = attrPattern.exec(rawAttrs)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';

    if (!permitted.has(name)) continue;

    if (name === 'style') {
      const style = sanitizeStyle(value);
      if (style) rebuilt.push(`style="${escapeAttr(style)}"`);
      continue;
    }

    rebuilt.push(`${name}="${escapeAttr(value)}"`);
  }

  return rebuilt.length > 0 ? ` ${rebuilt.join(' ')}` : '';
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sanitizes AI-generated HTML down to a safe, printable subset.
 *
 * Disallowed tags are unwrapped (their text content survives) rather than deleted, so a
 * model that reaches for an unexpected tag degrades to plain text instead of losing a
 * paragraph of the letter.
 *
 * @param {string} html Raw model output.
 * @returns {string} HTML containing only allowlisted tags and attributes.
 */
export function sanitizeGeneratedHtml(html) {
  if (typeof html !== 'string' || html.trim() === '') return '';

  let working = stripDangerousBlocks(html);

  // If the model returned a full document, keep only the body.
  const bodyMatch = working.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) working = bodyMatch[1];
  working = working.replace(/<\/?(?:html|body)\b[^>]*>/gi, '');

  const openTagStack = [];

  const sanitized = working.replace(
    /<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g,
    (_full, closing, rawName, rawAttrs) => {
      const tagName = rawName.toLowerCase();

      if (!ALLOWED_TAGS.has(tagName)) return ''; // Unwrap: drop markup, keep inner text.

      if (closing) {
        if (VOID_TAGS.has(tagName)) return '';
        const idx = openTagStack.lastIndexOf(tagName);
        // A stray close tag with no matching open would unbalance the output.
        if (idx === -1) return '';
        openTagStack.splice(idx, 1);
        return `</${tagName}>`;
      }

      if (VOID_TAGS.has(tagName)) {
        return `<${tagName}${sanitizeAttributes(tagName, rawAttrs)} />`;
      }

      openTagStack.push(tagName);
      return `<${tagName}${sanitizeAttributes(tagName, rawAttrs)}>`;
    }
  );

  // Any leftover '<' is literal text the scanner didn't treat as a tag; escape it so the
  // browser cannot reinterpret it as markup.
  const escapedStrays = sanitized.replace(/<(?![/a-zA-Z])/g, '&lt;');

  // Close whatever the model left open, innermost first, so the fragment cannot swallow
  // the surrounding dashboard layout.
  const closers = openTagStack.reverse().map((tag) => `</${tag}>`).join('');

  return (escapedStrays + closers).trim();
}

/** Strips all markup, for previews, logging and plain-text fallbacks. */
export function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    // Block-level content reads as separate paragraphs; list rows are single lines.
    .replace(/<\/(p|div|h[1-6]|blockquote|section)>/gi, '\n\n')
    .replace(/<\/(li|tr|dt|dd)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
