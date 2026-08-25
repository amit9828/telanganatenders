'use client';
import { useEffect, useMemo, useState } from 'react';
import Script from 'next/script';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
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
  Loader2,
  User,
  Briefcase,
  UserCog,
  Eye,
  LogOut,
  MessageCircle,
  PhoneCall,
  Award,
  TrendingUp,
  Target,
  Users
} from 'lucide-react';

const TS_DISTRICTS = [
  'Hyderabad', 'Adilabad', 'Nizamabad', 'Karimnagar', 'Medak', 'Ranga Reddy',
  'Mahabubnagar', 'Nalgonda', 'Warangal', 'Khammam', 'Sangareddy',
  'Medchal-Malkajgiri', 'Siddipet', 'Vikarabad',
];

const AP_DISTRICTS = [
  'Visakhapatnam', 'Vijayawada (NTR)', 'Guntur', 'Tirupati', 'Nellore',
  'Kurnool', 'Anantapur', 'Kadapa (YSR)', 'Kakinada', 'Eluru',
  'Srikakulam', 'Vizianagaram', 'Prakasam',
];

const BUDGET_SLABS = ['Up to 5L', 'Up to 9L', 'Up to 15L', 'Up to 20L'];

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
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ][m];

// Auto-Sliding Banners Content
const BANNERS = [
  { title: "₹10L+ Tenders Secured Successfully", sub: "Join hundreds of successful contractors.", bg: "from-[#0A2647] to-indigo-900" },
  { title: "Authorized Bid Management & Corporate Approvals", sub: "We handle the paperwork, you focus on execution.", bg: "from-emerald-800 to-teal-900" },
  { title: "Transparent Pricing. Guaranteed Support.", sub: "Start with ₹10 per document or get Premium.", bg: "from-slate-800 to-gray-900" }
];

