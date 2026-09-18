'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { workflowFetch } from '@/components/workflow/api';

export default function SuggestSowModal({ open, onOpenChange, job, clients = [], onDone }) {
  const [clientEmail, setClientEmail] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!clientEmail) return toast.error('Select a client from the database.');
    if (!file) return toast.error('Upload the SOW PDF. Typed scope is not allowed.');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('client_email', clientEmail);
      form.append('sow', file);
      const data = await workflowFetch(`/api/workflow/jobs/${job._id}/suggest`, { method: 'POST', body: form });
      toast.success('SOW sent. Client will see Pending Approval.');
      onDone?.(data?.job);
      onOpenChange(false);
      setClientEmail('');
      setFile(null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suggest to client</DialogTitle>
          <DialogDescription>
            Pick an approved client and attach the Scope of Work PDF. There is no typed scope field.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Client</Label>
            <Select value={clientEmail} onValueChange={setClientEmail}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.email} value={c.email}>
                    {(c.company_name || c.client_name || c.name || c.email)} — {c.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>SOW PDF *</Label>
            <input type="file" accept="application/pdf" className="mt-1 block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">{busy ? 'Sending…' : 'Send SOW'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
