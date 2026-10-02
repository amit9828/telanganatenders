'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { PRICING_DEFAULTS, paygBase } from '@/lib/billing-schema';

function subscribeIntent(base, extra) {
  return { ...extra, previewBase: Math.round((Number(base) || 0) * 100) / 100 };
}

export const PAYG_FEATURES = ['Base Tender Perks', 'Reverse Auction Strategy', 'Tech Evaluation & Doc Help', 'Tracking up to Bid Won', 'Legal Support'];
export const UNLIMITED_FEATURES = ['Unlimited Bids', 'Unlimited Service Catalogs (Free)', 'Unlimited Product Catalogs (Free)', 'Unlimited Tech Evaluations (Free)', 'Unlimited Lead Search & Participation', 'Legal Support', 'MSME Samadhan', 'JV Structuring & Payment Tracking'];
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
  { key: 'esi_epf_combo', label: 'ESI & EPF' },
  { key: 'vendor_assessment', label: 'Vendor Assessment' },
  { key: 'oem_panel_approval', label: 'OEM Panel Approval' },
  { key: 'product_catalogs', label: 'Product Catalog' },
];
const THIRD_PARTY = [
  { key: 'inc_llp', label: 'Company Incorporation (LLP)' },
  { key: 'inc_pvt', label: 'Company Incorporation (Private Limited)' },
  { key: 'inc_ltd', label: 'Company Incorporation (LTD)' },
  { key: 'labor_license', label: 'Labor License' },
  { key: 'shop_establishment', label: 'Shop Establishment Registration' },
  { key: 'fssai', label: 'FSSAI' },
  { key: 'iso_certificate', label: 'ISO Certificate' },
  { key: 'iec', label: 'IEC' },
  { key: 'dsc', label: 'DSC' },
  { key: 'trade_license', label: 'Trade License' },
  { key: 'startup_india', label: 'Startup India (DPIIT Recognition)' },
];
const CORE_SERVICES = [
  { key: 'gem_support', label: 'GeM Support' },
  { key: 'technical_clarifications', label: 'Clarification on Technical Disqualify' },
  { key: 'account_recovery', label: 'Unblocking of GeM accounts' },
];
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
        <li key={item} className="flex gap-2">
          <Check className={`w-4 h-4 shrink-0 mt-0.5 ${light ? 'text-emerald-300' : 'text-emerald-600'}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const INITIAL_ITEMS = PRICING_DEFAULTS.map(({ service_key, name, base_price }) => ({ service_key, name, base_price }));

function PriceChecks({ rows, picked, onToggle, priceOf, dense = false, showPrice = true }) {
  return (
    <div className={dense ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3' : 'grid grid-cols-1 gap-3'}>
      {rows.map((row) => (
        <label key={row.key} className="flex w-full items-start gap-4 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span className="flex flex-1 items-start gap-2 min-w-0 text-sm font-semibold text-[#0A2647]">
            <input type="checkbox" checked={picked.includes(row.key)} onChange={() => onToggle(row.key)} className="accent-emerald-600 shrink-0 mt-0.5" />
            <span className="flex-1 min-w-0 break-words leading-snug">{row.label}</span>
          </span>
          {showPrice ? <span className="shrink-0 whitespace-nowrap text-right min-w-[4.5rem] text-sm font-black text-emerald-700">{rupee(priceOf(row.key))}</span> : null}
        </label>
      ))}
    </div>
  );
}

export default function GrowthPartnerPricing({ onSubscribe, access, cardsOnly = false, initialItems }) {
  const seeded = Array.isArray(initialItems) && initialItems.length ? initialItems : null;
  const [items, setItems] = useState(seeded || INITIAL_ITEMS);
  const [bids, setBids] = useState('1');
  const [trackKey, setTrackKey] = useState('track_1m');
  const [registration, setRegistration] = useState([]);
  const [thirdParty, setThirdParty] = useState([]);
  const [core, setCore] = useState([]);
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadGroup, setLeadGroup] = useState('third');
  const [lead, setLead] = useState({ enterprise_name: '', name: '', phone: '', area: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (seeded) return undefined;
    let cancelled = false;
    fetch('/api/pricing-master', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.items) && data.items.length) setItems(data.items);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [seeded]);

  const priceOf = (key) => Number(items.find((item) => item.service_key === key)?.base_price) || 0;
  const sumKeys = (keys) => keys.reduce((sum, key) => sum + priceOf(key), 0);
  const paygItem = items.find((item) => item.service_key === 'custom_bids_10');
  const bidCount = Math.floor(Number(bids));
  const bidCountValid = Number.isFinite(bidCount) && bidCount >= 1;
  const paygTotal = bidCountValid ? paygBase(paygItem, bidCount) : 0;
  const regTotal = useMemo(() => sumKeys(registration), [registration, items]);
  const coreTotal = useMemo(() => sumKeys(core), [core, items]);

  const toggle = (setter) => (key) => setter((prev) => (prev.includes(key) ? prev.filter((id) => id !== key) : [...prev, key]));
  const labelsFor = (rows, keys) => rows.filter((row) => keys.includes(row.key)).map((row) => row.label);

  const openLead = (group) => {
    setLeadGroup(group);
    setSent(false);
    setLeadOpen(true);
  };

  const submitLead = async (e) => {
    e.preventDefault();
    const selected = leadGroup === 'core' ? labelsFor(CORE_SERVICES, core) : labelsFor(THIRD_PARTY, thirdParty);
    setSending(true);
    try {
      const res = await fetch('/api/guest-queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...lead,
          query: selected.join(', '),
          services: selected,
          source: leadGroup === 'core' ? 'core_services' : 'third_party',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send your request.');
      setSent(true);
      toast.success('Request Submitted. We will directly call you.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const planCards = (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 items-stretch">
              {!access?.unlimitedActive && (
              <article className="w-full max-w-full rounded-3xl bg-white border border-slate-200 shadow-xl hover:-translate-y-1 hover:shadow-2xl transition p-5 sm:p-6 flex flex-col min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-600">Core subscription</p>
                <h3 className="text-2xl font-black text-[#0A2647] mt-2">Pay-As-You-Go</h3>
                <p className="text-sm text-slate-500 mt-1">For single or selective bids.</p>
                <p className="mt-2 text-sm font-bold text-emerald-700">Valid for 3 months</p>
                <p className="text-4xl font-black text-[#0A2647] mt-5">{rupee(paygTotal)}</p>
                <label className="mt-4 text-sm font-semibold text-slate-700" htmlFor={cardsOnly ? 'promo-bid-count' : 'bid-count'}>Number of bids</label>
                <input id={cardsOnly ? 'promo-bid-count' : 'bid-count'} type="number" min="1" inputMode="numeric" value={bids} onChange={(e) => setBids(e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 text-lg font-bold text-[#0A2647]" />
                <div className="mt-5 flex-1"><FeatureList items={PAYG_FEATURES} /></div>
                <Button className="mt-6 w-full bg-[#0A2647] hover:bg-emerald-600 h-11" disabled={!bidCountValid} onClick={() => { if (bidCountValid) onSubscribe?.(subscribeIntent(paygTotal, { planId: 'custom_bids_10', bidCount })); }}>Subscribe</Button>
              </article>
              )}

              <article className="w-full max-w-full rounded-3xl bg-[#0A2647] text-white shadow-2xl hover:-translate-y-1 transition p-5 sm:p-6 flex flex-col border-4 border-emerald-400 relative min-w-0">
                <span className="absolute -top-3 left-6 bg-emerald-500 text-[#0A2647] text-xs font-black px-3 py-1 rounded-full">RECOMMENDED</span>
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Core subscription</p>
                <h3 className="text-2xl font-black mt-2">Unlimited Monthly</h3>
                <p className="text-sm text-slate-300 mt-1">Full-service bidding for active businesses.</p>
                <p className="text-4xl font-black mt-5">{rupee(priceOf('saas_unlimited'))}</p>
                <div className="mt-5 flex-1"><FeatureList items={UNLIMITED_FEATURES} light /></div>
                <Button className="mt-6 w-full bg-emerald-500 hover:bg-emerald-400 text-[#0A2647] font-black h-11" onClick={() => onSubscribe?.(subscribeIntent(priceOf('saas_unlimited'), { planId: 'saas_unlimited' }))}>{access?.paygActive ? 'Upgrade to Unlimited' : 'Subscribe'}</Button>
              </article>

              <article className="w-full max-w-full rounded-3xl bg-white border border-slate-200 shadow-xl hover:-translate-y-1 hover:shadow-2xl transition p-5 sm:p-6 flex flex-col min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-600">Core subscription</p>
                <h3 className="text-2xl font-black text-[#0A2647] mt-2">Payment Tracking</h3>
                <p className="text-sm text-slate-500 mt-1">We take the responsibility to credit payments to your accounts.</p>
                <p className="text-4xl font-black text-[#0A2647] mt-5">{rupee(priceOf(trackKey))}</p>
                <label className="mt-4 text-sm font-semibold text-slate-700" htmlFor={cardsOnly ? 'promo-track-duration' : 'track-duration'}>Duration</label>
                <select id={cardsOnly ? 'promo-track-duration' : 'track-duration'} value={trackKey} onChange={(e) => setTrackKey(e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm">
                  {TRACK_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
                <div className="mt-5 flex-1"><FeatureList items={TRACK_FEATURES} /></div>
                <Button className="mt-6 w-full bg-[#0A2647] hover:bg-emerald-600 h-11" onClick={() => onSubscribe?.(subscribeIntent(priceOf(trackKey), { planId: trackKey }))}>Subscribe</Button>
              </article>
            </div>
  );

  if (cardsOnly) return planCards;

  return (
    <section className="bg-slate-50 py-12 sm:py-16 w-full">
      <div className="w-full max-w-[95%] lg:max-w-[1400px] mx-auto px-2 sm:px-4">
        <div className="text-center mb-10">
          <h2 className="text-3xl md:text-5xl font-black text-[#0A2647] tracking-tight">Choose Your Growth Partner</h2>
          <p className="mt-3 text-slate-500 text-base sm:text-lg">Select a plan that fits your business needs. Upgrade anytime.</p>
        </div>

        {planCards}

            <div className="mt-10 rounded-3xl bg-white border border-slate-200 shadow-xl p-5 sm:p-8">
              <h3 className="text-2xl font-black text-[#0A2647]">Registration & Setup Services</h3>
              <p className="text-slate-500 mt-2">Start your business journey with our seamless registration services.</p>
              <div className="mt-6"><PriceChecks dense rows={REGISTRATION} picked={registration} onToggle={toggle(setRegistration)} priceOf={priceOf} /></div>
              <p className="mt-4 text-sm font-semibold text-emerald-700">Select any of the above services and get Udyam Registration FREE!</p>
              <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="text-lg font-black text-[#0A2647]">Total {rupee(regTotal)}</p>
                <Button className="w-full sm:w-auto bg-[#0A2647] hover:bg-emerald-600" disabled={!registration.length} onClick={() => onSubscribe?.(subscribeIntent(regTotal, { planId: registration[0], planIds: registration }))}>Proceed to Checkout</Button>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="rounded-3xl bg-white border border-slate-200 shadow-xl p-5 sm:p-8 min-w-0">
                <h3 className="text-2xl font-black text-[#0A2647]">Third-Party & Compliance</h3>
                <p className="text-slate-500 mt-2 text-sm">Costs vary by the licence. Our team will call you to confirm the work.</p>
                <div className="mt-6"><PriceChecks rows={THIRD_PARTY} picked={thirdParty} onToggle={toggle(setThirdParty)} priceOf={priceOf} showPrice={false} /></div>
                <div className="mt-5 flex justify-end">
                  <Button className="w-full sm:w-auto bg-[#0A2647] hover:bg-emerald-600" disabled={!thirdParty.length} onClick={() => openLead('third')}>Request Service</Button>
                </div>
              </div>
              <div className="rounded-3xl bg-white border border-slate-200 shadow-xl p-5 sm:p-8 min-w-0">
                <h3 className="text-2xl font-black text-[#0A2647]">Our Core Services</h3>
                <div className="mt-6"><PriceChecks rows={CORE_SERVICES} picked={core} onToggle={toggle(setCore)} priceOf={priceOf} /></div>
                <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <p className="text-lg font-black text-[#0A2647]">Total {rupee(coreTotal)}</p>
                  <Button className="w-full sm:w-auto bg-[#0A2647] hover:bg-emerald-600" disabled={!core.length} onClick={() => openLead('core')}>Request Service</Button>
                </div>
              </div>
            </div>

            <div className="mt-8 rounded-3xl bg-[#0A2647] text-white shadow-xl p-5 sm:p-8">
              <p className="text-lg font-bold">For custom requirements or direct support, call our Leadership:</p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {LEADERS.map((person) => (
                  <a key={person.phone} href={`tel:${person.phone.replace(/\s/g, '')}`} className="flex items-center justify-between gap-3 rounded-2xl bg-white/10 px-4 py-3 hover:bg-white/15">
                    <span className="font-bold">{person.name}</span>
                    <span className="flex items-center gap-2 font-black text-emerald-300"><Phone className="w-4 h-4" /> {person.phone}</span>
                  </a>
                ))}
              </div>
            </div>
      </div>

      <Dialog open={leadOpen} onOpenChange={setLeadOpen}>
        <DialogContent className="max-w-md w-[calc(100%-1.5rem)]">
          <DialogHeader>
            <DialogTitle className="text-[#0A2647]">Request Service</DialogTitle>
            <DialogDescription>
              {sent ? 'Request Submitted. We will directly call you.' : 'Tell us how to reach you. This goes to the MD lead queue.'}
            </DialogDescription>
          </DialogHeader>
          {sent ? (
            <p className="text-emerald-700 font-bold">Request Submitted. We will directly call you.</p>
          ) : (
            <form onSubmit={submitLead} className="space-y-3">
              <div><Label>Enterprise Name</Label><Input required value={lead.enterprise_name} onChange={(e) => setLead({ ...lead, enterprise_name: e.target.value })} /></div>
              <div><Label>Name</Label><Input required value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} /></div>
              <div><Label>Phone Number</Label><Input required value={lead.phone} onChange={(e) => setLead({ ...lead, phone: e.target.value })} /></div>
              <div><Label>Area</Label><Input required value={lead.area} onChange={(e) => setLead({ ...lead, area: e.target.value })} /></div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setLeadOpen(false)}>Go Back</Button>
                <Button type="submit" className="flex-1 bg-emerald-600" disabled={sending}>{sending ? 'Sending…' : 'Submit'}</Button>
              </div>
            </form>
          )}
          {sent && (
            <Button type="button" variant="outline" onClick={() => setLeadOpen(false)}>Go Back</Button>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
