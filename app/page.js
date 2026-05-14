'use client';
import { useEffect, useMemo, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  MapPin,
  Building2,
  Clock,
  Lock,
  Mail,
  CheckCircle2,
  Filter,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';

const DISTRICTS = [
  'Adilabad',
  'Nizamabad',
  'Karimnagar',
  'Medak',
  'Ranga Reddy',
  'Mahabubnagar',
  'Nalgonda',
  'Warangal',
  'Khammam',
];
const HYDERABAD = 'Hyderabad';

const PLANS = [
  {
    id: 'single',
    name: 'Single PDF',
    price: 9,
    desc: 'Unlock this one tender PDF',
    perks: ['Instant 1 PDF unlock', 'No subscription', 'Best for one-time use'],
  },
  {
    id: 'month',
    name: '1-Month Pass',
    price: 149,
    desc: 'Unlimited tenders for 30 days',
    perks: ['All tenders unlocked', 'Archive access', 'Email alerts'],
    highlight: true,
  },
  {
    id: 'year',
    name: '1-Year Pro',
    price: 1499,
    desc: 'Best value — 12 months access',
    perks: [
      'All tenders for 365 days',
      'Full archive + priority alerts',
      'Save ₹29 vs monthly',
    ],
  },
];

const monthName = (m) =>
  [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ][m];

function App() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12
  const [selectedDay, setSelectedDay] = useState(null);
  const [district, setDistrict] = useState('all');
  const [tenders, setTenders] = useState([]);
  const [calDays, setCalDays] = useState({});
  const [loading, setLoading] = useState(false);

  const [searchQ, setSearchQ] = useState('');

  const [email, setEmail] = useState('');
  const [emailModal, setEmailModal] = useState(false);
  const [paywallModal, setPaywallModal] = useState(false);
  const [pdfModal, setPdfModal] = useState(false);
  const [pendingTender, setPendingTender] = useState(null);
  const [pdfData, setPdfData] = useState(null);
  const [subscription, setSubscription] = useState(null);

  // Load email from localStorage
  useEffect(() => {
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_email') : '';
    if (e) setEmail(e);
  }, []);

  // Refresh access info when email changes
  useEffect(() => {
    if (!email) return;
    fetch(`/api/access?email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((d) => setSubscription(d.subscription || null))
      .catch(() => {});
  }, [email]);

  // Fetch tenders
  const fetchTenders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (district !== 'all') params.set('district', district);
      params.set('month', String(month));
      params.set('year', String(year));
      if (searchQ.trim()) {
        params.set('q', searchQ.trim());
        params.set('scope', 'all'); // search across all months when query given
      }
      const r = await fetch(`/api/tenders?${params.toString()}`);
      const d = await r.json();
      setTenders(d.tenders || []);
    } finally {
      setLoading(false);
    }
  };

  const fetchCalendar = async () => {
    const r = await fetch(`/api/tenders/calendar?month=${month}&year=${year}`);
    const d = await r.json();
    setCalDays(d.days || {});
  };

  useEffect(() => {
    fetchTenders();
    fetchCalendar();
    // eslint-disable-next-line
  }, [month, year, district, searchQ]);

  const filteredTenders = useMemo(() => {
    if (!selectedDay) return tenders;
    return tenders.filter((t) => new Date(t.last_date).getDate() === selectedDay);
  }, [tenders, selectedDay]);

  // ----- Calendar grid -----
  const calendarCells = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDow = first.getDay(); // 0 Sun
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month, year]);

  const prevMonth = () => {
    setSelectedDay(null);
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else setMonth(month - 1);
  };
  const nextMonth = () => {
    setSelectedDay(null);
    if (month === 12) {
      setMonth(1);
      setYear(year + 1);
    } else setMonth(month + 1);
  };

  // ----- Actions -----
  const handleViewPDF = async (t) => {
    setPendingTender(t);
    if (!email) {
      setEmailModal(true);
      return;
    }
    await tryUnlockPDF(t, email);
  };

  const submitEmail = async (e) => {
    e.preventDefault();
    const val = e.target.email.value.trim().toLowerCase();
    if (!val) return;
    const r = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: val }),
    });
    if (!r.ok) {
      toast.error('Invalid email');
      return;
    }
    localStorage.setItem('tt_email', val);
    setEmail(val);
    setEmailModal(false);
    toast.success('Email captured. Unlocking...');
    if (pendingTender) await tryUnlockPDF(pendingTender, val);
  };

  const tryUnlockPDF = async (t, mail) => {
    const r = await fetch(
      `/api/tenders/${t.id}/pdf?email=${encodeURIComponent(mail)}`
    );
    if (r.status === 402) {
      setPaywallModal(true);
      return;
    }
    const d = await r.json();
    setPdfData(d);
    setPdfModal(true);
  };

  const buyPlan = async (plan) => {
    if (!email) {
      toast.error('Email missing');
      return;
    }
    toast.info('Creating Razorpay order...');
    const r1 = await fetch('/api/payment/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        plan,
        tenderId: pendingTender?.id,
      }),
    });
    const { order } = await r1.json();
    // MOCK: in real flow we'd open Razorpay checkout. Here auto-verify.
    await new Promise((res) => setTimeout(res, 800));
    const r2 = await fetch('/api/payment/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: order.id,
        email,
        plan,
        tenderId: pendingTender?.id,
      }),
    });
    const d2 = await r2.json();
    if (d2.success) {
      toast.success('Payment successful — access unlocked!');
      setPaywallModal(false);
      // refresh subscription info
      fetch(`/api/access?email=${encodeURIComponent(email)}`)
        .then((r) => r.json())
        .then((d) => setSubscription(d.subscription || null));
      if (pendingTender) await tryUnlockPDF(pendingTender, email);
    } else {
      toast.error('Payment failed');
    }
  };

  // ---------------- RENDER ----------------
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Top bar */}
      <header className="border-b bg-white sticky top-0 z-30">
        <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <BrandLogo />
          <div className="flex items-center gap-1.5 sm:gap-3">
            {subscription ? (
              <Badge className="bg-[#16a34a] hover:bg-[#15803d] text-white text-[10px] sm:text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {subscription.plan === 'year' ? 'Pro' : 'Monthly'}
              </Badge>
            ) : null}
            <a href="/archive" className="text-sm font-medium text-[#0A2647] hover:text-[#16a34a] hidden md:inline">
              Archive
            </a>
            {email ? (
              <a href="/account" className="text-sm font-medium text-[#0A2647] hover:text-[#16a34a] hidden md:inline">
                My Account
              </a>
            ) : null}
            {email ? (
              <span className="text-xs text-muted-foreground hidden lg:inline">
                {email}
              </span>
            ) : null}
            <a href="/admin">
              <Button variant="outline" size="sm" className="text-xs sm:text-sm h-8 sm:h-9">
                Admin
              </Button>
            </a>
          </div>
        </div>
        {/* mobile sub-nav */}
        <div className="md:hidden border-t bg-slate-50/60 flex divide-x">
          <a href="/archive" className="flex-1 text-center py-2 text-xs font-medium text-[#0A2647]">
            Archive
          </a>
          <a href="/account" className="flex-1 text-center py-2 text-xs font-medium text-[#0A2647]">
            My Account
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="navy-gradient text-white">
        <div className="container mx-auto px-3 sm:px-4 py-8 md:py-14">
          <div className="max-w-3xl">
            <Badge className="bg-[#16a34a] hover:bg-[#15803d] mb-3 text-[10px] sm:text-xs">
              <Sparkles className="w-3 h-3 mr-1" />
              Updated daily — all 10 districts + Hyderabad
            </Badge>
            <h2 className="text-2xl sm:text-3xl md:text-5xl font-extrabold leading-tight">
              Every Government Tender in Telangana — one calendar away.
            </h2>
            <p className="text-slate-200 mt-3 max-w-2xl text-sm sm:text-base">
              Browse, filter, and instantly unlock official tender PDFs. Pay
              ₹9 for a single doc or go Pro for unlimited access.
            </p>
            {/* Search bar */}
            <div className="mt-5 sm:mt-6 flex gap-2 max-w-2xl bg-white rounded-lg p-1 tender-shadow-lg">
              <div className="flex-1 flex items-center px-2 sm:px-3 gap-2 min-w-0">
                <Search className="w-4 h-4 text-[#0A2647] shrink-0" />
                <input
                  type="text"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Search tenders..."
                  className="flex-1 min-w-0 py-2 text-sm text-[#0A2647] outline-none bg-transparent placeholder:text-slate-400"
                />
                {searchQ && (
                  <button
                    onClick={() => setSearchQ('')}
                    className="text-slate-400 hover:text-slate-700 shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <a href="/archive" className="shrink-0">
                <Button className="bg-[#16a34a] hover:bg-[#15803d] text-xs sm:text-sm px-3 sm:px-4">
                  <span className="hidden sm:inline">Browse </span>Archive
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      <main className="container mx-auto px-3 sm:px-4 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* District filter */}
        <Card className="tender-shadow">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-[#0A2647]" />
              <CardTitle className="text-base">Filter by District</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-2 px-2 sm:flex-wrap sm:overflow-visible">
              <button
                onClick={() => {
                  setDistrict('all');
                  setSelectedDay(null);
                }}
                className={`shrink-0 px-3 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium border transition ${
                  district === 'all'
                    ? 'bg-[#0A2647] text-white border-[#0A2647]'
                    : 'bg-white text-[#0A2647] border-slate-200 hover:border-[#0A2647]'
                }`}
              >
                All Districts
              </button>
              <button
                onClick={() => {
                  setDistrict(HYDERABAD);
                  setSelectedDay(null);
                }}
                className={`shrink-0 px-3 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-bold border-2 transition ${
                  district === HYDERABAD
                    ? 'bg-[#16a34a] text-white border-[#16a34a]'
                    : 'bg-emerald-50 text-[#15803d] border-[#16a34a]'
                }`}
              >
                ★ Hyderabad
              </button>
              <div className="w-px bg-slate-200 mx-1 shrink-0" />
              {DISTRICTS.map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    setDistrict(d);
                    setSelectedDay(null);
                  }}
                  className={`shrink-0 px-3 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium border transition ${
                    district === d
                      ? 'bg-[#0A2647] text-white border-[#0A2647]'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-[#0A2647]'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Calendar + Tender List two-column */}
        <div className="grid lg:grid-cols-5 gap-6">
          {/* Calendar */}
          <Card className="lg:col-span-2 tender-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-[#0A2647]" />
                  <CardTitle className="text-lg">
                    {monthName(month - 1)} {year}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={prevMonth}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={nextMonth}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <CardDescription>
                Click a date with tenders to filter the list.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1 text-center mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div
                    key={d}
                    className="text-xs font-semibold text-muted-foreground py-1"
                  >
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map((d, idx) => {
                  if (d === null)
                    return <div key={idx} className="h-12 sm:h-14" />;
                  const has = calDays[d];
                  const count = has ? has.length : 0;
                  const isToday =
                    d === today.getDate() &&
                    month === today.getMonth() + 1 &&
                    year === today.getFullYear();
                  const isSelected = selectedDay === d;
                  return (
                    <button
                      key={idx}
                      onClick={() => count > 0 && setSelectedDay(isSelected ? null : d)}
                      disabled={count === 0}
                      className={`h-12 sm:h-14 rounded-md border text-xs sm:text-sm flex flex-col items-center justify-center transition ${
                        isSelected
                          ? 'bg-[#0A2647] text-white border-[#0A2647]'
                          : count > 0
                          ? 'bg-emerald-50 border-[#16a34a]/30 hover:bg-[#16a34a] hover:text-white cursor-pointer'
                          : 'bg-white border-slate-100 text-slate-400'
                      } ${isToday && !isSelected ? 'ring-2 ring-[#0A2647]/40' : ''}`}
                    >
                      <span className="font-semibold">{d}</span>
                      {count > 0 && (
                        <span
                          className={`text-[9px] sm:text-[10px] mt-0.5 px-1 sm:px-1.5 py-0.5 rounded-full ${
                            isSelected
                              ? 'bg-white/20 text-white'
                              : 'bg-[#16a34a] text-white'
                          }`}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {selectedDay && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => setSelectedDay(null)}
                >
                  <X className="w-3 h-3 mr-1" /> Clear date filter
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Tender list */}
          <div className="lg:col-span-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#0A2647]">
                {selectedDay
                  ? `Tenders due ${monthName(month - 1)} ${selectedDay}`
                  : `${monthName(month - 1)} Tenders`}
                {district !== 'all' && (
                  <span className="text-[#16a34a]"> — {district}</span>
                )}
              </h3>
              <Badge variant="outline">{filteredTenders.length} found</Badge>
            </div>

            {loading && (
              <Card className="p-6 text-center text-muted-foreground">
                Loading tenders...
              </Card>
            )}

            {!loading && filteredTenders.length === 0 && (
              <Card className="p-10 text-center">
                <FileText className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                <p className="text-muted-foreground">
                  No tenders found for this period / district.
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Try changing month, district, or check back soon.
                </p>
              </Card>
            )}

            {filteredTenders.map((t) => (
              <Card
                key={t.id}
                className="tender-shadow hover:tender-shadow-lg transition"
              >
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row items-start sm:items-start gap-3 sm:gap-4">
                    <div className="flex-1 min-w-0 w-full">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge
                          className={
                            t.district === HYDERABAD
                              ? 'bg-[#16a34a] hover:bg-[#15803d]'
                              : 'bg-[#0A2647] hover:bg-[#0A2647]'
                          }
                        >
                          <MapPin className="w-3 h-3 mr-1" />
                          {t.district}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <strong className="text-[#0A2647]">
                            {new Date(t.last_date).toDateString()}
                          </strong>
                        </span>
                      </div>
                      <h4 className="font-bold text-[#0A2647] text-base md:text-lg mb-1 line-clamp-2">
                        {t.title}
                      </h4>
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mb-2">
                        <Building2 className="w-3 h-3" />
                        {t.department}
                      </p>
                      {t.supply_details && (
                        <p className="text-sm text-slate-600 line-clamp-2">
                          <span className="font-semibold text-[#0A2647]">
                            Supply:
                          </span>{' '}
                          {t.supply_details}
                        </p>
                      )}
                    </div>
                    <Button
                      onClick={() => handleViewPDF(t)}
                      className="bg-[#16a34a] hover:bg-[#15803d] text-white shrink-0 w-full sm:w-auto"
                    >
                      <FileText className="w-4 h-4 mr-1" /> View PDF
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t mt-12 bg-slate-50">
        <div className="container mx-auto px-4 py-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Telangana Tenders — Government Tender
          Portal. For official tender notifications across Telangana.
        </div>
      </footer>

      {/* Email modal */}
      <Dialog open={emailModal} onOpenChange={setEmailModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-[#16a34a]" /> Enter your email to
              continue
            </DialogTitle>
            <DialogDescription>
              We use your email to send tender alerts and to verify your PDF
              access.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEmail} className="space-y-3">
            <div>
              <Label>Email address</Label>
              <Input
                name="email"
                type="email"
                placeholder="you@example.com"
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                className="bg-[#0A2647] hover:bg-[#144272] w-full"
              >
                Continue
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Paywall modal */}
      <Dialog open={paywallModal} onOpenChange={setPaywallModal}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Lock className="w-5 h-5 text-[#16a34a]" /> Unlock this tender PDF
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Choose a plan. Payment is instant — access unlocks automatically
              after Razorpay confirmation.
            </DialogDescription>
          </DialogHeader>
          <div className="grid sm:grid-cols-3 gap-3 sm:gap-4 py-2">
            {PLANS.map((p) => (
              <div
                key={p.id}
                className={`rounded-xl border-2 p-5 flex flex-col ${
                  p.highlight
                    ? 'border-[#16a34a] bg-emerald-50 relative'
                    : 'border-slate-200 bg-white'
                }`}
              >
                {p.highlight && (
                  <Badge className="absolute -top-3 right-4 bg-[#16a34a]">
                    Most Popular
                  </Badge>
                )}
                <h3 className="font-bold text-[#0A2647] text-lg">{p.name}</h3>
                <p className="text-xs text-muted-foreground">{p.desc}</p>
                <div className="my-3">
                  <span className="text-3xl font-extrabold text-[#0A2647]">
                    ₹{p.price}
                  </span>
                  <span className="text-sm text-muted-foreground ml-1">
                    {p.id === 'single'
                      ? '/PDF'
                      : p.id === 'month'
                      ? '/month'
                      : '/year'}
                  </span>
                </div>
                <ul className="text-xs text-slate-600 space-y-1 mb-4 flex-1">
                  {p.perks.map((x) => (
                    <li key={x} className="flex items-start gap-1">
                      <CheckCircle2 className="w-3 h-3 text-[#16a34a] mt-0.5 shrink-0" />
                      {x}
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={() => buyPlan(p.id)}
                  className={
                    p.highlight
                      ? 'bg-[#16a34a] hover:bg-[#15803d] w-full'
                      : 'bg-[#0A2647] hover:bg-[#144272] w-full'
                  }
                >
                  Pay ₹{p.price} with Razorpay
                </Button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-center text-muted-foreground">
            Secured by Razorpay. Webhook auto-verifies and unlocks instantly.
          </p>
        </DialogContent>
      </Dialog>

      {/* PDF modal */}
      <Dialog open={pdfModal} onOpenChange={setPdfModal}>
        <DialogContent className="max-w-4xl w-[95vw] h-[90vh] sm:h-[85vh] flex flex-col p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg pr-6">
              <FileText className="w-5 h-5 text-[#16a34a] shrink-0" />
              <span className="truncate">{pdfData?.title}</span>
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1 text-xs">
              {pdfData?.pdf_filename}
              {pdfData?.watermarked && (
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 ml-2 text-[10px]">
                  <Lock className="w-3 h-3 mr-1" /> Watermarked to {email}
                </Badge>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 rounded-md border overflow-hidden bg-slate-100">
            {pdfData?.pdf_base64 ? (
              <iframe
                title="tender-pdf"
                src={`data:application/pdf;base64,${pdfData.pdf_base64}`}
                className="w-full h-full"
              />
            ) : (
              <div className="p-10 text-center text-muted-foreground">
                No PDF uploaded for this tender yet.
              </div>
            )}
          </div>
          <DialogFooter>
            {pdfData?.pdf_base64 && (
              <a
                href={`data:application/pdf;base64,${pdfData.pdf_base64}`}
                download={pdfData.pdf_filename}
                className="w-full sm:w-auto"
              >
                <Button className="bg-[#0A2647] hover:bg-[#144272] w-full">
                  Download Watermarked PDF
                </Button>
              </a>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default App;
