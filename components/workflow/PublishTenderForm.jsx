'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Pencil, PlusCircle, UploadCloud } from 'lucide-react';
import { workflowFetch, staffHeaders } from '@/components/workflow/api';
import { TS_AP_DISTRICTS } from '@/lib/regions';

const EMPTY_FORM = {
  bid_no: '',
  title: '',
  department: '',
  last_date: '',
  district: '',
  category: 'Product',
  supply_details: '',
};

const CATEGORIES = ['Product', 'Service', 'Works'];
const PDF_MAX_BYTES = 3 * 1024 * 1024;

function lastDateValue(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function matchDistrict(value) {
  const needle = String(value || '').trim().toLowerCase();
  if (!needle) return '';
  return TS_AP_DISTRICTS.find((d) => d.toLowerCase() === needle)
    || TS_AP_DISTRICTS.find((d) => needle.includes(d.toLowerCase()) || d.toLowerCase().includes(needle))
    || '';
}

function matchCategory(value) {
  const needle = String(value || '').trim().toLowerCase();
  return CATEGORIES.find((c) => c.toLowerCase() === needle) || '';
}

export default function PublishTenderForm({
  awaitingJobs = [],
  onPublished,
  editTender = null,
  onCancelEdit,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [pdfBase64, setPdfBase64] = useState('');
  const [pdfName, setPdfName] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pendingJobId, setPendingJobId] = useState('');

  const editingId = editTender?._id || editTender?.id || null;
  const waitingIds = useMemo(
    () => awaitingJobs.map((j) => String(j._id || j.id || '')).filter(Boolean),
    [awaitingJobs],
  );

  useEffect(() => {
    if (!editTender) return;
    setForm({
      bid_no: editTender.bid_no || '',
      title: editTender.title || '',
      department: editTender.department || '',
      last_date: lastDateValue(editTender.last_date),
      district: matchDistrict(editTender.district) || editTender.district || '',
      category: matchCategory(editTender.category) || 'Product',
      supply_details: editTender.supply_details || '',
    });
    setPdfBase64('');
    setPdfName('');
  }, [editingId]);

  useEffect(() => {
    setPendingJobId((current) => {
      if (current && waitingIds.includes(String(current))) return current;
      return waitingIds[0] || '';
    });
  }, [waitingIds]);

  const resolveJobId = () => {
    if (pendingJobId && waitingIds.includes(String(pendingJobId))) return pendingJobId;
    return waitingIds[0] || '';
  };

  const analyze = async (file) => {
    setAnalyzing(true);
    toast.info('AI is reading the document. Please wait...', { duration: 3000 });
    try {
      const payload = new FormData();
      payload.append('file', file);
      payload.append('saveToDraft', 'false');
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        credentials: 'include',
        headers: staffHeaders(),
        body: payload,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const fallback = res.status === 429
          ? 'AI limit reached. Please wait a moment and try again, or fill the form manually.'
          : 'AI analysis failed. Enter details manually.';
        const msg = String(body.error || fallback);
        toast.error(msg.length > 180 ? fallback : msg, { duration: 6000 });
        return;
      }
      const data = body.data || {};
      setForm((prev) => ({
        ...prev,
        bid_no: data.bid_no || prev.bid_no,
        title: data.title || prev.title,
        department: data.department || prev.department,
        last_date: lastDateValue(data.last_date) || prev.last_date,
        district: matchDistrict(data.district) || prev.district,
        category: matchCategory(data.category) || prev.category,
        supply_details: [
          data.emd_amount ? `EMD: ${data.emd_amount}` : '',
          data.turnover_req ? `Turnover Req: ${data.turnover_req}` : '',
          (data.mandatory_docs || []).length ? `Mandatory Docs: ${data.mandatory_docs.join(', ')}` : '',
        ].filter(Boolean).join('\n') || prev.supply_details,
      }));
      toast.success('AI Successfully auto-filled the tender details!');
    } catch {
      toast.error('Network error during AI analysis. Enter details manually.', { duration: 6000 });
    } finally {
      setAnalyzing(false);
    }
  };

  const onPdfChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf' && !String(file.name || '').toLowerCase().endsWith('.pdf')) {
      return toast.error('Please upload a PDF file');
    }
    if (file.size > PDF_MAX_BYTES) return toast.error('PDF file is too large! Please upload under 3MB.');
    const reader = new FileReader();
    reader.onload = () => {
      const base64Str = reader.result?.toString().split(',')[1] || '';
      setPdfBase64(base64Str);
      setPdfName(file.name);
      toast.success('PDF Loaded. Starting AI Analysis...');
      analyze(file);
    };
    reader.readAsDataURL(file);
  };

  const reset = () => {
    setForm(EMPTY_FORM);
    setPdfBase64('');
    setPdfName('');
    setPendingJobId('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (publishing) return;
    if (!form.title || !form.department || !form.last_date || !form.bid_no) {
      return toast.error('Please fill all required fields');
    }
    const jobId = editingId ? '' : resolveJobId();
    setPublishing(true);
    try {
      const url = editingId ? `/api/tenders/${editingId}` : '/api/tenders';
      const method = editingId ? 'PUT' : 'POST';
      const r = await fetch(url, {
        method,
        credentials: 'include',
        headers: staffHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ...form,
          ...(pdfBase64 ? { pdf_base64: pdfBase64 } : {}),
          pdf_filename: pdfName || 'tender.pdf',
        }),
      });
      const published = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(published.error || 'Failed to save tender');
      let attachJob = null;
      if (!editingId) {
        const tenderId = published.id || published.tender?._id || published.tender_id;
        if (jobId && tenderId) {
          try {
            const attached = await workflowFetch(`/api/workflow/jobs/${jobId}/publish-attach`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tender_id: tenderId, bid_no: form.bid_no }),
            });
            attachJob = attached?.job || null;
          } catch (attachErr) {
            setPendingJobId('');
            onPublished?.(published);
            throw new Error(`Tender published, but it was not attached to the workflow job: ${attachErr.message}`);
          }
        }
      }
      toast.success(editingId ? 'Tender updated successfully!' : 'Tender published successfully!');
      reset();
      onCancelEdit?.();
      onPublished?.({ ...published, job: attachJob });
    } catch (err) {
      toast.error(err.message || 'Network error');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Card className={`border-0 shadow-md h-fit ${editingId ? 'ring-2 ring-blue-500' : ''}`}>
      <CardHeader className="pb-4 border-b border-slate-100 flex flex-row justify-between items-center">
        <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
          {editingId ? <><Pencil className="w-5 h-5 text-blue-600" /> Edit Tender</> : <><PlusCircle className="w-5 h-5" /> Publish New Tender</>}
        </CardTitle>
        {editingId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { reset(); onCancelEdit?.(); }}
            className="h-7 text-xs text-slate-500 hover:text-red-500"
          >
            Cancel Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-5">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Document Title (Work) *</Label>
            <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="bg-white h-10" />
          </div>
          <div>
            <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Bid Number (Internal Use) *</Label>
            <Input required value={form.bid_no} onChange={(e) => setForm({ ...form, bid_no: e.target.value })} placeholder="e.g. GEM/2026/B/..." className="bg-white h-10" />
          </div>
          <div>
            <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Department Name *</Label>
            <Input required value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="bg-white h-10" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Last Date *</Label>
              <Input required type="date" value={form.last_date} onChange={(e) => setForm({ ...form, last_date: e.target.value })} className="bg-white h-10 text-sm" />
            </div>
            <div>
              <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Category *</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger className="bg-white h-10"><SelectValue placeholder="Product" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-sm font-bold text-[#0A2647] mb-1 block">District (TS & AP) *</Label>
            <Select value={form.district} onValueChange={(v) => setForm({ ...form, district: v })}>
              <SelectTrigger className="bg-white h-10"><SelectValue placeholder="Select District" /></SelectTrigger>
              <SelectContent>
                {TS_AP_DISTRICTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Supply / Tender Details</Label>
            <textarea
              className="w-full border rounded-md p-3 h-24 text-sm bg-white outline-none focus:ring-1 focus:ring-slate-300"
              value={form.supply_details}
              onChange={(e) => setForm({ ...form, supply_details: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-sm font-bold text-[#0A2647] mb-1 block">PDF Document {editingId && '(Optional to replace)'}</Label>
            <div className={`border-2 border-dashed border-slate-200 rounded-md p-6 text-center bg-slate-50 hover:bg-slate-100 cursor-pointer transition relative group ${analyzing ? 'animate-pulse bg-blue-50' : ''}`}>
              <input type="file" accept="application/pdf" onChange={onPdfChange} disabled={analyzing} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed" />
              {analyzing ? (
                <div className="flex flex-col items-center">
                  <Loader2 className="w-6 h-6 text-blue-600 animate-spin mb-2" />
                  <span className="text-sm font-bold text-blue-600">AI is analyzing document...</span>
                </div>
              ) : (
                <>
                  <UploadCloud className="w-6 h-6 text-[#16a34a] mx-auto mb-2 group-hover:scale-110 transition-transform" />
                  <span className="text-sm font-bold text-[#0A2647]">{pdfName || (editingId ? 'Upload new PDF to replace old' : 'Drop PDF here for AI Auto-Fill')}</span>
                </>
              )}
            </div>
          </div>
          <Button type="submit" disabled={publishing} className={`w-full h-11 text-base font-bold shadow-md ${editingId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-[#16a34a] hover:bg-[#15803d]'}`}>
            {publishing ? (editingId ? 'Updating...' : 'Publishing...') : (editingId ? 'Save Changes' : 'Publish')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
