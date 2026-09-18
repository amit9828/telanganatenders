'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FileText, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { staffHeaders, staffPdfHref } from '@/components/workflow/api';

async function openStaffBlob(url) {
  const res = await fetch(url, { credentials: 'include', headers: staffHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Could not open file (${res.status})`);
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const opened = window.open(href, '_blank', 'noopener,noreferrer');
  if (!opened) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }
}

export default function ClientBidSupportPanel({ tenders = [], pdfEmail = '', onSuggested }) {
  const [requests, setRequests] = useState([]);
  const [bidReply, setBidReply] = useState({});
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    try {
      const res = await fetch(`/api/client-requests?t=${Date.now()}`, {
        credentials: 'include',
        headers: staffHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load bid support requests.');
      setRequests(data.requests || []);
    } catch (err) {
      toast.error(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const removeCard = (reqId) => {
    setRequests((prev) => prev.filter((r) => String(r._id) !== String(reqId)));
    setBidReply((prev) => {
      const next = { ...prev };
      delete next[reqId];
      return next;
    });
  };

  const rejectRequest = async (req) => {
    const reqId = req._id;
    setBusyId(reqId);
    removeCard(reqId);
    try {
      const res = await fetch('/api/client-requests/reply', {
        method: 'PUT',
        credentials: 'include',
        headers: staffHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          req_id: reqId,
          status: 'Rejected',
          reply: bidReply[reqId] || 'Request rejected by GM',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to reject request.');
      toast.success('Request rejected.');
    } catch (err) {
      toast.error(err.message);
      load();
    } finally {
      setBusyId('');
    }
  };

  const suggestToClient = async (req) => {
    const reqId = req._id;
    setBusyId(reqId);
    removeCard(reqId);
    try {
      const res = await fetch('/api/client-requests/suggest', {
        method: 'PUT',
        credentials: 'include',
        headers: staffHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          req_id: reqId,
          reply: bidReply[reqId] || 'Parked on Suggestion Bar',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to park on Suggestion Bar.');
      toast.success('Parked on Suggestion Bar for this client.');
      if (data.job) onSuggested?.(data.job);
    } catch (err) {
      toast.error(err.message);
      load();
    } finally {
      setBusyId('');
    }
  };

  const viewDocument = async (req) => {
    const matchedTender = tenders.find((t) => t.bid_no === req.link_or_id);
    try {
      if (req.has_file) {
        await openStaffBlob(`/api/client-requests/${req._id}/file`);
        return;
      }
      if (matchedTender) {
        window.open(staffPdfHref(matchedTender._id || matchedTender.id, { email: pdfEmail, role: 'employee' }), '_blank');
        return;
      }
      if (req.link_or_id && String(req.link_or_id).startsWith('http')) {
        window.open(req.link_or_id, '_blank');
        return;
      }
      toast.info('No file attached. The link/ID reference is shown above.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Card className="tender-shadow border-0 bg-slate-50/50">
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-[#0A2647] text-lg flex items-center gap-2">
          <UploadCloud className="w-5 h-5 text-blue-600" /> Client Bid Support Requests ({requests.length})
        </CardTitle>
        <CardDescription>Requests submitted by clients. Reject, or park on the Suggestion Bar for that client.</CardDescription>
      </CardHeader>
      <CardContent className="pt-4 max-h-[850px] overflow-y-auto">
        {requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <UploadCloud className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm font-semibold">No custom bid requests pending.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((req) => {
              const matchedTender = tenders.find((t) => t.bid_no === req.link_or_id);
              const hasLink = req.link_or_id && String(req.link_or_id).startsWith('http');
              const canOpen = Boolean(req.has_file || matchedTender || hasLink);
              const label = req.has_file
                ? 'View Uploaded Document'
                : (matchedTender ? 'View Original Tender PDF' : (hasLink ? 'Open Tender Link' : 'No Document Attached'));
              return (
                <div key={req._id} className="p-4 border border-slate-200 rounded-xl bg-white shadow-sm hover:border-blue-300 transition">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <Badge className="mb-2 bg-blue-50 text-blue-700 border-blue-200">{req.client_email}</Badge>
                      <h4 className="font-bold text-[#0A2647] text-sm break-all">{req.link_or_id}</h4>
                    </div>
                    <Badge className="bg-amber-100 text-amber-800 border-0 animate-pulse">{req.status}</Badge>
                  </div>
                  <p className="text-xs bg-slate-50 p-3 rounded-md border border-slate-100 text-slate-700 font-medium mb-3">&quot;{req.description}&quot;</p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canOpen}
                    onClick={() => viewDocument(req)}
                    className={`mb-4 w-full sm:w-auto h-8 text-xs ${canOpen ? 'border-blue-200 text-blue-700 hover:bg-blue-50' : 'text-slate-400 border-slate-200 bg-slate-100'}`}
                  >
                    <FileText className="w-3.5 h-3.5 mr-1" />
                    {label}
                  </Button>
                  <div className="flex flex-col gap-3 border-t pt-3">
                    <Input
                      placeholder="Reply or instructions (optional)..."
                      className="h-9 text-xs bg-white"
                      value={bidReply[req._id] || ''}
                      onChange={(e) => setBidReply({ ...bidReply, [req._id]: e.target.value })}
                    />
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 h-8 flex-1"
                        disabled={busyId === req._id}
                        onClick={() => suggestToClient(req)}
                      >
                        Suggest to Client
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-600 hover:bg-red-50 h-8 flex-1"
                        disabled={busyId === req._id}
                        onClick={() => rejectRequest(req)}
                      >
                        Reject Request
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
