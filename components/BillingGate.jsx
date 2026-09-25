'use client';

import { useEffect, useRef, useState } from 'react';
import { load } from '@cashfreepayments/cashfree-js';
import { toast } from 'sonner';
import GrowthPartnerPricing from '@/components/GrowthPartnerPricing';

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

export async function startCashfreeCheckout(intent) {
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
  const cashfree = await load({ mode: 'production' });
  await cashfree.checkout({
    paymentSessionId: data.payment_session_id,
    returnUrl: `${window.location.origin}/payment-status?order_id=${data.order_id}`,
  });
}

export default function BillingGate() {
  const [resume] = useState(readIntent);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !resume?.planId) return;
    if (new URLSearchParams(window.location.search).get('step') !== 'billing') return;
    started.current = true;
    startCashfreeCheckout(resume).catch((err) => toast.error(err.message));
  }, [resume]);

  return (
    <GrowthPartnerPricing
      onSubscribe={(intent) => {
        startCashfreeCheckout(intent).catch((err) => toast.error(err.message));
      }}
    />
  );
}
