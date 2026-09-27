'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import GrowthPartnerPricing from '@/components/GrowthPartnerPricing';
import { startCashfreeCheckout } from '@/components/BillingGate';
import { paygActive, trackingActive, unlimitedActive } from '@/lib/billing-access';

const DISMISS_KEY = 'tt_pricing_promo_dismissed';

export default function PricingPromoModal({ user }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (typeof window !== 'undefined' && sessionStorage.getItem(DISMISS_KEY) === '1') return;
    const free = !unlimitedActive(user) && !paygActive(user) && !trackingActive(user);
    if (free) setOpen(true);
  }, [user]);

  const dismiss = () => {
    if (typeof window !== 'undefined') sessionStorage.setItem(DISMISS_KEY, '1');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent className="max-w-6xl w-[calc(100%-1rem)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#0A2647]">Choose a plan</DialogTitle>
          <DialogDescription>Pay-As-You-Go, Unlimited Monthly, and Payment Tracking. Close this if you want to look around first.</DialogDescription>
        </DialogHeader>
        <GrowthPartnerPricing
          cardsOnly
          access={{ unlimitedActive: unlimitedActive(user), paygActive: paygActive(user) }}
          onSubscribe={(intent) => {
            startCashfreeCheckout(intent).catch((err) => toast.error(err.message));
          }}
        />
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={dismiss}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
