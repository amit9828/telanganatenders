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
  LogOut
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

export default function App() {
  const today = new Date();
  const { data: session, status } = useSession();
  const router = useRouter();

  const [userData, setUserData] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [gatewayMode, setGatewayMode] = useState('select'); 
  const [empEmail, setEmpEmail] = useState('');
  const [empPwd, setEmpPwd] = useState('');
  const [empLoading, setEmpLoading] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  
  const [intent, setIntent] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('tt_intent') || '';
    return '';
  });

  const [onboardForm, setOnboardForm] = useState({
    client_name: '',
    company_name: '', 
    phone: '',
    company_type: 'Proprietor (Individual)', 
    service: '', 
    has_gst: false, 
    has_esi: false,
    has_epf: false,
    has_iso: false,
    has_bank: false,
    has_pan: false,
    has_aadhar: false,
    has_dsc: false,
    has_ifsc: false, 
    has_fssai: false,
    has_cer: false,
    has_turnover: false,
    has_annual_returns: false
  });
  const [submittingOnboard, setSubmittingOnboard] = useState(false);

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState(null);
  const [category, setCategory] = useState('all');       
  const [stateFilter, setStateFilter] = useState('all'); 
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
  const [brandSettings, setBrandSettings] = useState({ name: 'Telangana & AP Tenders', logo: null });

  // URL Intent Tracking (Guarantees data won't be lost after Google redirect)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlIntent = urlParams.get('intent');
      if (urlIntent) {
        localStorage.setItem('tt_intent', urlIntent);
        setIntent(urlIntent);
        // Clean up URL safely
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
      .then((d) => {
         if(d.settings) setBrandSettings(d.settings);
      })
      .catch(()=>{});
  }, []);

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.email) {
      const e = session.user.email.toLowerCase();
      setEmail(e);
      if (typeof window !== 'undefined') localStorage.setItem('tt_email', e);
      
      fetch(`/api/me?email=${encodeURIComponent(e)}&t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      })
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

  // Client Redirect Hook
  useEffect(() => {
    if (status === 'authenticated' && intent === 'client' && userData && userData.onboarding_complete) {
      router.push('/client');
    }
  }, [status, intent, userData, router]);

  const performHardSignOut = async () => {
    if (typeof window !== 'undefined') {
      localStorage.clear();
    }
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
    // eslint-disable-next-line
  }, [month, year, district, category, searchQ, userData?.onboarding_complete, isGuest, intent]);

  const filteredTenders = useMemo(() => {
    if (!selectedDay) return tenders;
    return tenders.filter((t) => new Date(t.last_date).getDate() === selectedDay);
  }, [tenders, selectedDay]);

  const calendarCells = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDow = first.getDay();
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
    setPdfModal(true);
    setPdfData(null);

    const r = await fetch(
      `/api/tenders/${t._id || t.id}/pdf?email=${encodeURIComponent(mail)}`
    );
    
    if (r.status === 402) {
      setPdfModal(false);
      setPaywallModal(true);
      return;
    }
    const d = await r.json();
    setPdfData(d);
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
    
    await new Promise((r) => setTimeout(r, 250));

    const isSubscription = plan === 'month' || plan === 'year';

    try {
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

      const cashfree = await load({ mode: "production" });
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

  const submitOnboarding = async (e) => {
    e.preventDefault();
    if(!onboardForm.client_name || !onboardForm.company_name || !onboardForm.phone || !onboardForm.service) {
      return toast.error('Please fill required fields (Name, Company, Phone, Service)');
    }
    setSubmittingOnboard(true);
    
    try {
      const r = await fetch('/api/users/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email, 
          client_name: onboardForm.client_name,
          company_name: onboardForm.company_name,
          phone: onboardForm.phone,
          company_type: onboardForm.company_type,
          service_category: onboardForm.service,
          documents: {
            has_gst: onboardForm.has_gst,
            has_esi: onboardForm.has_esi,
            has_epf: onboardForm.has_epf,
            has_iso: onboardForm.has_iso,
            has_bank: onboardForm.has_bank,
            has_pan: onboardForm.has_pan,
            has_aadhar: onboardForm.has_aadhar,
            has_dsc: onboardForm.has_dsc,
            has_ifsc: onboardForm.has_ifsc,
            has_fssai: onboardForm.has_fssai,
            has_cer: onboardForm.has_cer,
            has_turnover: onboardForm.has_turnover,
            has_annual_returns: onboardForm.has_annual_returns
          },
          status: 'approved' 
        })
      });
      
      toast.success('Profile created successfully! Loading your dashboard...');
      
      setUserData(prev => ({ 
        ...prev, 
        onboarding_complete: true, 
        is_approved: true 
      }));
      
      router.push('/client');

    } catch (err) {
      toast.error('Error submitting profile');
    }
    setSubmittingOnboard(false);
  };

  const handleEmployeeLogin = async (e) => {
    e.preventDefault();
    setEmpLoading(true);
    toast.info('Verifying credentials...');
    
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: empEmail, password: empPwd }),
      });
      const d = await r.json();
      
      if (r.ok) {
        localStorage.setItem('tt_admin', d.token);
        toast.success('Admin verified. Redirecting...');
        router.push('/admin');
        return;
      } 
      
      if (empPwd === 'emp123') { 
         localStorage.setItem('tt_emp_email', empEmail.toLowerCase());
         localStorage.setItem('tt_role', 'employee');
         toast.success('Employee verified. Redirecting...');
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

  useEffect(() => {
    if (email) {
      const urlParams = new URLSearchParams(window.location.search);
      const openId = urlParams.get('open_tender');
      if (openId) {
        tryUnlockPDF({ id: openId }, email);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, [email]);

  let currentDistricts = [];
  if (stateFilter === 'TS') currentDistricts = TS_DISTRICTS;
  else if (stateFilter === 'AP') currentDistricts = AP_DISTRICTS;
  else currentDistricts = [...TS_DISTRICTS, ...AP_DISTRICTS];

  if (status === 'loading' || loadingUser) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/></div>;
  }

  // ==============================================================================
  // SCREEN 1: GATEKEEPER (Forces Login for Everyone)
  // ==============================================================================
  if (status === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md tender-shadow-lg overflow-hidden border-0">
          <div className="bg-[#0A2647] p-8 text-center text-white relative flex flex-col items-center justify-center">
            {brandSettings.logo ? (
               // eslint-disable-next-line @next/next/no-img-element
               <img src={brandSettings.logo} alt="Logo" className="w-16 h-16 rounded-full object-contain mb-3 bg-white p-1 shadow-md" />
            ) : (
               <div className="w-12 h-12 bg-[#16a34a] rounded-full flex items-center justify-center text-white font-bold mb-3 shadow">TT</div>
            )}
            <h1 className="text-2xl font-bold">{brandSettings.name}</h1>
            <p className="text-sm text-slate-300 opacity-90 mt-1">Enterprise B2B Tender Portal</p>
          </div>
          <CardContent className="p-8 bg-white">
            {gatewayMode === 'select' ? (
              <div className="space-y-4">
                <h2 className="text-center font-semibold text-slate-700 mb-2">Select your Portal Access</h2>
                
                <Button onClick={() => { 
                  if (typeof window !== 'undefined') localStorage.setItem('tt_intent', 'client');
                  setIntent('client');
                  const cb = typeof window !== 'undefined' ? `${window.location.origin}/?intent=client` : '/?intent=client';
                  signIn('google', { callbackUrl: cb });
                }} className="w-full bg-[#16a34a] hover:bg-[#15803d] h-12 text-base shadow-md">
                  <Briefcase className="w-5 h-5 mr-2" /> Client / Contractor Portal
                </Button>

                <Button onClick={() => {
                  if (typeof window !== 'undefined') localStorage.setItem('tt_intent', 'guest');
                  setIntent('guest');
                  setIsGuest(true);
                  const cb = typeof window !== 'undefined' ? `${window.location.origin}/?intent=guest` : '/?intent=guest';
                  signIn('google', { callbackUrl: cb }); 
                }} className="w-full bg-[#16a34a] hover:bg-[#15803d] h-12 text-base shadow-md">
                  <Eye className="w-5 h-5 mr-2" /> Browse as Guest
                </Button>
                
                <div className="relative flex items-center py-2">
                  <div className="flex-grow border-t border-slate-200"></div>
                  <span className="flex-shrink-0 mx-4 text-slate-400 text-xs font-medium">Internal Access</span>
                  <div className="flex-grow border-t border-slate-200"></div>
                </div>
                
                <Button onClick={() => setGatewayMode('employee_login')} variant="outline" className="w-full h-12 text-[#0A2647] border-slate-300">
                  <UserCog className="w-5 h-5 mr-2" /> Employee Login
                </Button>

              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <Button variant="ghost" size="sm" onClick={() => setGatewayMode('select')} className="p-0 h-auto hover:bg-transparent text-slate-500"><ChevronLeft className="w-4 h-4"/> Back</Button>
                </div>
                <h2 className="font-bold text-[#0A2647] text-lg">Employee Authentication</h2>
                <form onSubmit={handleEmployeeLogin} className="space-y-4">
                  <div>
                    <Label className="text-slate-600">Employee ID (Email)</Label>
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
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ==============================================================================
  // SCREEN 2: CLIENT ONBOARDING (For Client intent that has not completed registration)
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
              
              <div className="grid sm:grid-cols-2 gap-4">
                 <div>
                    <Label className="text-[#0A2647] font-semibold">Client Name *</Label>
                    <Input required value={onboardForm.client_name} onChange={e => setOnboardForm({...onboardForm, client_name: e.target.value})} placeholder="e.g. John Doe" className="mt-1 bg-white"/>
                 </div>
                 <div>
                    <Label className="text-[#0A2647] font-semibold">Contact Number *</Label>
                    <Input required type="tel" value={onboardForm.phone} onChange={e => setOnboardForm({...onboardForm, phone: e.target.value})} placeholder="e.g. 9876543210" className="mt-1 bg-white"/>
                 </div>
                 <div className="sm:col-span-2">
                    <Label className="text-[#0A2647] font-semibold">Company / Firm Name *</Label>
                    <Input required value={onboardForm.company_name} onChange={e => setOnboardForm({...onboardForm, company_name: e.target.value})} placeholder="e.g. Balaji Enterprises" className="mt-1 bg-white"/>
                 </div>
                 <div>
                    <Label className="text-[#0A2647] font-semibold">Company Type *</Label>
                    <select required className="w-full border rounded-md p-2 mt-1 bg-white text-sm" value={onboardForm.company_type} onChange={e => setOnboardForm({...onboardForm, company_type: e.target.value})}>
                      <option value="Proprietor (Individual)">Proprietor (Individual)</option>
                      <option value="Partnership">Partnership</option>
                      <option value="Private Limited">Private Limited</option>
                      <option value="Public Limited">Public Limited</option>
                      <option value="LLP">LLP</option>
                    </select>
                 </div>
                 <div>
                    <Label className="text-[#0A2647] font-semibold">Core Service / Product *</Label>
                    <Input required value={onboardForm.service} onChange={e => setOnboardForm({...onboardForm, service: e.target.value})} placeholder="e.g. Civil Works, Computers" className="mt-1 bg-white"/>
                 </div>
              </div>

              <div className="border-t pt-5">
                <Label className="text-[#0A2647] font-semibold block mb-1">Do you have these basic documents?</Label>
                <p className="text-xs text-muted-foreground mb-4">Please tick the documents you currently hold to build your Vendor Master Profile.</p>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_pan} onChange={e => setOnboardForm({...onboardForm, has_pan: e.target.checked})} /> PAN Card
                  </label>
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_gst} onChange={e => setOnboardForm({...onboardForm, has_gst: e.target.checked})} /> GST Certificate
                  </label>
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_bank} onChange={e => setOnboardForm({...onboardForm, has_bank: e.target.checked})} /> Bank Account
                  </label>
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_ifsc} onChange={e => setOnboardForm({...onboardForm, has_ifsc: e.target.checked})} /> IFSC Details
                  </label>
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_aadhar} onChange={e => setOnboardForm({...onboardForm, has_aadhar: e.target.checked})} /> Aadhar
                  </label>
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_esi} onChange={e => setOnboardForm({...onboardForm, has_esi: e.target.checked})} /> ESI Registration
                  </label>
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_epf} onChange={e => setOnboardForm({...onboardForm, has_epf: e.target.checked})} /> EPF Registration
                  </label>
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_iso} onChange={e => setOnboardForm({...onboardForm, has_iso: e.target.checked})} /> ISO Certificate
                  </label>
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_msme} onChange={e => setOnboardForm({...onboardForm, has_msme: e.target.checked})} /> MSME (Udyam)
                  </label>
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_dsc} onChange={e => setOnboardForm({...onboardForm, has_dsc: e.target.checked})} /> DSC Class 3
                  </label>
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_fssai} onChange={e => setOnboardForm({...onboardForm, has_fssai: e.target.checked})} /> FSSAI
                  </label>
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_cer} onChange={e => setOnboardForm({...onboardForm, has_cer: e.target.checked})} /> CER
                  </label>
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_turnover} onChange={e => setOnboardForm({...onboardForm, has_turnover: e.target.checked})} /> Turnover Cert.
                  </label>
                  <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a] transition">
                    <input type="checkbox" className="accent-[#16a34a] w-4 h-4" checked={onboardForm.has_annual_returns} onChange={e => setOnboardForm({...onboardForm, has_annual_returns: e.target.checked})} /> Annual Returns
                  </label>
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
  // SCREEN 3: VERIFICATION WAITING & REDIRECTING CLIENT
  // ==============================================================================
  if (status === 'authenticated' && intent === 'client' && userData?.onboarding_complete) {
    if (!userData.is_approved) {
      // 🚀 NEW: MD ఇంకా అప్రూవ్ చేయకపోతే మాత్రమే ఈ వెరిఫికేషన్ స్క్రీన్ రావాలి (కేవలం క్లయింట్స్ కి)
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <Card className="max-w-md w-full tender-shadow text-center p-6 border-t-4 border-amber-500">
            <ShieldCheck className="w-16 h-16 mx-auto text-amber-500 mb-4" />
            <h2 className="text-xl font-bold text-[#0A2647] mb-2">Profile Under Verification</h2>
            <p className="text-slate-600 text-sm mb-6">
              Thank you for registering. Our MD is verifying your business details. You will receive an email once approved.
            </p>
            <Button onClick={performHardSignOut} variant="outline" className="w-full text-slate-500 hover:text-slate-700">
              <LogOut className="w-4 h-4 mr-2" /> Logout
            </Button>
          </Card>
        </div>
      );
    } else {
      // MD అప్రూవ్ చేసేస్తే, డైరెక్ట్ గా క్లయింట్ డాష్‌బోర్డ్ కి పంపాలి
      return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/></div>;
    }
  }

  // ==============================================================================
  // SCREEN 4: MAIN PORTAL (Guests & Approved Browsers reach here)
  // ==============================================================================

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b bg-white sticky top-0 z-30">
        <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {brandSettings.logo ? (
               // eslint-disable-next-line @next/next/no-img-element
               <img src={brandSettings.logo} alt="Logo" className="w-8 h-8 rounded object-contain" />
            ) : (
               <div className="w-8 h-8 bg-[#16a34a] rounded flex items-center justify-center text-white font-bold">TT</div>
            )}
            <h1 className="font-bold text-[#0A2647] text-lg hidden sm:block">{brandSettings.name}</h1>
          </div>

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
              <a href={(intent === 'client' || userData?.onboarding_complete) ? "/client" : "/account"} className="text-sm font-medium text-[#0A2647] hover:text-[#16a34a] hidden md:inline">
                {(intent === 'client' || userData?.onboarding_complete) ? "Client Dashboard" : "My Account"}
              </a>
            ) : null}
            
            {email ? (
              <span className="text-xs text-muted-foreground hidden lg:inline">
                {email}
              </span>
            ) : null}

            {session ? (
              <Button
                onClick={performHardSignOut} 
                variant="ghost"
                size="sm"
                className="text-xs sm:text-sm h-8 sm:h-9 hidden sm:inline-flex text-red-600 hover:text-red-700 hover:bg-red-50"
                title={session.user.email}
              >
                {session.user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={session.user.image} alt="" className="w-5 h-5 rounded-full mr-1" />
                ) : <LogOut className="w-4 h-4 mr-1"/>}
                Sign out
              </Button>
            ) : (
              <Button
                onClick={() => { 
                  if (typeof window !== 'undefined') localStorage.setItem('tt_intent', 'guest');
                  setIsGuest(false); 
                  const cb = typeof window !== 'undefined' ? `${window.location.origin}/?intent=guest` : '/?intent=guest';
                  signIn('google', { callbackUrl: cb }); 
                }}
                size="sm"
                className="text-xs sm:text-sm h-8 sm:h-9 bg-[#16a34a] hover:bg-[#15803d]"
              >
                Sign in
              </Button>
            )}
          </div>
        </div>
        <div className="md:hidden border-t bg-slate-50/60 flex divide-x">
          <a href="/archive" className="flex-1 text-center py-2 text-xs font-medium text-[#0A2647]">
            Archive
          </a>
          <a href={(intent === 'client' || userData?.onboarding_complete) ? "/client" : "/account"} className="flex-1 text-center py-2 text-xs font-medium text-[#0A2647]">
            {(intent === 'client' || userData?.onboarding_complete) ? "Client Dashboard" : "My Account"}
          </a>
          {session && (
            <button onClick={performHardSignOut} className="flex-1 text-center py-2 text-xs font-medium text-red-600">
               Sign Out
            </button>
          )}
        </div>
      </header>

      <section className="navy-gradient text-white">
        <div className="container mx-auto px-3 sm:px-4 py-8 md:py-14">
          <div className="max-w-3xl">
            {isGuest ? (
               <Badge className="bg-amber-500 hover:bg-amber-600 mb-3 text-[10px] sm:text-xs text-white">
                 <Eye className="w-3 h-3 mr-1" /> Public Guest View
               </Badge>
            ) : (
               <Badge className="bg-[#16a34a] hover:bg-[#15803d] mb-3 text-[10px] sm:text-xs">
                 <Sparkles className="w-3 h-3 mr-1" /> Updated daily — Telangana & Andhra Pradesh
               </Badge>
            )}
            
            <h2 className="text-2xl sm:text-3xl md:text-5xl font-extrabold leading-tight">
              Every Government Tender in Telangana & AP — one calendar away.
            </h2>
            <p className="text-slate-200 mt-3 max-w-2xl text-sm sm:text-base">
              Browse, filter by category and state, and instantly unlock official tender PDFs. Pay
              ₹10 for a single doc or go Pro for unlimited access.
            </p>
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
        
        <Card className="tender-shadow">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-[#0A2647]" />
              <CardTitle className="text-base">Advanced Tender Filters</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs sm:text-sm font-semibold text-slate-700 min-w-[70px]">Category:</span>
              <button
                onClick={() => setCategory('all')}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  category === 'all' ? 'bg-[#0A2647] text-white border-[#0A2647]' : 'bg-white text-slate-700 hover:border-[#0A2647]'
                }`}
              >
                All Categories
              </button>
              <button
                onClick={() => setCategory('Product')}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  category === 'Product' ? 'bg-[#0A2647] text-white border-[#0A2647]' : 'bg-white text-slate-700 hover:border-[#0A2647]'
                }`}
              >
                Product
              </button>
              <button
                onClick={() => setCategory('Service')}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  category === 'Service' ? 'bg-[#0A2647] text-white border-[#0A2647]' : 'bg-white text-slate-700 hover:border-[#0A2647]'
                }`}
              >
                Service
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <span className="text-xs sm:text-sm font-semibold text-slate-700 min-w-[70px]">State:</span>
              <button
                onClick={() => { setStateFilter('all'); setDistrict('all'); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${
                  stateFilter === 'all' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700'
                }`}
              >
                All States
              </button>
              <button
                onClick={() => { setStateFilter('TS'); setDistrict('all'); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${
                  stateFilter === 'TS' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700'
                }`}
              >
                Telangana (TS)
              </button>
              <button
                onClick={() => { setStateFilter('AP'); setDistrict('all'); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${
                  stateFilter === 'AP' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700'
                }`}
              >
                Andhra Pradesh (AP)
              </button>
            </div>

            <div className="border-t pt-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs sm:text-sm font-semibold text-slate-700">Filter by District:</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-2 px-2 sm:flex-wrap sm:overflow-visible">
                <button
                  onClick={() => { setDistrict('all'); setSelectedDay(null); }}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                    district === 'all'
                      ? 'bg-[#0A2647] text-white border-[#0A2647]'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-[#0A2647]'
                  }`}
                >
                  All Districts
                </button>
                {currentDistricts.map((d) => (
                  <button
                    key={d}
                    onClick={() => { setDistrict(d); setSelectedDay(null); }}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                      district === d
                        ? 'bg-[#0A2647] text-white border-[#0A2647]'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-[#0A2647]'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-5 gap-6">
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
                  No tenders found for this period / filter.
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
                        <Badge className="bg-[#0A2647] hover:bg-[#0A2647]">
                          <MapPin className="w-3 h-3 mr-1" />
                          {t.district}
                        </Badge>
                        {t.category && (
                          <Badge variant="outline" className="text-xs">
                            {t.category}
                          </Badge>
                        )}
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

      <footer className="border-t mt-14 bg-[#0A2647] text-white py-10 rounded-t-2xl">
        <div className="container mx-auto px-4 text-center">
          <h3 className="text-2xl font-bold mb-2">{brandSettings.name}</h3>
          <p className="text-slate-300 mb-6 text-sm">Government Tender Service Portal | Upto 10 Lakhs</p>
          
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
              © {new Date().getFullYear()} {brandSettings.name}. This is a private service portal and not an official government website.
            </p>
            <p className="text-xs text-slate-500 mb-4">Contact: support@tgtenders.co.in</p>

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
                if (typeof window !== 'undefined') localStorage.setItem('tt_intent', 'guest');
                setIntent('guest');
                const cb = typeof window !== 'undefined' ? `${window.location.origin}/?intent=guest&open_tender=${pendingTender?._id || pendingTender?.id || ''}` : '/';
                signIn('google', { callbackUrl: cb });
              }}
              className="w-full bg-white hover:bg-slate-50 border text-[#0A2647] gap-2 h-11"
            >
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

      <Dialog open={pdfModal} onOpenChange={setPdfModal}>
        <DialogContent className="max-w-4xl w-[95vw] h-[90vh] sm:h-[85vh] flex flex-col p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg pr-6">
              <FileText className="w-5 h-5 text-[#16a34a] shrink-0" />
              <span className="truncate">{pdfData ? pdfData.title : 'Loading Document...'}</span>
            </DialogTitle>
            
            {pdfData?.watermarked && (
              <div className="flex flex-col sm:flex-row items-center gap-2 p-3 bg-emerald-50 rounded border border-emerald-100 mt-2 shadow-sm">
                <div className="flex items-center gap-2 border-b sm:border-b-0 sm:border-r border-emerald-200 pb-2 sm:pb-0 sm:pr-3">
                  {brandSettings.logo && <img src={brandSettings.logo} className="w-6 h-6 object-contain" alt="Logo" />}
                  <span className="font-bold text-[#0A2647] text-sm">{brandSettings.name}</span>
                </div>
                <div className="flex items-center gap-1 text-emerald-800 text-xs font-medium">
                  <Lock className="w-3 h-3" />
                  <span>Licensed to: <strong>{email}</strong></span>
                </div>
              </div>
            )}
          </DialogHeader>

          <div className="flex-1 rounded-md border overflow-hidden bg-slate-100 flex items-center justify-center">
            {!pdfData ? (
              <div className="flex flex-col items-center justify-center p-10">
                <Loader2 className="w-12 h-12 text-[#16a34a] animate-spin mb-4" />
                <p className="text-[#0A2647] font-semibold text-lg">Fetching your PDF...</p>
                <p className="text-muted-foreground text-sm">Please wait a moment...</p>
              </div>
            ) : pdfData.pdf_base64 ? (
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
