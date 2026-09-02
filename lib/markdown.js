// Minimal markdown -> HTML converter for AI chat output.
//
// Written in-house rather than pulling in a markdown library because the output is fed to
// dangerouslySetInnerHTML: this emits a fixed, small tag vocabulary and every character of
// text content is HTML-escaped first, so no markup can survive from the model's response.
// The result is still passed through sanitizeGeneratedHtml at the render site as a second
// layer.

const INLINE_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (char) => INLINE_ESCAPES[char]);
}

/**
 * Applies inline markdown to text that has ALREADY been HTML-escaped.
 *
 * Code spans are extracted first and restored last so that emphasis markers inside them
 * are left alone.
 */
function renderInline(escapedText) {
  const codeSpans = [];
  let text = escapedText.replace(/`([^`]+)`/g, (_match, code) => {
    codeSpans.push(code);
    return `\u0000CODE${codeSpans.length - 1}\u0000`;
  });

  // Links: only the label is kept. Rendering model-supplied hrefs would let a prompt
  // injection place a clickable link in staff-facing UI.
  text = text.replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1');

  text = text
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return text.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => `<code>${codeSpans[Number(index)]}</code>`);
}

function renderTable(rows) {
  // rows are raw pipe-delimited lines; the separator row has already been removed.
  const cells = rows.map((row) =>
    row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim())
  );
  const [header, ...body] = cells;

  const head = `<thead><tr>${header.map((c) => `<th>${renderInline(escapeHtml(c))}</th>`).join('')}</tr></thead>`;
  const rest = body.length
    ? `<tbody>${body.map((row) => `<tr>${row.map((c) => `<td>${renderInline(escapeHtml(c))}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '';

  return `<table>${head}${rest}</table>`;
}

/**
 * Converts a markdown string to a safe HTML fragment.
 *
 * Supports: ATX headings, unordered and ordered lists (one level), fenced and inline code,
 * blockquotes, pipe tables, horizontal rules, bold/italic/strikethrough, and paragraphs.
 */
export function markdownToHtml(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];

  let listType = null;      // 'ul' | 'ol' | null
  let paragraph = [];
  let quote = [];
  let codeFence = null;     // { lines: string[] }
  let tableRows = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${renderInline(escapeHtml(paragraph.join(' ')))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listType) return;
    out.push(`</${listType}>`);
    listType = null;
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    out.push(`<blockquote>${renderInline(escapeHtml(quote.join(' ')))}</blockquote>`);
    quote = [];
  };
  const flushTable = () => {
    if (!tableRows) return;
    out.push(renderTable(tableRows));
    tableRows = null;
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); flushTable(); };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');

    // Fenced code blocks swallow everything verbatim until the closing fence.
    if (/^\s*```/.test(line)) {
      if (codeFence) {
        out.push(`<pre><code>${escapeHtml(codeFence.lines.join('\n'))}</code></pre>`);
        codeFence = null;
      } else {
        flushAll();
        codeFence = { lines: [] };
      }
      continue;
    }
    if (codeFence) { codeFence.lines.push(rawLine); continue; }

    if (line.trim() === '') { flushAll(); continue; }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2].trim()))}</h${level}>`);
      continue;
    }

    if (/^\s{0,3}([-*_])\s*\1\s*\1[\s-*_]*$/.test(line)) { flushAll(); out.push('<hr />'); continue; }

    // Pipe tables: buffer rows, dropping the |---|---| separator.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph(); flushList(); flushQuote();
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
      tableRows = tableRows || [];
      tableRows.push(line);
      continue;
    }
    flushTable();

    const quoteLine = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quoteLine) { flushParagraph(); flushList(); quote.push(quoteLine[1]); continue; }
    flushQuote();

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const wanted = bullet ? 'ul' : 'ol';
      if (listType !== wanted) { flushList(); out.push(`<${wanted}>`); listType = wanted; }
      out.push(`<li>${renderInline(escapeHtml((bullet || numbered)[1]))}</li>`);
      continue;
    }
    flushList();

    paragraph.push(line.trim());
  }

  if (codeFence) out.push(`<pre><code>${escapeHtml(codeFence.lines.join('\n'))}</code></pre>`);
  flushAll();

  return out.join('\n');
}

/**
 * Strips markdown down to speakable plain text for speechSynthesis. Reading "##" and "**"
 * aloud is unbearable, so the markers go while sentence structure is preserved.
 */
export function markdownToSpeech(markdown) {
  return String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' code block omitted. ')
    .replace(/^\s*\|.*\|\s*$/gm, (row) =>
      `${row.replace(/\|/g, ', ').replace(/^,\s*|,\s*$/g, '')}. `
    )
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*\*|\*\*|~~|`)/g, '')
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$)/g, '$1$2')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
}
