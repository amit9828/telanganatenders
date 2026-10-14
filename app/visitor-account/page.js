'use client';

import { useEffect, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import { toast } from 'sonner';
import BrandLogo from '@/components/BrandLogo';
import { clientHeaders } from '@/lib/tab-handoff';
import { createBillingCheckout, openCashfreeSession } from '@/components/BillingGate';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, CheckCircle2, FileText, Loader2 } from 'lucide-react';

const VIEW_PLANS = {
  view_single: 'This tender PDF',
  view_month: '30-day view access',
  view_year: '365-day view access',
};

function viewWindow(subscription) {
  if (!subscription || subscription.view_source !== 'pricing_master' || !subscription.view_until) return null;
  const until = new Date(subscription.view_until);
  if (Number.isNaN(until.getTime())) return null;
  return { until, active: until > new Date() };
}

function readCheckout() {
  if (typeof window === 'undefined') return null;
  if (new URLSearchParams(window.location.search).get('checkout') !== '1') return null;
  const planId = sessionStorage.getItem('tt_pending_plan') || '';
  if (!VIEW_PLANS[planId]) return null;
  return {
    planId,
    tenderId: sessionStorage.getItem('tt_pending_tender') || undefined,
  };
}

export default function VisitorAccountPage() {
  const { data: session, status } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checkout, setCheckout] = useState(null);
  const [paying, setPaying] = useState(false);
  const email = status === 'authenticated' ? String(session?.user?.email || '').toLowerCase() : '';
  const windowAccess = viewWindow(data?.subscription);
  const unlocks = Array.isArray(data?.unlocked_tenders) ? data.unlocked_tenders : [];

  useEffect(() => {
    if (!email) {
      setData(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/me?email=${encodeURIComponent(email)}`, { credentials: 'include', headers: clientHeaders() })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [email]);

  useEffect(() => {
    if (email) setCheckout(readCheckout());
  }, [email]);

  const pay = async () => {
    if (!checkout) return;
    setPaying(true);
    try {
      const quote = await createBillingCheckout(checkout);
      await openCashfreeSession(quote);
    } catch (err) {
      toast.error(err.message || 'Could not start payment');
      setPaying(false);
    }
  };

  const upgrade = () => {
    sessionStorage.removeItem('tt_pending_plan');
    sessionStorage.removeItem('tt_pending_tender');
    sessionStorage.removeItem('tt_pending_plans');
    document.cookie = 'tt_signup_kind=client; path=/; max-age=600; samesite=lax';
    window.location.href = '/client?step=billing';
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-[#0A2647]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <BrandLogo subtitle="Visitor account" />
          <div className="flex items-center gap-2">
            {email && (
              <Button variant="ghost" size="sm" className="text-red-600" onClick={() => signOut({ callbackUrl: '/' })}>Sign out</Button>
            )}
            <a href="/"><Button variant="outline" size="sm">Home</Button></a>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
        {!email ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-[#0A2647]">Sign in to view your PDFs</CardTitle>
              <CardDescription>A Google sign-in keeps your purchases on this visitor account. It does not create a client profile.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="bg-[#0A2647]" onClick={() => signIn('google', { callbackUrl: '/visitor-account' })}>Sign in with Google</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="font-bold text-[#0A2647]">{email}</p>
              {windowAccess?.active ? (
                <Badge className="bg-emerald-600"><CheckCircle2 className="w-4 h-4 mr-1" /> View access active</Badge>
              ) : (
                <Badge variant="outline">No timed view plan</Badge>
              )}
            </div>

            {checkout && (
              <Card className="border-emerald-200">
                <CardHeader>
                  <CardTitle className="text-[#0A2647]">Finish this purchase</CardTitle>
                  <CardDescription>{VIEW_PLANS[checkout.planId]}. This does not open a client agreement.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="bg-emerald-600" disabled={paying} onClick={pay}>
                    {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Continue to payment'}
                  </Button>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-[#0A2647]"><Calendar className="w-5 h-5 text-emerald-600" /> Active subscription</CardTitle>
              </CardHeader>
              <CardContent>
                {windowAccess ? (
                  <p className="font-bold text-[#0A2647]">
                    {windowAccess.active ? 'All tender PDFs are open until' : 'View access ended on'} {windowAccess.until.toLocaleDateString()}
                  </p>
                ) : (
                  <p className="text-slate-600">No 30-day or yearly view plan. A single PDF purchase does not start one.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-[#0A2647]">
                  <FileText className="w-5 h-5 text-emerald-600" /> My Purchased PDFs ({unlocks.length})
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                </CardTitle>
                <CardDescription>Each ₹10 unlock stays on this account and can be opened again.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {unlocks.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No single PDFs yet.</p>}
                <div className="divide-y">
                  {unlocks.map((tender) => (
                    <div key={tender.id} className="p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-[#0A2647] truncate">{tender.title}</p>
                        <p className="text-xs text-slate-500">{tender.department} · {tender.district}</p>
                      </div>
                      <a href={`/api/tenders/${tender.id}/pdf`} target="_blank" rel="noreferrer">
                        <Button size="sm" className="bg-[#0A2647]">Open PDF</Button>
                      </a>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#0A2647] text-white">
              <CardHeader>
                <CardTitle>Our core services and plans</CardTitle>
                <CardDescription className="text-slate-200">Bid participation, registration, and payment tracking are for full clients. That path collects business details and an agreement.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="bg-emerald-500 text-[#0A2647] hover:bg-emerald-400" onClick={upgrade}>Upgrade to Full Client</Button>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
