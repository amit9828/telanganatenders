'use client';
import { useEffect, useMemo, useState } from 'react';
import Script from 'next/script';
import { useSession, signIn, signOut } from 'next-auth/react';
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
import { load } from '@cashfreepayments/cashfree-js';
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
    name: 'Single Document',
    price: 10,
    desc: 'Unlock only the PDF you clicked on',
    mode: 'oneoff',
    perks: [
      'Instant 1 PDF unlock',
      'Email-watermarked download',
      'No subscription, no auto-renew',
    ],
    cta: 'Pay ₹10 for this PDF',
  },
  {
    id: 'month',
    name: 'Monthly Premium',
    price: 149,
    desc: 'Auto-renews every 30 days — cancel anytime',
    mode: 'subscription',
    perks: [
      'Every current & future tender unlocked',
      'Full archive & calendar access',
      'Auto-renew · cancel anytime',
      'Best for active bidders',
    ],
    cta: 'Subscribe ₹149/mo',
    highlight: true,
  },
  {
    id: 'year',
    name: 'Yearly Premium',
    price: 1499,
    desc: 'Auto-renews every 365 days — save big',
    mode: 'subscription',
    perks: [
      'Everything in Monthly',
      'Auto-renews yearly',
      'Save ₹289 vs 12× monthly',
      'Cancel anytime',
    ],
    cta: 'Subscribe ₹1499/yr',
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
  const { data: session } = useSession();
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
  const [buying, setBuying] = useState(false);

  // Sync Google session email -> local email
  useEffect(() => {
    if (session?.user?.email) {
      const e = session.user.email.toLowerCase();
      setEmail(e);
      if (typeof window !== 'undefined') localStorage.setItem('tt_email', e);
      // Also create user record (idempotent)
      fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e, name: session.user.name || '' }),
      }).catch(() => {});
    }
  }, [session]);

  // Load email from localStorage (for users who used email-only flow earlier)
  useEffect(() => {
    if (session?.user?.email) return; // session takes priority
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_email') : '';
    if (e) setEmail(e);
  }, [session]);

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
      `/api/tenders/${t._id || t.id}/pdf?email=${encodeURIComponent(mail)}`
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
      toast.error('Please sign in first');
      return;
    }
    if (buying) return;
    if (plan === 'single' && !pendingTender?.id && !pendingTender?._id) {
      toast.error('Please pick a tender first');
      return;
    }
    setBuying(true);
    setPaywallModal(false);
    
    // UI స్మూత్ గా ఉండటానికి చిన్న డిలే
    await new Promise((r) => setTimeout(r, 250));

    const isSubscription = plan === 'month' || plan === 'year';

    try {
      // 1. Payment Session ID తెచ్చుకోవడం
      const endpoint = isSubscription ? '/api/subscription/create' : '/api/payment/order';
      const r1 = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, plan, tenderId: pendingTender?._id || pendingTender?.id }),
      });
      const d1 = await r1.json();

      if (!r1.ok || (!d1.payment_session_id && !d1.order?.payment_session_id)) {
        toast.error(d1.error || 'Failed to initialize payment');
        setBuying(false);
        return;
      }

      // 2. Cashfree SDK లోడ్ చేయడం
      const cashfree = await load({ mode: "production" });

      // 3. Checkout పేజీ ఓపెన్ చేయడం
      const checkoutOptions = {
        paymentSessionId: d1.payment_session_id || d1.order?.payment_session_id,
        returnUrl: "https://www.tgtenders.in/payment-status?order_id={order_id}",
      };

      await cashfree.checkout(checkoutOptions);
      
    } catch (e) {
      console.error(e);
      toast.error('Could not start payment');
    } finally {
      setBuying(false);
    }
  };

  // ----- NEW LOGIC: FAST AUTO-OPEN PDF AFTER SUCCESSFUL PAYMENT -----
  useEffect(() => {
    if (email) {
      const urlParams = new URLSearchParams(window.location.search);
      const openId = urlParams.get('open_tender');
      
      if (openId) {
        // Fetch the PDF immediately without waiting for the full tenders list to load
        tryUnlockPDF({ id: openId }, email);
        
        // Remove the parameter from the URL so it doesn't reopen if the user refreshes
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, [email]);

  // ---------------- RENDER ----------------
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">

      {/* Top bar */}
      <header className="border-b bg-white sticky top-0 z-30">
        <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <BrandLogo />
          <div className="flex items-center gap-1.5 sm:gap-3">
            {subscription && subscription.status === 'active' ? (
              <Badge className="bg-[#16a34a] hover:bg-[#15803d] text-white text-[10px] sm:text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {subscription.plan === 'year' ? 'Pro' : 'Monthly'}
              </Badge>
            ) : null}
            <a href="/archive" className="text-sm font-medium text-[#0A2647] hover:text-[#16a34a] hidden md:inline">
              Archive
            </a>
            <a href="#pricing" className="text-sm font-medium text-[#0A2647] hover:text-[#16a34a] hidden md:inline">
              Pricing
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
            {session ? (
              <Button
                onClick={() => signOut()}
                variant="ghost"
                size="sm"
                className="text-xs sm:text-sm h-8 sm:h-9 hidden sm:inline-flex"
                title={session.user.email}
              >
                {session.user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={session.user.image} alt="" className="w-5 h-5 rounded-full mr-1" />
                ) : null}
                Sign out
              </Button>
            ) : (
              <Button
                onClick={() => signIn('google')}
                size="sm"
                className="text-xs sm:text-sm h-8 sm:h-9 bg-[#16a34a] hover:bg-[#15803d]"
              >
                Sign in
              </Button>
            )}
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
                key={t._id || t.id}
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
        {/* Pricing section — public, sits above footer */}
        <section id="pricing" className="pt-6 scroll-mt-24">
          <div className="text-center max-w-2xl mx-auto mb-6">
            <Badge className="bg-[#16a34a] hover:bg-[#15803d] mb-2">PRICING</Badge>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-[#0A2647]">
              Pick the plan that fits you
            </h3>
            <p className="text-sm sm:text-base text-muted-foreground mt-2">
              Pay once for a single PDF, or go Premium for unlimited tender
              access. All payments handled securely by Cashfree.
            </p>
          </div>
          <PlanGrid
            plans={PLANS}
            buying={buying}
            onBuy={(p) => {
              if (p === 'single' && !pendingTender) {
                toast.info('Click "View PDF" on any tender to buy ₹10 single access.');
                return;
              }
              setPendingTender(null);
              if (!email) {
                setEmailModal(true);
                return;
              }
              buyPlan(p);
            }}
          />
        </section>
      </main>
{/* --- NEW FOOTER SECTION WITH ORIGINAL LINKS & LEGAL --- */}
      <footer className="border-t mt-14 bg-[#0A2647] text-white py-10 rounded-t-2xl">
        <div className="container mx-auto px-4 text-center">
          <h3 className="text-2xl font-bold mb-2">Telangana Tenders</h3>
          <p className="text-slate-300 mb-6 text-sm">Government Tender Service Portal | Upto 10 Lakhs</p>
          
          {/* Social Links */}
          <div className="flex justify-center space-x-6 mb-8">
            <a href="https://whatsapp.com/channel/0029VbD5F2h2975IQSMPVK2x" target="_blank" rel="noreferrer" className="text-emerald-400 hover:text-emerald-300 font-semibold text-sm sm:text-base">
              📱 WhatsApp Channel
            </a>
            <a href="https://www.youtube.com/@esakafficial1237" target="_blank" rel="noreferrer" className="text-red-400 hover:text-red-300 font-semibold text-sm sm:text-base">
              ▶️ YouTube
            </a>
            <a href="https://www.instagram.com/telangana_tenders?igsh=MWIzbTAyZmE2OHkyMQ==" target="_blank" rel="noreferrer" className="text-pink-400 hover:text-pink-300 font-semibold text-sm sm:text-base">
              📸 Instagram
            </a>
          </div>
          
          <div className="max-w-2xl mx-auto border-t border-slate-700 pt-6">
            <p className="text-xs text-slate-400 mb-2 leading-relaxed">
              © {new Date().getFullYear()} Telangana Tenders. This is a private service portal and not an official government website.
            </p>
            <p className="text-xs text-slate-500 mb-4">Contact: support@tgtenders.co.in</p>

            {/* Legal Links */}
            <div className="flex justify-center space-x-3 sm:space-x-6 text-[10px] sm:text-xs text-slate-400">
              <a href="/legal#terms" className="hover:text-emerald-400 transition">Terms & Conditions</a>
              <span>|</span>
              <a href="/legal#privacy" className="hover:text-emerald-400 transition">Privacy Policy</a>
              <span>|</span>
              <a href="/legal#refund" className="hover:text-emerald-400 transition">Refund Policy</a>
            </div>
          </div>
        </div>
      </footer>
      {/* --- END FOOTER SECTION --- */}

      {/* Email modal */}
      <Dialog open={emailModal} onOpenChange={setEmailModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-[#16a34a]" /> Sign in to view this PDF
            </DialogTitle>
            <DialogDescription>
              Pick one option below. Your email is used to confirm your PDF
              access and send tender alerts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button
              onClick={() => {
                setEmailModal(false);
                signIn('google', { callbackUrl: typeof window !== 'undefined' ? window.location.href : '/' });
              }}
              className="w-full bg-white hover:bg-slate-50 border text-[#0A2647] gap-2 h-11"
            >
              {/* Google G logo */}
              <svg className="w-5 h-5" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.5-5.9 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8c1.8-4.4 6-7.5 11.1-7.5 3 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.4 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.4 0 10.3-2.1 14-5.4l-6.5-5.5C29.6 34.6 26.9 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.6 5.1C9.5 39.5 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4 5.4l6.5 5.5c-.4.4 6.9-5 6.9-15-.1-1.4-.2-2.7-.5-3.4z"/>
              </svg>
              Continue with Google
            </Button>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <div className="flex-1 h-px bg-slate-200" /> or use email <div className="flex-1 h-px bg-slate-200" />
            </div>
            <form onSubmit={submitEmail} className="space-y-2">
              <Input
                name="email"
                type="email"
                placeholder="you@example.com"
                required
              />
              <Button
                type="submit"
                className="bg-[#0A2647] hover:bg-[#144272] w-full"
              >
                Continue with Email
              </Button>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Paywall modal */}
      <Dialog open={paywallModal} onOpenChange={setPaywallModal}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Lock className="w-5 h-5 text-[#16a34a]" /> Unlock this Tender PDF
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              <strong className="text-[#0A2647]">3 ways to access:</strong>{' '}
              one-time ₹10 for this single PDF, or go Premium to unlock every
              tender. Payments are secured by Cashfree; access is unlocked
              instantly after verification.
            </DialogDescription>
          </DialogHeader>
          {pendingTender && (
            <div className="bg-slate-50 border rounded-md p-3 text-sm">
              <span className="text-xs text-muted-foreground">Selected tender</span>
              <p className="font-semibold text-[#0A2647] truncate">
                {pendingTender.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {pendingTender.department} · {pendingTender.district}
              </p>
            </div>
          )}
          <PlanGrid plans={PLANS} buying={buying} onBuy={buyPlan} />
          <p className="text-[11px] text-center text-muted-foreground">
            🔒 Secured by Cashfree · UPI, Cards, Net-banking, Wallets accepted ·
            Webhook auto-verifies and unlocks instantly
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

function PlanGrid({ plans, buying, onBuy }) {
  return (
    <div className="grid sm:grid-cols-3 gap-4">
      {plans.map((p) => (
        <div
          key={p.id}
          className={`rounded-xl border-2 p-5 flex flex-col ${
            p.highlight
              ? 'border-[#16a34a] bg-emerald-50 relative shadow-lg'
              : 'border-slate-200 bg-white'
          }`}
        >
          {p.highlight && (
            <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#16a34a]">
              ⭐ Most Popular
            </Badge>
          )}
          <h3 className="font-bold text-[#0A2647] text-lg">{p.name}</h3>
          <p className="text-xs text-muted-foreground min-h-[32px]">{p.desc}</p>
          <div className="my-3 flex items-baseline gap-1">
            <span className="text-3xl sm:text-4xl font-extrabold text-[#0A2647]">
              ₹{p.price}
            </span>
            <span className="text-sm text-muted-foreground">
              {p.id === 'single'
                ? '/ PDF'
                : p.id === 'month'
                ? '/ 30 days'
                : '/ 365 days'}
            </span>
          </div>
          <ul className="text-xs sm:text-sm text-slate-600 space-y-1.5 mb-4 flex-1">
            {p.perks.map((x) => (
              <li key={x} className="flex items-start gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-[#16a34a] mt-0.5 shrink-0" />
                <span>{x}</span>
              </li>
            ))}
          </ul>
          <Button
            onClick={() => onBuy(p.id)}
            disabled={buying}
            className={
              p.highlight
                ? 'bg-[#16a34a] hover:bg-[#15803d] w-full h-11'
                : 'bg-[#0A2647] hover:bg-[#144272] w-full h-11'
            }
          >
            {buying ? 'Processing...' : p.cta || `Pay ₹${p.price}`}
          </Button>
        </div>
      ))}
    </div>
  );
}
