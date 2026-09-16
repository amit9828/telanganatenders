'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, FileText, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { staffHeaders, staffPdfHref } from '@/components/workflow/api';
import { DESIGNATIONS, resolveStaffDesignation } from '@/lib/designations';

export default function ClientBidSupportPanel({ team = [], tenders = [], pdfEmail = '' }) {
  const [requests, setRequests] = useState([]);
  const [bidReply, setBidReply] = useState({});
  const [bidAssignee, setBidAssignee] = useState({});

  const assignees = team.filter((emp) => {
    const role = resolveStaffDesignation(emp);
    return role === DESIGNATIONS.DOC_TEAM_TL || role === DESIGNATIONS.DOC_TEAM_MEMBER;
  });

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

  const processRequest = async (reqId, status) => {
    const reply = bidReply[reqId];
    const assigneeId = bidAssignee[reqId];
    if (status === 'Assigned' && !assigneeId) {
      return toast.error('Please select an employee from the dropdown to assign.');
    }
    try {
      let endpoint = '/api/client-requests/reply';
      let payload = { req_id: reqId, status, reply: reply || 'Processed by GM' };
      if (status === 'Assigned' && assigneeId) {
        const emp = assignees.find((t) => t.emp_id === assigneeId);
        endpoint = '/api/client-requests/assign';
        payload = {
          req_id: reqId,
          emp_id: emp.emp_id,
          emp_name: emp.name,
          status: 'Assigned',
          reply: reply || 'Assigned to Employee',
        };
      }
      const res = await fetch(endpoint, {
        method: 'PUT',
        credentials: 'include',
        headers: staffHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update status.');
      toast.success(`Client Request ${status}!`);
      setBidReply((prev) => ({ ...prev, [reqId]: '' }));
      setBidAssignee((prev) => ({ ...prev, [reqId]: '' }));
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteRequest = async (id) => {
    if (!confirm('Permanently delete this request?')) return;
    setRequests((prev) => prev.filter((r) => r._id !== id));
    try {
      const res = await fetch(`/api/client-requests?id=${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: staffHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Delete failed.');
      toast.success('Deleted permanently.');
    } catch (err) {
      toast.error(err.message);
      load();
    }
  };

  const viewDocument = (req) => {
    const docLink = req.file_url || req.document_url || req.file || req.attachment || req.pdf || req.document || req.uploaded_file || req.client_file;
    if (docLink) {
      const finalUrl = docLink.startsWith('http') ? docLink : (docLink.startsWith('/') ? docLink : `/uploads/${docLink}`);
      window.open(finalUrl, '_blank');
    } else if (req.link_or_id && String(req.link_or_id).startsWith('http')) {
      window.open(req.link_or_id, '_blank');
    } else {
      toast.info('No file attached. The link/ID reference is shown above.');
    }
  };

  return (
    <Card className="tender-shadow border-0 bg-slate-50/50">
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-[#0A2647] text-lg flex items-center gap-2">
          <UploadCloud className="w-5 h-5 text-blue-600" /> Client Bid Support Requests ({requests.length})
        </CardTitle>
        <CardDescription>Requests submitted by clients. Assign to employees to track progress.</CardDescription>
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
              const hasDoc = req.file_url || req.document_url || req.file || req.attachment || req.pdf || req.document || req.uploaded_file || req.client_file || (req.link_or_id && String(req.link_or_id).startsWith('http'));
              const matchedTender = tenders.find((t) => t.bid_no === req.link_or_id);
              const isClientUpload = hasDoc && !matchedTender;
              return (
                <div key={req._id} className="p-4 border border-slate-200 rounded-xl bg-white shadow-sm hover:border-blue-300 transition">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <Badge className="mb-2 bg-blue-50 text-blue-700 border-blue-200">{req.client_email}</Badge>
                      <h4 className="font-bold text-[#0A2647] text-sm break-all">{req.link_or_id}</h4>
                    </div>
                    <Badge className={req.status === 'Pending Officer Review' ? 'bg-amber-100 text-amber-800 border-0 animate-pulse' : 'bg-emerald-100 text-emerald-800 border-0'}>{req.status}</Badge>
                  </div>
                  <p className="text-xs bg-slate-50 p-3 rounded-md border border-slate-100 text-slate-700 font-medium mb-3">&quot;{req.description}&quot;</p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hasDoc && !matchedTender}
                    onClick={() => {
                      if (isClientUpload || !matchedTender) viewDocument(req);
                      else window.open(staffPdfHref(matchedTender._id || matchedTender.id, { email: pdfEmail, role: 'employee' }), '_blank');
                    }}
                    className={`mb-4 w-full sm:w-auto h-8 text-xs ${hasDoc || matchedTender ? 'border-blue-200 text-blue-700 hover:bg-blue-50' : 'text-slate-400 border-slate-200 bg-slate-100'}`}
                  >
                    <FileText className="w-3.5 h-3.5 mr-1" />
                    {isClientUpload ? 'View Uploaded Document' : (matchedTender ? 'View Original Tender PDF' : 'No Document Attached')}
                  </Button>
                  {req.status === 'Pending Officer Review' ? (
                    <div className="flex flex-col gap-3 border-t pt-3">
                      <Input
                        placeholder="Reply or instructions..."
                        className="h-9 text-xs bg-white"
                        value={bidReply[req._id] || ''}
                        onChange={(e) => setBidReply({ ...bidReply, [req._id]: e.target.value })}
                      />
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Select value={bidAssignee[req._id] || ''} onValueChange={(v) => setBidAssignee({ ...bidAssignee, [req._id]: v })}>
                          <SelectTrigger className="flex-1 h-8 text-xs bg-white"><SelectValue placeholder="Assign to Employee..." /></SelectTrigger>
                          <SelectContent>
                            {assignees.map((emp) => (
                              <SelectItem key={emp.emp_id} value={emp.emp_id}>{emp.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" className="bg-[#16a34a] hover:bg-[#15803d] h-8" onClick={() => processRequest(req._id, 'Assigned')}>
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Assign & Notify
                        </Button>
                      </div>
                      <Button size="sm" variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 h-8 mt-1" onClick={() => processRequest(req._id, 'Rejected')}>
                        Reject Request
                      </Button>
                    </div>
                  ) : (
                    <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 mt-2">
                      <p className="text-xs text-emerald-800 font-bold mb-1">Status: {req.status}</p>
                      <p className="text-xs text-slate-700 font-medium">Reply: {req.reply}</p>
                      <div className="flex gap-2 mt-3 pt-2 border-t border-emerald-200/50">
                        <Button size="sm" variant="ghost" onClick={() => processRequest(req._id, 'Pending Officer Review')} className="h-7 text-[10px] text-amber-600 bg-amber-50 hover:bg-amber-100">
                          <RefreshCw className="w-3 h-3 mr-1" /> Re-Query
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteRequest(req._id)} className="h-7 text-[10px] text-red-600 bg-red-50 hover:bg-red-100">
                          <Trash2 className="w-3 h-3 mr-1" /> Delete Permanently
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
