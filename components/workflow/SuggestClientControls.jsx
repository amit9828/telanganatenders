'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { workflowFetch } from '@/components/workflow/api';
import { canParticipate } from '@/lib/billing-access';

export default function SuggestClientControls({
  tender,
  clients = [],
  onDone,
  compact = false,
  variant = 'forward-gm',
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const isSuggest = variant === 'suggest';
  const choices = clients.filter((client) => {
    const knowsPlan = client.subscription != null || client.bid_balance != null || client.billing_paid != null;
    return knowsPlan ? canParticipate(client) : true;
  });

  const parkForClient = async () => {
    if (!email) return toast.error('Select an active client.');
    const client = choices.find((c) => c.email === email) || {};
    const tenderId = tender?._id?.$oid || tender?._id || tender?.id || '';
    setBusy(true);
    try {
      const data = await workflowFetch('/api/workflow/jobs', {
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
      toast.success(isSuggest ? 'Parked on Suggestion Bar.' : 'Forwarded to GM Suggestion Bar.');
      setEmail('');
      onDone?.(data?.job);
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
          {choices.map((c) => (
            <SelectItem key={c.email} value={c.email}>
              {c.company_name || c.client_name || c.name || c.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        className={`${compact ? 'h-7 text-[10px]' : 'h-8 text-xs'} bg-emerald-600 hover:bg-emerald-700 shrink-0`}
        onClick={parkForClient}
        disabled={busy}
      >
        {busy ? (isSuggest ? 'Parking…' : 'Forwarding…') : (isSuggest ? 'Suggest' : 'Forward to GM')}
      </Button>
    </div>
  );
}
