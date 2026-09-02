'use client';

import { BadgeCheck, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

function staffHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('tt_admin');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Verification chip next to a client phone number. Staff can click to toggle the flag
 * that gates automated WhatsApp alerts.
 */
export default function WhatsAppVerifiedBadge({ email, phone, verified, onChanged }) {
  if (!phone) return <span className="text-slate-800 font-semibold text-sm">Not Provided</span>;

  const toggle = async () => {
    if (!email) return;
    const next = !verified;
    try {
      const res = await fetch('/api/users/whatsapp', {
        method: 'PATCH',
        headers: staffHeaders(),
        body: JSON.stringify({ email, verified: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not update WhatsApp verification.');
        return;
      }
      toast.success(next ? 'WhatsApp number marked verified.' : 'WhatsApp verification removed.');
      onChanged?.(next);
    } catch {
      toast.error('Network error.');
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-slate-800 font-semibold text-sm">{phone}</span>
      <button
        type="button"
        onClick={toggle}
        title={verified ? 'WhatsApp verified — click to revoke' : 'Not verified — click to confirm this number'}
        className={`inline-flex items-center gap-0.5 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${
          verified
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-amber-300 hover:text-amber-700'
        }`}
      >
        {verified ? <BadgeCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
        {verified ? 'WA Verified' : 'WA Unverified'}
      </button>
    </span>
  );
}
