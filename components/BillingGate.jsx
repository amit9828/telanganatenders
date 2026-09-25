'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { load } from '@cashfreepayments/cashfree-js';

const GROUPS = [
  { id: 'view', title: 'View access' },
  { id: 'registration', title: 'Registration combos' },
  { id: 'saas', title: 'Bidding plans' },
  { id: 'payg', title: 'Pay-as-you-go' },
  { id: 'payment_tracking', title: 'Payment tracking' },
  { id: 'ondemand', title: 'On-demand services' },
];

export default function BillingGate({ onPaid }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState('');
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const pending = sessionStorage.getItem('tt_pending_plan') || '';
    fetch('/api/pricing-master', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const rows = (d.items || []).filter((item) => item.is_active !== false && item.individually_purchasable !== false);
        setItems(rows);
        if (pending && rows.some((row) => row.service_key === pending)) setSelected(pending);
      })
      .catch(() => toast.error('Could not load prices.'));
  }, []);

  const choose = (item) => {
    setSelected(item.service_key);
    const subtotal = Number(item.base_price) || 0;
    const gst = Math.round(subtotal * 0.18 * 100) / 100;
    setSummary({ name: item.name, subtotal, gst, total: Math.round((subtotal + gst) * 100) / 100, includesUdyam: ['gem_account', 'gst_combo', 'esi_epf_combo'].includes(item.service_key) });
  };

  const pay = async () => {
    if (!selected || !summary) return toast.error('Choose a service first.');
    setBusy(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed.');
      const cashfree = await load({ mode: 'production' });
      await cashfree.checkout({
        paymentSessionId: data.payment_session_id,
        returnUrl: `${window.location.origin}/payment-status?order_id=${data.order_id}`,
      });
      onPaid?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-3xl mx-auto shadow-xl">
      <CardHeader>
        <CardTitle className="text-[#0A2647]">Choose a service</CardTitle>
        <CardDescription>Prices are before tax. GST is added on the summary below.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {GROUPS.map((group) => {
          const rows = items.filter((item) => item.category === group.id);
          if (!rows.length) return null;
          return (
            <section key={group.id}>
              <h3 className="text-sm font-bold text-[#0A2647] mb-2">{group.title}</h3>
              <div className="grid sm:grid-cols-2 gap-2">
                {rows.map((item) => (
                  <button key={item.service_key} type="button" onClick={() => choose(item)} className={`rounded-lg border px-3 py-2 text-left ${selected === item.service_key ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                    <span className="block text-sm font-semibold text-[#0A2647]">{item.name}</span>
                    <span className="text-sm font-bold">₹{Number(item.base_price) || 0}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {summary ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm space-y-1">
            <p className="font-semibold text-[#0A2647]">{summary.name}</p>
            {summary.includesUdyam ? <p className="text-emerald-700">Udyam is included with this combo.</p> : null}
            <p>Subtotal: ₹{summary.subtotal}</p>
            <p>GST 18%: ₹{summary.gst}</p>
            <p className="font-bold">Total: ₹{summary.total}</p>
            <Button className="mt-2 bg-[#0A2647]" disabled={busy} onClick={pay}>{busy ? 'Opening payment…' : 'Pay'}</Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