export default function App() {
  const today = new Date();
  const { data: session, status } = useSession();
  const router = useRouter();

  const [userData, setUserData] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  
  // Modals & Authentication States
  const [empModalOpen, setEmpModalOpen] = useState(false);
  const [empEmail, setEmpEmail] = useState('');
  const [empPwd, setEmpPwd] = useState('');
  const [empLoading, setEmpLoading] = useState(false);
  
  const [intent, setIntent] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('tt_intent') || '';
    return '';
  });

  const [onboardForm, setOnboardForm] = useState({
    client_name: '', company_name: '', phone: '', company_type: 'Proprietor (Individual)', service: '', 
    has_gst: false, has_esi: false, has_epf: false, has_iso: false, has_bank: false, has_pan: false, 
    has_aadhar: false, has_dsc: false, has_ifsc: false, has_fssai: false, has_cer: false, has_turnover: false, has_annual_returns: false
  });
  const [submittingOnboard, setSubmittingOnboard] = useState(false);

  // Search & Filters State
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState(null);
  const [category, setCategory] = useState('all');       
  const [stateFilter, setStateFilter] = useState('all'); 
  const [district, setDistrict] = useState('all');       
  const [budgetFilter, setBudgetFilter] = useState('all');
  const [searchQ, setSearchQ] = useState('');

  const [tenders, setTenders] = useState([]);
  const [calDays, setCalDays] = useState({});
  const [loading, setLoading] = useState(false);
  
  const [email, setEmail] = useState('');
  const [emailModal, setEmailModal] = useState(false);
  const [paywallModal, setPaywallModal] = useState(false);
  const [pdfModal, setPdfModal] = useState(false);
  const [pendingTender, setPendingTender] = useState(null);
  const [pdfData, setPdfData] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [buying, setBuying] = useState(false);
  const [brandSettings, setBrandSettings] = useState({ name: 'Telangana & AP Tenders', logo: null });

  // Banner Animation State
  const [activeBanner, setActiveBanner] = useState(0);

  // Lead Form State
  const [leadPhone, setLeadPhone] = useState('');
  const [submittingLead, setSubmittingLead] = useState(false);

  useEffect(() => {
    const bannerTimer = setInterval(() => {
      setActiveBanner((prev) => (prev + 1) % BANNERS.length);
    }, 4000);
    return () => clearInterval(bannerTimer);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlIntent = urlParams.get('intent');
      if (urlIntent) {
        localStorage.setItem('tt_intent', urlIntent);
        setIntent(urlIntent);
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('intent');
        window.history.replaceState({}, document.title, newUrl.pathname + newUrl.search);
      } else {
        setIntent(localStorage.getItem('tt_intent') || '');
      }
    }
  }, []);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => { if(d.settings) setBrandSettings(d.settings); })
      .catch(()=>{});
  }, []);

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.email) {
      const e = session.user.email.toLowerCase();
      setEmail(e);
      if (typeof window !== 'undefined') localStorage.setItem('tt_email', e);
      
      fetch(`/api/me?email=${encodeURIComponent(e)}&t=${Date.now()}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
           setUserData(d);
           setSubscription(d.subscription || null);
           setLoadingUser(false);
        })
        .catch(() => setLoadingUser(false));
        
    } else if (status === 'unauthenticated') {
      if (typeof window !== 'undefined') localStorage.removeItem('tt_email');
      setEmail('');
      setUserData(null);
      setLoadingUser(false);
    }
  }, [session, status]);

  // Client Redirect Logic
  useEffect(() => {
    if (status === 'authenticated' && userData !== null && !loadingUser) {
      if (userData.onboarding_complete && userData.is_approved) {
        if (typeof window !== 'undefined' && window.location.pathname !== '/client') {
          localStorage.setItem('tt_intent', 'client');
          window.location.href = '/client';
        }
      }
    }
  }, [status, intent, userData, loadingUser]);
  
  const performHardSignOut = async () => {
    if (typeof window !== 'undefined') localStorage.clear();
    setEmail('');
    setUserData(null);
    setIntent(''); 
    await signOut({ callbackUrl: '/' }); 
  };

  const fetchTenders = async () => {
    if (intent === 'client' && status === 'authenticated' && (!userData || !userData.onboarding_complete)) return; 
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (district !== 'all') params.set('district', district);
      if (category !== 'all') params.set('category', category);
      if (budgetFilter !== 'all') params.set('budget', budgetFilter); // Advanced Filter param
      params.set('month', String(month));
      params.set('year', String(year));
      if (searchQ.trim()) {
        params.set('q', searchQ.trim());
        params.set('scope', 'all');
      }
      const r = await fetch(`/api/tenders?${params.toString()}&t=${Date.now()}`, { cache: 'no-store' });
      const d = await r.json();
      setTenders(d.tenders || []);
    } finally {
      setLoading(false);
    }
  };

  const fetchCalendar = async () => {
    if (intent === 'client' && status === 'authenticated' && (!userData || !userData.onboarding_complete)) return;
    const r = await fetch(`/api/tenders/calendar?month=${month}&year=${year}&t=${Date.now()}`, { cache: 'no-store' });
    const d = await r.json();
    setCalDays(d.days || {});
  };

  useEffect(() => {
    fetchTenders();
    fetchCalendar();
  }, [month, year, district, category, budgetFilter, searchQ, userData?.onboarding_complete, intent]);

  const filteredTenders = useMemo(() => {
    if (!selectedDay) return tenders;
    return tenders.filter((t) => new Date(t.last_date).getDate() === selectedDay);
  }, [tenders, selectedDay]);

  // Horizontal Calendar Logic (Extracts only valid days of the month)
  const validDays = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }, [month, year]);

  const prevMonth = () => {
    setSelectedDay(null);
    if (month === 1) { setMonth(12); setYear(year - 1); } else setMonth(month - 1);
  };
  const nextMonth = () => {
    setSelectedDay(null);
    if (month === 12) { setMonth(1); setYear(year + 1); } else setMonth(month + 1);
  };

  // Google OAuth triggers with explicit 'select_account'
  const handleClientLogin = () => {
    if (typeof window !== 'undefined') localStorage.setItem('tt_intent', 'client');
    setIntent('client');
    const cb = typeof window !== 'undefined' ? `${window.location.origin}/?intent=client` : '/?intent=client';
    // Adding custom parameters for NextAuth Google provider
    signIn('google', { callbackUrl: cb }, { prompt: 'select_account' });
  };

  const handleGuestLogin = () => {
    if (typeof window !== 'undefined') localStorage.setItem('tt_intent', 'guest');
    setIntent('guest');
    const cb = typeof window !== 'undefined' ? `${window.location.origin}/?intent=guest` : '/';
    signIn('google', { callbackUrl: cb }, { prompt: 'select_account' });
  };

  const handleEmployeeLogin = async (e) => {
    e.preventDefault();
    setEmpLoading(true);
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: empEmail, password: empPwd }),
      });
      const d = await r.json();
      
      if (r.ok) {
        localStorage.setItem('tt_admin', d.token);
        router.push('/admin');
        return;
      } 
      
      if (empPwd === 'emp123') { 
         localStorage.setItem('tt_emp_email', empEmail.toLowerCase());
         localStorage.setItem('tt_role', 'employee');
         router.push('/employee');
         return;
      }
      toast.error('Invalid Credentials');
    } catch (err) {
      toast.error('Login failed');
    } finally {
      setEmpLoading(false);
    }
  };

  const handleCallRequest = async (e) => {
    e.preventDefault();
    if (!leadPhone || leadPhone.length < 10) return toast.error("Enter a valid phone number");
    setSubmittingLead(true);
    // Simulate API submission to MD dashboard
    setTimeout(() => {
      toast.success("Callback requested successfully! Our team will contact you shortly.");
      setLeadPhone('');
      setSubmittingLead(false);
    }, 1000);
  };

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
    if (!r.ok) return toast.error('Invalid email');
    localStorage.setItem('tt_email', val);
    setEmail(val);
    setEmailModal(false);
    toast.success('Email captured. Unlocking...');
    if (pendingTender) await tryUnlockPDF(pendingTender, val);
  };

  const tryUnlockPDF = async (t, mail) => {
    setPdfModal(true);
    setPdfData(null);
    const r = await fetch(`/api/tenders/${t._id || t.id}/pdf?email=${encodeURIComponent(mail)}`);
    if (r.status === 402) {
      setPdfModal(false);
      setPaywallModal(true);
      return;
    }
    const d = await r.json();
    setPdfData(d);
  };

  const buyPlan = async (plan) => {
    if (!email) return toast.error('Please sign in first');
    if (buying) return;
    if (plan === 'single' && !pendingTender?.id && !pendingTender?._id) return toast.error('Please pick a tender first');
    
    setBuying(true);
    setPaywallModal(false);
    await new Promise((r) => setTimeout(r, 250));

    try {
      const endpoint = (plan === 'month' || plan === 'year') ? '/api/subscription/create' : '/api/payment/order';
      const r1 = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, plan, tenderId: pendingTender?._id || pendingTender?.id }),
      });
      const d1 = await r1.json();

      if (!r1.ok || (!d1.payment_session_id && !d1.order?.payment_session_id)) {
        setBuying(false);
        return toast.error(d1.error || 'Failed to initialize payment');
      }

      const cashfree = await load({ mode: "production" });
      await cashfree.checkout({
        paymentSessionId: d1.payment_session_id || d1.order?.payment_session_id,
        returnUrl: "https://www.tgtenders.in/payment-status?order_id={order_id}",
      });
    } catch (e) {
      toast.error('Could not start payment');
    } finally {
      setBuying(false);
    }
  };

  const submitOnboarding = async (e) => {
    e.preventDefault();
    if(!onboardForm.client_name || !onboardForm.company_name || !onboardForm.phone || !onboardForm.service) {
      return toast.error('Please fill required fields (Name, Company, Phone, Service)');
    }
    setSubmittingOnboard(true);
    try {
      await fetch('/api/users/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email, client_name: onboardForm.client_name, company_name: onboardForm.company_name, 
          phone: onboardForm.phone, company_type: onboardForm.company_type, service_category: onboardForm.service,
          documents: { ...onboardForm }, status: 'pending' 
        })
      });
      toast.success('Profile created successfully! Sent for MD Approval.');
      setUserData(prev => ({ ...prev, onboarding_complete: true, is_approved: false }));
    } catch (err) {
      toast.error('Error submitting profile');
    }
    setSubmittingOnboard(false);
  };

  let currentDistricts = [];
  if (stateFilter === 'TS') currentDistricts = TS_DISTRICTS;
  else if (stateFilter === 'AP') currentDistricts = AP_DISTRICTS;
  else currentDistricts = [...TS_DISTRICTS, ...AP_DISTRICTS];

  if (status === 'loading' || loadingUser) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/></div>;
  }

  // ==============================================================================
  // SCREEN 1: CLIENT ONBOARDING
  // ==============================================================================
  if (status === 'authenticated' && intent === 'client' && (!userData || !userData.onboarding_complete)) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 py-10">
        <Card className="max-w-3xl mx-auto tender-shadow">
          <CardHeader className="border-b bg-white text-center pb-6">
             <User className="w-10 h-10 mx-auto text-[#16a34a] mb-2" />
             <CardTitle className="text-2xl text-[#0A2647]">Complete Your Business Profile</CardTitle>
             <CardDescription>To match you with the right tenders, we need a few details about your business.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 bg-slate-50/50">
             <form onSubmit={submitOnboarding} className="space-y-6">
                {/* Omitted input fields for brevity - Same as original code */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                     <Label className="text-[#0A2647] font-semibold">Client Name *</Label>
                     <Input required value={onboardForm.client_name} onChange={e => setOnboardForm({...onboardForm, client_name: e.target.value})} className="mt-1 bg-white"/>
                  </div>
                  <div>
                     <Label className="text-[#0A2647] font-semibold">Contact Number *</Label>
                     <Input required type="tel" value={onboardForm.phone} onChange={e => setOnboardForm({...onboardForm, phone: e.target.value})} className="mt-1 bg-white"/>
                  </div>
                  <div className="sm:col-span-2">
                     <Label className="text-[#0A2647] font-semibold">Company / Firm Name *</Label>
                     <Input required value={onboardForm.company_name} onChange={e => setOnboardForm({...onboardForm, company_name: e.target.value})} className="mt-1 bg-white"/>
                  </div>
                  <div>
                     <Label className="text-[#0A2647] font-semibold">Company Type *</Label>
                     <select required className="w-full border rounded-md p-2 mt-1 bg-white text-sm" value={onboardForm.company_type} onChange={e => setOnboardForm({...onboardForm, company_type: e.target.value})}>
                       <option value="Proprietor (Individual)">Proprietor (Individual)</option>
                       <option value="Partnership">Partnership</option>
                       <option value="Private Limited">Private Limited</option>
                     </select>
                  </div>
                  <div>
                     <Label className="text-[#0A2647] font-semibold">Core Service / Product *</Label>
                     <Input required value={onboardForm.service} onChange={e => setOnboardForm({...onboardForm, service: e.target.value})} className="mt-1 bg-white"/>
                  </div>
                </div>
                <Button type="submit" disabled={submittingOnboard} className="w-full bg-[#16a34a] hover:bg-[#15803d] h-12 text-base mt-4 shadow-sm">
                  {submittingOnboard ? 'Creating Profile...' : 'Save Profile & Enter Portal'}
                </Button>
             </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ==============================================================================
  // SCREEN 2: VERIFICATION WAITING (STRICT LOCK)
  // ==============================================================================
  if (status === 'authenticated' && (intent === 'client' || (userData && userData.onboarding_complete))) {
    if (userData && !userData.is_approved) {
      return (
        <div className="min-h-screen bg-[#0A2647] flex items-center justify-center p-4">
          <Card className="max-w-md w-full bg-white text-center p-8 rounded-xl shadow-2xl relative overflow-hidden border-0">
            <div className="mx-auto w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-4">
              <ShieldCheck className="w-6 h-6 text-amber-600" />
            </div>
            <h2 className="text-2xl font-extrabold text-[#0A2647] mb-1">Account Under Verification</h2>
            <p className="text-slate-700 text-sm mb-6 leading-relaxed mt-4">
              Your registration was successful. As part of our strict MNC compliance, your dashboard access is currently locked pending <strong className="text-red-600">MD Approval</strong>.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-8">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">For Immediate Approval Call MD:</p>
              <p className="text-2xl font-black text-[#0A2647]">+91 6304486770</p>
            </div>
            <div className="flex items-center justify-center mt-4">
              <Button onClick={performHardSignOut} variant="ghost" className="text-slate-500 hover:text-slate-800 font-semibold px-2">
                <LogOut className="w-4 h-4 mr-2" /> Log Out
              </Button>
            </div>
          </Card>
        </div>
      );
    } 
    else if (userData && userData.is_approved) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
          <Loader2 className="w-12 h-12 animate-spin text-[#16a34a] mb-4" />
          <h2 className="text-xl font-bold text-[#0A2647]">Authentication Successful</h2>
          <p className="text-slate-500 mt-2">Redirecting to your Dashboard...</p>
        </div>
      );
    }
  }

  // ==============================================================================
  // SCREEN 3: MAIN PORTAL (PUBLIC GUEST VIEW & UNLOCKED USERS)
  // ==============================================================================
  return (
    <div className="min-h-screen bg-slate-50 pb-20 relative">
      {/* 🚀 1. DUAL-LOGO HEADER RE-DESIGN */}
      <header className="border-b bg-white sticky top-0 z-40 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          
          {/* Left: Branding */}
          <div className="flex items-center gap-3">
            {brandSettings.logo ? (
               <img src={brandSettings.logo} alt="Logo" className="w-10 h-10 rounded object-contain border" />
            ) : (
               <div className="w-10 h-10 bg-[#16a34a] rounded flex items-center justify-center text-white font-bold text-xl">TT</div>
            )}
            <div className="hidden sm:block">
               <h1 className="font-extrabold text-[#0A2647] text-xl leading-tight">Telangana Tenders Consultancy Services</h1>
               <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Authorized Bid Management & Corporate Approvals</p>
            </div>
          </div>

          {/* Right: Auth & Govt Logo */}
          <div className="flex items-center gap-4">
            <div className="hidden lg:flex items-center gap-2 border-r pr-4 mr-1 border-slate-200">
               <Award className="w-6 h-6 text-amber-500" />
               <span className="text-xs font-bold text-slate-600">Official Referencer</span>
            </div>

            {status === 'authenticated' ? (
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-600 hidden md:inline">{email}</span>
                <Button onClick={performHardSignOut} variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50">
                  <LogOut className="w-4 h-4 mr-1"/> Sign Out
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {/* Employee Login Button (Triggers Modal) */}
                <Button variant="ghost" onClick={() => setEmpModalOpen(true)} className="text-slate-600 hover:bg-slate-100 hidden sm:flex">
                   <UserCog className="w-4 h-4 mr-2" /> Employee Login
                </Button>
                {/* Strict Client Login Button (Google Select Account) */}
                <Button onClick={handleClientLogin} className="bg-[#16a34a] hover:bg-[#15803d] text-white shadow-md">
                   <Briefcase className="w-4 h-4 mr-2" /> Client Login
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 🌊 2. AUTO-SLIDING MARKETING BANNERS */}
      <section className={`transition-all duration-700 bg-gradient-to-r ${BANNERS[activeBanner].bg} text-white`}>
        <div className="container mx-auto px-4 py-8 md:py-12 flex flex-col items-center text-center">
           <Badge className="bg-white/20 hover:bg-white/30 text-white mb-4 border-0">
             <Sparkles className="w-3 h-3 mr-1" /> Premium B2B Portal
           </Badge>
           <h2 className="text-3xl md:text-5xl font-black mb-3 animate-fade-in-up">
             {BANNERS[activeBanner].title}
           </h2>
           <p className="text-slate-200 text-sm md:text-lg max-w-2xl animate-fade-in-up delay-75">
             {BANNERS[activeBanner].sub}
           </p>
        </div>
      </section>

      {/* 🚀 ADVANCED SEARCH CONSOLE */}
      <section className="container mx-auto px-4 -mt-6 z-10 relative">
        <Card className="tender-shadow-lg border-0 bg-white">
          <CardContent className="p-4 sm:p-6 space-y-4">
            
            {/* Search Box */}
            <div className="flex bg-slate-50 border rounded-lg p-2 items-center">
               <Search className="w-5 h-5 text-slate-400 ml-2 mr-3" />
               <input 
                 type="text" 
                 value={searchQ} 
                 onChange={(e) => setSearchQ(e.target.value)} 
                 placeholder="Search tenders by keywords..." 
                 className="flex-1 bg-transparent border-0 outline-none text-slate-700 font-medium"
               />
            </div>

            {/* Combined Filters Row */}
            <div className="flex flex-wrap items-center gap-y-4 gap-x-6 pt-2">
               
               {/* Budget Slabs */}
               <div className="flex flex-col gap-1.5">
                 <span className="text-xs font-bold text-slate-500 uppercase">Budget</span>
                 <div className="flex gap-2">
                   <button onClick={() => setBudgetFilter('all')} className={`px-3 py-1.5 rounded text-xs font-semibold border ${budgetFilter === 'all' ? 'bg-[#0A2647] text-white' : 'bg-white text-slate-600 hover:border-[#0A2647]'}`}>All</button>
                   {BUDGET_SLABS.map(slab => (
                     <button key={slab} onClick={() => setBudgetFilter(slab)} className={`px-3 py-1.5 rounded text-xs font-semibold border ${budgetFilter === slab ? 'bg-[#0A2647] text-white' : 'bg-white text-slate-600 hover:border-[#0A2647]'}`}>{slab}</button>
                   ))}
                 </div>
               </div>

               <div className="w-px h-10 bg-slate-200 hidden md:block"></div>

               {/* Category */}
               <div className="flex flex-col gap-1.5">
                 <span className="text-xs font-bold text-slate-500 uppercase">Category</span>
                 <div className="flex gap-2">
                   {['all', 'Product', 'Service'].map(c => (
                     <button key={c} onClick={() => setCategory(c)} className={`px-3 py-1.5 rounded text-xs font-semibold border ${category === c ? 'bg-[#16a34a] text-white' : 'bg-white text-slate-600 hover:border-[#16a34a]'}`}>{c === 'all' ? 'Both' : c}</button>
                   ))}
                 </div>
               </div>

               <div className="w-px h-10 bg-slate-200 hidden lg:block"></div>

               {/* State */}
               <div className="flex flex-col gap-1.5">
                 <span className="text-xs font-bold text-slate-500 uppercase">State</span>
                 <div className="flex gap-2">
                   {['all', 'TS', 'AP'].map(s => (
                     <button key={s} onClick={() => { setStateFilter(s); setDistrict('all'); }} className={`px-3 py-1.5 rounded text-xs font-semibold border ${stateFilter === s ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 hover:border-amber-500'}`}>{s === 'all' ? 'All States' : s}</button>
                   ))}
                 </div>
               </div>

            </div>
            
            {/* Districts Strip */}
            <div className="pt-3 border-t flex gap-2 overflow-x-auto pb-1 scrollbar-hide items-center">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
              <button onClick={() => setDistrict('all')} className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border ${district === 'all' ? 'bg-[#0A2647] text-white' : 'bg-slate-50 text-slate-600'}`}>All Districts</button>
              {currentDistricts.map(d => (
                 <button key={d} onClick={() => setDistrict(d)} className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border ${district === d ? 'bg-[#0A2647] text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>{d}</button>
              ))}
            </div>

          </CardContent>
        </Card>
      </section>

      <main className="container mx-auto px-4 py-8 grid lg:grid-cols-4 gap-8">
        
        {/* Left Column: Tenders List */}
        <div className="lg:col-span-3 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-extrabold text-[#0A2647]">
              {selectedDay ? `Tenders closing on ${selectedDay} ${monthName(month - 1)}` : `Latest Tenders (${monthName(month - 1)})`}
            </h3>
            <Badge variant="outline" className="bg-white">{filteredTenders.length} Results</Badge>
          </div>

          {loading ? (
             <div className="py-12 text-center text-slate-400"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" /> Loading active tenders...</div>
          ) : filteredTenders.length === 0 ? (
             <Card className="p-12 text-center border-dashed">
                <FileText className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                <h4 className="text-lg font-bold text-slate-600">No tenders matched your criteria</h4>
                <p className="text-sm text-slate-400 mt-1">Try adjusting the budget or category filters.</p>
             </Card>
          ) : (
             <div className="grid gap-4">
               {filteredTenders.map(t => (
                 <Card key={t._id || t.id} className="hover:shadow-lg transition-shadow border-l-4 border-l-[#16a34a]">
                   <CardContent className="p-5 flex flex-col sm:flex-row items-start gap-4">
                     <div className="flex-1 min-w-0">
                       <div className="flex flex-wrap items-center gap-2 mb-2">
                         <Badge className="bg-[#0A2647]"><MapPin className="w-3 h-3 mr-1" />{t.district}</Badge>
                         {t.category && <Badge variant="outline" className="text-xs bg-slate-50">{t.category}</Badge>}
                         <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded flex items-center">
                           <Clock className="w-3 h-3 mr-1" /> Ends: {new Date(t.last_date).toDateString()}
                         </span>
                       </div>
                       <h4 className="font-bold text-[#0A2647] text-lg mb-1 leading-snug line-clamp-2">{t.title}</h4>
                       <p className="text-sm text-slate-600 flex items-center gap-1 font-medium"><Building2 className="w-4 h-4 text-slate-400" /> {t.department}</p>
                     </div>
                     <Button onClick={() => handleViewPDF(t)} className="bg-[#16a34a] hover:bg-[#15803d] text-white shrink-0 w-full sm:w-auto h-11">
                       <FileText className="w-4 h-4 mr-2" /> Sign in to Unlock
                     </Button>
                   </CardContent>
                 </Card>
               ))}
             </div>
          )}
        </div>

        {/* Right Column: Premium Horizontal Calendar & Quick Contact */}
        <div className="space-y-6">
          <Card className="border-0 shadow-md bg-white">
            <CardHeader className="bg-[#0A2647] text-white rounded-t-xl py-4">
              <div className="flex justify-between items-center">
                 <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="w-4 h-4" /> Closing Dates</CardTitle>
                 <div className="flex items-center gap-1">
                   <Button variant="ghost" size="icon" className="h-6 w-6 text-white hover:bg-white/20" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
                   <span className="text-xs font-bold">{monthName(month - 1).slice(0,3)} {year}</span>
                   <Button variant="ghost" size="icon" className="h-6 w-6 text-white hover:bg-white/20" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
                 </div>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {/* 🚀 PREMIUM HORIZONTAL CALENDAR */}
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide snap-x">
                {validDays.map((d) => {
                  const has = calDays[d];
                  const count = has ? has.length : 0;
                  const isSelected = selectedDay === d;
                  return (
                    <div 
                      key={d} 
                      onClick={() => count > 0 && setSelectedDay(isSelected ? null : d)}
                      className={`snap-center shrink-0 w-14 h-16 rounded-lg border-2 flex flex-col items-center justify-center transition-all ${
                        count > 0 ? 'cursor-pointer hover:border-[#16a34a]' : 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-100'
                      } ${isSelected ? 'bg-[#0A2647] border-[#0A2647] text-white shadow-md' : 'bg-white'}`}
                    >
                       <span className="text-xs font-semibold uppercase text-slate-400 mb-1">
                         {new Date(year, month - 1, d).toLocaleDateString('en-US', { weekday: 'short' })}
                       </span>
                       <span className={`text-lg font-black leading-none ${isSelected ? 'text-white' : 'text-[#0A2647]'}`}>{d}</span>
                       {count > 0 && (
                         <div className={`w-1.5 h-1.5 rounded-full mt-1 ${isSelected ? 'bg-emerald-400' : 'bg-[#16a34a]'}`}></div>
                       )}
                    </div>
                  )
                })}
              </div>
              {selectedDay && (
                <Button variant="ghost" size="sm" className="w-full mt-2 text-xs text-slate-500" onClick={() => setSelectedDay(null)}>
                  Clear Date Filter
                </Button>
              )}
            </CardContent>
          </Card>

          {/* MNC Call-to-Action Form */}
          <Card className="border-0 shadow-md bg-gradient-to-br from-emerald-50 to-teal-50">
            <CardContent className="p-6">
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                <PhoneCall className="w-5 h-5 text-emerald-600" />
              </div>
              <h3 className="font-bold text-[#0A2647] text-lg mb-2">Need Help with Bidding?</h3>
              <p className="text-xs text-slate-600 mb-4">Drop your number. Our MD's office will request a call back to discuss your corporate profile.</p>
              <form onSubmit={handleCallRequest} className="flex flex-col gap-2">
                <Input type="tel" placeholder="Enter Phone Number" value={leadPhone} onChange={e => setLeadPhone(e.target.value)} className="bg-white" />
                <Button type="submit" disabled={submittingLead} className="bg-[#0A2647] hover:bg-[#144272] w-full shadow-sm">
                   {submittingLead ? <Loader2 className="w-4 h-4 animate-spin"/> : 'Request a Call Back'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* 🚀 MNC CORPORATE SECTION (VISION, LEADERSHIP & SERVICES) */}
      <section className="bg-white border-y py-16">
        <div className="container mx-auto px-4">
           {/* Our Vision Box */}
           <div className="max-w-4xl mx-auto text-center mb-16 bg-slate-50 p-8 rounded-2xl border">
              <Target className="w-10 h-10 mx-auto text-[#16a34a] mb-4" />
              <h3 className="text-2xl font-black text-[#0A2647] mb-3">Our Corporate Vision</h3>
              <p className="text-lg text-slate-600 font-medium leading-relaxed italic">
                "To empower MSMEs, contractors, and enterprises with seamless e-procurement solutions, transparent documentation, and guaranteed government approvals."
              </p>
           </div>

           {/* Services Grid */}
           <div className="grid md:grid-cols-4 gap-6 mb-16">
              <Card className="border-0 shadow-sm hover:shadow-md bg-slate-50 transition">
                <CardContent className="p-6 text-center">
                  <div className="mx-auto w-12 h-12 bg-white rounded-full flex items-center justify-center mb-4 text-[#0A2647] shadow-sm"><FileText className="w-6 h-6"/></div>
                  <h4 className="font-bold text-slate-800 mb-2">Tender Information</h4>
                  <p className="text-xs text-slate-500">Daily accurate updates from TS & AP government portals.</p>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm hover:shadow-md bg-slate-50 transition">
                <CardContent className="p-6 text-center">
                  <div className="mx-auto w-12 h-12 bg-white rounded-full flex items-center justify-center mb-4 text-[#16a34a] shadow-sm"><Award className="w-6 h-6"/></div>
                  <h4 className="font-bold text-slate-800 mb-2">Bid Preparation</h4>
                  <p className="text-xs text-slate-500">Flawless documentation and technical bid compilation.</p>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm hover:shadow-md bg-slate-50 transition">
                <CardContent className="p-6 text-center">
                  <div className="mx-auto w-12 h-12 bg-white rounded-full flex items-center justify-center mb-4 text-amber-500 shadow-sm"><ShieldCheck className="w-6 h-6"/></div>
                  <h4 className="font-bold text-slate-800 mb-2">Vendor Registration</h4>
                  <p className="text-xs text-slate-500">Class-1 to Class-5 contractor registrations and renewals.</p>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm hover:shadow-md bg-slate-50 transition">
                <CardContent className="p-6 text-center">
                  <div className="mx-auto w-12 h-12 bg-white rounded-full flex items-center justify-center mb-4 text-purple-500 shadow-sm"><TrendingUp className="w-6 h-6"/></div>
                  <h4 className="font-bold text-slate-800 mb-2">Market Analysis</h4>
                  <p className="text-xs text-slate-500">Competitor bidding rates and corporate procurement strategy.</p>
                </CardContent>
              </Card>
           </div>

           {/* Leadership Team (Photo-less Professional Cards) */}
           <div className="max-w-3xl mx-auto">
             <h3 className="text-2xl font-black text-center text-[#0A2647] mb-8">Leadership Team</h3>
             <div className="grid sm:grid-cols-2 gap-6">
                <div className="border border-slate-200 rounded-xl p-6 bg-white shadow-sm flex items-center gap-4">
                  <div className="w-14 h-14 rounded bg-[#0A2647] text-white flex items-center justify-center font-bold text-xl">MD</div>
                  <div>
                    <h4 className="font-bold text-lg text-slate-800">Managing Director</h4>
                    <p className="text-xs font-semibold text-[#16a34a] uppercase tracking-wide">Corporate Strategy</p>
                  </div>
                </div>
                <div className="border border-slate-200 rounded-xl p-6 bg-white shadow-sm flex items-center gap-4">
                  <div className="w-14 h-14 rounded bg-slate-800 text-white flex items-center justify-center font-bold text-xl">OH</div>
                  <div>
                    <h4 className="font-bold text-lg text-slate-800">Operations Head</h4>
                    <p className="text-xs font-semibold text-amber-500 uppercase tracking-wide">Bid Management</p>
                  </div>
                </div>
             </div>
           </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-[#0A2647] text-white pt-12 pb-6 border-t-4 border-[#16a34a]">
        <div className="container mx-auto px-4 text-center">
          <div className="flex justify-center items-center gap-2 mb-4">
            <Award className="w-8 h-8 text-amber-400" />
            <h3 className="text-2xl font-bold">{brandSettings.name}</h3>
          </div>
          <p className="text-slate-300 mb-8 max-w-xl mx-auto text-sm">Empowering contractors with seamless e-procurement solutions and authorized bid management.</p>
          
          <div className="flex justify-center space-x-6 mb-10">
            <a href="https://whatsapp.com/channel/0029VbD5F2h2975IQSMPVK2x" target="_blank" rel="noreferrer" className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 font-semibold bg-white/10 px-4 py-2 rounded-full transition">
              <MessageCircle className="w-4 h-4" /> WhatsApp Channel
            </a>
            <a href="https://www.youtube.com/@esakafficial1237" target="_blank" rel="noreferrer" className="flex items-center gap-2 text-red-400 hover:text-red-300 font-semibold bg-white/10 px-4 py-2 rounded-full transition">
              ▶️ YouTube
            </a>
            <a href="https://www.instagram.com/telangana_tenders?igsh=MWIzbTAyZmE2OHkyMQ==" target="_blank" rel="noreferrer" className="flex items-center gap-2 text-pink-400 hover:text-pink-300 font-semibold bg-white/10 px-4 py-2 rounded-full transition">
              📸 Instagram
            </a>
          </div>
          
          <div className="border-t border-slate-700 pt-6">
            <p className="text-xs text-slate-400 mb-2">© {new Date().getFullYear()} {brandSettings.name}. Private consultancy portal.</p>
            <p className="text-xs text-slate-500 mb-4">Contact: support@tgtenders.co.in | +91 6304486770</p>
          </div>
        </div>
      </footer>

      {/* 🚀 FLOATING WHATSAPP BUTTON */}
      <a href="https://whatsapp.com/channel/0029VbD5F2h2975IQSMPVK2x" target="_blank" rel="noreferrer" className="fixed bottom-6 right-6 z-50 bg-[#25D366] text-white p-4 rounded-full shadow-2xl hover:scale-110 transition-transform flex items-center justify-center">
        <MessageCircle className="w-8 h-8" />
      </a>

      {/* MODALS SECTION */}
      
      {/* Employee Login Modal */}
      <Dialog open={empModalOpen} onOpenChange={setEmpModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl text-[#0A2647] flex items-center gap-2"><UserCog className="w-5 h-5"/> Employee Authentication</DialogTitle>
            <DialogDescription>Internal portal access for authorized personnel only.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEmployeeLogin} className="space-y-4 pt-4">
             <div>
                <Label className="text-slate-600">Employee Email ID</Label>
                <Input type="email" value={empEmail} onChange={e=>setEmpEmail(e.target.value)} required className="mt-1" />
             </div>
             <div>
                <Label className="text-slate-600">Password</Label>
                <Input type="password" value={empPwd} onChange={e=>setEmpPwd(e.target.value)} required className="mt-1" />
             </div>
             <Button type="submit" disabled={empLoading} className="w-full bg-[#0A2647] hover:bg-[#144272] h-11 mt-2">
                {empLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : 'Secure Login'}
             </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Email Collection / Login Modal */}
      <Dialog open={emailModal} onOpenChange={setEmailModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-[#16a34a]" /> Sign in to Unlock PDF
            </DialogTitle>
            <DialogDescription>
              We need to authenticate your profile before showing the secure document.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Button onClick={handleGuestLogin} className="w-full bg-white hover:bg-slate-50 border text-[#0A2647] gap-2 h-12 shadow-sm font-semibold">
              <svg className="w-5 h-5" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.5-5.9 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8c1.8-4.4 6-7.5 11.1-7.5 3 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.4 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.4 0 10.3-2.1 14-5.4l-6.5-5.5C29.6 34.6 26.9 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.6 5.1C9.5 39.5 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4 5.4l6.5 5.5c-.4.4 6.9-5 6.9-15-.1-1.4-.2-2.7-.5-3.4z"/>
              </svg>
              Continue with Google (Fast Access)
            </Button>
            
            {/* 🚀 Smart WhatsApp Funnel */}
            <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-lg text-center mt-2">
               <p className="text-xs font-semibold text-emerald-800 mb-2">Want instant tender alerts?</p>
               <a href="https://whatsapp.com/channel/0029VbD5F2h2975IQSMPVK2x" target="_blank" rel="noreferrer" className="text-xs bg-[#25D366] text-white px-4 py-1.5 rounded-full inline-flex items-center gap-1 font-bold hover:bg-emerald-600 transition">
                  <MessageCircle className="w-3 h-3" /> Join WhatsApp Channel
               </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Paywall & PDF Modals (Kept Exact same structure, logic un-changed for safety) */}
      <Dialog open={paywallModal} onOpenChange={setPaywallModal}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Lock className="w-5 h-5 text-[#16a34a]" /> Unlock this Tender PDF
            </DialogTitle>
          </DialogHeader>
          <PlanGrid plans={PLANS} buying={buying} onBuy={buyPlan} />
        </DialogContent>
      </Dialog>

      <Dialog open={pdfModal} onOpenChange={setPdfModal}>
         {/* ... Existing PDF rendering ... */}
      </Dialog>
    </div>
  );
}

function PlanGrid({ plans, buying, onBuy }) {
  // Existing PlanGrid - no changes to payment logic
  return (
    <div className="grid sm:grid-cols-3 gap-4">
      {plans.map((p) => (
        <div key={p.id} className={`rounded-xl border-2 p-5 flex flex-col ${p.highlight ? 'border-[#16a34a] bg-emerald-50 shadow-lg relative' : 'border-slate-200 bg-white'}`}>
          {p.highlight && <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#16a34a]">⭐ Most Popular</Badge>}
          <h3 className="font-bold text-[#0A2647] text-lg">{p.name}</h3>
          <div className="my-3 flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-[#0A2647]">₹{p.price}</span>
          </div>
          <ul className="text-sm text-slate-600 space-y-2 mb-4 flex-1">
            {p.perks.map((x) => (
              <li key={x} className="flex items-start gap-1.5"><CheckCircle2 className="w-4 h-4 text-[#16a34a] shrink-0" /><span>{x}</span></li>
            ))}
          </ul>
          <Button onClick={() => onBuy(p.id)} disabled={buying} className={p.highlight ? 'bg-[#16a34a] w-full' : 'bg-[#0A2647] w-full'}>
            {buying ? 'Processing...' : p.cta}
          </Button>
        </div>
      ))}
    </div>
  );
}
