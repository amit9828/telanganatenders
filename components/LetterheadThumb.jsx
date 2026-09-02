'use client';

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';

export function staffLetterheadHeaders(extra = {}) {
  const headers = { ...extra };
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('tt_admin');
    if (token) headers.Authorization = `Bearer ${token}`;
    const emp = localStorage.getItem('tt_emp_email');
    if (emp) headers['x-employee-email'] = emp;
  }
  return headers;
}

export function LetterheadThumb({ id, kind, alt = '', className = 'max-h-28 w-full object-contain' }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (kind !== 'image' || !id) return undefined;
    let objectUrl;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/letterheads/file?id=${encodeURIComponent(id)}`, {
          headers: staffLetterheadHeaders(),
          credentials: 'include',
        });
        if (!res.ok) return;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
      } catch { /* preview optional */ }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, kind]);

  if (kind !== 'image') {
    return <FileText className="w-8 h-8 text-slate-400" />;
  }
  if (!url) return <div className="w-full h-full bg-slate-100" />;
  return <img src={url} alt={alt} className={className} />;
}
