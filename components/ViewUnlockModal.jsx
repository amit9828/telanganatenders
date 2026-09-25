'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const VIEWS = [
  { key: 'view_single', name: 'This tender', detail: 'Unlock this bid number and document' },
  { key: 'view_month', name: '30 days', detail: 'Unmask bid numbers and documents for 30 days' },
  { key: 'view_year', name: '365 days', detail: 'Unmask bid numbers and documents for a year' },
];

export default function ViewUnlockModal({ open, tenderTitle, onClose, onChoose }) {
  const [prices, setPrices] = useState({});

  useEffect(() => {
    if (!open) return;
    fetch('/api/pricing-master', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        const map = {};
        for (const item of data.items || []) {
          if (VIEWS.some((row) => row.key === item.service_key)) map[item.service_key] = Number(item.base_price) || 0;
        }
        setPrices(map);
      })
      .catch(() => setPrices({}));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[#0A2647]">Unlock this tender</DialogTitle>
          <DialogDescription>{tenderTitle || 'Bid numbers and documents stay hidden until you choose a view plan.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {VIEWS.map((row) => (
            <button key={row.key} type="button" onClick={() => onChoose?.(row.key)} className="w-full text-left rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-emerald-500 hover:shadow-md transition">
              <span className="block font-black text-[#0A2647]">{row.name}</span>
              <span className="block text-sm text-slate-500">{row.detail}</span>
              <span className="block mt-1 text-lg font-black text-emerald-700">₹{prices[row.key] ?? '—'}</span>
            </button>
          ))}
          <Button variant="ghost" className="w-full" onClick={onClose}>Not now</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
