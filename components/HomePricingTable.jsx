'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

const GROUPS = [
  { id: 'view', title: 'Freemium views', blurb: 'Unmask bid numbers and documents. Does not include bidding.' },
  { id: 'saas', title: 'SaaS plans', blurb: 'Participate access for accepting recommendations.' },
  { id: 'payg', title: 'Bid packs', blurb: 'Pay as you go. Each suggestion spends one bid credit.' },
];

export default function HomePricingTable({ onSelect }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/pricing-master')
      .then((res) => res.json())
      .then((data) => setItems(Array.isArray(data.items) ? data.items : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="bg-white py-20 border-t border-slate-200 w-full">
      <div className="container mx-auto px-4 w-full">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-black text-[#0A2647] uppercase tracking-wide mb-3">Pricing</h2>
          <p className="text-slate-500 font-medium max-w-2xl mx-auto">Base prices in ₹. GST is added only on the checkout summary.</p>
        </div>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-[#0A2647]" /></div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {GROUPS.map((group) => {
              const rows = items.filter((item) => item.category === group.id);
              return (
                <div key={group.id} className="rounded-2xl border border-slate-200 bg-slate-50 shadow-xl overflow-hidden">
                  <div className="bg-[#0A2647] px-6 py-5">
                    <h3 className="text-lg font-black text-white">{group.title}</h3>
                    <p className="text-sm text-emerald-200 mt-1">{group.blurb}</p>
                  </div>
                  <div className="p-6 space-y-3">
                    {rows.length === 0 ? <p className="text-sm text-slate-400">No plans published.</p> : null}
                    {rows.map((item) => (
                      <div key={item.service_key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                        <div>
                          <p className="font-bold text-[#0A2647] text-sm">{item.name}</p>
                          {item.bid_credits ? <p className="text-[11px] text-slate-400">{item.bid_credits} bid credits</p> : null}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-lg font-black text-emerald-700">₹{Number(item.base_price) || 0}</p>
                          <Button type="button" size="sm" className="mt-1 bg-[#0A2647] hover:bg-emerald-600 h-8" onClick={() => onSelect?.(item.service_key)}>
                            Choose
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
