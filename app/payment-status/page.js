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
  const billingReturn = '/client?step=billing';
  const [destination, setDestination] = useState(fallbackNext || billingReturn);

  useEffect(() => {
    if (!order_id) {
      router.push(billingReturn);
      return;
    }

    // 🚀 FIX: Cashfree సిగ్నల్ కన్ఫర్మ్ అయ్యేదాకా కనీసం 60 సెకన్ల పాటు (20 retries * 3s) వెయిట్ చేసే సిస్టమ్
    const verifyOrder = async (retries = 20) => {
      try {
        const res = await fetch('/api/payment/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id })
        });
        
        // బ్యాకెండ్ 202 (PROCESSING) అని పంపితే, ఫెయిల్ అనకుండా మళ్ళీ 3 సెకన్లు ఆగి చెక్ చేస్తుంది
        if (res.status === 202 && retries > 0) {
          setTimeout(() => verifyOrder(retries - 1), 3000);
          return;
        }

        const data = await res.json().catch(() => ({}));

        // బ్యాంక్ దగ్గర ప్రాసెసింగ్ లో ఉన్నా లేదా పెండింగ్ లో ఉన్నా, ఆగి మళ్ళీ చెక్ చేయాలి
        if ((data.status === 'ACTIVE' || data.status === 'PENDING') && retries > 0) {
          setTimeout(() => verifyOrder(retries - 1), 3000); 
          return;
        }

        // నెట్‌వర్క్ ఎర్రర్ లాంటివి వస్తే వెంటనే ఫెయిల్ అనకుండా మళ్ళీ ట్రై చేస్తుంది
        if (!res.ok && retries > 0) {
          setTimeout(() => verifyOrder(retries - 1), 3000);
          return;
        }

        // పక్కాగా సక్సెస్ అని సిగ్నల్ వస్తే అప్పుడు మాత్రమే అన్‌లాక్ చేయాలి
        if (data.success && (data.status === 'PAID' || !data.status)) {
          const returnTo = safePath(data.return_to) || fallbackNext;
          const target = returnTo
            ? (data.tenderId ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}open_tender=${data.tenderId}` : returnTo)
            : (data.tenderId ? `/?open_tender=${data.tenderId}` : '/');

          setDestination(target);
          sessionStorage.removeItem('tt_pending_plan');
          sessionStorage.removeItem('tt_pending_bid_count');
          sessionStorage.removeItem('tt_pending_plans');
          sessionStorage.removeItem('tt_pending_tender');
          setStatus('success');
          setTimeout(() => router.push(target), 3000);
          return;
        }

        // క్యాష్‌ఫ్రీ పక్కాగా "ఫెయిల్" అని కన్ఫర్మ్ చేస్తేనే ఫెయిల్ చేయాలి (లేదా retries అయిపోతే)
        setDestination(billingReturn);
        setStatus('failed');
        setTimeout(() => router.push(billingReturn), 4000);

      } catch (err) {
        if (retries > 0) {
          setTimeout(() => verifyOrder(retries - 1), 3000);
        } else {
          setDestination(billingReturn);
          setStatus('failed');
          setTimeout(() => router.push(billingReturn), 4000);
        }
      }
    };

    // పేజీ ఓపెన్ అవ్వగానే 1 సెకన్ ఆగి వెరిఫికేషన్ మొదలుపెడుతుంది
    setTimeout(() => verifyOrder(20), 1000);

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
            <p className="text-slate-600 mt-3">We could not verify your payment. Taking you back to checkout...</p>
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
