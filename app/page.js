'use client';
import { useEffect, useMemo, useState } from 'react';
import Script from 'next/script';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { load } from '@cashfreepayments/cashfree-js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

import {
  CalendarDays, ChevronLeft, ChevronRight, FileText, MapPin, Building2, Clock, Lock, Mail, CheckCircle2,
  Filter, Search, ShieldCheck, UserCog, Briefcase, LogOut, Award, TrendingUp, Loader2, Star,
  FileBadge, Activity, Eye, User, Sparkles, X, Phone
} from 'lucide-react';

const TS_DISTRICTS = ['Hyderabad', 'Adilabad', 'Nizamabad', 'Karimnagar', 'Medak', 'Ranga Reddy', 'Mahabubnagar', 'Nalgonda', 'Warangal', 'Khammam', 'Sangareddy', 'Medchal-Malkajgiri', 'Siddipet', 'Vikarabad'];
const AP_DISTRICTS = ['Visakhapatnam', 'Vijayawada (NTR)', 'Guntur', 'Tirupati', 'Nellore', 'Kurnool', 'Anantapur', 'Kadapa (YSR)', 'Kakinada', 'Eluru', 'Srikakulam', 'Vizianagaram', 'Prakasam'];

const PLANS = [
  { id: 'single', name: 'Single Document', price: 10, desc: 'Unlock only the PDF you clicked on', mode: 'oneoff', perks: ['Instant 1 PDF unlock', 'Email-watermarked download', 'No account required'], cta: 'Pay ₹10 for this PDF' },
  { id: 'month', name: 'Monthly Premium', price: 149, desc: 'Auto-renews every 30 days', mode: 'subscription', perks: ['Every tender unlocked', 'Full archive access', 'Cancel anytime'], cta: 'Subscribe ₹149/mo', highlight: true },
  { id: 'year', name: 'Yearly Premium', price: 1499, desc: 'Save big on yearly', mode: 'subscription', perks: ['Everything in Monthly', 'Save ₹289 vs 12× monthly', 'Cancel anytime'], cta: 'Subscribe ₹1499/yr' },
];

const monthName = (m) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m];

