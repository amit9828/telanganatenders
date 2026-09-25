'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Check, Loader2, Phone } from 'lucide-react';

const PAYG_FEATURES = ['Base Tender Perks', 'Reverse Auction Strategy', 'Tech Evaluation & Doc Help', 'Tracking up to Bid Won', 'Legal Support'];
const UNLIMITED_FEATURES = ['Unlimited Bids', 'Unlimited Service Catalogs (Free)', 'Unlimited Product Catalogs (Free)', 'Unlimited Tech Evaluations (Free)', 'Unlimited Lead Search & Participation', 'Legal Support', 'MSME Samadhan', 'JV Structuring & Payment Tracking'];
const TRACK_FEATURES = ['CRAC follow-up and generation', 'GeM invoice generation', 'Timeline-based payment tracking'];
const TRACK_OPTIONS = [
  { key: 'track_1m', label: '1 Month' },
  { key: 'track_3m', label: '3 Months' },
  { key: 'track_6m', label: '6 Months' },
  { key: 'track_12m', label: '12 Months' },
];
const REGISTRATION = [
  { key: 'gem_account', label: 'GeM Account Creation' },
  { key: 'gst_combo', label: 'GST Registration' },
  { key: 'esi_epf_combo', label: 'ESI & EPF (Combo)' },
  { key: 'vendor_assessment', label: 'Vendor Assessment' },
  { key: 'oem_panel_approval', label: 'OEM Panel Approval' },
  { key: 'product_catalogs', label: 'Product Catalog' },
];
const COMPANY_TYPES = ['Private Limited', 'LLP', 'LTP'];
const CERTIFICATIONS = ['FSSAI', 'ISO', 'IEC', 'DSC', 'Trade License', 'NIC', 'Startup India'];
const LEADERS = [
  { name: 'B. Esak', phone: '+91 6304486770' },
  { name: 'M. Laxmi Narasimha', phone: '+91 9100029185' },
];

