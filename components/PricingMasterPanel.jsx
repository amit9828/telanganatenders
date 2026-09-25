'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { IndianRupee } from 'lucide-react';

const GROUPS = [
  { id: 'view', title: 'Freemium views' },
  { id: 'registration', title: 'Registration combos' },
  { id: 'saas', title: 'Bidding SaaS plans' },
  { id: 'payg', title: 'Pay-as-you-go packs' },
  { id: 'payment_tracking', title: 'Payment tracking' },
  { id: 'ondemand', title: 'On-demand services' },
  { id: 'compliance', title: 'Third-party and compliance' },
];

function authHeaders(token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export default function PricingMasterPanel({ token = '', canEdit = false }) {
  const [items, setItems] = useState([]);
  const [allowed, setAllowed] = useState(canEdit);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch('/api/pricing-master', { credentials: 'include', headers: authHeaders(token) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || 'Could not load prices.');
      return;
    }
    setItems(data.items || []);
    setAllowed(Boolean(data.canEdit) && canEdit);
  };

  useEffect(() => { load(); }, [token]);

  const setPrice = (serviceKey, value) => {
    setItems((prev) => prev.map((item) => (
      item.service_key === serviceKey ? { ...item, base_price: value } : item
    )));
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/pricing-master', {
        method: 'PUT',
        credentials: 'include',
        headers: authHeaders(token),
        body: JSON.stringify({
          prices: items.map((item) => ({
            service_key: item.service_key,
            base_price: Number(item.base_price) || 0,
            is_active: item.is_active !== false,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      setItems(data.items || []);
      toast.success('Prices saved.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="tender-shadow border-t-4 border-t-emerald-600">
      <CardHeader className="border-b bg-emerald-50/40">
        <CardTitle className="text-[#0A2647] flex items-center gap-2"><IndianRupee className="w-5 h-5 text-emerald-600" /> PricingMaster</CardTitle>
        <CardDescription>Base prices in ₹. GST is added only on the checkout summary.</CardDescription>
      </CardHeader>
      <CardContent className="pt-5 space-y-6">
        {GROUPS.map((group) => {
          const rows = items.filter((item) => item.category === group.id);
          if (!rows.length) return null;
          return (
            <section key={group.id} className="space-y-2">
              <h3 className="text-sm font-bold text-[#0A2647] border-b border-slate-200 pb-1">{group.title}</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {rows.map((item) => {
                  const locked = !allowed || item.individually_purchasable === false;
                  return (
                    <label key={item.service_key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <span className="text-sm font-semibold text-slate-800">
                        {item.name}
                        {item.individually_purchasable === false ? <span className="block text-[10px] font-medium text-slate-400">Included with a combo. Not sold alone.</span> : null}
                        {item.bid_credits ? <span className="block text-[10px] font-medium text-slate-400">{item.bid_credits} bid credits</span> : null}
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        <span className="text-sm font-bold text-slate-500">₹</span>
                        <Input
                          type="number"
                          min="0"
                          disabled={locked}
                          value={item.base_price ?? 0}
                          onChange={(e) => setPrice(item.service_key, e.target.value)}
                          className="h-8 w-28 text-right"
                        />
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}
        {allowed ? (
          <Button onClick={save} disabled={busy} className="bg-[#0A2647] hover:bg-[#144272]">
            {busy ? 'Saving…' : 'Save prices'}
          </Button>
        ) : (
          <p className="text-xs text-slate-500">Prices are read-only on this desk.</p>
        )}
      </CardContent>
    </Card>
  );
}
