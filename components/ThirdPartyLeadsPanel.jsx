'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Users } from 'lucide-react';

function authHeaders(token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function when(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function ThirdPartyLeadsPanel({ token = '' }) {
  const [leads, setLeads] = useState([]);
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    const res = await fetch('/api/third-party-leads', { credentials: 'include', headers: authHeaders(token) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || 'Could not load leads.');
      return;
    }
    setLeads(data.leads || []);
  };

  useEffect(() => { load(); }, [token]);

  const closeLead = async (id) => {
    setBusyId(id);
    try {
      const res = await fetch('/api/third-party-leads', {
        method: 'PUT',
        credentials: 'include',
        headers: authHeaders(token),
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not close lead.');
      setLeads((prev) => prev.filter((lead) => lead._id !== id));
      toast.success('Lead closed.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId('');
    }
  };

  return (
    <Card className="tender-shadow border-t-4 border-t-purple-600">
      <CardHeader className="border-b bg-purple-50/40">
        <CardTitle className="text-[#0A2647] flex items-center gap-2"><Users className="w-5 h-5 text-purple-600" /> Third-party leads</CardTitle>
        <CardDescription>Certificate and registration requests from the public form. ISO, FSSAI, company registration, and similar queries land here.</CardDescription>
      </CardHeader>
      <CardContent className="pt-4 overflow-x-auto">
        {leads.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No open leads.</p>
        ) : (
          <table className="premium-table text-sm text-left min-w-[760px]">
            <thead>
              <tr>
                <th>Enterprise name</th>
                <th>Client name</th>
                <th>Phone</th>
                <th>Area</th>
                <th>Query details</th>
                <th>Requested date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead._id}>
                  <td className="text-xs font-semibold">{lead.enterprise_name || '—'}</td>
                  <td className="text-xs">{lead.client_name || '—'}</td>
                  <td className="text-xs whitespace-nowrap">{lead.phone || '—'}</td>
                  <td className="text-xs">{lead.area || '—'}</td>
                  <td className="text-xs max-w-[240px]">{lead.query || '—'}</td>
                  <td className="text-xs whitespace-nowrap">{when(lead.created_at)}</td>
                  <td>
                    <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={busyId === lead._id} onClick={() => closeLead(lead._id)}>
                      {busyId === lead._id ? 'Closing…' : 'Dismiss / Close lead'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
