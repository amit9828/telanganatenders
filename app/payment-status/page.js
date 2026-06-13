'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

function PaymentStatusContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const order_id = searchParams.get('order_id');
  const [status, setStatus] = useState('verifying'); 

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
      if (data.success) {
        setStatus('success');
        // Auto-open magic link: Sends the tender ID back to home page
        if (data.tenderId) {
            setTimeout(() => router.push('/?open_tender=' + data.tenderId), 3000);
        } else {
            setTimeout(() => router.push('/'), 3000);
        }
      } else {
        setStatus('failed');
        setTimeout(() => router.push('/'), 4000);
      }
    })
    .catch(() => {
      setStatus('failed');
      setTimeout(() => router.push('/'), 4000);
    });

  }, [order_id, router]);

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
            <p className="text-slate-600 mt-3">Access granted. Redirecting back to portal...</p>
          </div>
        )}

        {status === 'failed' && (
          <div className="flex flex-col items-center">
            <XCircle className="w-20 h-20 text-red-500 mb-4" />
            <h2 className="text-3xl font-bold text-red-500">Payment Failed</h2>
            <p className="text-slate-600 mt-3">We could not verify your payment. Redirecting to home...</p>
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