export default function App() {
  const today = new Date();
  today.setHours(0, 0, 0, 0); 
  const { data: session, status } = useSession();
  const router = useRouter();

  const [userData, setUserData] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [subscription, setSubscription] = useState(null);
  
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
    has_aadhar: false, has_dsc: false, has_ifsc: false, has_fssai: false, has_cer: false, has_turnover: false, has_annual_returns: false, has_msme: false
  });
  const [submittingOnboard, setSubmittingOnboard] = useState(false);

  // Search & Filters - Separated UI State from Applied State
  const [uiYear, setUiYear] = useState(today.getFullYear());
  const [uiMonth, setUiMonth] = useState(today.getMonth() + 1);
  const [appliedYear, setAppliedYear] = useState(today.getFullYear());
  const [appliedMonth, setAppliedMonth] = useState(today.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState(null);
  const [appliedDay, setAppliedDay] = useState(null);
  
  const [category, setCategory] = useState('all');       
  const [stateFilter, setStateFilter] = useState('all'); 
  const [district, setDistrict] = useState('all');       
  const [searchQ, setSearchQ] = useState('');

  const [tenders, setTenders] = useState([]);
  const [calDays, setCalDays] = useState({});
  const [loading, setLoading] = useState(false);
  
  const [email, setEmail] = useState('');
  const [paywallModal, setPaywallModal] = useState(false);
  
  // 🚀 FIXED: GUEST PAY MODAL NOW USES NAME AND PHONE ONLY
  const [guestPayModal, setGuestPayModal] = useState(false);
  const [guestPayForm, setGuestPayForm] = useState({ name: '', phone: '' });
  
  const [pendingTender, setPendingTender] = useState(null);
  const [pdfData, setPdfData] = useState(null);
  const [buying, setBuying] = useState(false);
  
  // LIVE API Settings
  const [brandSettings, setBrandSettings] = useState({ 
    name: 'Telangana Tenders', logo: null, gem_logo: null, banners: [], leaders: [], vision_text: null 
  });
  const [activeBanner, setActiveBanner] = useState(0);

  // Visitor API State
  const [visitors, setVisitors] = useState({ total: "Loading...", today: "..." });

  const [clientRegForm, setClientRegForm] = useState({ name: '', phone: '', enterprise: '' });
  const [submittingClientReg, setSubmittingClientReg] = useState(false);

  const [queryForm, setQueryForm] = useState({ name: '', phone: '', query: '' });
  const [submittingLead, setSubmittingLead] = useState(false);

  const [policyModal, setPolicyModal] = useState(null);

  // Auto-Slide Logic for Banners
  useEffect(() => {
    if (brandSettings.banners && brandSettings.banners.length > 0) {
      const bannerTimer = setInterval(() => setActiveBanner((prev) => (prev + 1) % brandSettings.banners.length), 5000);
      return () => clearInterval(bannerTimer);
    }
  }, [brandSettings.banners]);

  const prevBanner = () => {
    if(brandSettings.banners?.length > 0) setActiveBanner(p => (p === 0 ? brandSettings.banners.length - 1 : p - 1));
  }
  const nextBanner = () => {
    if(brandSettings.banners?.length > 0) setActiveBanner(p => (p + 1) % brandSettings.banners.length);
  }

  // URL Intent Tracking (Guarantees data won't be lost after Google redirect)
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

  // ALL LIVE API FETCHES (Including Live IP Traffic Polling)
  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((d) => { if(d.settings) setBrandSettings(d.settings); }).catch(()=>{});
    
    // Polling function for Live Traffic via IP
    const getLiveTraffic = () => {
      fetch('/api/analytics/visitors')
        .then(r => r.json())
        .then(d => { if(d) setVisitors(d); })
        .catch(()=>{});
    };
    
    getLiveTraffic();
    const trafficInterval = setInterval(getLiveTraffic, 15000); // Live poll every 15 seconds
    
    return () => clearInterval(trafficInterval);
  }, []);

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.email) {
      const e = session.user.email.toLowerCase();
      setEmail(e); 
      localStorage.setItem('tt_email', e);
      fetch(`/api/me?email=${encodeURIComponent(e)}&t=${Date.now()}`, { 
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      })
        .then((r) => r.json()).then((d) => { 
          setUserData(d); 
          setSubscription(d.subscription || null);
          setLoadingUser(false); 
        }).catch(() => setLoadingUser(false));
    } else if (status === 'unauthenticated') {
      if (typeof window !== 'undefined') localStorage.removeItem('tt_email');
      setEmail(''); 
      setUserData(null); 
      setLoadingUser(false);
    }
  }, [session, status]);

  // Client Dashboard Logic (Intent based) - NOW OPENS IN NEW TAB
  useEffect(() => {
    if (status === 'authenticated' && userData !== null && !loadingUser) {
      if (intent === 'client' && userData.onboarding_complete && userData.is_approved) {
        if (typeof window !== 'undefined' && window.location.pathname !== '/client') {
          window.open('/client', '_blank'); // Opens strictly in new tab
          localStorage.removeItem('tt_intent');
          setIntent(''); // Clears intent in original tab to avoid looping
        }
      }
    }
  }, [status, intent, userData, loadingUser]);
  
  // 🚀 FIXED: Hard Logout Logic
  const performHardSignOut = async () => {
    if (typeof window !== 'undefined') {
        localStorage.clear();
        sessionStorage.clear();
    }
    await signOut({ redirect: false }); 
    window.location.href = '/'; 
  };

  // LIVE API: Fetch Tenders based on APPLIED Filter
  const fetchTenders = async () => {
    if (intent === 'client' && status === 'authenticated' && (!userData || !userData.onboarding_complete)) return; 
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (district !== 'all') params.set('district', district);
      if (category !== 'all') params.set('category', category);
      params.set('month', String(appliedMonth)); 
      params.set('year', String(appliedYear));
      if (searchQ.trim()) {
        params.set('q', searchQ.trim());
        params.set('scope', 'all'); 
      }
      const r = await fetch(`/api/tenders?${params.toString()}&t=${Date.now()}`, { cache: 'no-store' });
      const d = await r.json(); 
      setTenders(d.tenders || []);
    } finally { setLoading(false); }
  };

  // Fetch Calendar Data purely for the UI display
  const fetchCalendar = async () => {
    if (intent === 'client' && status === 'authenticated' && (!userData || !userData.onboarding_complete)) return;
    const r = await fetch(`/api/tenders/calendar?month=${uiMonth}&year=${uiYear}&t=${Date.now()}`, { cache: 'no-store' });
    const d = await r.json(); 
    setCalDays(d.days || {});
  };

  useEffect(() => { fetchTenders(); }, [appliedMonth, appliedYear, district, category, searchQ]);
  useEffect(() => { fetchCalendar(); }, [uiMonth, uiYear]);

  // 🚀 FIXED: AUTO-DELETE EXPIRED TENDERS FROM UI (Filters out past dates automatically)
  const activeTenders = useMemo(() => tenders.filter(t => new Date(t.last_date).getTime() >= today.getTime()), [tenders, today]);
  
  const filteredTenders = useMemo(() => {
    if (!appliedDay) return activeTenders; 
    return activeTenders.filter((t) => new Date(t.last_date).getDate() === appliedDay);
  }, [activeTenders, appliedDay]);

  const validDays = useMemo(() => {
    const daysInMonth = new Date(uiYear, uiMonth, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }, [uiMonth, uiYear]);

  const prevMonth = () => { setSelectedDay(null); if (uiMonth === 1) { setUiMonth(12); setUiYear(uiYear - 1); } else setUiMonth(uiMonth - 1); };
  const nextMonth = () => { setSelectedDay(null); if (uiMonth === 12) { setUiMonth(1); setUiYear(uiYear + 1); } else setUiMonth(uiMonth + 1); };

  const handleClientLogin = () => {
    localStorage.setItem('tt_intent', 'client'); setIntent('client');
    signIn('google', { callbackUrl: `${window.location.origin}/?intent=client` }, { prompt: 'select_account' });
  };

  const handleSubscribeLogin = () => {
    localStorage.setItem('tt_intent', 'subscribe'); setIntent('subscribe');
    signIn('google', { callbackUrl: `${window.location.origin}/?intent=subscribe` }, { prompt: 'select_account' });
  };

  // 🚀 PROPER FIX: Employee & Admin Database Login
  const handleEmployeeLogin = async (e) => {
    e.preventDefault(); 
    setEmpLoading(true);
    try {
      // 1. Check if it's the Admin/MD first
      const r = await fetch('/api/admin/login', { 
         method: 'POST', 
         headers: { 'Content-Type': 'application/json' }, 
         body: JSON.stringify({ email: empEmail, password: empPwd }) 
      });
      const d = await r.json();
      
      if (r.ok) { 
        localStorage.setItem('tt_admin', d.token); 
        window.open('/admin', '_blank');
        setEmpModalOpen(false);
        setEmpLoading(false);
        return; 
      } 
      
      // 2. Not Admin, so check the Real Employee Database via NextAuth
      const res = await signIn('employee-login', {
         redirect: false,
         email: empEmail, // Now accepts EMP-XXXX or email
         password: empPwd
      });

      if (res?.error) {
         toast.error("Invalid Credentials. Please check your ID and Password.");
      } else {
         localStorage.setItem('tt_emp_email', empEmail.toLowerCase()); 
         localStorage.setItem('tt_role', 'employee'); 
         window.open('/employee', '_blank');
         setEmpModalOpen(false);
      }
    } catch (err) { 
      toast.error('Login system failed. Check Network.'); 
    } finally { 
      setEmpLoading(false); 
    }
  };

  const handleClientReg = async (e) => {
    e.preventDefault();
    if (!clientRegForm.phone || clientRegForm.phone.length < 10) return toast.error("Enter a valid phone number");
    setSubmittingClientReg(true);
    try {
      await fetch('/api/client-prereg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clientRegForm) });
      toast.success("Details saved! Redirecting to secure profile setup...");
      setClientRegForm({ name: '', phone: '', enterprise: '' });
      setTimeout(() => { handleClientLogin(); }, 1500);
    } catch (err) { toast.error("Failed to register. Try again."); } finally { setSubmittingClientReg(false); }
  };

  const handleGuestQuery = async (e) => {
    e.preventDefault();
    if (!queryForm.phone || queryForm.phone.length < 10) return toast.error("Enter a valid phone number");
    setSubmittingLead(true);
    try {
      await fetch('/api/guest-queries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(queryForm) });
      toast.success("Query submitted successfully! Our team will contact you shortly.");
      setQueryForm({ name: '', phone: '', query: '' });
    } catch (e) { toast.error("Failed to submit query. Try again."); } finally { setSubmittingLead(false); }
  };

  // 🚀 FIXED: REAL PDF UNLOCK LOGIC & NETWORK ERROR BYPASS
  const tryUnlockPDF = async (t) => {
    const userMail = email || (typeof window !== 'undefined' ? localStorage.getItem('guest_email') : null);
    if (!userMail) {
       setPendingTender(t);
       setPaywallModal(true);
       return;
    }

    const toastId = toast.loading('Verifying secure access...');
    try {
       const res = await fetch(`/api/me?email=${encodeURIComponent(userMail)}`);
       const d = await res.json();
       
       let hasAccess = false;
       if (d.subscription && d.subscription.status === 'active') hasAccess = true;
       if (d.purchases && d.purchases.includes(t._id || t.id)) hasAccess = true;

       if (hasAccess) {
          toast.success('Access Granted!', { id: toastId });
          window.open(`/api/tenders/${t._id || t.id}/pdf?email=${encodeURIComponent(userMail)}&role=guest`, '_blank');
       } else {
          toast.dismiss(toastId);
          setPendingTender(t);
          setPaywallModal(true);
       }
    } catch (e) { toast.error('Network Error.', { id: toastId }); }
  };

  // Automated Cashfree Subscriptions Integration
  const executePayment = async (planId, userEmail, userPhone = "9999999999") => {
    setBuying(true); setGuestPayModal(false);
    await new Promise((r) => setTimeout(r, 250));

    const isSubscription = planId === 'month' || planId === 'year';
    
    try {
      const endpoint = isSubscription ? '/api/subscription/create' : '/api/payment/order';
      const r1 = await fetch(endpoint, { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ email: userEmail, phone: userPhone, plan: planId, tenderId: pendingTender?._id || pendingTender?.id }) 
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
    } catch (e) { toast.error('Could not start payment'); } finally { setBuying(false); }
  };

  const buyPlan = (planId) => {
    if (planId === 'single') {
       if (email) executePayment('single', email); 
       else { setPaywallModal(false); setGuestPayModal(true); } 
    } else {
       if (!email) { toast.info("Please sign in to Subscribe securely"); handleSubscribeLogin(); return; }
       executePayment(planId, email);
    }
  };

  // 🚀 FIXED: Handle ₹10 Purchase without real email
  const handleGuestPaySubmit = (e) => {
    e.preventDefault();
    if(!guestPayForm.name || guestPayForm.phone.length < 10) return toast.error("Enter valid name & phone number");
    
    // Create a dummy email based on phone number to store purchases in database securely
    const dummyEmail = `${guestPayForm.phone}@guest.tgtenders.in`;
    localStorage.setItem('guest_email', dummyEmail);
    
    executePayment('single', dummyEmail, guestPayForm.phone);
  };

  // Full Database Automation Form Submission 
  const submitOnboarding = async (e) => {
    e.preventDefault();
    if(!onboardForm.client_name || !onboardForm.company_name || !onboardForm.phone || !onboardForm.service) return toast.error('Please fill required fields');
    setSubmittingOnboard(true);
    try {
      await fetch('/api/users/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email, client_name: onboardForm.client_name, company_name: onboardForm.company_name, phone: onboardForm.phone, 
          company_type: onboardForm.company_type, service_category: onboardForm.service, 
          documents: { 
            has_gst: onboardForm.has_gst, has_esi: onboardForm.has_esi, has_epf: onboardForm.has_epf, has_iso: onboardForm.has_iso,
            has_bank: onboardForm.has_bank, has_pan: onboardForm.has_pan, has_aadhar: onboardForm.has_aadhar, has_dsc: onboardForm.has_dsc,
            has_ifsc: onboardForm.has_ifsc, has_fssai: onboardForm.has_fssai, has_cer: onboardForm.has_cer, 
            has_turnover: onboardForm.has_turnover, has_annual_returns: onboardForm.has_annual_returns, has_msme: onboardForm.has_msme
          }, 
          status: 'pending' // STRICT: Always pending for new clients
        })
      });
      toast.success('Profile created successfully! Sent for MD Approval.');
      setUserData(prev => ({ ...prev, onboarding_complete: true, is_approved: false }));
    } catch (err) { toast.error('Error submitting profile'); }
    setSubmittingOnboard(false);
  };

  if (status === 'loading' || loadingUser) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/></div>;

  // VERIFICATION LOCKOUT TRAP
  if (status === 'authenticated' && intent === 'client') {
     if (userData && !userData.onboarding_complete) {
        return (
          <div className="min-h-screen bg-slate-50 p-4 py-10 w-full overflow-x-hidden">
            <Card className="max-w-3xl mx-auto shadow-2xl">
              <CardHeader className="border-b bg-white text-center pb-6">
                 <UserCog className="w-10 h-10 mx-auto text-blue-600 mb-2" />
                 <CardTitle className="text-2xl text-[#0A2647]">Complete Your Business Profile</CardTitle>
              </CardHeader>
              <CardContent className="p-6 bg-slate-50/50">
                 <form onSubmit={submitOnboarding}>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div><Label>Client Name *</Label><Input required value={onboardForm.client_name} onChange={e => setOnboardForm({...onboardForm, client_name: e.target.value})} className="mt-1"/></div>
                      <div><Label>Contact Number *</Label><Input required type="tel" value={onboardForm.phone} onChange={e => setOnboardForm({...onboardForm, phone: e.target.value})} className="mt-1"/></div>
                      <div className="sm:col-span-2"><Label>Company / Firm Name *</Label><Input required value={onboardForm.company_name} onChange={e => setOnboardForm({...onboardForm, company_name: e.target.value})} className="mt-1"/></div>
                      <div>
                        <Label>Company Type *</Label>
                        <select required className="w-full border rounded-md p-2 mt-1 bg-white text-sm" value={onboardForm.company_type} onChange={e => setOnboardForm({...onboardForm, company_type: e.target.value})}>
                          <option value="Proprietor (Individual)">Proprietor (Individual)</option>
                          <option value="Partnership">Partnership</option>
                          <option value="Private Limited">Private Limited</option>
                          <option value="Public Limited">Public Limited</option>
                          <option value="LLP">LLP</option>
                        </select>
                      </div>
                      <div><Label>Core Service *</Label><Input required value={onboardForm.service} onChange={e => setOnboardForm({...onboardForm, service: e.target.value})} className="mt-1"/></div>
                    </div>
                    <div className="border-t pt-5 mt-4">
                      <Label className="text-[#0A2647] font-semibold block mb-1">Do you have these basic documents?</Label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_pan} onChange={e => setOnboardForm({...onboardForm, has_pan: e.target.checked})} /> PAN Card</label>
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_gst} onChange={e => setOnboardForm({...onboardForm, has_gst: e.target.checked})} /> GST Certificate</label>
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_bank} onChange={e => setOnboardForm({...onboardForm, has_bank: e.target.checked})} /> Bank Account</label>
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_ifsc} onChange={e => setOnboardForm({...onboardForm, has_ifsc: e.target.checked})} /> IFSC Details</label>
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_aadhar} onChange={e => setOnboardForm({...onboardForm, has_aadhar: e.target.checked})} /> Aadhar</label>
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_esi} onChange={e => setOnboardForm({...onboardForm, has_esi: e.target.checked})} /> ESI Registration</label>
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_epf} onChange={e => setOnboardForm({...onboardForm, has_epf: e.target.checked})} /> EPF Registration</label>
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_iso} onChange={e => setOnboardForm({...onboardForm, has_iso: e.target.checked})} /> ISO Certificate</label>
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_msme} onChange={e => setOnboardForm({...onboardForm, has_msme: e.target.checked})} /> MSME (Udyam)</label>
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_dsc} onChange={e => setOnboardForm({...onboardForm, has_dsc: e.target.checked})} /> DSC Class 3</label>
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_fssai} onChange={e => setOnboardForm({...onboardForm, has_fssai: e.target.checked})} /> FSSAI</label>
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_cer} onChange={e => setOnboardForm({...onboardForm, has_cer: e.target.checked})} /> CER</label>
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_turnover} onChange={e => setOnboardForm({...onboardForm, has_turnover: e.target.checked})} /> Turnover Cert.</label>
                        <label className="flex items-center gap-2 text-sm bg-white p-2 border rounded cursor-pointer hover:border-[#16a34a]"><input type="checkbox" className="accent-[#16a34a]" checked={onboardForm.has_annual_returns} onChange={e => setOnboardForm({...onboardForm, has_annual_returns: e.target.checked})} /> Annual Returns</label>
                      </div>
                    </div>
                    <Button type="submit" disabled={submittingOnboard} className="w-full bg-[#16a34a] hover:bg-[#15803d] h-12 text-base mt-6 shadow-sm">
                      {submittingOnboard ? 'Creating Profile...' : 'Save Profile & Enter Portal'}
                    </Button>
                 </form>
              </CardContent>
            </Card>
          </div>
        );
    } else if (userData && !userData.is_approved) {
        return (
          <div className="min-h-screen bg-[#0A2647] flex items-center justify-center p-4 w-full overflow-x-hidden">
            <Card className="max-w-md w-full bg-white text-center p-8 rounded-xl shadow-2xl">
              <ShieldCheck className="w-12 h-12 text-amber-600 mx-auto mb-4" />
              <h2 className="text-2xl font-extrabold text-[#0A2647] mb-4">Account Under Verification</h2>
              <p className="text-slate-700 text-sm mb-6">Your registration is successful. Dashboard access is locked pending <strong className="text-red-600">MD Approval</strong>.</p>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-8">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">For Immediate Approval Call MD:</p>
                <a href="tel:+916304486770" className="text-2xl font-black text-blue-600 hover:text-blue-800 hover:underline">+91 6304486770</a>
              </div>
              <Button onClick={performHardSignOut} variant="ghost" className="text-slate-500 hover:text-slate-800 font-semibold px-2"><LogOut className="w-4 h-4 mr-2" /> Log Out</Button>
            </Card>
          </div>
        );
    } 
  }

  // ==============================================================================
  // PUBLIC PORTAL
  // ==============================================================================
  return (
    <div className="min-h-screen bg-slate-50 pb-20 relative font-sans w-full overflow-x-hidden">
      
      {/* 🚀 FIXED: CLASSIC HEADER LAYOUT */}
      <header className="border-b bg-white sticky top-0 z-40 shadow-sm w-full">
        <div className="container mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          
          {/* Left Side: Telangana Tenders */}
          <div className="flex items-center gap-3">
             {brandSettings.logo ? (
                <img src={brandSettings.logo} alt="Logo" className="w-14 h-14 md:w-16 md:h-16 rounded object-contain" />
             ) : (
                <div className="w-14 h-14 bg-[#16a34a] rounded flex items-center justify-center text-white font-bold text-2xl">TT</div>
             )}
             <div className="hidden sm:block">
                <h1 className="text-2xl md:text-3xl font-extrabold text-[#0A2647] leading-tight">
                  Telangana Tenders
                </h1>
                <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">Consultancy Services & Corporate Approvals</p>
             </div>
          </div>

          {/* Right Side: GeM Logo & Login */}
          <div className="flex items-center gap-4">
            
            {/* GeM Logo Block */}
            <div className="hidden lg:flex flex-col items-center border-r pr-4 mr-1 border-slate-200">
               {brandSettings.gem_logo ? (
                  <img src={brandSettings.gem_logo} alt="GeM Logo" className="w-14 h-14 md:w-16 md:h-16 object-contain" />
               ) : (
                  <img src="https://gem.gov.in/resources/images/gem-new-logo-v6.svg" alt="GeM" className="w-14 h-14 md:w-16 md:h-16 object-contain" onError={(e) => e.target.style.display='none'}/>
               )}
               <span className="text-[10px] md:text-xs font-black text-[#0A2647] uppercase mt-1 tracking-wide">Bidding Service</span>
            </div>

            {subscription && subscription.status === 'active' ? (
              <Badge className="bg-[#16a34a] hover:bg-[#15803d] text-white text-[10px] sm:text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {subscription.plan === 'year' ? 'Pro' : 'Monthly'}
              </Badge>
            ) : null}

            {status === 'authenticated' ? (
              <div className="flex items-center gap-3">
                {userData?.onboarding_complete && (
                   <a href="/client" target="_blank" rel="noreferrer" className="text-sm font-bold text-[#0A2647] hover:text-[#16a34a] hidden md:inline border-r pr-3">
                     Client Dashboard
                   </a>
                )}
                <Button onClick={performHardSignOut} variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50 font-bold">
                  <LogOut className="w-4 h-4 mr-2"/> Sign Out
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Button onClick={() => setMainLoginModal(true)} className="bg-gradient-to-r from-[#0A2647] to-blue-900 hover:opacity-90 text-white shadow-lg text-sm md:text-base px-4 md:px-6">
                   Login / Sign Up
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 🌊 AUTO-SLIDING BANNERS (LIVE DATA ONLY) */}
      <section className="w-full relative h-[300px] md:h-[400px] overflow-hidden bg-slate-900 group">
        {brandSettings.banners && brandSettings.banners.length > 0 && (
          <>
            {brandSettings.banners.map((imgUrl, idx) => (
              <img key={idx} src={imgUrl} alt={`Banner ${idx}`} className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${idx === activeBanner ? 'opacity-100' : 'opacity-0'}`} />
            ))}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end justify-center pb-8">
                <Badge className="bg-[#16a34a] text-white border-0 text-sm md:text-base px-4 py-1 shadow-2xl">Official B2B Tenders Portal</Badge>
            </div>
            <button onClick={prevBanner} className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white p-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-20">
                <ChevronLeft className="w-8 h-8" />
            </button>
            <button onClick={nextBanner} className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white p-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-20">
                <ChevronRight className="w-8 h-8" />
            </button>
          </>
        )}
      </section>

      {/* 🚀 ADVANCED SEARCH */}
      <section className="container mx-auto px-4 -mt-8 z-20 relative">
        <Card className="shadow-2xl border-0 bg-white rounded-xl">
          <CardContent className="p-4 sm:p-6 space-y-4">
            
            <div className="flex bg-slate-50 border border-slate-200 rounded-lg p-3 items-center shadow-inner w-full">
               {loading ? <Loader2 className="w-5 h-5 text-blue-600 ml-2 mr-3 animate-spin shrink-0" /> : <Search className="w-5 h-5 text-blue-600 ml-2 mr-3 shrink-0" />}
               <input type="text" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search tenders by keywords..." className="flex-1 bg-transparent border-0 outline-none text-slate-700 font-bold min-w-0" />
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
            <div className="pt-4 flex gap-2 overflow-x-auto pb-2 scrollbar-hide items-center w-full">
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
        <div className="lg:col-span-3 space-y-6 w-full min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-black text-[#0A2647] uppercase tracking-wide">
              {appliedDay ? `Closing on ${appliedDay} ${monthName(appliedMonth - 1)}` : `Active Tenders for ${monthName(appliedMonth - 1)}`}
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
             <div className="grid gap-4 w-full">
               {filteredTenders.map(t => (
                 <Card key={t._id || t.id} className="hover:shadow-xl transition-all border-l-4 border-l-emerald-500 bg-white overflow-hidden">
                   <CardContent className="p-5 flex flex-col sm:flex-row items-start gap-4">
                     <div className="flex-1 min-w-0 w-full">
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
                     <Button onClick={() => tryUnlockPDF(t)} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 text-white shrink-0 w-full sm:w-auto h-11 shadow-md font-bold">
                       <FileText className="w-4 h-4 mr-2" /> View PDF
                     </Button>
                   </CardContent>
                 </Card>
               ))}
             </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6 w-full min-w-0">
          
          <Card className="border-0 shadow-xl bg-white rounded-xl overflow-hidden w-full">
            <CardHeader className="bg-gradient-to-r from-[#0A2647] to-blue-900 text-white py-4">
              <div className="flex justify-between items-center">
                 <CardTitle className="text-base flex items-center gap-2 font-bold"><CalendarDays className="w-4 h-4" /> Closing Dates</CardTitle>
                 <div className="flex items-center gap-1">
                   <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/20" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
                   <span className="text-xs font-black">{monthName(uiMonth - 1).slice(0,3)} {uiYear}</span>
                   <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/20" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
                 </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 w-full">
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide snap-x w-full">
                {validDays.map((d) => {
                  const has = calDays[d];
                  const count = has ? has.length : 0;
                  const isSelected = selectedDay === d;
                  return (
                    <div 
                      key={d} onClick={() => count > 0 && setSelectedDay(isSelected ? null : d)}
                      className={`snap-center shrink-0 w-14 h-16 rounded-lg border-2 flex flex-col items-center justify-center transition-all ${count > 0 ? 'cursor-pointer hover:border-emerald-500' : 'opacity-40 cursor-not-allowed bg-slate-50 border-slate-100'} ${isSelected ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg shadow-emerald-200' : 'bg-white'}`}
                    >
                       <span className="text-[10px] font-black uppercase text-slate-400 mb-0.5">{new Date(uiYear, uiMonth - 1, d).toLocaleDateString('en-US', { weekday: 'short' })}</span>
                       <span className={`text-lg font-black leading-none ${isSelected ? 'text-white' : 'text-[#0A2647]'}`}>{d}</span>
                       {count > 0 && <div className={`w-1.5 h-1.5 rounded-full mt-1 ${isSelected ? 'bg-white' : 'bg-emerald-500'}`}></div>}
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 flex gap-2 w-full">
                 <Button onClick={() => {
                    setAppliedMonth(uiMonth);
                    setAppliedYear(uiYear);
                    setAppliedDay(selectedDay);
                 }} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-9">Apply Filter</Button>
                 
                 <Button onClick={() => { 
                    setSelectedDay(null); 
                    setAppliedDay(null); 
                    setAppliedMonth(uiMonth);
                    setAppliedYear(uiYear);
                 }} variant="outline" className="flex-1 border-2 border-slate-200 h-9 font-bold text-slate-600">Clear</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-xl overflow-hidden relative transform transition hover:scale-[1.02] w-full">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl transform translate-x-10 -translate-y-10 pointer-events-none"></div>
            <CardContent className="p-6 relative z-10 w-full">
              <div className="flex items-center gap-2 mb-1">
                <Star className="w-5 h-5 text-yellow-200 fill-yellow-200" />
                <h3 className="font-black text-xl text-white uppercase tracking-wide">Register as Client</h3>
              </div>
              <p className="text-[11px] text-orange-100 mb-4 font-bold uppercase tracking-wider border-b border-orange-400/50 pb-2">Premium Partner Pre-Registration</p>
              
              <form onSubmit={handleClientReg} className="flex flex-col gap-3 w-full">
                <div><Input required placeholder="Your Name" value={clientRegForm.name} onChange={e => setClientRegForm({...clientRegForm, name: e.target.value})} className="bg-white/20 border-white/30 text-white placeholder:text-white/70 h-10 font-medium w-full" /></div>
                <div><Input required type="tel" placeholder="Phone Number" value={clientRegForm.phone} onChange={e => setClientRegForm({...clientRegForm, phone: e.target.value})} className="bg-white/20 border-white/30 text-white placeholder:text-white/70 h-10 font-medium w-full" /></div>
                <div><Input required placeholder="Enterprise / Company Name" value={clientRegForm.enterprise} onChange={e => setClientRegForm({...clientRegForm, enterprise: e.target.value})} className="bg-white/20 border-white/30 text-white placeholder:text-white/70 h-10 font-medium w-full" /></div>
                <Button type="submit" disabled={submittingClientReg} className="bg-white text-orange-600 hover:bg-slate-100 font-black w-full shadow-lg mt-2 h-11 text-sm uppercase tracking-wide">
                   {submittingClientReg ? <Loader2 className="w-5 h-5 animate-spin"/> : 'Submit & Setup Profile'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-xl bg-[#0A2647] text-white rounded-xl overflow-hidden relative w-full">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500 opacity-20 rounded-full blur-3xl transform translate-x-10 -translate-y-10 pointer-events-none"></div>
            <CardContent className="p-6 relative z-10 w-full">
              <h3 className="font-black text-xl mb-1 text-emerald-400">Need Expert Help?</h3>
              <p className="text-xs text-slate-300 mb-4 font-medium">Drop your query, and our MD's office will get back to you directly.</p>
              <form onSubmit={handleGuestQuery} className="flex flex-col gap-3 w-full">
                <div><Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Full Name</Label><Input required placeholder="E.g., John Doe" value={queryForm.name} onChange={e => setQueryForm({...queryForm, name: e.target.value})} className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 h-10 w-full" /></div>
                <div><Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Phone Number</Label><Input required type="tel" placeholder="+91" value={queryForm.phone} onChange={e => setQueryForm({...queryForm, phone: e.target.value})} className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 h-10 w-full" /></div>
                <div>
                  <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Your Query</Label>
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

      {/* 🚀 POWERFUL MNC VISION & SERVICES (LIVE DATA) */}
      <section className="bg-slate-900 py-20 relative overflow-hidden w-full">
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-blue-600/30 blur-[120px] rounded-full mix-blend-screen pointer-events-none"></div>
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-emerald-600/20 blur-[120px] rounded-full mix-blend-screen pointer-events-none"></div>
        
        <div className="container mx-auto px-4 relative z-10 w-full">
           <div className="max-w-4xl mx-auto text-center mb-20 bg-white/5 backdrop-blur-xl border border-white/10 p-10 rounded-3xl shadow-2xl">
              <TrendingUp className="w-14 h-14 mx-auto text-emerald-400 mb-6 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]" />
              <h3 className="text-3xl md:text-5xl font-black text-white mb-6 uppercase tracking-tight">Our Corporate Vision</h3>
              <p className="text-lg md:text-2xl text-slate-300 font-medium leading-relaxed">
                {brandSettings.vision_text || '"Empowering every young individual to become an entrepreneur and transforming middle-class dreams into business reality. We turn private individuals into trusted partners of the Government."'}
              </p>
           </div>

           <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20 w-full">
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

      {/* 🚀 DYNAMIC LEADERS PORTAL (LIVE DATA ONLY) */}
      {brandSettings.leaders && brandSettings.leaders.length > 0 && (
        <section className="bg-slate-50 py-20 border-t-4 border-[#0A2647] w-full relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 bg-emerald-500 rounded-b-full"></div>
          <div className="container mx-auto px-4 w-full">
            <div className="text-center mb-16">
               <h3 className="text-3xl md:text-4xl font-black text-[#0A2647] uppercase tracking-wide mb-4">Our Leadership</h3>
               <p className="text-slate-500 font-medium max-w-2xl mx-auto">Meet the visionaries driving our consultancy forward. Connect directly with our core management team.</p>
            </div>
            
            <div className="flex flex-wrap justify-center gap-8 w-full max-w-6xl mx-auto">
              {brandSettings.leaders.map((leader, i) => (
                <div key={i} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xl text-center w-full max-w-sm hover:-translate-y-2 hover:shadow-2xl transition-all duration-300 group">
                  
                  {/* Realistic Photo Container */}
                  <div className="relative w-36 h-36 mx-auto rounded-full overflow-hidden border-4 border-slate-100 group-hover:border-emerald-500 transition-colors mb-5 shadow-lg bg-white">
                    <img src={leader.image} alt={leader.name} className="w-full h-full object-cover object-top" />
                  </div>
                  
                  {/* Name & Designation */}
                  <h4 className="font-black text-2xl text-[#0A2647] mb-2">{leader.name}</h4>
                  <Badge className="bg-emerald-100 text-emerald-800 border-0 font-bold px-4 py-1.5 mb-5 text-xs tracking-wide uppercase">
                    {leader.role}
                  </Badge>
                  
                  {/* Contact Information (Rendered only if backend provides them) */}
                  {(leader.phone || leader.email) && (
                    <div className="border-t border-slate-100 pt-5 flex flex-col gap-3 items-center">
                      {leader.phone && (
                         <a href={`tel:${leader.phone}`} className="flex items-center gap-3 text-slate-600 hover:text-emerald-600 font-bold transition-colors text-sm w-full justify-center">
                           <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-emerald-50 transition-colors">
                             <Phone className="w-4 h-4" />
                           </div>
                           {leader.phone}
                         </a>
                      )}
                      {leader.email && (
                         <a href={`mailto:${leader.email}`} className="flex items-center gap-3 text-slate-600 hover:text-blue-600 font-bold transition-colors text-sm w-full justify-center">
                           <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                             <Mail className="w-4 h-4" />
                           </div>
                           <span className="truncate max-w-[200px]">{leader.email}</span>
                         </a>
                      )}
                    </div>
                  )}
                  
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FOOTER */}
      <footer className="bg-[#051324] text-white pt-16 pb-8 border-t-4 border-emerald-500 w-full relative">
        <div className="container mx-auto px-4 text-center w-full">
          <div className="flex justify-center items-center gap-2 mb-6">
            <Award className="w-10 h-10 text-emerald-500" />
            <h3 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-blue-400">{brandSettings.name}</h3>
          </div>
          <p className="text-slate-400 mb-8 max-w-2xl mx-auto text-sm font-medium leading-relaxed">
            Empowering every young individual to become an entrepreneur. We turn private businesses into trusted partners of the Government.
          </p>
          
          <div className="border-t border-white/10 pt-8 grid md:grid-cols-3 gap-6 text-left max-w-5xl mx-auto items-center w-full">
            <div>
              <p className="text-xs text-slate-500 mb-1 font-bold tracking-widest uppercase">Contact Us</p>
              <p className="text-sm text-slate-300 font-medium">support@tgtenders.co.in <br/> <a href="tel:+916304486770" className="hover:text-emerald-400 hover:underline transition text-base font-bold mt-1 inline-block text-emerald-500">+91 6304486770</a></p>
            </div>
            
            <div className="flex flex-col items-center justify-center bg-white/5 p-4 rounded-xl border border-white/10">
              <div className="flex items-center gap-2 text-emerald-400 mb-2">
                 <Activity className="w-4 h-4" />
                 <span className="text-[10px] font-bold tracking-widest uppercase">Portal Traffic</span>
              </div>
              <div className="flex items-center gap-6 text-center">
                <div>
                  <p className="text-xl font-black text-white">{visitors.today}</p>
                  <p className="text-[9px] text-slate-400 uppercase font-bold mt-1">Today</p>
                </div>
                <div className="w-px h-8 bg-slate-700"></div>
                <div>
                  <p className="text-xl font-black text-emerald-400">{visitors.total}</p>
                  <p className="text-[9px] text-slate-400 uppercase font-bold mt-1">Total Visitors</p>
                </div>
              </div>
            </div>

            <div className="md:text-right space-x-3 text-[10px] md:text-xs font-bold text-slate-400 flex justify-center md:justify-end">
               <button onClick={() => setPolicyModal('privacy')} className="hover:text-emerald-400 transition uppercase">Privacy Policy</button>
               <span>|</span>
               <button onClick={() => setPolicyModal('terms')} className="hover:text-emerald-400 transition uppercase">Terms</button>
               <span>|</span>
               <button onClick={() => setPolicyModal('refund')} className="hover:text-emerald-400 transition uppercase">Refund</button>
            </div>
          </div>
        </div>
      </footer>

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
             {/* 🚀 FIXED: HTML FORM INPUT TYPE CHANGED TO TEXT FOR EMP-ID */}
             <div>
                <Label className="font-bold text-slate-700">Employee ID or Email</Label>
                <Input type="text" placeholder="e.g. EMP-1001 or email@tgtenders.in" value={empEmail} onChange={e=>setEmpEmail(e.target.value)} required className="mt-1 border-2 h-11" />
             </div>
             <div>
                <Label className="font-bold text-slate-700">Password</Label>
                <Input type="password" value={empPwd} onChange={e=>setEmpPwd(e.target.value)} required className="mt-1 border-2 h-11" />
             </div>
             <Button type="submit" disabled={empLoading} className="w-full bg-[#0A2647] hover:bg-[#144272] h-12 mt-2 font-bold text-lg">
                {empLoading ? <Loader2 className="w-5 h-5 animate-spin"/> : 'Secure Login'}
             </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* 🚀 FIXED: GUEST PAY MODAL (Name and Phone) */}
      <Dialog open={guestPayModal} onOpenChange={setGuestPayModal}>
        <DialogContent className="sm:max-w-md border-0 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-black text-[#0A2647]"><Lock className="w-6 h-6 text-emerald-500" /> Unlock This PDF for ₹10</DialogTitle>
            <DialogDescription className="font-semibold text-slate-500">Provide Name & Phone so you can re-access this document anytime.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleGuestPaySubmit} className="space-y-4 pt-2">
            <div><Label className="font-bold text-slate-700">Full Name *</Label><Input type="text" required placeholder="Enter your name" value={guestPayForm.name} onChange={e => setGuestPayForm({...guestPayForm, name: e.target.value})} className="mt-1 border-2 h-11"/></div>
            <div><Label className="font-bold text-slate-700">Phone Number *</Label><Input type="tel" required placeholder="10-digit number" value={guestPayForm.phone} onChange={e => setGuestPayForm({...guestPayForm, phone: e.target.value})} className="mt-1 border-2 h-11"/></div>
            <Button type="submit" disabled={buying} className="w-full bg-emerald-600 hover:bg-emerald-500 h-12 mt-2 font-bold text-lg shadow-lg text-white">
              {buying ? <Loader2 className="w-5 h-5 animate-spin"/> : 'Proceed to Pay ₹10'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* PAYWALL */}
      <Dialog open={paywallModal} onOpenChange={setPaywallModal}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto bg-slate-50">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base sm:text-2xl font-black text-[#0A2647]"><Lock className="w-6 h-6 text-emerald-600" /> Unlock this Document</DialogTitle>
          </DialogHeader>
          <div className="grid sm:grid-cols-3 gap-4 mt-4">
            {PLANS.map((p) => (
              <div key={p.id} className={`rounded-2xl border-2 p-6 flex flex-col ${p.highlight ? 'border-emerald-500 bg-emerald-50 shadow-xl relative transform scale-105 z-10' : 'border-slate-200 bg-white'}`}>
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

      {/* 🚀 POLICY MODALS */}
      <Dialog open={!!policyModal} onOpenChange={(open) => !open && setPolicyModal(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto bg-white border-0 shadow-2xl">
          <DialogHeader className="mb-4 border-b pb-4">
            <DialogTitle className="text-2xl font-black text-[#0A2647] flex items-center gap-2">
              <FileBadge className="w-6 h-6 text-emerald-500" />
              {policyModal === 'terms' && 'Terms & Conditions'}
              {policyModal === 'privacy' && 'Privacy Policy'}
              {policyModal === 'refund' && 'Refund Policy'}
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-slate-600 space-y-5 leading-relaxed pb-4">
            {policyModal === 'terms' && (
               <>
                  <p className="font-semibold text-slate-800">Welcome to Telangana Tenders Consultancy Services. By using our portal, you agree to these terms.</p>
                  <div><h4 className="font-bold text-[#0A2647] text-lg mb-1">1. Service Description</h4><p>We provide B2B consultancy, bid management, and tender information. We are a private corporate entity and NOT an official government department.</p></div>
                  <div><h4 className="font-bold text-[#0A2647] text-lg mb-1">2. Document Unlocks</h4><p>PDF documents unlocked via our ₹10 plan or premium subscriptions are for internal business use only and cannot be resold.</p></div>
                  <div><h4 className="font-bold text-[#0A2647] text-lg mb-1">3. Account Verification</h4><p>Client accounts require mandatory MD approval. We reserve the right to suspend accounts providing false business details.</p></div>
               </>
            )}
            {policyModal === 'privacy' && (
               <>
                  <p className="font-semibold text-slate-800">Your privacy is strictly protected under our corporate policies.</p>
                  <div><h4 className="font-bold text-[#0A2647] text-lg mb-1">1. Data Collection</h4><p>We collect Name, Phone, Email, and Business Credentials (GST, PAN, etc.) solely for vendor registration and bid management operations.</p></div>
                  <div><h4 className="font-bold text-[#0A2647] text-lg mb-1">2. Data Security</h4><p>All corporate data is securely encrypted. We do not sell or share your business data with third-party marketers.</p></div>
                  <div><h4 className="font-bold text-[#0A2647] text-lg mb-1">3. Payment Processing</h4><p>Payments are securely handled by Cashfree. We do not store your credit card or UPI details on our servers.</p></div>
               </>
            )}
            {policyModal === 'refund' && (
               <>
                  <p className="font-semibold text-slate-800">Our refund policies are designed to be transparent and fair for B2B operations.</p>
                  <div><h4 className="font-bold text-[#0A2647] text-lg mb-1">1. Single Document Unlocks (₹10)</h4><p>Due to the digital nature of the PDFs, the ₹10 fee is strictly non-refundable once the document is successfully unlocked.</p></div>
                  <div><h4 className="font-bold text-[#0A2647] text-lg mb-1">2. Subscriptions</h4><p>Monthly and Yearly subscriptions auto-renew. You may cancel at any time to prevent future billing. Partial month refunds are not provided.</p></div>
                  <div><h4 className="font-bold text-[#0A2647] text-lg mb-1">3. Failed Transactions</h4><p>If your account is debited but the PDF does not unlock due to a technical error, the transaction will automatically be refunded to your original payment method by Cashfree within 5-7 business days.</p></div>
               </>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setPolicyModal(null)} className="bg-[#0A2647] hover:bg-[#144272] text-white font-bold px-8">Acknowledge & Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
