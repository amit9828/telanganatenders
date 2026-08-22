'use client';
import { useEffect, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Mail,
  CheckCircle2,
  FileText,
  IndianRupee,
  Calendar,
  Loader2
} from 'lucide-react';

function AccountPage() {
  const [isMounted, setIsMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [tempEmail, setTempEmail] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_email') : '';
    if (e) setEmail(e);
  }, []);

  useEffect(() => {
    if (!email) return;
    setLoading(true);
    
    // Fetch User Data (Only Core Details)
    fetch(`/api/me?email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [email]);

  const setMyEmail = (e) => {
    e.preventDefault();
    if (!tempEmail) return;
    localStorage.setItem('tt_email', tempEmail.toLowerCase());
    setEmail(tempEmail.toLowerCase());
  };

  const logout = () => {
    localStorage.removeItem('tt_email');
    setEmail('');
    setData(null);
  };

  if (!isMounted) return null;

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
              <CardTitle className="flex items-center gap-2 text-[#0A2647]">
                <Mail className="w-5 h-5 text-[#16a34a]" /> Enter your email
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={setMyEmail} className="space-y-3">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={tempEmail}
                  onChange={(e) => setTempEmail(e.target.value)}
                  required
                />
                <Button type="submit" className="bg-[#0A2647] hover:bg-[#144272] w-full">
                  View My Account
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            
            {/* USER HEADER */}
            <Card className="tender-shadow border-t-4 border-t-[#0A2647]">
              <CardContent className="p-6 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Signed in as</p>
                  <p className="text-lg md:text-xl font-bold text-[#0A2647]">{email}</p>
                </div>
                {data?.subscription ? (
                  <Badge className="bg-[#16a34a] hover:bg-[#15803d] text-sm px-3 py-1">
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    {data.subscription.plan === 'year' ? 'Pro Annual' : 'Monthly Premium'} Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-slate-100 text-slate-600">No active subscription</Badge>
                )}
              </CardContent>
            </Card>

            {/* SUBSCRIPTION CARD */}
            {data?.subscription && (
              <Card className="tender-shadow bg-emerald-50 border border-[#16a34a]/30">
                <CardContent className="p-6">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
                    <div className="flex items-center gap-3">
                      <Calendar className="w-8 h-8 text-[#16a34a]" />
                      <div>
                        <p className="text-sm text-emerald-800 font-semibold">
                          Your {data.subscription.plan === 'year' ? 'Annual' : 'Monthly'} Access Pass
                        </p>
                        <p className="text-lg font-bold text-[#0A2647]">
                          Valid until {new Date(data.subscription.expires_at).toDateString()}
                        </p>
                        {data.auto_renew && (
                          <p className="text-xs text-emerald-700 mt-1">
                            🔁 Auto-renews via Cashfree — cancel anytime
                          </p>
                        )}
                        {data.subscription_status === 'cancelled_pending' && (
                          <p className="text-xs text-amber-700 mt-1">
                            ⏳ Auto-renewal cancelled — premium ends at expiry
                          </p>
                        )}
                      </div>
                    </div>
                    {data.auto_renew && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-white text-red-600 border-red-200 hover:bg-red-50"
                        onClick={async () => {
                          if (!confirm('Cancel auto-renewal? You keep premium until current expiry.')) return;
                          const r = await fetch('/api/subscription/cancel', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email }),
                          });
                          const d = await r.json();
                          if (r.ok) {
                            toast.success(d.message || 'Cancelled');
                            fetch(`/api/me?email=${encodeURIComponent(email)}`)
                              .then((r) => r.json())
                              .then((d) => setData(d));
                          } else {
                            toast.error(d.error || 'Failed');
                          }
                        }}
                      >
                        Cancel Auto-renew
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* PURCHASED PDFs */}
            <Card className="tender-shadow">
              <CardHeader className="bg-slate-50 border-b pb-4">
                <CardTitle className="text-[#0A2647] flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#16a34a]" />
                  My Purchased PDFs ({data?.unlocked_tenders?.length || 0})
                  {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </CardTitle>
                <CardDescription>Documents you have unlocked with a Single Purchase plan.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {(!data || !data.unlocked_tenders || data.unlocked_tenders.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    You haven't purchased any single PDF documents yet.
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
                      <a href={`/?open_tender=${t.id || t._id}`} className="shrink-0">
                        <Button size="sm" className="bg-[#0A2647] hover:bg-[#144272] w-full sm:w-auto">
                          <FileText className="w-3 h-3 mr-2" /> View Document
                        </Button>
                      </a>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* PAYMENT HISTORY */}
            <Card className="tender-shadow">
              <CardHeader className="bg-slate-50 border-b pb-4">
                <CardTitle className="text-[#0A2647] flex items-center gap-2">
                  <IndianRupee className="w-5 h-5 text-[#16a34a]" />
                  Payment History
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
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs text-slate-500 uppercase bg-slate-100/50 border-b">
                        <tr>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Plan Type</th>
                          <th className="px-4 py-3">Amount</th>
                          <th className="px-4 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.payments.map((p, i) => (
                          <tr key={i} className="border-b last:border-0 hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-[#0A2647]">
                              {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '-'}
                            </td>
                            <td className="px-4 py-3 capitalize">{p.plan} Access</td>
                            <td className="px-4 py-3 text-[#16a34a] font-bold flex items-center">
                              ₹{p.amount}
                            </td>
                            <td className="px-4 py-3">
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
