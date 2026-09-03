'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, FileText, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';

function downloadBase64(filename, mime, base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'document.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function printHtml(html) {
  if (typeof document === 'undefined') return;
  let host = document.getElementById('a4-print-sheet');
  if (!host) {
    host = document.createElement('div');
    host.id = 'a4-print-sheet';
    document.body.appendChild(host);
  }
  host.className = 'workspace-print-host';
  host.innerHTML = html;
  document.body.classList.add('printing-document');

  const cleanup = () => {
    document.body.classList.remove('printing-document');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 1500);
}

/** Rendered phase: letterhead-accurate preview, with download and print. */
export default function DocumentPreview({ session, files }) {
  const [active, setActive] = useState(0);
  // `files` carries the PDF bytes from this render; the session copy survives a refresh
  // but deliberately holds no base64, so preview stays available and download does not.
  const list = files?.length ? files : (session?.files || []);
  if (!list.length) return null;

  const current = list[Math.min(active, list.length - 1)];

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-2.5 border-b bg-white flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {list.map((file, i) => (
            <button
              key={file.filename || i}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
                i === (active < list.length ? active : 0)
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400',
              )}
            >
              <FileText className="w-3 h-3" />
              {file.doc_type?.label || file.filename}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => printHtml(current.html)}>
            <Printer className="w-3 h-3 mr-1" /> Print
          </Button>
          {current.content_base64 && (
            <Button
              size="sm"
              className="h-7 text-[10px] bg-[#0A2647] hover:bg-[#144272]"
              onClick={() => downloadBase64(current.filename, current.mime, current.content_base64)}
            >
              <Download className="w-3 h-3 mr-1" /> Download PDF
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-slate-200/70 p-4">
        <div
          className="origin-top mx-auto bg-white shadow-lg"
          style={{ width: '210mm', transform: 'scale(0.62)', transformOrigin: 'top center' }}
          dangerouslySetInnerHTML={{ __html: current.html }}
        />
      </div>
    </div>
  );
}
