'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { FileText, Loader2, Download } from 'lucide-react';
import { LetterheadThumb, staffLetterheadHeaders } from '@/components/LetterheadThumb';

const DOC_OPTIONS = [
  { id: 'custom_letterhead', label: 'Custom Letterhead' },
  { id: 'bid_undertaking', label: 'Bid Undertaking' },
  { id: 'compliance_declaration', label: 'Compliance Declaration' },
  { id: 'package_100x', label: '100x Document Package' },
];

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

/**
 * Tender-workflow card: pick tender, client, letterhead template, then download
 * PDFs with body text overlaid on that letterhead.
 */
export default function DocumentLetterheadGenerator({
  tenders = [],
  clients = [],
  defaultTenderId = '',
}) {
  const [tenderId, setTenderId] = useState(defaultTenderId || '');
  const [clientEmail, setClientEmail] = useState('');
  const [docType, setDocType] = useState('custom_letterhead');
  const [letterheadId, setLetterheadId] = useState('');
  const [letterheads, setLetterheads] = useState([]);
  const [generating, setGenerating] = useState(false);

  const loadLetterheads = useCallback(async () => {
    try {
      const res = await fetch(`/api/letterheads?t=${Date.now()}`, {
        headers: staffLetterheadHeaders(),
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (res.ok) setLetterheads(data.letterheads || []);
    } catch {
      /* gallery is best-effort */
    }
  }, []);

  useEffect(() => { loadLetterheads(); }, [loadLetterheads]);
  useEffect(() => {
    const onUpdate = () => loadLetterheads();
    window.addEventListener('letterheads-updated', onUpdate);
    return () => window.removeEventListener('letterheads-updated', onUpdate);
  }, [loadLetterheads]);

  const tenderOptions = useMemo(
    () => (tenders || []).slice(0, 400).map((t) => ({
      id: String(t._id || t.id || t.bid_no || ''),
      label: `${t.bid_no || 'No bid no'} — ${(t.title || 'Untitled').slice(0, 70)}`,
    })).filter((t) => t.id),
    [tenders],
  );

  const generate = async () => {
    if (!letterheadId) return toast.error('Select a letterhead template first.');
    if (!clientEmail) return toast.error('Select a client for KYC details.');
    if (!tenderId) return toast.error('Select the tender this document is for.');
    setGenerating(true);
    try {
      const res = await fetch('/api/tenders/generate-docs', {
        method: 'POST',
        credentials: 'include',
        headers: staffLetterheadHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          tender_id: tenderId,
          client_email: clientEmail,
          letterhead_id: letterheadId,
          doc_type: docType,
          format: 'pdf',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || `Generation failed (${res.status})`, { duration: 9000 });
        return;
      }
      const files = data.files || [];
      if (!files.length) {
        toast.error('No files were returned.');
        return;
      }
      files.forEach((file) => downloadBase64(file.filename, file.mime, file.content_base64));
      const kb = (data.knowledge_used || []).length;
      toast.success(
        `${files.length} file(s) on “${data.stationery?.letterhead_name || 'letterhead'}”` +
        (kb ? ` · ${kb} Co-Pilot source(s)` : ''),
      );
    } catch {
      toast.error('Network error while generating documents.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card className="tender-shadow border-t-4 border-t-[#0A2647] w-full">
      <CardHeader className="bg-slate-50/80 border-b pb-4">
        <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
          <FileText className="w-5 h-5 text-indigo-600" /> AI Document &amp; Letterhead Generator
        </CardTitle>
        <CardDescription>
          A letterhead template is required. Generated text is placed in the body area of that layout.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5 space-y-4">
        <div>
          <Label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
            Letterhead template <span className="text-red-500">*</span>
          </Label>
          <Select value={letterheadId} onValueChange={setLetterheadId}>
            <SelectTrigger className="mt-1 bg-white h-10">
              <SelectValue placeholder={letterheads.length ? 'Select a stored letterhead' : 'Upload a letterhead first'} />
            </SelectTrigger>
            <SelectContent>
              {letterheads.map((lh) => (
                <SelectItem key={lh.id} value={lh.id}>
                  {lh.name} ({lh.kind})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {letterheads.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              {letterheads.map((lh) => (
                <button
                  key={lh.id}
                  type="button"
                  onClick={() => setLetterheadId(lh.id)}
                  className={`border rounded-lg overflow-hidden text-left bg-white ${
                    letterheadId === lh.id ? 'ring-2 ring-indigo-600 border-indigo-400' : 'border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <div className="h-16 bg-slate-100 flex items-center justify-center">
                    <LetterheadThumb
                      id={lh.id}
                      kind={lh.kind}
                      alt={lh.name}
                      className="max-h-16 w-full object-contain"
                    />
                  </div>
                  <p className="px-1.5 py-1 text-[10px] font-semibold text-slate-700 truncate">{lh.name}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Tender</Label>
            <Select value={tenderId} onValueChange={setTenderId}>
              <SelectTrigger className="mt-1 bg-white h-10"><SelectValue placeholder="Select a published tender" /></SelectTrigger>
              <SelectContent>
                {tenderOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Client (KYC)</Label>
            <Select value={clientEmail} onValueChange={setClientEmail}>
              <SelectTrigger className="mt-1 bg-white h-10"><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {(clients || []).map((c) => (
                  <SelectItem key={c.email} value={c.email}>
                    {(c.client_id ? `${c.client_id} · ` : '') + (c.company_name || c.name || c.email)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Document type</Label>
          <Select value={docType} onValueChange={setDocType}>
            <SelectTrigger className="mt-1 bg-white h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOC_OPTIONS.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={generate}
          disabled={generating || !letterheadId}
          className="w-full sm:w-auto bg-[#0A2647] hover:bg-[#144272]"
        >
          {generating
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Drafting on letterhead…</>
            : <><Download className="w-4 h-4 mr-2" /> Generate &amp; Download</>}
        </Button>
        {!letterheadId && (
          <p className="text-xs text-amber-700">Upload and select a letterhead in Letterhead Management before generating.</p>
        )}
      </CardContent>
    </Card>
  );
}
