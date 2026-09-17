'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Eye, FolderPlus, Send, UploadCloud } from 'lucide-react';
import { staffHeaders } from '@/components/workflow/api';

export default function OperationsStoragePanel({ clients = [], uploadedBy = '' }) {
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [sharingDocId, setSharingDocId] = useState(null);
  const [targetClientEmail, setTargetClientEmail] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/operator/docs?t=${Date.now()}`, {
        credentials: 'include',
        headers: staffHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to load storage (${res.status})`);
      setDocs(data.docs || []);
    } catch (err) {
      toast.error(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf' && !String(file.name || '').toLowerCase().endsWith('.pdf')) {
      return toast.error('Please upload a PDF file');
    }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch('/api/operator/docs', {
          method: 'POST',
          credentials: 'include',
          headers: staffHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            name: file.name,
            file_base64: String(reader.result || '').split(',')[1] || '',
            uploaded_by: uploadedBy,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to store document.');
        toast.success('Document stored successfully in Operations Storage!');
        load();
      } catch (err) {
        toast.error(err.message || 'Network error during upload.');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const share = async (docId) => {
    if (!targetClientEmail) return toast.error('Please select a client to share with.');
    try {
      const res = await fetch('/api/operator/share', {
        method: 'POST',
        credentials: 'include',
        headers: staffHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ docId, client_email: targetClientEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to share document.');
      toast.success('Document successfully shared with the client!');
      setSharingDocId(null);
      setTargetClientEmail('');
    } catch (err) {
      toast.error(err.message || 'Network error.');
    }
  };

  const openFile = async (docId) => {
    try {
      const res = await fetch(`/api/operator/docs/${docId}/file`, {
        credentials: 'include',
        headers: staffHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Could not open file (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Card className="shadow-sm border-t-4 border-t-purple-600 w-full mt-6">
      <CardHeader className="bg-purple-50/50 border-b pb-4">
        <CardTitle className="text-purple-900 flex items-center gap-2">
          <FolderPlus className="w-5 h-5 text-purple-600" /> Operations Storage & Client Sharing
        </CardTitle>
        <CardDescription>Upload blank proformas, GeM formats, or reference docs here and share directly to clients.</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <label className="flex-1 border-2 border-dashed border-purple-300 bg-purple-50 rounded-lg flex flex-col items-center justify-center h-24 cursor-pointer hover:bg-purple-100 transition shadow-sm">
            <UploadCloud className="w-6 h-6 text-purple-500 mb-1" />
            <span className="text-[10px] font-bold text-purple-700 uppercase">{uploading ? 'Uploading...' : 'Upload New Document to Storage'}</span>
            <input type="file" accept="application/pdf" onChange={onUpload} disabled={uploading} className="hidden" />
          </label>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[300px] overflow-y-auto pr-2">
          {docs.length === 0 ? (
            <p className="text-xs text-slate-500 col-span-full text-center py-4">No documents stored yet.</p>
          ) : (
            docs.map((doc) => (
              <div key={doc._id} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm flex flex-col justify-between hover:border-purple-300 transition">
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0 pr-2">
                    <h4 className="text-sm font-bold text-[#0A2647] truncate" title={doc.name}>{doc.name}</h4>
                    <p className="text-[9px] text-slate-400 mt-0.5">Uploaded: {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '—'}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-blue-500 hover:bg-blue-50" onClick={() => openFile(doc._id)}>
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="border-t border-slate-100 pt-3 mt-auto">
                  {sharingDocId === doc._id ? (
                    <div className="flex flex-col gap-2">
                      <Select value={targetClientEmail} onValueChange={setTargetClientEmail}>
                        <SelectTrigger className="h-8 text-[10px] bg-slate-50"><SelectValue placeholder="Select Client" /></SelectTrigger>
                        <SelectContent>
                          {clients.map((c) => (
                            <SelectItem key={c.email} value={c.email}>{c.company_name || c.client_name || c.email} ({c.client_id || c.email})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => share(doc._id)} className="flex-1 bg-purple-600 hover:bg-purple-700 h-7 text-[10px]">Share</Button>
                        <Button size="sm" variant="outline" onClick={() => setSharingDocId(null)} className="h-7 text-[10px] px-2 text-slate-500">Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setSharingDocId(doc._id)} className="w-full text-purple-600 border-purple-200 hover:bg-purple-50 h-8 text-xs">
                      <Send className="w-3 h-3 mr-1" /> Share to Client
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
