// Minimal markdown → HTML for the workspace message thread.
//
// Chat answers (deep-dive bullets, GeM RAG) arrive as markdown. We convert only the
// constructs we actually emit — headings, lists, bold, italics, inline code — and escape
// everything else, so a model that returns HTML cannot execute it in the panel.

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineFormat(escaped) {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/**
 * Converts a markdown string to a safe HTML fragment.
 */
export function markdownToSafeHtml(markdown) {
  const source = String(markdown || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return '';

  const lines = source.split('\n');
  const html = [];
  let inList = null; // 'ul' | 'ol'

  const closeList = () => {
    if (inList) {
      html.push(`</${inList}>`);
      inList = null;
    }
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineFormat(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      if (inList !== 'ul') {
        closeList();
        html.push('<ul>');
        inList = 'ul';
      }
      html.push(`<li>${inlineFormat(escapeHtml(unordered[1]))}</li>`);
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      if (inList !== 'ol') {
        closeList();
        html.push('<ol>');
        inList = 'ol';
      }
      html.push(`<li>${inlineFormat(escapeHtml(ordered[1]))}</li>`);
      continue;
    }

    if (line.trim() === '') {
      closeList();
      continue;
    }

    closeList();
    html.push(`<p>${inlineFormat(escapeHtml(line))}</p>`);
  }

  closeList();
  return html.join('');
}

/** Plain text for copy / speech — strip markdown markers without introducing HTML. */
export function markdownToPlainText(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
