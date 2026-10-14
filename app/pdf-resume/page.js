'use client';

import { Suspense, useEffect, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { canViewTender } from '@/lib/billing-access';
import ViewUnlockModal from '@/components/ViewUnlockModal';

function PdfResumeContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const [tenderId, setTenderId] = useState('');
  const [offer, setOffer] = useState(false);

  useEffect(() => {
    const fromUrl = searchParams.get('tender') || '';
    const fromStore = typeof window !== 'undefined' ? (sessionStorage.getItem('tt_resume_pdf') || '') : '';
    const id = fromUrl || fromStore;
    if (fromStore) sessionStorage.removeItem('tt_resume_pdf');
    if (!id) {
      window.location.replace('/');
      return;
    }
    setTenderId(id);
  }, [searchParams]);

  useEffect(() => {
    if (!tenderId || status === 'loading') return undefined;
    if (status === 'unauthenticated') {
      sessionStorage.setItem('tt_resume_pdf', tenderId);
      signIn('google', { callbackUrl: `/pdf-resume?tender=${encodeURIComponent(tenderId)}` });
      return undefined;
    }
    const email = session?.user?.email;
    if (!email) return undefined;
    let cancelled = false;
    fetch(`/api/me?email=${encodeURIComponent(email)}`, { credentials: 'include' })
      .then((res) => res.json().then((profile) => ({ ok: res.ok, profile })))
      .then(({ ok, profile }) => {
        if (cancelled) return;
        if (ok && canViewTender(profile, tenderId)) {
          window.location.replace(`/api/tenders/${encodeURIComponent(tenderId)}/pdf`);
          return;
        }
        setOffer(true);
      })
      .catch(() => {
        if (!cancelled) setOffer(true);
      });
    return () => { cancelled = true; };
  }, [status, session, tenderId]);

  const choosePlan = (planKey) => {
    sessionStorage.setItem('tt_pending_plan', planKey);
    if (planKey === 'view_single' && tenderId) sessionStorage.setItem('tt_pending_tender', tenderId);
    else sessionStorage.removeItem('tt_pending_tender');
    document.cookie = 'tt_signup_kind=visitor; path=/; max-age=600; samesite=lax';
    window.location.href = '/visitor-account?checkout=1';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      {!offer && <Loader2 className="w-8 h-8 animate-spin text-[#0A2647]" />}
      <ViewUnlockModal
        open={offer}
        onClose={() => { window.location.href = '/'; }}
        onChoose={choosePlan}
      />
    </div>
  );
}

export default function PdfResumePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-8 h-8 animate-spin text-[#0A2647]" /></div>}>
      <PdfResumeContent />
    </Suspense>
  );
}
