'use client';
import { useEffect, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  Mail,
  CheckCircle2,
  FileText,
  IndianRupee,
  Calendar,
} from 'lucide-react';

function AccountPage() {
  const [email, setEmail] = useState('');
  const [tempEmail, setTempEmail] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_email') : '';
    if (e) setEmail(e);
  }, []);

  useEffect(() => {
    if (!email) return;
    setLoading(true);
    fetch(`/api/me?email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((d) => setData(d))
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b bg-white sticky top-0 z-30">
        <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <BrandLogo subtitle="My Account" />
          <div className="flex items-center gap-2">
            {email && (
              <Button variant="ghost" size="sm" onClick={logout}>
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
            <Card className="tender-shadow">
              <CardContent className="p-6 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Signed in as</p>
                  <p className="text-lg font-bold text-[#0A2647]">{email}</p>
                </div>
                {data?.subscription ? (
                  <Badge className="bg-[#16a34a] hover:bg-[#15803d] text-base px-3 py-1">
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    {data.subscription.plan === 'year' ? 'Pro Annual' : 'Monthly'} active
                  </Badge>
                ) : (
                  <Badge variant="outline">No active subscription</Badge>
                )}
              </CardContent>
            </Card>

            {data?.subscription && (
              <Card className="tender-shadow bg-emerald-50 border-[#16a34a]">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-8 h-8 text-[#16a34a]" />
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Your {data.subscription.plan === 'year' ? 'annual' : 'monthly'} pass
                      </p>
                      <p className="text-lg font-bold text-[#0A2647]">
                        Active until {new Date(data.subscription.expires_at).toDateString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="tender-shadow">
              <CardHeader>
                <CardTitle className="text-[#0A2647]">
                  Purchased PDFs ({data?.unlocked_tenders?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(!data || data.unlocked_tenders.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No single PDF unlocks yet.
                  </p>
                )}
                {data?.unlocked_tenders?.map((t) => (
                  <div
                    key={t.id}
                    className="border rounded-md p-3 flex items-center justify-between hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[#0A2647] truncate">{t.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.department} · {t.district}
                      </p>
                    </div>
                    <a href="/">
                      <Button size="sm" className="bg-[#0A2647] hover:bg-[#144272]">
                        <FileText className="w-3 h-3 mr-1" /> Open
                      </Button>
                    </a>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="tender-shadow">
              <CardHeader>
                <CardTitle className="text-[#0A2647]">
                  Payment History ({data?.payments?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(!data || data.payments.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No payments yet.
                  </p>
                )}
                {data?.payments?.length > 0 && (
                  <div className="space-y-1 text-sm">
                    <div className="grid grid-cols-4 font-semibold text-[#0A2647] border-b pb-2">
                      <span>Date</span>
                      <span>Plan</span>
                      <span>Amount</span>
                      <span>Expires</span>
                    </div>
                    {data.payments.map((p, i) => (
                      <div key={i} className="grid grid-cols-4 py-2 border-b last:border-0">
                        <span>{p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '-'}</span>
                        <span className="capitalize font-medium">{p.plan}</span>
                        <span className="flex items-center">
                          <IndianRupee className="w-3 h-3" /> {p.amount}
                        </span>
                        <span>
                          {p.expires_at
                            ? new Date(p.expires_at).toLocaleDateString()
                            : 'One-time'}
                        </span>
                      </div>
                    ))}
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
