'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export default function MasterTenderDesk() {
  const [bidNo, setBidNo] = useState('');
  const [extract, setExtract] = useState(null);
  const [clients, setClients] = useState([]);
  const [busy, setBusy] = useState(false);

  async function loadExtract(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/estimator/staff?action=extract&bid_no=${encodeURIComponent(bidNo)}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the extract.');
      setExtract(data.extract);
      if (!data.extract) toast.message('No extract yet. It appears after a client asks about this bid.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(event) {
    event.preventDefault();
    const file = event.target.file.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.set('file', file);
    if (bidNo.trim()) body.set('bid_no', bidNo.trim());
    setBusy(true);
    try {
      const res = await fetch('/api/estimator/staff', { method: 'POST', credentials: 'include', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      toast.success(`Saved ${data.saved} tender${data.saved === 1 ? '' : 's'}.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadMatches() {
    setBusy(true);
    try {
      const res = await fetch('/api/estimator/staff?action=matches', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not score matches.');
      setClients(data.clients || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function suggest(clientEmail, match) {
    const res = await fetch('/api/estimator/staff', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'suggest', client_email: clientEmail, bid_no: match.bid_no }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) toast.error(data.error || 'Suggest failed.');
    else toast.success(`Suggested ${match.bid_no} to ${clientEmail}.`);
  }

  const blocks = extract ? [
    ['Scope', extract.scope],
    ['Documents', extract.documents],
    ['MSME', extract.msme],
    ['Financial', extract.financial],
  ] : [];

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded-xl p-4 space-y-3">
        <h2 className="font-bold text-[#0A2647]">Master tenders</h2>
        <p className="text-sm text-slate-500">Upload an Excel sheet of tenders, or one PDF with its bid number. Nothing is sent to the model from this screen.</p>
        <form onSubmit={upload} className="flex flex-wrap gap-2 items-center">
          <Input value={bidNo} onChange={(event) => setBidNo(event.target.value)} placeholder="Bid number for a PDF" className="max-w-xs" />
          <input name="file" type="file" accept=".pdf,.xlsx,.xls" className="text-sm" />
          <Button type="submit" disabled={busy}>Upload</Button>
        </form>
      </div>
      <div className="bg-white border rounded-xl p-4 space-y-3">
        <h2 className="font-bold text-[#0A2647]">Staff extract</h2>
        <form onSubmit={loadExtract} className="flex gap-2">
          <Input value={bidNo} onChange={(event) => setBidNo(event.target.value)} placeholder="Bid number" />
          <Button type="submit" disabled={busy}>Load</Button>
        </form>
        {extract ? (
          <div className="space-y-3 text-sm">
            {extract.l1_unverified ? <p className="text-amber-700">Any price note is unverified until your team confirms it.</p> : null}
            {blocks.map(([label, items]) => (
              <div key={label}>
                <p className="font-semibold">{label}</p>
                {(items || []).length ? (items || []).map((item) => <p key={item.quote} className="text-slate-700">{item.text}</p>) : <p className="text-slate-400">Nothing quoted.</p>}
              </div>
            ))}
            {(extract.missing || []).length ? <p className="text-slate-500">Missing: {extract.missing.join(', ')}</p> : null}
          </div>
        ) : null}
      </div>
      <div className="bg-white border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[#0A2647]">Client matches</h2>
          <Button type="button" onClick={loadMatches} disabled={busy}>Score matches</Button>
        </div>
        {clients.map((client) => (
          <div key={client.email} className="border-t pt-3">
            <p className="font-semibold text-sm">{client.name}</p>
            <ul className="mt-2 space-y-2">
              {client.matches.map((match) => (
                <li key={`${client.email}-${match.tender_id}`} className="flex items-center justify-between gap-3 text-sm">
                  <span>{match.bid_no} · {match.title} · {match.score}</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => suggest(client.email, match)}>Suggest</Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
