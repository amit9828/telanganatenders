'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  FileText, Loader2, Download, ClipboardCheck, AlertTriangle, ScanSearch, RefreshCw, Paperclip,
} from 'lucide-react';
import { LetterheadThumb, staffLetterheadHeaders } from '@/components/LetterheadThumb';

const DOC_OPTIONS = [
  { id: 'custom_letterhead', label: 'Custom Letterhead' },
  { id: 'bid_undertaking', label: 'Bid Undertaking' },
  { id: 'compliance_declaration', label: 'Compliance Declaration' },
  { id: 'package_100x', label: '100x Document Package' },
];

const CONFIDENCE_STYLES = {
  high: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
  low: 'bg-slate-100 text-slate-700 border-slate-200',
};

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
  // Requirement pre-flight: what the bid document itself says must be submitted.
  const [requirements, setRequirements] = useState(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [selectedDocTypes, setSelectedDocTypes] = useState([]);

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

  // Reads the bid document and reports what it actually demands, before anything is
  // drafted. Repeat calls for the same tender are served from the cached analysis.
  const analyseRequirements = useCallback(async (id, { refresh = false } = {}) => {
    if (!id) return;
    setAnalysing(true);
    setAnalysisError('');
    try {
      const res = await fetch('/api/tenders/requirements', {
        method: 'POST',
        credentials: 'include',
        headers: staffLetterheadHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tender_id: id, refresh }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRequirements(null);
        setAnalysisError(data?.error || `Requirement check failed (${res.status}).`);
        return;
      }
      setRequirements(data);
      // Pre-tick every mandatory undertaking we can actually draft — that is the
      // checklist the officer would otherwise have to assemble from memory.
      setSelectedDocTypes([...new Set(
        (data.items || [])
          .filter((i) => i.kind === 'undertaking' && i.mandatory && i.doc_type)
          .map((i) => i.doc_type.id),
      )]);
    } catch {
      setRequirements(null);
      setAnalysisError('Network error while reading the bid document.');
    } finally {
      setAnalysing(false);
    }
  }, []);

  useEffect(() => {
    setRequirements(null);
    setSelectedDocTypes([]);
    setAnalysisError('');
    if (tenderId) analyseRequirements(tenderId);
  }, [tenderId, analyseRequirements]);

  const toggleDocType = (id) => {
    setSelectedDocTypes((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  };

  const runGeneration = async (docTypeIds) => {
    if (!letterheadId) return toast.error('Select a letterhead template first.');
    if (!clientEmail) return toast.error('Select a client for KYC details.');
    if (!tenderId) return toast.error('Select the tender this document is for.');
    if (!docTypeIds.length) return toast.error('Nothing selected to draft.');

    setGenerating(true);
    try {
      const responses = await Promise.all(docTypeIds.map(async (id) => {
        const res = await fetch('/api/tenders/generate-docs', {
          method: 'POST',
          credentials: 'include',
          headers: staffLetterheadHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            tender_id: tenderId,
            client_email: clientEmail,
            letterhead_id: letterheadId,
            doc_type: id,
            format: 'pdf',
          }),
        });
        const data = await res.json().catch(() => null);
        return { id, ok: res.ok, status: res.status, data };
      }));

      const failed = responses.filter((r) => !r.ok);
      const files = responses.filter((r) => r.ok).flatMap((r) => r.data?.files || []);

      files.forEach((file) => downloadBase64(file.filename, file.mime, file.content_base64));

      if (files.length) {
        const letterheadName = responses.find((r) => r.ok)?.data?.stationery?.letterhead_name || 'letterhead';
        const kb = new Set(responses.flatMap((r) => r.data?.knowledge_used || [])).size;
        toast.success(
          `${files.length} file(s) on “${letterheadName}”` + (kb ? ` · ${kb} Co-Pilot source(s)` : ''),
        );
      }
      if (failed.length) {
        toast.error(
          `${failed.length} document(s) failed: ${failed[0].data?.error || `HTTP ${failed[0].status}`}`,
          { duration: 9000 },
        );
      } else if (!files.length) {
        toast.error('No files were returned.');
      }
    } catch {
      toast.error('Network error while generating documents.');
    } finally {
      setGenerating(false);
    }
  };

  const generate = () => runGeneration([docType]);

  const undertakings = (requirements?.items || []).filter((i) => i.kind === 'undertaking');
  const supporting = (requirements?.items || []).filter((i) => i.kind === 'document');
  const draftableCount = new Set(
    undertakings.filter((i) => i.doc_type).map((i) => i.doc_type.id),
  ).size;

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
        {tenderId && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-indigo-100/60 border-b border-indigo-200">
              <div className="flex items-center gap-2 min-w-0">
                <ClipboardCheck className="w-4 h-4 text-indigo-700 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-indigo-900 uppercase tracking-wider">
                    What this tender requires
                  </p>
                  <p className="text-[11px] text-indigo-700 truncate">
                    Read from the bid document itself, not from the tender form.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={analysing}
                onClick={() => analyseRequirements(tenderId, { refresh: true })}
                className="shrink-0 bg-white border-indigo-300 text-indigo-800 hover:bg-indigo-100"
              >
                {analysing
                  ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Reading…</>
                  : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Re-read</>}
              </Button>
            </div>

            <div className="p-4 space-y-3">
              {analysing && !requirements && (
                <div className="flex items-center gap-2 text-sm text-indigo-800 py-3">
                  <ScanSearch className="w-4 h-4 animate-pulse" />
                  Reading the full bid document and its ATC clauses. This takes up to a minute the first time.
                </div>
              )}

              {analysisError && !analysing && (
                <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{analysisError}</span>
                </div>
              )}

              {requirements && (
                <>
                  {requirements.bid_no_mismatch && (
                    <div className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>
                        The document states bid number <strong>{requirements.bid_no}</strong>, but the tender
                        record says <strong>{requirements.recorded_bid_no}</strong>. Both will now resolve in
                        the Co-Pilot — correct the record when you get a chance.
                      </span>
                    </div>
                  )}

                  {requirements.summary && (
                    <p className="text-sm text-slate-700 leading-relaxed">{requirements.summary}</p>
                  )}

                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {requirements.bid_end_date && (
                      <Badge variant="outline" className="bg-white">Closes: {requirements.bid_end_date}</Badge>
                    )}
                    {requirements.emd_amount && (
                      <Badge variant="outline" className="bg-white">EMD: ₹{Number(requirements.emd_amount).toLocaleString('en-IN')}</Badge>
                    )}
                    {requirements.mse_exemption_allowed && (
                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">MSE exemption allowed</Badge>
                    )}
                    {requirements.cached && (
                      <Badge variant="outline" className="bg-white text-slate-500">Cached analysis</Badge>
                    )}
                  </div>

                  {undertakings.length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2">
                        Undertakings to submit ({undertakings.length})
                      </p>
                      <div className="space-y-1.5">
                        {undertakings.map((item, i) => {
                          const draftable = Boolean(item.doc_type);
                          const checked = draftable && selectedDocTypes.includes(item.doc_type.id);
                          return (
                            <label
                              key={`${item.title}-${i}`}
                              className={`flex items-start gap-2.5 rounded-lg border p-2.5 bg-white ${
                                draftable ? 'cursor-pointer hover:border-indigo-400' : 'border-slate-200'
                              } ${checked ? 'border-indigo-500 ring-1 ring-indigo-200' : 'border-slate-200'}`}
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 accent-indigo-600"
                                disabled={!draftable}
                                checked={checked}
                                onChange={() => draftable && toggleDocType(item.doc_type.id)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-sm font-semibold text-slate-800">{item.title}</span>
                                  {item.mandatory
                                    ? <Badge className="bg-red-100 text-red-800 border-red-200 text-[9px] px-1.5 py-0">Mandatory</Badge>
                                    : <Badge variant="outline" className="text-[9px] px-1.5 py-0">Optional</Badge>}
                                  <Badge className={`${CONFIDENCE_STYLES[item.confidence]} text-[9px] px-1.5 py-0 border`}>
                                    {item.confidence} confidence
                                  </Badge>
                                  {item.notarised && (
                                    <Badge className="bg-purple-100 text-purple-800 border-purple-200 text-[9px] px-1.5 py-0">Notarised</Badge>
                                  )}
                                  {!draftable && (
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-slate-500">Draft manually</Badge>
                                  )}
                                </span>
                                {item.why && <span className="block text-[11px] text-slate-600 mt-0.5">{item.why}</span>}
                                {item.clause && (
                                  <span className="block text-[10px] font-mono text-slate-400 mt-0.5">Ref: {item.clause}</span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {supporting.length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Paperclip className="w-3 h-3" /> Documents to attach ({supporting.length})
                      </p>
                      <ul className="space-y-1">
                        {supporting.map((item, i) => (
                          <li key={`${item.title}-${i}`} className="text-xs text-slate-700 flex items-start gap-2">
                            <span className="text-slate-400 mt-0.5">•</span>
                            <span>
                              <strong className="font-semibold">{item.title}</strong>
                              {item.mandatory ? '' : ' (optional)'}
                              {item.why ? ` — ${item.why}` : ''}
                              {item.clause ? <span className="font-mono text-slate-400"> [{item.clause}]</span> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {requirements.eligibility?.length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Eligibility</p>
                      <ul className="space-y-1">
                        {requirements.eligibility.map((line, i) => (
                          <li key={i} className="text-xs text-slate-700 flex items-start gap-2">
                            <span className="text-slate-400 mt-0.5">•</span><span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {requirements.watch_outs?.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-[11px] font-bold text-amber-900 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3" /> Watch out
                      </p>
                      <ul className="space-y-1">
                        {requirements.watch_outs.map((line, i) => (
                          <li key={i} className="text-xs text-amber-900 flex items-start gap-2">
                            <span className="mt-0.5">•</span><span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {undertakings.length === 0 && supporting.length === 0 && (
                    <p className="text-sm text-slate-500">
                      The document did not spell out any specific undertakings. Draft from the list below instead.
                    </p>
                  )}

                  {draftableCount > 0 && (
                    <Button
                      type="button"
                      onClick={() => runGeneration(selectedDocTypes)}
                      disabled={generating || !letterheadId || !clientEmail || selectedDocTypes.length === 0}
                      className="w-full sm:w-auto bg-indigo-700 hover:bg-indigo-800"
                    >
                      {generating
                        ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Drafting {selectedDocTypes.length} document(s)…</>
                        : <><Download className="w-4 h-4 mr-2" /> Generate {selectedDocTypes.length} selected undertaking(s)</>}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div>
          <Label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
            Or draft one specific document type
          </Label>
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
