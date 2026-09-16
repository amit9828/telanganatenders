'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Pencil, PlusCircle, UploadCloud } from 'lucide-react';
import { workflowFetch } from '@/components/workflow/api';
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

function lastDateValue(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toISOString().split('T')[0];
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

  useEffect(() => {
    if (!editTender) return;
    setForm({
      bid_no: editTender.bid_no || '',
      title: editTender.title || '',
      department: editTender.department || '',
      last_date: lastDateValue(editTender.last_date),
      district: editTender.district || '',
      category: editTender.category || 'Product',
      supply_details: editTender.supply_details || '',
    });
    setPdfBase64('');
    setPdfName('');
  }, [editingId]);

  useEffect(() => {
    if (pendingJobId) return;
    if (awaitingJobs[0]?._id) setPendingJobId(awaitingJobs[0]._id);
  }, [awaitingJobs, pendingJobId]);

  const analyze = async (base64Data) => {
    setAnalyzing(true);
    toast.info('AI is reading the document. Please wait...', { duration: 3000 });
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64: base64Data, saveToDraft: false }),
      });
      if (!res.ok) {
        toast.error('AI Analysis failed. You may need to enter manually.');
        return;
      }
      const { data } = await res.json();
      if (!data) return;
      setForm((prev) => ({
        ...prev,
        bid_no: data.bid_no !== 'N/A' ? data.bid_no : prev.bid_no,
        title: data.title !== 'N/A' ? data.title : prev.title,
        department: data.department !== 'N/A' ? data.department : prev.department,
        last_date: data.last_date !== 'N/A' ? data.last_date : prev.last_date,
        supply_details: `EMD: ${data.emd_amount}\nTurnover Req: ${data.turnover_req}\nMandatory Docs: ${(data.mandatory_docs || []).join(', ')}`,
      }));
      toast.success('AI Successfully auto-filled the tender details!');
    } catch {
      toast.error('Network error during AI analysis.');
    } finally {
      setAnalyzing(false);
    }
  };

  const onPdfChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') return toast.error('Please upload a PDF file');
    if (file.size > 3 * 1024 * 1024) return toast.error('PDF file is too large! Please upload under 3MB.');
    const reader = new FileReader();
    reader.onload = () => {
      const base64Str = reader.result?.toString().split(',')[1] || '';
      setPdfBase64(base64Str);
      setPdfName(file.name);
      toast.success('PDF Loaded. Starting AI Analysis...');
      analyze(base64Str);
    };
    reader.readAsDataURL(file);
  };

  const reset = () => {
    setForm(EMPTY_FORM);
    setPdfBase64('');
    setPdfName('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.department || !form.last_date || !form.bid_no) {
      return toast.error('Please fill all required fields');
    }
    setPublishing(true);
    try {
      const url = editingId ? `/api/tenders/${editingId}` : '/api/tenders';
      const method = editingId ? 'PUT' : 'POST';
      const r = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          ...(pdfBase64 ? { pdf_base64: pdfBase64 } : {}),
          pdf_filename: pdfName || 'tender.pdf',
        }),
      });
      const published = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(published.error || 'Failed to save tender');
      if (!editingId) {
        const jobId = pendingJobId || awaitingJobs[0]?._id;
        const tenderId = published.id || published.tender?._id || published.tender_id;
        if (tenderId && jobId) {
          await workflowFetch(`/api/workflow/jobs/${jobId}/publish-attach`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tender_id: tenderId, bid_no: form.bid_no }),
          });
        }
      }
      toast.success(editingId ? 'Tender updated successfully!' : 'Tender published successfully!');
      reset();
      onCancelEdit?.();
      onPublished?.(published);
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
          {awaitingJobs.length > 0 && !editingId && (
            <div>
              <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Attach to assigned job</Label>
              <Select value={pendingJobId} onValueChange={setPendingJobId}>
                <SelectTrigger className="bg-white h-10"><SelectValue placeholder="Select AWAITING_PUBLISH job" /></SelectTrigger>
                <SelectContent>
                  {awaitingJobs.map((j) => (
                    <SelectItem key={j._id} value={j._id}>
                      {(j.assigned_emp_name || j.assigned_emp_id || 'Job')} — {j.title || j.bid_no || j._id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
                  <SelectItem value="Product">Product</SelectItem>
                  <SelectItem value="Service">Service</SelectItem>
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
          <Button type="submit" disabled={publishing || analyzing} className={`w-full h-11 text-base font-bold shadow-md ${editingId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-[#16a34a] hover:bg-[#15803d]'}`}>
            {publishing ? (editingId ? 'Updating...' : 'Publishing...') : (editingId ? 'Save Changes' : 'Publish Tender')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
