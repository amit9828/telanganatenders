'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Image as ImageIcon, Loader2, PenTool, Trash2, UploadCloud } from 'lucide-react';

function staffHeaders() {
  const headers = {};
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('tt_admin');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function Slot({ kind, label, hint, url, uploading, onUpload, onClear }) {
  return (
    <div className="border rounded-xl p-3 bg-slate-50">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">{label}</p>
      {url ? (
        <img src={url} alt={label} className="w-full h-28 object-contain bg-white border rounded-md mb-2" />
      ) : (
        <div className="h-28 border border-dashed rounded-md flex items-center justify-center text-slate-400 mb-2 bg-white">
          {kind === 'signature' ? <PenTool className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}
        </div>
      )}
      <p className="text-[11px] text-slate-500 mb-2">{hint}</p>
      <div className="flex gap-2">
        <label className={`flex-1 h-8 text-xs font-semibold rounded-md flex items-center justify-center text-white ${uploading ? 'bg-slate-400' : 'bg-[#0A2647] hover:bg-[#144272] cursor-pointer'}`}>
          {uploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <UploadCloud className="w-3 h-3 mr-1" />}
          {url ? 'Replace' : 'Upload'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onUpload(kind, file); }}
          />
        </label>
        {url && (
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs text-red-600 border-red-200" onClick={() => onClear(kind)}>
            <Trash2 className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Staff-only dialog to attach a client's letterhead background and signature stamp.
 * Previews are fetched with the staff Authorization header (blob URLs) so they work
 * even when the R2 bucket is private.
 */
export default function StationeryUploader({ client, open, onOpenChange, onUpdated }) {
  const [uploadingKind, setUploadingKind] = useState(null);
  const [preview, setPreview] = useState({ letterhead: null, signature: null });

  const email = client?.email;

  const loadPreview = async (kind) => {
    if (!email) return;
    try {
      const res = await fetch(`/api/users/stationery/file?email=${encodeURIComponent(email)}&kind=${kind}`, {
        headers: staffHeaders(),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      setPreview((p) => {
        if (p[kind]) URL.revokeObjectURL(p[kind]);
        return { ...p, [kind]: objectUrl };
      });
    } catch { /* no file yet */ }
  };

  useEffect(() => {
    if (!open || !email) return;
    loadPreview('letterhead');
    loadPreview('signature');
    return () => {
      setPreview((p) => {
        if (p.letterhead) URL.revokeObjectURL(p.letterhead);
        if (p.signature) URL.revokeObjectURL(p.signature);
        return { letterhead: null, signature: null };
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, email]);

  const upload = async (kind, file) => {
    if (!email) return;
    if (file.size > 3 * 1024 * 1024) {
      return toast.error('Keep stationery images under 3MB.');
    }
    setUploadingKind(kind);
    const form = new FormData();
    form.append('file', file);
    form.append('email', email);
    form.append('kind', kind);
    try {
      const res = await fetch('/api/users/stationery', { method: 'POST', headers: staffHeaders(), body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Upload failed.');
        return;
      }
      if (data.warning) toast.warning(data.warning, { duration: 8000 });
      else toast.success(`${kind === 'letterhead' ? 'Letterhead' : 'Signature'} saved.`);
      await loadPreview(kind);
      onUpdated?.({ email, kind, url: data.url });
    } catch {
      toast.error('Network error while uploading stationery.');
    } finally {
      setUploadingKind(null);
    }
  };

  const clear = async (kind) => {
    if (!email) return;
    try {
      const res = await fetch(`/api/users/stationery?email=${encodeURIComponent(email)}&kind=${kind}`, {
        method: 'DELETE',
        headers: staffHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || 'Could not remove the file.');
        return;
      }
      setPreview((p) => {
        if (p[kind]) URL.revokeObjectURL(p[kind]);
        return { ...p, [kind]: null };
      });
      onUpdated?.({ email, kind, url: null });
      toast.success('Removed.');
    } catch {
      toast.error('Network error.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[#0A2647]">Client Stationery</DialogTitle>
          <DialogDescription>
            Letterhead background and signature stamp for {client?.company_name || client?.email}. Generated bid documents print onto these assets.
          </DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3 pt-1">
          <Slot
            kind="letterhead"
            label="Letterhead background"
            hint="A4 PNG/JPEG of their printed letterhead."
            url={preview.letterhead}
            uploading={uploadingKind === 'letterhead'}
            onUpload={upload}
            onClear={clear}
          />
          <Slot
            kind="signature"
            label="Signature / stamp"
            hint="Transparent PNG of the authorised signatory."
            url={preview.signature}
            uploading={uploadingKind === 'signature'}
            onUpload={upload}
            onClear={clear}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
