'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { BookOpen, Loader2, UploadCloud } from 'lucide-react';

function staffHeaders() {
  const headers = {};
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('tt_admin');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * MD drop-zone: train GeM Co-Pilot from GFR / circular / custom PDFs.
 * Files go to R2 gem_copilot_knowledge/ and Mongo gem_copilot_knowledge.
 */
export default function CopilotTrainDropzone() {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [docs, setDocs] = useState([]);
  const [total, setTotal] = useState(0);

  const load = async () => {
    try {
      const res = await fetch(`/api/ai/copilot-upload?t=${Date.now()}`, { headers: staffHeaders() });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setDocs(data.docs || []);
        setTotal(data.total || 0);
      }
    } catch {
      /* listing is best-effort */
    }
  };

  useEffect(() => { load(); }, []);

  const queueFiles = (fileList) => {
    const next = Array.from(fileList || []).filter(
      (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
    );
    if (!next.length) {
      toast.error('Only PDF files can be used to train the Co-Pilot.');
      return;
    }
    setPendingFiles(next);
  };

  const train = async () => {
    if (!pendingFiles.length || uploading) return;
    setUploading(true);
    const form = new FormData();
    pendingFiles.forEach((f) => form.append('files', f));
    form.append('uploadedBy', 'MD Admin');
    try {
      const res = await fetch('/api/ai/copilot-upload', {
        method: 'POST',
        headers: staffHeaders(),
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Training upload failed.', { duration: 9000 });
        return;
      }
      const trained = data?.summary?.trained || 0;
      const failed = data?.summary?.failed || 0;
      if (trained > 0) {
        toast.success(`${trained} PDF(s) indexed into Co-Pilot memory.`);
      }
      if (failed > 0) {
        const first = (data.results || []).find((r) => r.status === 'failed');
        toast.error(
          `${failed} file(s) failed${first ? `: ${first.fileName} — ${first.error}` : '.'}`,
          { duration: 9000 },
        );
      }
      setPendingFiles([]);
      load();
    } catch {
      toast.error('Network error while training the Co-Pilot.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="tender-shadow border-t-4 border-t-violet-600">
      <CardHeader className="bg-violet-50/40 border-b pb-4">
        <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
          <BookOpen className="w-5 h-5 text-violet-600" /> Co-Pilot Manual Training
        </CardTitle>
        <CardDescription>
          Drop GFR rules, special circulars or custom manuals. Each PDF is stored in
          gem_copilot_knowledge and becomes searchable in employee Co-Pilot chat immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5 space-y-4">
        <label
          onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragActive(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (!uploading) queueFiles(e.dataTransfer?.files);
          }}
          className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center text-center transition ${
            uploading
              ? 'bg-violet-100 cursor-wait'
              : dragActive
                ? 'border-violet-600 bg-violet-100'
                : 'border-violet-200 bg-violet-50/50 hover:bg-violet-50 cursor-pointer'
          }`}
        >
          <input
            type="file"
            multiple
            accept="application/pdf,.pdf"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { queueFiles(e.target.files); e.target.value = ''; }}
          />
          {uploading ? (
            <Loader2 className="w-8 h-8 text-violet-600 animate-spin mb-2" />
          ) : (
            <UploadCloud className="w-8 h-8 text-violet-500 mb-2" />
          )}
          <span className="text-sm font-bold text-violet-900">
            {uploading
              ? 'Extracting text and indexing Co-Pilot memory…'
              : 'Drop training PDFs or click to browse'}
          </span>
          <span className="text-xs text-violet-700 mt-1">
            PDF only · max 15MB each · up to 8 files per batch
          </span>
        </label>

        {pendingFiles.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
            <p className="text-xs text-violet-800 font-semibold truncate">
              {pendingFiles.length} PDF{pendingFiles.length === 1 ? '' : 's'} ready:{' '}
              {pendingFiles.map((f) => f.name).join(', ')}
            </p>
            <Button
              size="sm"
              onClick={train}
              disabled={uploading}
              className="bg-violet-700 hover:bg-violet-800 text-white shrink-0"
            >
              {uploading
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Training…</>
                : 'Upload & Train Co-Pilot'}
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>{total} document{total === 1 ? '' : 's'} in Co-Pilot memory</span>
          <span>{docs.length} recent manual upload{docs.length === 1 ? '' : 's'}</span>
        </div>

        {docs.length > 0 && (
          <div className="max-h-48 overflow-y-auto border rounded-lg divide-y text-sm">
            {docs.map((d) => (
              <div key={d.doc_id || d._id} className="px-3 py-2 flex justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{d.title}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {d.category} · {d.original_filename || d.doc_id}
                  </p>
                </div>
                <p className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                  {(d.char_count || 0).toLocaleString('en-IN')} chars
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
