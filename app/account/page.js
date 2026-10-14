'use client';
import { useEffect, useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import BrandLogo from '@/components/BrandLogo';
import { clientHeaders } from '@/lib/tab-handoff';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  IndianRupee,
  Calendar,
  Loader2
} from 'lucide-react';

function viewWindow(subscription) {
  if (!subscription || subscription.view_source !== 'pricing_master' || !subscription.view_until) return null;
  const until = new Date(subscription.view_until);
  if (Number.isNaN(until.getTime())) return null;
  return { until, active: until > new Date() };
}

function AccountPage() {
  const { data: session, status } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const email = status === 'authenticated' ? String(session?.user?.email || '').toLowerCase() : '';

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
      .catch((err) => console.error(err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [email]);

  const logout = () => {
    signOut({ callbackUrl: '/' });
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-[#0A2647]" />
      </div>
    );
  }

  const windowAccess = viewWindow(data?.subscription);
  const unlockCount = data?.unlocked_tenders?.length || 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b bg-white sticky top-0 z-30">
        <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <BrandLogo subtitle="My Account" />
          <div className="flex items-center gap-2">
            {email && (
              <Button variant="ghost" size="sm" onClick={logout} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                Logout
              </Button>
            )}
            <a href="/">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-3 h-3 mr-1" /> Home
              </Button>
            </a>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {!email ? (
          <Card className="tender-shadow max-w-md mx-auto">
            <CardHeader>
              <CardTitle className="text-[#0A2647]">Sign in to see your account</CardTitle>
              <CardDescription>Your view plan, billing history, and unlocked PDFs are tied to your Google account.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" className="bg-[#0A2647] hover:bg-[#144272] w-full" onClick={() => signIn('google', { callbackUrl: '/account' })}>
                Sign in with Google
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            
            <Card className="tender-shadow border-t-4 border-t-[#0A2647]">
              <CardContent className="p-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Signed in as</p>
                  <p className="text-lg md:text-xl font-bold text-[#0A2647]">{email}</p>
                </div>
                {windowAccess?.active ? (
                  <Badge className="bg-[#16a34a] hover:bg-[#15803d] text-sm px-3 py-1">
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    View access active
                  </Badge>
                ) : unlockCount > 0 ? (
                  <Badge className="bg-[#0A2647] text-sm px-3 py-1">PDF access</Badge>
                ) : (
                  <Badge variant="outline" className="bg-slate-100 text-slate-600">No active view plan</Badge>
                )}
              </CardContent>
            </Card>

            <Card className="tender-shadow bg-emerald-50 border border-[#16a34a]/30">
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-8 h-8 text-[#16a34a]" />
                    <div>
                      <p className="text-sm text-emerald-800 font-semibold">View subscription</p>
                      {windowAccess ? (
                        <p className="text-lg font-bold text-[#0A2647]">
                          {windowAccess.active ? 'Active until' : 'Expired on'} {windowAccess.until.toLocaleDateString()}
                        </p>
                      ) : (
                        <p className="text-lg font-bold text-[#0A2647]">No 30-day or yearly view plan</p>
                      )}
                      <p className="text-xs text-emerald-800 mt-1">A single PDF purchase stays on this account and does not start a timed plan.</p>
                    </div>
                  </div>
                  <a href="/client?step=billing">
                    <Button className="bg-[#0A2647] hover:bg-[#144272]">Upgrade to Full Client</Button>
                  </a>
                </div>
              </CardContent>
            </Card>

            <Card className="tender-shadow">
              <CardHeader className="bg-slate-50 border-b pb-4">
                <CardTitle className="text-[#0A2647] flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#16a34a]" />
                  My Purchased PDFs ({unlockCount})
                  {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </CardTitle>
                <CardDescription>Documents unlocked with a single purchase. You can open them again anytime.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {unlockCount === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    You have not purchased any single PDF documents yet.
                  </p>
                )}
                <div className="divide-y">
                  {data?.unlocked_tenders?.map((t) => (
                    <div
                      key={t.id || t._id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 transition"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-[#0A2647] truncate">{t.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          <span className="font-semibold text-slate-600">{t.department}</span> • {t.district}
                        </p>
                      </div>
                      <a href={`/api/tenders/${t.id || t._id}/pdf`} className="shrink-0" target="_blank" rel="noreferrer">
                        <Button size="sm" className="bg-[#0A2647] hover:bg-[#144272] w-full sm:w-auto">
                          <FileText className="w-3 h-3 mr-2" /> View Document
                        </Button>
                      </a>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="tender-shadow">
              <CardHeader className="bg-slate-50 border-b pb-4">
                <CardTitle className="text-[#0A2647] flex items-center gap-2">
                  <IndianRupee className="w-5 h-5 text-[#16a34a]" />
                  Billing History
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {(!data || !data.payments || data.payments.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No successful payments found.
                  </p>
                )}
                {data?.payments?.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="premium-table text-sm text-left">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Plan</th>
                          <th>Amount</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.payments.map((p, i) => (
                          <tr key={p.order_id || i}>
                            <td className="font-medium text-[#0A2647]">
                              {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '-'}
                            </td>
                            <td className="capitalize">{p.plan_id || p.plan || 'Payment'}</td>
                            <td className="text-[#16a34a] font-bold">
                              ₹{p.total_amount ?? p.amount}
                            </td>
                            <td>
                              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Success</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        )}
      </main>
    </div>
  );
}

export default AccountPage;
