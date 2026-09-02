'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Image as ImageIcon, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { LetterheadThumb, staffLetterheadHeaders } from '@/components/LetterheadThumb';

/**
 * Upload / list company letterhead templates (PNG/JPEG/PDF) stored in R2 + Mongo.
 */
export default function LetterheadManager({ onChanged } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/letterheads?t=${Date.now()}`, {
        headers: staffLetterheadHeaders(),
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (res.ok) setItems(data.letterheads || []);
    } catch {
      /* listing is best-effort */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const uploadFile = async (file) => {
    if (!file) return;
    const okType = file.type === 'application/pdf'
      || /^image\/(png|jpeg|webp)$/.test(file.type)
      || /\.(pdf|png|jpe?g|webp)$/i.test(file.name);
    if (!okType) return toast.error('Upload a PNG, JPEG, WebP or PDF letterhead.');

    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('name', name || file.name.replace(/\.[^.]+$/, ''));
    try {
      const res = await fetch('/api/letterheads', {
        method: 'POST',
        headers: staffLetterheadHeaders(),
        credentials: 'include',
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Letterhead upload failed.');
        return;
      }
      toast.success(`Saved “${data.letterhead?.name || 'letterhead'}”.`);
      setName('');
      await load();
      onChanged?.(data.letterhead);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('letterheads-updated'));
    } catch {
      toast.error('Network error while uploading the letterhead.');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/letterheads?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: staffLetterheadHeaders(),
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || 'Could not delete letterhead.');
        return;
      }
      toast.success('Letterhead removed.');
      await load();
      onChanged?.();
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('letterheads-updated'));
    } catch {
      toast.error('Network error while deleting.');
    }
  };

  return (
    <Card className="tender-shadow border-t-4 border-t-slate-700 w-full">
      <CardHeader className="bg-slate-50/80 border-b pb-4">
        <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
          <ImageIcon className="w-5 h-5 text-slate-600" /> Letterhead Management
        </CardTitle>
        <CardDescription>
          Upload company letterhead templates (scanned A4 image or PDF). Select one in the generator before drafting.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5 space-y-4">
        <div>
          <Label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Template name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Pvt Ltd — official letterhead"
            className="mt-1 bg-white h-9"
          />
        </div>
        <label
          onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragActive(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (!uploading) uploadFile(e.dataTransfer?.files?.[0]);
          }}
          className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center text-center transition ${
            uploading
              ? 'bg-slate-100 cursor-wait'
              : dragActive
                ? 'border-[#0A2647] bg-slate-100'
                : 'border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer'
          }`}
        >
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { uploadFile(e.target.files?.[0]); e.target.value = ''; }}
          />
          {uploading
            ? <Loader2 className="w-7 h-7 text-slate-600 animate-spin mb-2" />
            : <UploadCloud className="w-7 h-7 text-slate-500 mb-2" />}
          <span className="text-sm font-bold text-slate-800">
            {uploading ? 'Uploading letterhead…' : 'Drop letterhead image or PDF'}
          </span>
          <span className="text-xs text-slate-500 mt-1">PNG / JPEG / WebP / PDF · max 8MB</span>
        </label>

        {loading && items.length === 0 ? (
          <p className="text-xs text-slate-500 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading templates…
          </p>
        ) : items.length === 0 ? (
          <p className="text-xs text-slate-500">No letterheads stored yet. Upload one to enable document generation.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((item) => (
              <div key={item.id} className="border rounded-lg overflow-hidden bg-white">
                <div className="h-28 bg-slate-100 flex items-center justify-center">
                  <LetterheadThumb id={item.id} kind={item.kind} alt={item.name} />
                </div>
                <div className="px-2 py-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">{item.name}</p>
                    <p className="text-[10px] text-slate-400 uppercase">{item.kind}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-red-600 border-red-200"
                    onClick={() => remove(item.id)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
