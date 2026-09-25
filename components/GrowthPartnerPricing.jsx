'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

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
  { key: 'esi_epf_combo', label: 'ESI & EPF Registration (Combo)' },
];
const COMPLIANCE = ['Company Registrations (LLP, Pvt Ltd, LDP)', 'Certifications (FSSAI, ISO, IEC, DSC, Trade License, NIC, Startup India)', 'GeM Support', 'Technical Support'];

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
  const [regOpen, setRegOpen] = useState(false);
  const [picked, setPicked] = useState([]);
  const [leadOpen, setLeadOpen] = useState(false);
  const [lead, setLead] = useState({ enterprise_name: '', name: '', phone: '', area: '', query: '' });
  const [sending, setSending] = useState(false);

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

  const submitLead = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const res = await fetch('/api/guest-queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead),
      });
      if (!res.ok) throw new Error('Could not send your request.');
      toast.success('Request sent. Our MD office will call you.');
      setLead({ enterprise_name: '', name: '', phone: '', area: '', query: '' });
      setLeadOpen(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
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
                <label className="mt-4 text-sm font-semibold text-slate-700">Bids: {bids}</label>
                <input type="range" min="1" max="10" value={bids} onChange={(e) => setBids(Number(e.target.value))} className="mt-2 accent-emerald-600" />
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
              <Button className="mt-6 bg-emerald-600 hover:bg-emerald-500" onClick={() => setRegOpen(true)}>Place Request</Button>
            </div>

            <div className="mt-8 rounded-3xl bg-white border border-slate-200 shadow-xl p-8">
              <h3 className="text-2xl font-black text-[#0A2647]">Compliance & Third-Party Services</h3>
              <p className="text-slate-500 mt-2">Expert support for all your compliance and critical business needs. Prices are dynamically assigned by our management team based on your requirement.</p>
              <div className="grid sm:grid-cols-2 gap-3 mt-6">
                {COMPLIANCE.map((item) => (
                  <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-semibold text-[#0A2647]">{item}</div>
                ))}
              </div>
              <Button className="mt-6 bg-[#0A2647] hover:bg-emerald-600" onClick={() => setLeadOpen(true)}>Request a Call</Button>
            </div>
          </>
        )}
      </div>

      <Dialog open={regOpen} onOpenChange={setRegOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#0A2647]">Registration request</DialogTitle>
            <DialogDescription>Select any of the above services and get Udyam Registration absolutely FREE! (Udyam cannot be requested individually).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {REGISTRATION.map((row) => (
              <label key={row.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-[#0A2647]">
                  <input type="checkbox" checked={picked.includes(row.key)} onChange={() => toggle(row.key)} className="accent-emerald-600" />
                  {row.label}
                </span>
                <span className="text-sm font-black text-emerald-700">{rupee(priceOf(row.key))}</span>
              </label>
            ))}
            <p className="text-sm font-bold text-[#0A2647]">Total {rupee(regTotal)} · Udyam included</p>
            <Button className="w-full bg-[#0A2647]" disabled={!picked.length} onClick={() => { setRegOpen(false); onSubscribe?.({ planId: picked[0], planIds: picked }); }}>Submit Request</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={leadOpen} onOpenChange={setLeadOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#0A2647]">Request a call</DialogTitle>
            <DialogDescription>This goes straight to the MD lead queue.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitLead} className="space-y-3">
            <div><Label>Enterprise Name</Label><Input required value={lead.enterprise_name} onChange={(e) => setLead({ ...lead, enterprise_name: e.target.value })} /></div>
            <div><Label>Name</Label><Input required value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} /></div>
            <div><Label>Phone Number</Label><Input required value={lead.phone} onChange={(e) => setLead({ ...lead, phone: e.target.value })} /></div>
            <div><Label>Area</Label><Input required value={lead.area} onChange={(e) => setLead({ ...lead, area: e.target.value })} /></div>
            <div><Label>Query</Label><Input required value={lead.query} onChange={(e) => setLead({ ...lead, query: e.target.value })} /></div>
            <Button type="submit" className="w-full bg-emerald-600" disabled={sending}>{sending ? 'Sending…' : 'Submit'}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
