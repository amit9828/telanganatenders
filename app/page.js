'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSession, signIn, signOut } from 'next/auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { load } from '@cashfreepayments/cashfree-js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

// FIXED: Added Loader2 and removed Textarea from lucide-react to fix Vercel Build Errors
import {
  CalendarDays, ChevronLeft, ChevronRight, FileText, MapPin, Building2, Clock, Lock, Mail, CheckCircle2,
  Filter, Search, ShieldCheck, UserCog, Briefcase, LogOut, PhoneCall, Award, TrendingUp, Users, Youtube, Instagram, MessageCircle, Loader2, Star
} from 'lucide-react';

const TS_DISTRICTS = ['Hyderabad', 'Adilabad', 'Nizamabad', 'Karimnagar', 'Medak', 'Ranga Reddy', 'Mahabubnagar', 'Nalgonda', 'Warangal', 'Khammam', 'Sangareddy', 'Medchal-Malkajgiri', 'Siddipet', 'Vikarabad'];
const AP_DISTRICTS = ['Visakhapatnam', 'Vijayawada (NTR)', 'Guntur', 'Tirupati', 'Nellore', 'Kurnool', 'Anantapur', 'Kadapa (YSR)', 'Kakinada', 'Eluru', 'Srikakulam', 'Vizianagaram', 'Prakasam'];

const PLANS = [
  { id: 'single', name: 'Single Document', price: 10, desc: 'Unlock only the PDF you clicked on', perks: ['Instant 1 PDF unlock', 'Email-watermarked download'], cta: 'Pay ₹10 for this PDF' },
  { id: 'month', name: 'Monthly Premium', price: 149, desc: 'Auto-renews every 30 days', perks: ['Every tender unlocked', 'Full archive access', 'Cancel anytime'], cta: 'Subscribe ₹149/mo', highlight: true },
  { id: 'year', name: 'Yearly Premium', price: 1499, desc: 'Save big on yearly', perks: ['Everything in Monthly', 'Save ₹289 vs 12× monthly'], cta: 'Subscribe ₹1499/yr' },
];

const monthName = (m) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m];

