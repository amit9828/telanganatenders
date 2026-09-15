'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { workflowFetch } from '@/components/workflow/api';

export default function SuggestClientControls({ tender, clients = [], onDone, compact = false }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const suggest = async () => {
    if (!email) return toast.error('Select an active client.');
    setBusy(true);
    try {
      await workflowFetch('/api/workflow/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tender_id: tender._id || tender.id,
          bid_no: tender.bid_no,
          title: tender.title,
          client_email: email,
        }),
      });
      toast.success('Moved to Suggestion Bar. Attach SOW there to send to the client.');
      setEmail('');
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
      <Button
        size="sm"
        className={`${compact ? 'h-7 text-[10px]' : 'h-8 text-xs'} bg-emerald-600 hover:bg-emerald-700 shrink-0`}
        onClick={suggest}
        disabled={busy}
      >
        {busy ? 'Suggesting…' : 'Suggest'}
      </Button>
    </div>
  );
}
