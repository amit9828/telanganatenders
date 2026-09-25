'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

/** Only same-site absolute paths may be used as a redirect target. */
function safePath(value) {
  const path = String(value || '').trim();
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  return path;
}

function PaymentStatusContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const order_id = searchParams.get('order_id');
  // A client who paid an invoice from their dashboard must return to that dashboard.
  // The order carries where it started; ?next= is the fallback for links built by hand.
  const fallbackNext = safePath(searchParams.get('next'));
  const [status, setStatus] = useState('verifying');
  const [destination, setDestination] = useState(fallbackNext || '/');

  useEffect(() => {
    if (!order_id) {
      router.push('/');
      return;
    }

    fetch('/api/payment/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id })
    })
    .then(res => res.json())
    .then(data => {
      const returnTo = safePath(data.return_to) || fallbackNext;
      // Auto-open magic link: send the tender ID back to whichever page opened checkout.
      const target = returnTo
        ? (data.tenderId ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}open_tender=${data.tenderId}` : returnTo)
        : (data.tenderId ? `/?open_tender=${data.tenderId}` : '/');

      setDestination(target);
      if (data.success) {
        sessionStorage.removeItem('tt_pending_plan');
        sessionStorage.removeItem('tt_pending_bid_count');
        sessionStorage.removeItem('tt_pending_plans');
        sessionStorage.removeItem('tt_pending_tender');
        setStatus('success');
        setTimeout(() => router.push(target), 3000);
      } else {
        setStatus('failed');
        setTimeout(() => router.push(target), 4000);
      }
    })
    .catch(() => {
      setStatus('failed');
      setTimeout(() => router.push(fallbackNext || '/'), 4000);
    });

  }, [order_id, router, fallbackNext]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        {status === 'verifying' && (
          <div className="flex flex-col items-center">
            <Loader2 className="w-16 h-16 text-[#0A2647] animate-spin mb-4" />
            <h2 className="text-2xl font-bold text-[#0A2647]">Verifying Payment...</h2>
            <p className="text-muted-foreground mt-2">Please wait, do not close this window.</p>
          </div>
        )}
        
        {status === 'success' && (
          <div className="flex flex-col items-center">
            <CheckCircle2 className="w-20 h-20 text-[#16a34a] mb-4" />
            <h2 className="text-3xl font-bold text-[#16a34a]">Payment Successful!</h2>
            <p className="text-slate-600 mt-3">Access granted. Taking you back to where you were...</p>
            <button
              type="button"
              onClick={() => router.push(destination)}
              className="mt-5 text-sm font-semibold text-[#0A2647] underline underline-offset-4"
            >
              Continue now
            </button>
          </div>
        )}

        {status === 'failed' && (
          <div className="flex flex-col items-center">
            <XCircle className="w-20 h-20 text-red-500 mb-4" />
            <h2 className="text-3xl font-bold text-red-500">Payment Failed</h2>
            <p className="text-slate-600 mt-3">We could not verify your payment. Taking you back...</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PaymentStatus() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <PaymentStatusContent />
    </Suspense>
  );
}
