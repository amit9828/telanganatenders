'use client';

import { Button } from '@/components/ui/button';
import { PAYG_FEATURES, UNLIMITED_FEATURES } from '@/components/GrowthPartnerPricing';
import { paygActive, unlimitedActive } from '@/lib/billing-access';

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function future(value) {
  const date = value ? new Date(value) : null;
  return Boolean(date && !Number.isNaN(date.getTime()) && date > new Date());
}

export default function ClientBillingPanel({ user, onUpgrade }) {
  const unlimited = unlimitedActive(user);
  const payg = paygActive(user);
  const planName = unlimited ? 'Unlimited' : payg ? 'Pay-As-You-Go' : 'No active plan';
  const features = unlimited ? UNLIMITED_FEATURES : payg ? PAYG_FEATURES : [];
  const services = Array.isArray(user?.purchased_services) ? user.purchased_services : [];
  const trackingUntil = user?.subscription?.tracking_until;
  const viewUntil = user?.subscription?.view_until;

  return (
    <section className="rounded-3xl bg-white border border-slate-200 shadow-xl p-5 sm:p-8">
      <h2 className="text-2xl font-black text-[#0A2647]">Billing & Payments</h2>
      <p className="mt-1 text-sm text-slate-500">Your active plan, bid balance, and unlocked services.</p>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Current plan</p>
          <p className="mt-2 text-xl font-black text-[#0A2647]">{planName}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Bid balance</p>
          <p className="mt-2 text-xl font-black text-[#0A2647]">{Number(user?.bid_balance) || 0}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Bid validity</p>
          <p className="mt-2 text-xl font-black text-[#0A2647]">{payg || user?.bid_expiry ? when(user?.bid_expiry) : '—'}</p>
          {(payg || user?.bid_expiry) && <p className="text-xs text-emerald-700 font-semibold mt-1">Valid for 3 months</p>}
        </div>
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Unlimited expiry</p>
          <p className="mt-2 text-xl font-black text-[#0A2647]">{unlimited ? when(user?.subscription?.expires_at) : '—'}</p>
        </div>
      </div>

      {payg && (
        <Button className="mt-6 bg-emerald-600 hover:bg-emerald-500 font-black" onClick={onUpgrade}>Upgrade to Unlimited</Button>
      )}

      <h3 className="mt-8 text-lg font-black text-[#0A2647]">Unlocked features</h3>
      {features.length ? (
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-slate-700">
          {features.map((item) => <li key={item} className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">{item}</li>)}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No core plan is active.</p>
      )}

      {(services.length > 0 || future(trackingUntil) || future(viewUntil)) && (
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {services.map((row, index) => (
            <li key={`${row.order_id || 'order'}-${row.service_key}-${index}`} className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
              {row.name || row.service_key}{row.included_free ? ' (included free)' : ''} · {when(row.at)}
            </li>
          ))}
          {future(trackingUntil) && <li className="rounded-xl border border-slate-200 px-3 py-2">Payment tracking until {when(trackingUntil)}</li>}
          {future(viewUntil) && <li className="rounded-xl border border-slate-200 px-3 py-2">Tender view access until {when(viewUntil)}</li>}
        </ul>
      )}
    </section>
  );
}
