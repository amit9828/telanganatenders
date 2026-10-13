'use client';
import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';

const POLL_INTERVAL_MS = 2000;
const POLL_WINDOW_MS = 90 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const SLOW_NOTICE_MS = 10000;
const SUCCESS_REDIRECT_MS = 1200;

/** Only same-site absolute paths may be used as a redirect target. */
function safePath(value) {
  const path = String(value || '').trim();
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  return path;
}

function clearPendingCheckout() {
  ['tt_pending_plan', 'tt_pending_bid_count', 'tt_pending_plans', 'tt_pending_tender', 'tt_pending_months']
    .forEach((key) => sessionStorage.removeItem(key));
}

function PaymentStatusContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const order_id = searchParams.get('order_id');
  // A client who paid an invoice from their dashboard must return to that dashboard.
  // The order carries where it started; ?next= is the fallback for links built by hand.
  const fallbackNext = safePath(searchParams.get('next'));
  const [status, setStatus] = useState('verifying');
  const billingReturn = '/client?step=billing';
  const [destination, setDestination] = useState(fallbackNext || billingReturn);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const timers = useRef([]);

  const later = useCallback((fn, ms) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    if (!order_id) {
      router.push(billingReturn);
      return undefined;
    }

    let cancelled = false;
    let inflight = null;
    const deadline = Date.now() + POLL_WINDOW_MS;
    setStatus('verifying');
    setSlow(false);
    later(() => setSlow(true), SLOW_NOTICE_MS);

    const succeed = (data) => {
      const returnTo = safePath(data.return_to) || fallbackNext;
      const target = returnTo
        ? (data.tenderId ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}open_tender=${data.tenderId}` : returnTo)
        : (data.tenderId ? `/?open_tender=${data.tenderId}` : '/');
      setDestination(target);
      clearPendingCheckout();
      setStatus('success');
      later(() => router.push(target), SUCCESS_REDIRECT_MS);
    };

    const poll = async () => {
      if (cancelled) return;
      let res = null;
      let data = {};
      inflight = new AbortController();
      const abortTimer = setTimeout(() => inflight?.abort(), REQUEST_TIMEOUT_MS);
      try {
        res = await fetch('/api/payment/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ order_id }),
          signal: inflight.signal,
        });
        data = await res.json().catch(() => ({}));
      } catch {
        res = null;
      } finally {
        clearTimeout(abortTimer);
        inflight = null;
      }
      if (cancelled) return;

      if (res?.ok && data.success) {
        succeed(data);
        return;
      }
      // Only an explicit verdict from Cashfree ends in "failed". 202, 404, 5xx and
      // network errors mean "not confirmed yet" and keep polling.
      if (res?.status === 400 && data.status === 'FAILED') {
        setDestination(billingReturn);
        setStatus('failed');
        return;
      }
      if (Date.now() >= deadline) {
        setStatus('pending');
        return;
      }
      later(poll, POLL_INTERVAL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      inflight?.abort();
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [order_id, router, fallbackNext, attempt, later]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        {status === 'verifying' && (
          <div className="flex flex-col items-center">
            <Loader2 className="w-16 h-16 text-[#0A2647] animate-spin mb-4" />
            <h2 className="text-2xl font-bold text-[#0A2647]">Verifying Payment...</h2>
            <p className="text-muted-foreground mt-2">Please wait, do not close this window.</p>
            {slow && (
              <p className="text-slate-600 mt-3 text-sm">
                Your bank is taking a little longer to confirm. Your money is safe, and do not pay
                again. Access unlocks the moment the bank confirms.
              </p>
            )}
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

        {status === 'pending' && (
          <div className="flex flex-col items-center">
            <Clock className="w-20 h-20 text-amber-500 mb-4" />
            <h2 className="text-2xl font-bold text-[#0A2647]">Payment Still Confirming</h2>
            <p className="text-slate-600 mt-3">
              If money left your account, do not pay again. Your access unlocks automatically
              as soon as Cashfree confirms the payment.
            </p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-5 rounded-lg bg-[#0A2647] px-5 py-2 text-sm font-semibold text-white"
            >
              Check again
            </button>
            <button
              type="button"
              onClick={() => router.push('/client')}
              className="mt-3 text-sm font-semibold text-[#0A2647] underline underline-offset-4"
            >
              Go to dashboard
            </button>
          </div>
        )}

        {status === 'failed' && (
          <div className="flex flex-col items-center">
            <XCircle className="w-20 h-20 text-red-500 mb-4" />
            <h2 className="text-3xl font-bold text-red-500">Payment Failed</h2>
            <p className="text-slate-600 mt-3">Cashfree reported this order as not paid. No access was granted.</p>
            <button
              type="button"
              onClick={() => router.push(billingReturn)}
              className="mt-5 text-sm font-semibold text-[#0A2647] underline underline-offset-4"
            >
              Go back to checkout
            </button>
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
