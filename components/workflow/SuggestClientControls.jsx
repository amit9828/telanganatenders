'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { workflowFetch } from '@/components/workflow/api';

export default function SuggestClientControls({ tender, clients = [], onDone, compact = false }) {
  const [email, setEmail] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const suggest = async () => {
    if (!email) return toast.error('Select an active client.');
    if (!file) return toast.error('Attach a SOW PDF.');
    if (file.type && file.type !== 'application/pdf' && !String(file.name || '').toLowerCase().endsWith('.pdf')) {
      return toast.error('SOW must be a PDF.');
    }
    const client = clients.find((c) => c.email === email) || {};
    const tenderId = tender?._id?.$oid || tender?._id || tender?.id || '';
    setBusy(true);
    try {
      const created = await workflowFetch('/api/workflow/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tender_id: tenderId ? String(tenderId) : undefined,
          bid_no: tender?.bid_no || undefined,
          title: tender?.title || undefined,
          client_email: email,
          client_id: client.client_id || undefined,
        }),
      });
      const jobId = created.job?._id;
      if (!jobId) throw new Error('Could not attach this tender.');
      const form = new FormData();
      form.append('client_email', email);
      if (client.client_id) form.append('client_id', client.client_id);
      form.append('sow', file);
      await workflowFetch(`/api/workflow/jobs/${jobId}/suggest`, { method: 'POST', body: form });
      toast.success('SOW sent. Client can approve on Recommended.');
      setEmail('');
      setFile(null);
      onDone?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex ${compact ? 'flex-wrap' : 'flex-col sm:flex-row'} items-center gap-2`}>
      <Select value={email} onValueChange={setEmail}>
        <SelectTrigger className={`${compact ? 'h-7 text-[10px] w-[160px]' : 'h-8 text-xs w-full sm:w-[200px]'} bg-white`}>
          <SelectValue placeholder="Select client" />
        </SelectTrigger>
        <SelectContent>
          {clients.map((c) => (
            <SelectItem key={c.email} value={c.email}>
              {c.company_name || c.client_name || c.name || c.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className={`${compact ? 'h-7 text-[10px] px-2' : 'h-8 text-xs px-3'} inline-flex items-center rounded-md border border-slate-200 bg-white cursor-pointer shrink-0`}>
        {file ? file.name : 'SOW PDF'}
        <input
          type="file"
          accept="application/pdf"
          className="sr-only"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      <Button
        size="sm"
        className={`${compact ? 'h-7 text-[10px]' : 'h-8 text-xs'} bg-emerald-600 hover:bg-emerald-700 shrink-0`}
        onClick={suggest}
        disabled={busy}
      >
        {busy ? 'Sending…' : 'Suggest'}
      </Button>
    </div>
  );
}
