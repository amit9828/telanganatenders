'use client';

import { useEffect, useRef, useState } from 'react';
import { load } from '@cashfreepayments/cashfree-js';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import GrowthPartnerPricing from '@/components/GrowthPartnerPricing';
import { paygActive, unlimitedActive } from '@/lib/billing-access';

function readIntent() {
  if (typeof window === 'undefined') return null;
  const planId = sessionStorage.getItem('tt_pending_plan');
  if (!planId) return null;
  let planIds = null;
  try { planIds = JSON.parse(sessionStorage.getItem('tt_pending_plans') || 'null'); } catch { planIds = null; }
  return {
    planId,
    planIds: Array.isArray(planIds) ? planIds : undefined,
    bidCount: Number(sessionStorage.getItem('tt_pending_bid_count')) || undefined,
    tenderId: sessionStorage.getItem('tt_pending_tender') || undefined,
  };
}

function rupee(value) {
  return `₹${(Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export async function createBillingCheckout(intent) {
  const res = await fetch('/api/billing/checkout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan_id: intent.planId,
      plan_ids: intent.planIds,
      bid_count: intent.bidCount,
      tender_id: intent.tenderId,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Checkout failed.');
  return data;
}

export async function openCashfreeSession(data) {
  const cashfree = await load({ mode: 'production' });
  await cashfree.checkout({
    paymentSessionId: data.payment_session_id,
    returnUrl: `${window.location.origin}/payment-status?order_id=${data.order_id}`,
  });
}

export async function startCashfreeCheckout(intent) {
  const data = await createBillingCheckout(intent);
  await openCashfreeSession(data);
  return data;
}

export default function BillingGate({ user }) {
  const [resume] = useState(readIntent);
  const [summary, setSummary] = useState(null);
  const [paying, setPaying] = useState(false);
  const started = useRef(false);
  const access = {
    unlimitedActive: unlimitedActive(user),
    paygActive: paygActive(user),
  };

  const quoteCheckout = async (intent) => {
    const data = await createBillingCheckout(intent);
    setSummary(data);
  };

  useEffect(() => {
    if (started.current || !resume?.planId) return;
    if (new URLSearchParams(window.location.search).get('step') !== 'billing') return;
    started.current = true;
    quoteCheckout(resume).catch((err) => toast.error(err.message));
  }, [resume]);

  return (
    <>
      <GrowthPartnerPricing
        access={access}
        onSubscribe={(intent) => {
          quoteCheckout(intent).catch((err) => toast.error(err.message));
        }}
      />
      <Dialog open={Boolean(summary)} onOpenChange={(open) => { if (!open) setSummary(null); }}>
        <DialogContent className="max-w-md w-[calc(100%-1.5rem)]">
          <DialogHeader>
            <DialogTitle className="text-[#0A2647]">Checkout summary</DialogTitle>
            <DialogDescription>Review the total before the payment page opens.</DialogDescription>
          </DialogHeader>
          {summary && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><span>Actual base price</span><span className="font-bold">{rupee(summary.subtotal)}</span></div>
              <div className="flex justify-between gap-3"><span>18% GST</span><span className="font-bold">{rupee(summary.gst_amount)}</span></div>
              <div className="flex justify-between gap-3 border-t pt-2 text-base"><span className="font-black text-[#0A2647]">Final total</span><span className="font-black text-[#0A2647]">{rupee(summary.total_amount)}</span></div>
              <Button className="w-full bg-emerald-600 mt-3" disabled={paying} onClick={() => {
                setPaying(true);
                openCashfreeSession(summary).catch((err) => {
                  toast.error(err.message);
                  setPaying(false);
                });
              }}>{paying ? 'Opening payment…' : 'Pay'}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