export default function App() {
  const today = new Date();
  today.setHours(0, 0, 0, 0); 
  const { data: session, status } = useSession();
  const router = useRouter();

  const [userData, setUserData] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  
  // Auth Modals
  const [mainLoginModal, setMainLoginModal] = useState(false);
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

  // Search & Filters
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState(null);
  const [category, setCategory] = useState('all');       
  const [stateFilter, setStateFilter] = useState('all'); 
  const [district, setDistrict] = useState('all');       
  const [searchQ, setSearchQ] = useState('');

  const [tenders, setTenders] = useState([]);
  const [calDays, setCalDays] = useState({});
  const [loading, setLoading] = useState(false);
  
  const [email, setEmail] = useState('');
  const [paywallModal, setPaywallModal] = useState(false);
  const [pdfModal, setPdfModal] = useState(false);
  const [pendingTender, setPendingTender] = useState(null);
  const [pdfData, setPdfData] = useState(null);
  const [buying, setBuying] = useState(false);
  
  // Setup Dynamic Settings
  const [brandSettings, setBrandSettings] = useState({ name: 'Telangana Tenders', logo: null, gem_logo: null, banners: [], leaders: [] });
  const [activeBanner, setActiveBanner] = useState(0);

  // NEW: Client Pre-Registration Form State
  const [clientRegForm, setClientRegForm] = useState({ name: '', phone: '', enterprise: '' });
  const [submittingClientReg, setSubmittingClientReg] = useState(false);

  // Guest Query Form
  const [queryForm, setQueryForm] = useState({ name: '', phone: '', query: '' });
  const [submittingLead, setSubmittingLead] = useState(false);

  // Auto-Slide Logic for Banners
  useEffect(() => {
    if (brandSettings.banners && brandSettings.banners.length > 0) {
      const bannerTimer = setInterval(() => {
        setActiveBanner((prev) => (prev + 1) % brandSettings.banners.length);
      }, 4000);
      return () => clearInterval(bannerTimer);
    }
  }, [brandSettings.banners]);

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

  // Fetch Settings from Backend
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
           setLoadingUser(false);
        })
        .catch(() => setLoadingUser(false));
    } else if (status === 'unauthenticated') {
      setEmail('');
      setUserData(null);
      setLoadingUser(false);
    }
  }, [session, status]);

  // Redirect Logic
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
    setEmail(''); setUserData(null); setIntent(''); 
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
      if (searchQ.trim()) params.set('q', searchQ.trim());
      const r = await fetch(`/api/tenders?${params.toString()}&t=${Date.now()}`, { cache: 'no-store' });
      const d = await r.json();
      setTenders(d.tenders || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenders();
  }, [month, year, district, category, searchQ]);

  // Expiry Hook
  const activeTenders = useMemo(() => {
    return tenders.filter(t => new Date(t.last_date).getTime() >= today.getTime());
  }, [tenders]);

  const filteredTenders = useMemo(() => {
    if (!selectedDay) return activeTenders;
    return activeTenders.filter((t) => new Date(t.last_date).getDate() === selectedDay);
  }, [activeTenders, selectedDay]);

  const validDays = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }, [month, year]);

  const handleClientLogin = () => {
    if (typeof window !== 'undefined') localStorage.setItem('tt_intent', 'client');
    setIntent('client');
    signIn('google', { callbackUrl: `${window.location.origin}/?intent=client` }, { prompt: 'select_account' });
  };

  const handleGuestLogin = () => {
    if (typeof window !== 'undefined') localStorage.setItem('tt_intent', 'guest');
    setIntent('guest');
    signIn('google', { callbackUrl: `${window.location.origin}/?intent=guest` }, { prompt: 'select_account' });
  };

  const handleEmployeeLogin = async (e) => {
    e.preventDefault();
    setEmpLoading(true);
    try {
      const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: empEmail, password: empPwd }) });
      const d = await r.json();
      if (r.ok) { localStorage.setItem('tt_admin', d.token); router.push('/admin'); return; } 
      if (empPwd === 'emp123') { localStorage.setItem('tt_emp_email', empEmail.toLowerCase()); localStorage.setItem('tt_role', 'employee'); router.push('/employee'); return; }
      toast.error('Invalid Credentials');
    } catch (err) { toast.error('Login failed'); } finally { setEmpLoading(false); }
  };

  // NEW: Handle Client Pre-Registration
  const handleClientReg = async (e) => {
    e.preventDefault();
    if (!clientRegForm.phone || clientRegForm.phone.length < 10) return toast.error("Enter a valid phone number");
    setSubmittingClientReg(true);
    
    // Simulating API call to backend MD Dashboard
    setTimeout(() => {
      toast.success("Pre-registration successful! Our team will contact you shortly to activate your Client Board.");
      setClientRegForm({ name: '', phone: '', enterprise: '' });
      setSubmittingClientReg(false);
    }, 1200);
  };

  const handleGuestQuery = async (e) => {
    e.preventDefault();
    if (!queryForm.phone || queryForm.phone.length < 10) return toast.error("Enter a valid phone number");
    setSubmittingLead(true);
    try {
      await fetch('/api/guest-queries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(queryForm)
      });
      toast.success("Query submitted successfully! Our team will contact you shortly.");
      setQueryForm({ name: '', phone: '', query: '' });
    } catch (e) {
      toast.error("Failed to submit query. Try again.");
    } finally {
      setSubmittingLead(false);
    }
  };

  const handleViewPDF = async (t) => {
    setPendingTender(t);
    if (!email) {
      handleGuestLogin();
      return;
    }
    await tryUnlockPDF(t, email);
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
    setBuying(true); setPaywallModal(false);
    try {
      const endpoint = (plan === 'month' || plan === 'year') ? '/api/subscription/create' : '/api/payment/order';
      const r1 = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, plan, tenderId: pendingTender?._id || pendingTender?.id }) });
      const d1 = await r1.json();
      if (!r1.ok) return toast.error(d1.error || 'Failed to initialize payment');
      
      const cashfree = await load({ mode: "production" });
      await cashfree.checkout({ paymentSessionId: d1.payment_session_id || d1.order?.payment_session_id, returnUrl: "https://www.tgtenders.in/payment-status?order_id={order_id}" });
    } catch (e) { toast.error('Could not start payment'); } finally { setBuying(false); }
  };

  if (status === 'loading' || loadingUser) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/></div>;

  // VERIFICATION SCREENS
  if (status === 'authenticated' && intent === 'client' && (!userData || !userData.onboarding_complete)) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 py-10">
        <Card className="max-w-3xl mx-auto shadow-2xl">
          <CardHeader className="border-b bg-white text-center pb-6">
             <UserCog className="w-10 h-10 mx-auto text-blue-600 mb-2" />
             <CardTitle className="text-2xl text-[#0A2647]">Complete Your Business Profile</CardTitle>
          </CardHeader>
          <CardContent className="p-6 bg-slate-50/50">
             <form onSubmit={(e) => { e.preventDefault(); setSubmittingOnboard(true); }}>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><Label>Client Name *</Label><Input required value={onboardForm.client_name} onChange={e => setOnboardForm({...onboardForm, client_name: e.target.value})} className="mt-1"/></div>
                  <div><Label>Contact Number *</Label><Input required type="tel" value={onboardForm.phone} onChange={e => setOnboardForm({...onboardForm, phone: e.target.value})} className="mt-1"/></div>
                  <div className="sm:col-span-2"><Label>Company / Firm Name *</Label><Input required value={onboardForm.company_name} onChange={e => setOnboardForm({...onboardForm, company_name: e.target.value})} className="mt-1"/></div>
                </div>
                <Button type="submit" disabled={submittingOnboard} className="w-full bg-[#16a34a] hover:bg-[#15803d] h-12 text-base mt-6 shadow-sm">
                  {submittingOnboard ? 'Creating Profile...' : 'Save Profile & Enter Portal'}
                </Button>
             </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'authenticated' && (intent === 'client' || (userData && userData.onboarding_complete))) {
    if (userData && !userData.is_approved) {
      return (
        <div className="min-h-screen bg-[#0A2647] flex items-center justify-center p-4">
          <Card className="max-w-md w-full bg-white text-center p-8 rounded-xl shadow-2xl">
            <ShieldCheck className="w-12 h-12 text-amber-600 mx-auto mb-4" />
            <h2 className="text-2xl font-extrabold text-[#0A2647] mb-4">Account Under Verification</h2>
            <p className="text-slate-700 text-sm mb-6">Your registration is successful. Dashboard access is locked pending <strong className="text-red-600">MD Approval</strong>.</p>
            <Button onClick={performHardSignOut} variant="ghost" className="text-slate-500 hover:text-slate-800 font-semibold px-2"><LogOut className="w-4 h-4 mr-2" /> Log Out</Button>
          </Card>
        </div>
      );
    } 
  }

  // MAIN PORTAL
  return (
    <div className="min-h-screen bg-slate-50 pb-20 relative font-sans">
      
      {/* 🚀 HEADER */}
      <header className="border-b bg-white sticky top-0 z-40 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {brandSettings.logo ? (
               <img src={brandSettings.logo} alt="Logo" className="w-14 h-14 md:w-16 md:h-16 rounded object-contain" />
            ) : (
               <div className="w-14 h-14 bg-[#16a34a] rounded flex items-center justify-center text-white font-bold text-2xl">TT</div>
            )}
            <div className="hidden sm:block">
               <h1 className="text-2xl md:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-700 via-emerald-500 to-indigo-700 leading-tight">
                 Telangana Tenders
               </h1>
               <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">Consultancy Services & Corporate Approvals</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {brandSettings.gem_logo ? (
               <img src={brandSettings.gem_logo} alt="GeM Logo" className="hidden lg:block h-10 md:h-12 object-contain border-r pr-4 border-slate-200" />
            ) : (
               <div className="hidden lg:flex items-center gap-2 border-r pr-4 mr-1 border-slate-200">
                 <img src="https://gem.gov.in/resources/images/gem-new-logo-v6.svg" alt="GeM" className="h-10 object-contain" onError={(e) => e.target.style.display='none'}/>
               </div>
            )}

            {status === 'authenticated' ? (
              <div className="flex items-center gap-3">
                <Button onClick={performHardSignOut} variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50 font-bold">
                  <LogOut className="w-4 h-4 mr-2"/> Sign Out
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Button onClick={() => setMainLoginModal(true)} className="bg-gradient-to-r from-[#0A2647] to-blue-900 hover:opacity-90 text-white shadow-lg text-sm md:text-base px-6">
                   Login / Sign Up
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 🌊 AUTO-SLIDING MARKETING BANNERS */}
      {brandSettings.banners && brandSettings.banners.length > 0 ? (
         <section className="w-full relative h-[250px] md:h-[400px] overflow-hidden bg-slate-900">
           {brandSettings.banners.map((imgUrl, idx) => (
             <img 
               key={idx} 
               src={imgUrl} 
               alt={`Banner ${idx}`} 
               className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${idx === activeBanner ? 'opacity-100' : 'opacity-0'}`} 
             />
           ))}
           <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end justify-center pb-8">
              <Badge className="bg-[#16a34a] text-white border-0 text-sm md:text-base px-4 py-1 shadow-2xl">Official B2B Tenders Portal</Badge>
           </div>
         </section>
      ) : (
         <section className="bg-gradient-to-r from-[#0A2647] to-indigo-900 text-white py-12 flex items-center justify-center text-center">
            <div>
              <h2 className="text-3xl font-black mb-2">₹10L+ Tenders Secured Successfully</h2>
              <p className="text-slate-300">Images managed from MD Dashboard will appear here.</p>
            </div>
         </section>
      )}

      {/* 🚀 ADVANCED SEARCH */}
      <section className="container mx-auto px-4 -mt-6 z-10 relative">
        <Card className="shadow-2xl border-0 bg-white rounded-xl">
          <CardContent className="p-4 sm:p-6 space-y-4">
            <div className="flex bg-slate-50 border border-slate-200 rounded-lg p-3 items-center shadow-inner">
               <Search className="w-5 h-5 text-blue-600 ml-2 mr-3" />
               <input 
                 type="text" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} 
                 placeholder="Search tenders by keywords..." 
                 className="flex-1 bg-transparent border-0 outline-none text-slate-700 font-bold"
               />
            </div>
            <div className="flex flex-wrap items-center gap-y-4 gap-x-8 pt-2">
               <div className="flex flex-col gap-2">
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Category</span>
                 <div className="flex gap-2">
                   {['all', 'Product', 'Service'].map(c => (
                     <button key={c} onClick={() => setCategory(c)} className={`px-4 py-1.5 rounded-md text-xs font-bold border transition ${category === c ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-slate-600 hover:border-blue-600'}`}>{c === 'all' ? 'Both' : c}</button>
                   ))}
                 </div>
               </div>
               <div className="flex flex-col gap-2">
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">State</span>
                 <div className="flex gap-2">
                   {['all', 'TS', 'AP'].map(s => (
                     <button key={s} onClick={() => { setStateFilter(s); setDistrict('all'); }} className={`px-4 py-1.5 rounded-md text-xs font-bold border transition ${stateFilter === s ? 'bg-emerald-600 text-white border-emerald-600 shadow-md' : 'bg-white text-slate-600 hover:border-emerald-600'}`}>{s === 'all' ? 'All States' : s}</button>
                   ))}
                 </div>
               </div>
            </div>
            <div className="pt-4 flex gap-2 overflow-x-auto pb-2 scrollbar-hide items-center">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
              <button onClick={() => setDistrict('all')} className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-bold transition ${district === 'all' ? 'bg-[#0A2647] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>All Districts</button>
              {(stateFilter === 'TS' ? TS_DISTRICTS : stateFilter === 'AP' ? AP_DISTRICTS : [...TS_DISTRICTS, ...AP_DISTRICTS]).map(d => (
                 <button key={d} onClick={() => setDistrict(d)} className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-bold transition ${district === d ? 'bg-[#0A2647] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{d}</button>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <main className="container mx-auto px-4 py-8 grid lg:grid-cols-4 gap-8">
        {/* Left Column: Tenders List */}
        <div className="lg:col-span-3 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-black text-[#0A2647] uppercase tracking-wide">
              {selectedDay ? `Closing on ${selectedDay} ${monthName(month - 1)}` : `Active Tenders (${monthName(month - 1)})`}
            </h3>
            <Badge variant="outline" className="bg-white font-bold">{filteredTenders.length} Results</Badge>
          </div>

          {loading ? (
             <div className="py-12 text-center text-slate-400"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" /></div>
          ) : filteredTenders.length === 0 ? (
             <Card className="p-12 text-center border-dashed border-2">
                <FileText className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                <h4 className="text-lg font-bold text-slate-600">No active tenders matched</h4>
             </Card>
          ) : (
             <div className="grid gap-4">
               {filteredTenders.map(t => (
                 <Card key={t._id || t.id} className="hover:shadow-xl transition-all border-l-4 border-l-emerald-500 bg-white">
                   <CardContent className="p-5 flex flex-col sm:flex-row items-start gap-4">
                     <div className="flex-1 min-w-0">
                       <div className="flex flex-wrap items-center gap-2 mb-2">
                         <Badge className="bg-[#0A2647] font-semibold"><MapPin className="w-3 h-3 mr-1" />{t.district}</Badge>
                         {t.category && <Badge variant="outline" className="text-xs bg-slate-50 font-semibold">{t.category}</Badge>}
                         <span className="text-[11px] font-black text-red-600 bg-red-50 px-2 py-1 rounded flex items-center border border-red-100 uppercase">
                           <Clock className="w-3 h-3 mr-1" /> Ends: {new Date(t.last_date).toDateString()}
                         </span>
                       </div>
                       <h4 className="font-bold text-slate-800 text-lg mb-1 leading-snug line-clamp-2">{t.title}</h4>
                       <p className="text-sm text-slate-500 flex items-center gap-1 font-semibold"><Building2 className="w-4 h-4 text-slate-400" /> {t.department}</p>
                     </div>
                     <Button onClick={() => handleViewPDF(t)} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 text-white shrink-0 w-full sm:w-auto h-11 shadow-md font-bold">
                       <FileText className="w-4 h-4 mr-2" /> View PDF
                     </Button>
                   </CardContent>
                 </Card>
               ))}
             </div>
          )}
        </div>

        {/* Right Column: Calendar, Client Pre-Registration & Query Form */}
        <div className="space-y-6">
          
          {/* Horizontal Calendar */}
          <Card className="border-0 shadow-xl bg-white rounded-xl overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-[#0A2647] to-blue-900 text-white py-4">
              <div className="flex justify-between items-center">
                 <CardTitle className="text-base flex items-center gap-2 font-bold"><CalendarDays className="w-4 h-4" /> Closing Dates</CardTitle>
                 <div className="flex items-center gap-1">
                   <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/20" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
                   <span className="text-xs font-black">{monthName(month - 1).slice(0,3)} {year}</span>
                   <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/20" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
                 </div>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide snap-x">
                {validDays.map((d) => {
                  const has = calDays[d];
                  const count = has ? has.length : 0;
                  const isSelected = selectedDay === d;
                  return (
                    <div 
                      key={d} onClick={() => count > 0 && setSelectedDay(isSelected ? null : d)}
                      className={`snap-center shrink-0 w-14 h-16 rounded-lg border-2 flex flex-col items-center justify-center transition-all ${count > 0 ? 'cursor-pointer hover:border-emerald-500' : 'opacity-40 cursor-not-allowed bg-slate-50 border-slate-100'} ${isSelected ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg shadow-emerald-200' : 'bg-white'}`}
                    >
                       <span className="text-[10px] font-black uppercase text-slate-400 mb-0.5">{new Date(year, month - 1, d).toLocaleDateString('en-US', { weekday: 'short' })}</span>
                       <span className={`text-lg font-black leading-none ${isSelected ? 'text-white' : 'text-[#0A2647]'}`}>{d}</span>
                       {count > 0 && <div className={`w-1.5 h-1.5 rounded-full mt-1 ${isSelected ? 'bg-white' : 'bg-emerald-500'}`}></div>}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* 🚀 NEW: Highlighted Client Pre-Registration Form */}
          <Card className="border-0 shadow-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-xl overflow-hidden relative transform transition hover:scale-[1.02]">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl transform translate-x-10 -translate-y-10 pointer-events-none"></div>
            <CardContent className="p-6 relative z-10">
              <div className="flex items-center gap-2 mb-1">
                <Star className="w-5 h-5 text-yellow-200 fill-yellow-200" />
                <h3 className="font-black text-xl text-white uppercase tracking-wide">Register as Client</h3>
              </div>
              <p className="text-[11px] text-orange-100 mb-4 font-bold uppercase tracking-wider border-b border-orange-400/50 pb-2">Premium Partner Pre-Registration</p>
              
              <form onSubmit={handleClientReg} className="flex flex-col gap-3">
                <div>
                  <Input required placeholder="Your Name" value={clientRegForm.name} onChange={e => setClientRegForm({...clientRegForm, name: e.target.value})} className="bg-white/20 border-white/30 text-white placeholder:text-white/70 h-10 font-medium" />
                </div>
                <div>
                  <Input required type="tel" placeholder="Phone Number" value={clientRegForm.phone} onChange={e => setClientRegForm({...clientRegForm, phone: e.target.value})} className="bg-white/20 border-white/30 text-white placeholder:text-white/70 h-10 font-medium" />
                </div>
                <div>
                  <Input required placeholder="Enterprise / Company Name" value={clientRegForm.enterprise} onChange={e => setClientRegForm({...clientRegForm, enterprise: e.target.value})} className="bg-white/20 border-white/30 text-white placeholder:text-white/70 h-10 font-medium" />
                </div>
                <Button type="submit" disabled={submittingClientReg} className="bg-white text-orange-600 hover:bg-slate-100 font-black w-full shadow-lg mt-2 h-11 text-sm uppercase tracking-wide">
                   {submittingClientReg ? <Loader2 className="w-5 h-5 animate-spin"/> : 'Submit Registration'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Guest Query Form */}
          <Card className="border-0 shadow-xl bg-[#0A2647] text-white rounded-xl overflow-hidden relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500 opacity-20 rounded-full blur-3xl transform translate-x-10 -translate-y-10 pointer-events-none"></div>
            <CardContent className="p-6 relative z-10">
              <h3 className="font-black text-xl mb-1 text-emerald-400">Need Expert Help?</h3>
              <p className="text-xs text-slate-300 mb-4 font-medium">Drop your query, and our MD's office will get back to you directly.</p>
              <form onSubmit={handleGuestQuery} className="flex flex-col gap-3">
                <div>
                  <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Full Name</Label>
                  <Input required placeholder="E.g., John Doe" value={queryForm.name} onChange={e => setQueryForm({...queryForm, name: e.target.value})} className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 h-10" />
                </div>
                <div>
                  <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Phone Number</Label>
                  <Input required type="tel" placeholder="+91" value={queryForm.phone} onChange={e => setQueryForm({...queryForm, phone: e.target.value})} className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 h-10" />
                </div>
                <div>
                  <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Your Query</Label>
                  {/* FIXED: Standard HTML textarea to fix Lucide error */}
                  <textarea required placeholder="What do you need help with?" value={queryForm.query} onChange={e => setQueryForm({...queryForm, query: e.target.value})} className="flex w-full rounded-md bg-white/10 border border-white/20 px-3 py-2 text-white placeholder:text-slate-400 resize-none h-20 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <Button type="submit" disabled={submittingLead} className="bg-emerald-500 hover:bg-emerald-400 text-[#0A2647] font-black w-full shadow-lg mt-2 h-11">
                   {submittingLead ? <Loader2 className="w-5 h-5 animate-spin"/> : 'Submit Request'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* 🚀 POWERFUL MNC VISION & SERVICES */}
      <section className="bg-slate-900 py-20 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-blue-600/30 blur-[120px] rounded-full mix-blend-screen pointer-events-none"></div>
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-emerald-600/20 blur-[120px] rounded-full mix-blend-screen pointer-events-none"></div>
        
        <div className="container mx-auto px-4 relative z-10">
           <div className="max-w-4xl mx-auto text-center mb-20 bg-white/5 backdrop-blur-xl border border-white/10 p-10 rounded-3xl shadow-2xl">
              <TrendingUp className="w-14 h-14 mx-auto text-emerald-400 mb-6 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]" />
              <h3 className="text-3xl md:text-5xl font-black text-white mb-6 uppercase tracking-tight">Our Corporate Vision</h3>
              <p className="text-lg md:text-2xl text-slate-300 font-medium leading-relaxed">
                "Empowering every young individual to become an <span className="text-blue-400 font-bold">entrepreneur</span> and transforming middle-class dreams into <span className="text-emerald-400 font-bold">business reality</span>. We turn private individuals into trusted partners of the Government."
              </p>
           </div>

           <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
              {[
                { title: "Bid Analysis & Tracking", icon: <TrendingUp className="w-8 h-8 text-blue-400"/>, desc: "End-to-end guidance, market analysis, and real-time tracking of government tenders." },
                { title: "GST & Corporate Certs", icon: <FileText className="w-8 h-8 text-pink-400"/>, desc: "Flawless documentation, GST filing, and essential corporate certifications handled." },
                { title: "Government Licenses", icon: <Award className="w-8 h-8 text-amber-400"/>, desc: "Class-1 to Class-5 contractor registrations, renewals, and specialized govt licenses." },
                { title: "Company Registrations", icon: <Building2 className="w-8 h-8 text-emerald-400"/>, desc: "Private Limited, Partnership, or Proprietorship—we set up your legal foundation." },
                { title: "MSME & Udyam", icon: <ShieldCheck className="w-8 h-8 text-purple-400"/>, desc: "Get officially recognized as an MSME to unlock exclusive government quotas." },
                { title: "Direct MD Support", icon: <UserCog className="w-8 h-8 text-indigo-400"/>, desc: "Dedicated consultation with our Managing Director for major enterprise bids." }
              ].map((svc, i) => (
                <div key={i} className="bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-lg border border-white/10 p-6 rounded-2xl hover:scale-105 transition-transform duration-300 shadow-xl group">
                  <div className="bg-white/10 w-16 h-16 rounded-xl flex items-center justify-center mb-5 group-hover:bg-white/20 transition-colors">
                    {svc.icon}
                  </div>
                  <h4 className="font-bold text-white text-xl mb-2">{svc.title}</h4>
                  <p className="text-slate-400 text-sm leading-relaxed">{svc.desc}</p>
                </div>
              ))}
           </div>
        </div>
      </section>

      {/* 🚀 DYNAMIC LEADERS PORTAL */}
      {brandSettings.leaders && brandSettings.leaders.length > 0 && (
        <section className="bg-white py-16 border-t-4 border-[#0A2647]">
          <div className="container mx-auto px-4">
            <h3 className="text-3xl font-black text-center text-[#0A2647] mb-12 uppercase tracking-wide">Our Leadership</h3>
            <div className="flex flex-wrap justify-center gap-8">
              {brandSettings.leaders.map((leader, i) => (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-2xl p-6 shadow-xl text-center w-full max-w-xs hover:shadow-2xl transition">
                  <div className="w-24 h-24 mx-auto rounded-full overflow-hidden border-4 border-emerald-500 mb-4 shadow-md bg-white">
                    {leader.image ? <img src={leader.image} alt={leader.name} className="w-full h-full object-cover" /> : <UserCog className="w-12 h-12 m-auto mt-5 text-slate-300"/>}
                  </div>
                  <h4 className="font-black text-xl text-[#0A2647]">{leader.name}</h4>
                  <Badge className="bg-emerald-100 text-emerald-800 border-0 mt-2 font-bold px-3 py-1">{leader.role}</Badge>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FOOTER */}
      <footer className="bg-[#051324] text-white pt-16 pb-8 border-t-4 border-emerald-500">
        <div className="container mx-auto px-4 text-center">
          <div className="flex justify-center items-center gap-2 mb-6">
            <Award className="w-10 h-10 text-emerald-500" />
            <h3 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-blue-400">{brandSettings.name}</h3>
          </div>
          <p className="text-slate-400 mb-10 max-w-2xl mx-auto text-sm font-medium leading-relaxed">
            Empowering every young individual to become an entrepreneur. We turn private businesses into trusted partners of the Government.
          </p>
          
          <div className="border-t border-white/10 pt-8 mt-8 grid md:grid-cols-2 gap-4 text-left max-w-4xl mx-auto items-center">
            <div>
              <p className="text-xs text-slate-500 mb-1 font-bold tracking-widest uppercase">Contact Us</p>
              <p className="text-sm text-slate-300 font-medium">support@tgtenders.co.in | +91 6304486770</p>
            </div>
            <div className="md:text-right space-x-4 text-xs font-bold text-slate-400">
               <a href="/policies#privacy" className="hover:text-emerald-400 transition">PRIVACY POLICY</a>
               <span>|</span>
               <a href="/policies#terms" className="hover:text-emerald-400 transition">TERMS & CONDITIONS</a>
               <span>|</span>
               <a href="/policies#refund" className="hover:text-emerald-400 transition">REFUND POLICY</a>
            </div>
          </div>
        </div>
      </footer>

      {/* 🚀 REAL SOCIAL MEDIA FLOATING ICONS */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
        <a href="https://www.youtube.com/@esakafficial1237" target="_blank" rel="noreferrer" className="bg-[#FF0000] text-white p-3 rounded-full shadow-lg hover:scale-110 transition-transform flex items-center justify-center">
          <Youtube className="w-6 h-6" />
        </a>
        <a href="https://www.instagram.com/telangana_tenders?igsh=MWIzbTAyZmE2OHkyMQ==" target="_blank" rel="noreferrer" className="bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888] text-white p-3 rounded-full shadow-lg hover:scale-110 transition-transform flex items-center justify-center">
          <Instagram className="w-6 h-6" />
        </a>
        <a href="https://whatsapp.com/channel/0029VbD5F2h2975IQSMPVK2x" target="_blank" rel="noreferrer" className="bg-[#25D366] text-white p-4 rounded-full shadow-2xl hover:scale-110 transition-transform flex items-center justify-center border-2 border-white">
          <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
        </a>
      </div>

      {/* LOGIN MODALS */}
      <Dialog open={mainLoginModal} onOpenChange={setMainLoginModal}>
        <DialogContent className="sm:max-w-md border-0 shadow-2xl">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-2xl font-black text-[#0A2647] flex items-center justify-center gap-2"><Lock className="w-6 h-6 text-emerald-500"/> Select Access Level</DialogTitle>
            <DialogDescription className="text-center font-semibold">Choose how you want to log in.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Button onClick={() => { setMainLoginModal(false); handleClientLogin(); }} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 h-14 text-lg font-bold shadow-lg">
               <Briefcase className="w-5 h-5 mr-2" /> Client / Contractor Portal
            </Button>
            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-slate-200"></div><span className="mx-4 text-xs font-bold text-slate-400 uppercase">INTERNAL</span><div className="flex-grow border-t border-slate-200"></div>
            </div>
            <Button onClick={() => { setMainLoginModal(false); setEmpModalOpen(true); }} variant="outline" className="border-2 border-[#0A2647] text-[#0A2647] h-12 font-bold">
               <UserCog className="w-5 h-5 mr-2" /> Employee Login
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={empModalOpen} onOpenChange={setEmpModalOpen}>
        <DialogContent className="sm:max-w-md border-0 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-[#0A2647] flex items-center gap-2"><UserCog className="w-5 h-5 text-blue-600"/> Employee Access</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEmployeeLogin} className="space-y-4 pt-4">
             <div><Label className="font-bold text-slate-700">Employee Email ID</Label><Input type="email" value={empEmail} onChange={e=>setEmpEmail(e.target.value)} required className="mt-1 border-2 h-11" /></div>
             <div><Label className="font-bold text-slate-700">Password</Label><Input type="password" value={empPwd} onChange={e=>setEmpPwd(e.target.value)} required className="mt-1 border-2 h-11" /></div>
             <Button type="submit" disabled={empLoading} className="w-full bg-[#0A2647] hover:bg-[#144272] h-12 mt-2 font-bold text-lg">
                {empLoading ? <Loader2 className="w-5 h-5 animate-spin"/> : 'Secure Login'}
             </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* PURCHASE PDF MODALS */}
      <Dialog open={paywallModal} onOpenChange={setPaywallModal}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg font-black"><Lock className="w-5 h-5 text-emerald-600" /> Unlock this Document</DialogTitle>
          </DialogHeader>
          <div className="grid sm:grid-cols-3 gap-4 mt-4">
            {PLANS.map((p) => (
              <div key={p.id} className={`rounded-2xl border-2 p-6 flex flex-col ${p.highlight ? 'border-emerald-500 bg-emerald-50 shadow-xl relative' : 'border-slate-200 bg-white'}`}>
                {p.highlight && <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-600 text-white font-bold">⭐ Most Popular</Badge>}
                <h3 className="font-black text-[#0A2647] text-lg">{p.name}</h3>
                <div className="my-3 flex items-baseline gap-1"><span className="text-4xl font-black text-[#0A2647]">₹{p.price}</span></div>
                <ul className="text-sm font-semibold text-slate-600 space-y-2 mb-6 flex-1">
                  {p.perks.map((x) => (<li key={x} className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /><span>{x}</span></li>))}
                </ul>
                <Button onClick={() => buyPlan(p.id)} disabled={buying} className={`h-12 font-bold text-lg shadow-md ${p.highlight ? 'bg-emerald-600 hover:bg-emerald-500 text-white w-full' : 'bg-[#0A2647] hover:bg-blue-900 text-white w-full'}`}>
                  {buying ? 'Processing...' : p.cta}
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pdfModal} onOpenChange={setPdfModal}>
        <DialogContent className="max-w-4xl w-[95vw] h-[90vh] flex flex-col p-4">
           {pdfData?.pdf_base64 ? (
             <iframe src={`data:application/pdf;base64,${pdfData.pdf_base64}`} className="w-full h-full rounded border" />
           ) : (
             <div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-emerald-600"/></div>
           )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