function rupee(value) {
  const n = Number(value) || 0;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function FeatureList({ items, light = false }) {
  return (
    <ul className={`space-y-2 text-sm ${light ? 'text-slate-100' : 'text-slate-600'}`}>
      {items.map((item) => (
        <li key={item} className="flex gap-2"><Check className={`w-4 h-4 shrink-0 mt-0.5 ${light ? 'text-emerald-300' : 'text-emerald-600'}`} /> {item}</li>
      ))}
    </ul>
  );
}

export default function GrowthPartnerPricing({ onSubscribe }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bids, setBids] = useState(1);
  const [trackKey, setTrackKey] = useState('track_1m');
  const [picked, setPicked] = useState([]);
  const [callOpen, setCallOpen] = useState(false);

  useEffect(() => {
    fetch('/api/pricing-master', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setItems(Array.isArray(data.items) ? data.items : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const priceOf = (key) => Number(items.find((item) => item.service_key === key)?.base_price) || 0;
  const paygUnit = priceOf('custom_bids_10') / 10;
  const paygTotal = Math.round(paygUnit * bids * 100) / 100;
  const trackPrice = priceOf(trackKey);
  const unlimited = priceOf('saas_unlimited');
  const regTotal = useMemo(
    () => picked.reduce((sum, key) => sum + priceOf(key), 0),
    [picked, items],
  );

  const toggle = (key) => setPicked((prev) => (prev.includes(key) ? prev.filter((id) => id !== key) : [...prev, key]));
  const setBidCount = (value) => {
    const next = Math.floor(Number(value));
    setBids(Number.isFinite(next) && next >= 1 ? next : 1);
  };

  return (
    <section className="bg-slate-50 py-16 w-full">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-5xl font-black text-[#0A2647] tracking-tight">Choose Your Growth Partner</h2>
          <p className="mt-3 text-slate-500 text-lg">Select a plan that fits your business needs. Upgrade anytime.</p>
        </div>
        {loading ? <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#0A2647]" /></div> : (
          <>
            <div className="grid lg:grid-cols-3 gap-6 items-stretch">
              <article className="rounded-3xl bg-white border border-slate-200 shadow-xl hover:-translate-y-1 hover:shadow-2xl transition p-6 flex flex-col">
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-600">Core subscription</p>
                <h3 className="text-2xl font-black text-[#0A2647] mt-2">Pay-As-You-Go</h3>
                <p className="text-sm text-slate-500 mt-1">For single or selective bids.</p>
                <p className="text-4xl font-black text-[#0A2647] mt-5">{rupee(paygTotal)}</p>
                <label className="mt-4 text-sm font-semibold text-slate-700" htmlFor="bid-count">Number of bids</label>
                <input id="bid-count" type="number" min="1" value={bids} onChange={(e) => setBidCount(e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 text-lg font-bold text-[#0A2647]" />
                <div className="mt-5 flex-1"><FeatureList items={PAYG_FEATURES} /></div>
                <Button className="mt-6 bg-[#0A2647] hover:bg-emerald-600 h-11" onClick={() => onSubscribe?.({ planId: 'custom_bids_10', bidCount: bids })}>Subscribe</Button>
              </article>

              <article className="rounded-3xl bg-[#0A2647] text-white shadow-2xl hover:-translate-y-1 transition p-6 flex flex-col ring-4 ring-emerald-400 relative">
                <span className="absolute -top-3 left-6 bg-emerald-500 text-[#0A2647] text-xs font-black px-3 py-1 rounded-full">RECOMMENDED</span>
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Core subscription</p>
                <h3 className="text-2xl font-black mt-2">Unlimited Monthly</h3>
                <p className="text-sm text-slate-300 mt-1">Full-service bidding for active businesses.</p>
                <p className="text-4xl font-black mt-5">{rupee(unlimited)}</p>
                <div className="mt-5 flex-1"><FeatureList items={UNLIMITED_FEATURES} light /></div>
                <Button className="mt-6 bg-emerald-500 hover:bg-emerald-400 text-[#0A2647] font-black h-11" onClick={() => onSubscribe?.({ planId: 'saas_unlimited' })}>Subscribe</Button>
              </article>

              <article className="rounded-3xl bg-white border border-slate-200 shadow-xl hover:-translate-y-1 hover:shadow-2xl transition p-6 flex flex-col">
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-600">Core subscription</p>
                <h3 className="text-2xl font-black text-[#0A2647] mt-2">Payment Tracking</h3>
                <p className="text-sm text-slate-500 mt-1">We take the responsibility to credit payments to your accounts.</p>
                <p className="text-4xl font-black text-[#0A2647] mt-5">{rupee(trackPrice)}</p>
                <label className="mt-4 text-sm font-semibold text-slate-700">Duration</label>
                <select value={trackKey} onChange={(e) => setTrackKey(e.target.value)} className="mt-2 h-10 rounded-lg border border-slate-200 px-3 text-sm">
                  {TRACK_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
                <div className="mt-5 flex-1"><FeatureList items={TRACK_FEATURES} /></div>
                <Button className="mt-6 bg-[#0A2647] hover:bg-emerald-600 h-11" onClick={() => onSubscribe?.({ planId: trackKey })}>Subscribe</Button>
              </article>
            </div>

            <div className="mt-14 rounded-3xl bg-white border border-slate-200 shadow-xl p-8">
              <h3 className="text-2xl font-black text-[#0A2647]">Registration & Setup Services</h3>
              <p className="text-slate-500 mt-2">Start your business journey with our seamless registration services.</p>
              <div className="grid sm:grid-cols-2 gap-3 mt-6">
                {REGISTRATION.map((row) => (
                  <label key={row.key} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-[#0A2647]">
                      <input type="checkbox" checked={picked.includes(row.key)} onChange={() => toggle(row.key)} className="accent-emerald-600" />
                      {row.label}
                    </span>
                    <span className="text-sm font-black text-emerald-700">{rupee(priceOf(row.key))}</span>
                  </label>
                ))}
              </div>
              <p className="mt-4 text-sm font-semibold text-emerald-700">Select any of the above services and get Udyam Registration FREE!</p>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-lg font-black text-[#0A2647]">Total {rupee(regTotal)}</p>
                <Button className="bg-[#0A2647] hover:bg-emerald-600" disabled={!picked.length} onClick={() => onSubscribe?.({ planId: picked[0], planIds: picked })}>Proceed to Checkout</Button>
              </div>
            </div>

            <div className="mt-8 grid lg:grid-cols-2 gap-6">
              <div className="rounded-3xl bg-white border border-slate-200 shadow-xl p-8">
                <h3 className="text-2xl font-black text-[#0A2647]">Third-Party & Compliance</h3>
                <p className="text-slate-500 mt-2 text-sm">Prices are assigned by our management team for your requirement.</p>
                <p className="mt-5 text-xs font-bold uppercase tracking-widest text-emerald-600">Company registrations</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {COMPANY_TYPES.map((item) => <span key={item} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-[#0A2647]">{item}</span>)}
                </div>
                <p className="mt-5 text-xs font-bold uppercase tracking-widest text-emerald-600">Certifications</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {CERTIFICATIONS.map((item) => <span key={item} className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">{item}</span>)}
                </div>
              </div>
              <div className="rounded-3xl bg-white border border-slate-200 shadow-xl p-8">
                <h3 className="text-2xl font-black text-[#0A2647]">Our Core Services</h3>
                <div className="mt-5 space-y-3">
                  <div className="rounded-2xl border border-slate-200 px-4 py-3 font-semibold text-[#0A2647]">GeM Support</div>
                  <button type="button" onClick={() => setCallOpen(true)} className="w-full text-left rounded-2xl border border-slate-200 px-4 py-3 font-semibold text-[#0A2647] hover:border-emerald-500">Technical Support</button>
                  <div className="rounded-2xl border border-slate-200 px-4 py-3 font-semibold text-[#0A2647]">Account Unblocking</div>
                </div>
                <Button className="mt-6 bg-[#0A2647] hover:bg-emerald-600" onClick={() => setCallOpen(true)}>Request a Call</Button>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog open={callOpen} onOpenChange={setCallOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#0A2647]">Talk to leadership</DialogTitle>
            <DialogDescription>For custom requirements, directly contact our Leadership team:</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {LEADERS.map((person) => (
              <a key={person.phone} href={`tel:${person.phone.replace(/\s/g, '')}`} className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 hover:border-emerald-500">
                <span className="font-bold text-[#0A2647]">{person.name}</span>
                <span className="flex items-center gap-2 font-black text-emerald-700"><Phone className="w-4 h-4" /> {person.phone}</span>
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
