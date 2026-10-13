'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
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
  FileBadge, Activity, Eye, User, Sparkles, X, Phone, Smartphone
} from 'lucide-react';
import { TS_DISTRICTS, AP_DISTRICTS } from '@/lib/regions';
import { deskPathForDesignation } from '@/lib/designations';
import { numberedPageList } from '@/components/workflow/api';
import { liveTendersOnly } from '@/lib/tender-sort';
import { rememberRealClientIdent, rememberRealStaffIdent } from '@/lib/tab-handoff';
import GrowthPartnerPricing from '@/components/GrowthPartnerPricing';
import { hasCorePlanView } from '@/lib/billing-access';
import ViewUnlockModal from '@/components/ViewUnlockModal';

const PLANS = [
  { id: 'single', name: 'Single Document', price: 10, desc: 'Unlock only the PDF you clicked on', mode: 'oneoff', perks: ['Instant 1 PDF unlock', 'Email-watermarked download', 'No account required'], cta: 'Pay ₹10 for this PDF' },
  { id: 'month', name: 'Monthly Premium', price: 149, desc: 'Auto-renews every 30 days', mode: 'subscription', perks: ['Every tender unlocked', 'Full archive access', 'Cancel anytime'], cta: 'Subscribe ₹149/mo', highlight: true },
  { id: 'year', name: 'Yearly Premium', price: 1499, desc: 'Save big on yearly', mode: 'subscription', perks: ['Everything in Monthly', 'Save ₹289 vs 12× monthly', 'Cancel anytime'], cta: 'Subscribe ₹1499/yr' },
];

const monthName = (m) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m];

export default function App({ initialItems = [] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0); 
  const { data: session, status } = useSession();
  const router = useRouter();

  const [userData, setUserData] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [subscription, setSubscription] = useState(null);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallBtn, setShowInstallBtn] = useState(false);
  
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

  // Search & Filters
  const [uiYear, setUiYear] = useState(today.getFullYear());
  const [uiMonth, setUiMonth] = useState(today.getMonth() + 1);
  // 🚀 FIX: No default month/year filter — null means "fetch ALL active tenders" until the
  // user explicitly clicks "Apply Filter" on the calendar.
  const [appliedYear, setAppliedYear] = useState(null);
  const [appliedMonth, setAppliedMonth] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [appliedDay, setAppliedDay] = useState(null);
  
  const [category, setCategory] = useState('all');       
  const [stateFilter, setStateFilter] = useState('all'); 
  const [district, setDistrict] = useState('all');       
  const [searchQ, setSearchQ] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setSearchQ(q);
  }, []);

  const [tenders, setTenders] = useState([]);
  const [calDays, setCalDays] = useState({});
  const [loading, setLoading] = useState(false);

  // 🚀 Pagination (10 tenders per page)
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const tendersListRef = useRef(null);
  
  const [email, setEmail] = useState('');
  const [paywallModal, setPaywallModal] = useState(false);
  
  // 🚀 FIXED: GUEST PAY MODAL NOW USES NAME AND PHONE ONLY
  const [guestPayModal, setGuestPayModal] = useState(false);
  const [guestPayForm, setGuestPayForm] = useState({ name: '', phone: '' });
  
  const [pendingTender, setPendingTender] = useState(null);
  const [viewOffer, setViewOffer] = useState(false);
  const [pdfData, setPdfData] = useState(null);
  const [buying, setBuying] = useState(false);
  
  // LIVE API Settings
  const [brandSettings, setBrandSettings] = useState({ 
    name: 'TG Tenders', logo: null, gem_logo: null, banners: [], leaders: [], clients: [], vision_text: null 
  });
  const [activeBanner, setActiveBanner] = useState(0);
  const [bannerPaused, setBannerPaused] = useState(false);
  const [bannerResetKey, setBannerResetKey] = useState(0);
  const [logoFlip, setLogoFlip] = useState(false); // 🚀 3D Rotating Logo State for Loading Screen

  // Visitor API State
  const [visitors, setVisitors] = useState({ total: "Loading...", today: "..." });

  const [clientRegForm, setClientRegForm] = useState({ name: '', phone: '', enterprise: '' });
  const [submittingClientReg, setSubmittingClientReg] = useState(false);

  const [queryForm, setQueryForm] = useState({ name: '', phone: '', enterprise_name: '', area: '', query: '' });
  const [submittingLead, setSubmittingLead] = useState(false);

  const [policyModal, setPolicyModal] = useState(null);

  // 🚀 3D Earth-like Vertical Logo Rotation (Used only in Loader)
  useEffect(() => {
    const flipTimer = setInterval(() => setLogoFlip(prev => !prev), 4000);
    return () => clearInterval(flipTimer);
  }, []);

  // Auto-Slide Logic for Banners (30s; pause on hover; reset on manual click)
  useEffect(() => {
    if (!brandSettings.banners?.length || bannerPaused) return;
    const bannerTimer = setInterval(
      () => setActiveBanner((prev) => (prev + 1) % brandSettings.banners.length),
      30000
    );
    return () => clearInterval(bannerTimer);
  }, [brandSettings.banners, bannerPaused, bannerResetKey]);

  const prevBanner = () => {
    if (brandSettings.banners?.length > 0) {
      setActiveBanner(p => (p === 0 ? brandSettings.banners.length - 1 : p - 1));
      setBannerResetKey(k => k + 1);
    }
  }
  const nextBanner = () => {
    if (brandSettings.banners?.length > 0) {
      setActiveBanner(p => (p + 1) % brandSettings.banners.length);
      setBannerResetKey(k => k + 1);
    }
  }

  // URL Intent Tracking
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

  // ALL LIVE API FETCHES
  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((d) => { if(d.settings) setBrandSettings(d.settings); }).catch(()=>{});

    fetch('/api/analytics/visitors')
      .then(r => r.json())
      .then(d => { if(d) setVisitors(d); })
      .catch(()=>{});
  }, []);

  // 🚀 PWA App Installation Logic
  useEffect(() => {
    // 1. Register Service Worker
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW setup failed', err));
    }

    // 2. Capture the Install Prompt
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBtn(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setShowInstallBtn(false);
      setDeferredPrompt(null);
    }
  };
  useEffect(() => {
    if (status === 'authenticated' && session?.user?.email) {
      const e = session.user.email.toLowerCase();
      setEmail(e); 
      rememberRealClientIdent(e);
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
      if (typeof window !== 'undefined') {
        /* real client session lives in NextAuth + per-tab sessionStorage */
      }
      setEmail(''); 
      setUserData(null); 
      setLoadingUser(false);
    }
  }, [session, status]);

  useEffect(() => {
    if (status === 'authenticated' && userData !== null && !loadingUser) {
      if (intent === 'subscribe' || intent === 'client') {
        if (typeof window !== 'undefined') {
          const pending = sessionStorage.getItem('tt_pending_plan');
          window.location.href = (intent === 'subscribe' || pending) ? '/client?step=billing' : '/client';
          localStorage.removeItem('tt_intent');
          setIntent('');
        }
      }
    }
  }, [status, intent, userData, loadingUser]);
  const performHardSignOut = async () => {
    try {
      await fetch('/api/system/logout', { method: 'POST', credentials: 'include' });
    } catch { /* the cookie clear is best-effort */ }
    if (typeof window !== 'undefined') {
        localStorage.clear();
        sessionStorage.clear();
    }
    await signOut({ redirect: false }); 
    window.location.href = '/'; 
  };

  const fetchTenders = async () => {
    if (intent === 'client' && status === 'authenticated' && (!userData || !userData.onboarding_complete)) return; 
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (district !== 'all') params.set('district', district);
      if (category !== 'all') params.set('category', category);
      // 🚀 FIX: Only scope the fetch to a specific month/year when the user has explicitly
      // applied a calendar filter. Otherwise fetch ALL active tenders.
      if (appliedMonth && appliedYear) {
        params.set('month', String(appliedMonth));
        params.set('year', String(appliedYear));
      }
      if (searchQ.trim()) {
        params.set('q', searchQ.trim());
      }
      const r = await fetch(`/api/tenders?${params.toString()}&t=${Date.now()}`, { cache: 'no-store' });
      const d = await r.json(); 
      setTenders(d.tenders || []);
    } finally { setLoading(false); }
  };

  const fetchCalendar = async () => {
    if (intent === 'client' && status === 'authenticated' && (!userData || !userData.onboarding_complete)) return;
    const r = await fetch(`/api/tenders/calendar?month=${uiMonth}&year=${uiYear}&t=${Date.now()}`, { cache: 'no-store' });
    const d = await r.json(); 
    setCalDays(d.days || {});
  };

  useEffect(() => { fetchTenders(); }, [appliedMonth, appliedYear, district, category, searchQ]);
  useEffect(() => { fetchCalendar(); }, [uiMonth, uiYear]);

  // 🚀 FIX: Reset to page 1 whenever any filter is applied/cleared/changed, so the user
  // never lands on a stale, out-of-range page.
  useEffect(() => { setCurrentPage(1); }, [appliedMonth, appliedYear, appliedDay, district, category, searchQ]);

  const activeTenders = useMemo(() => liveTendersOnly(tenders), [tenders]);
  
  const filteredTenders = useMemo(() => {
    if (!appliedDay) return activeTenders; 
    return activeTenders.filter((t) => new Date(t.last_date).getDate() === appliedDay);
  }, [activeTenders, appliedDay]);

  // 🚀 Pagination: slice filteredTenders into pages of `itemsPerPage`
  const totalPages = Math.max(1, Math.ceil(filteredTenders.length / itemsPerPage));
  const paginatedTenders = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredTenders.slice(start, start + itemsPerPage);
  }, [filteredTenders, currentPage]);

  const goToPage = (page) => {
    const safePage = Math.min(Math.max(1, page), totalPages);
    setCurrentPage(safePage);
    // Smoothly scroll the user back to the top of the tenders list on page change
    tendersListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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

  const handleEmployeeLogin = async (e) => {
    e.preventDefault(); 
    setEmpLoading(true);
    try {
      const r = await fetch('/api/system/verify', { 
         method: 'POST', headers: { 'Content-Type': 'application/json' }, 
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
      
      const res = await signIn('employee-login', {
         redirect: false,
         email: empEmail, 
         password: empPwd
      });

      if (res?.error) {
         toast.error("Invalid Credentials. Please check your ID and Password.");
      } else {
         let desk = '/employee';
         try {
           const sessRes = await fetch('/api/auth/session');
           const sess = await sessRes.json();
           if (sess?.user?.role === 'MD') {
             desk = '/admin';
           } else {
             rememberRealStaffIdent(empEmail.toLowerCase());
             if (sess?.user?.designation) desk = deskPathForDesignation(sess.user.designation);
           }
         } catch (_) {
           rememberRealStaffIdent(empEmail.toLowerCase());
         }
         window.open(desk, '_blank');
         setEmpModalOpen(false);
      }
    } catch (err) { 
      console.error('Login Fetch Error:', err);
      toast.error('Connection blocked. Please disable Adblocker/Edge Shields.'); 
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
      toast.success('Details saved. Continuing to sign in.');
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
      setQueryForm({ name: '', phone: '', enterprise_name: '', area: '', query: '' });
    } catch (e) { toast.error("Failed to submit query. Try again."); } finally { setSubmittingLead(false); }
  };

  const tryUnlockPDF = async (t) => {
    const userMail = email || (typeof window !== 'undefined' ? localStorage.getItem('guest_email') : null);
    if (!userMail) {
       setPendingTender(t);
       setViewOffer(true);
       return;
    }

    // 🚀 FIX (PDF never opened): the window.open() below used to run *after* awaiting
    // /api/me. By then the user-gesture chain is broken, so Chrome/Edge/Safari silently
    // block the popup — nothing happened and nothing was logged. Claim the tab
    // synchronously while still inside the click handler, then point it at the PDF once
    // access is verified (or close it if access is denied).
    const viewer = window.open('', '_blank');
    const toastId = toast.loading('Verifying secure access...');
    try {
       const res = await fetch(`/api/me?email=${encodeURIComponent(userMail)}`);
       const d = await res.json();
       
       const tenderId = String(t._id || t.id);
       const sub = d.subscription || {};
       const viewUntil = sub.view_until ? new Date(sub.view_until) : null;
       const viewWindow = sub.view_source === 'pricing_master' && viewUntil && viewUntil > new Date();
       const unlocked = Array.isArray(d.view_unlocks) && d.view_unlocks.some((row) => String(row.tender_id) === tenderId);
       const hasAccess = viewWindow || unlocked || hasCorePlanView(d);

       if (hasAccess) {
          toast.success('Access Granted!', { id: toastId });
          const pdfUrl = `/api/tenders/${t._id || t.id}/pdf?email=${encodeURIComponent(userMail)}&role=guest`;
          if (viewer && !viewer.closed) viewer.location.href = pdfUrl;
          else window.location.href = pdfUrl; // popup blocked entirely — navigate in place
       } else {
          if (viewer && !viewer.closed) viewer.close();
          toast.dismiss(toastId);
          setPendingTender(t);
          setViewOffer(true);
       }
    } catch (e) {
       if (viewer && !viewer.closed) viewer.close();
       toast.error('Network Error.', { id: toastId });
    }
  };

  const executePayment = async (planId, userEmail, userPhone = "9999999999") => {
    setBuying(true); setGuestPayModal(false);
    await new Promise((r) => setTimeout(r, 250));

    const isSubscription = planId === 'month' || planId === 'year';
    
    try {
      const endpoint = isSubscription ? '/api/subscription/create' : '/api/payment/order';
      const r1 = await fetch(endpoint, { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({
          email: userEmail,
          phone: userPhone,
          plan: planId,
          tenderId: pendingTender?._id || pendingTender?.id,
          return_to: '/',
        })
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
        returnUrl: `${window.location.origin}/payment-status?order_id={order_id}`,
      };
      
      cashfree.checkout(checkoutOptions).then((result) => {
         if (result && result.error) {
            toast.error(result.error.message || "Payment was cancelled.");
            setBuying(false); 
         }
      });
      
    } catch (e) { 
      toast.error('Could not start payment'); 
      setBuying(false); 
    } 
  }; // <-- 🚀 FIX: ఈ క్లోజింగ్ బ్రాకెట్ మిస్ అవ్వడం వల్లే <eof> ఎర్రర్ వచ్చింది!
  const chooseCatalogPlan = (intent) => {
    const serviceKey = intent?.planId || intent;
    const planIds = intent?.planIds;
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('tt_pending_plan', serviceKey);
      if (intent?.bidCount) sessionStorage.setItem('tt_pending_bid_count', String(intent.bidCount));
      else sessionStorage.removeItem('tt_pending_bid_count');
      if (intent?.months) sessionStorage.setItem('tt_pending_months', String(intent.months));
      else sessionStorage.removeItem('tt_pending_months');
      if (planIds?.length) sessionStorage.setItem('tt_pending_plans', JSON.stringify(planIds));
      else sessionStorage.removeItem('tt_pending_plans');
      if (intent?.tenderId) sessionStorage.setItem('tt_pending_tender', intent.tenderId);
    }
    if (!email) {
      toast.info('Please sign in to subscribe securely');
      handleSubscribeLogin();
      return;
    }
    window.location.href = '/client?step=billing';
  };
  const buyPlan = (planId) => {
    const catalogKey = planId === 'month' ? 'view_month' : planId === 'year' ? 'view_year' : planId === 'single' ? 'view_single' : planId;
    if (typeof window !== 'undefined') sessionStorage.setItem('tt_pending_plan', catalogKey);
    if (planId === 'single') {
       if (email) executePayment('single', email); 
       else { setPaywallModal(false); setGuestPayModal(true); } 
    } else {
       if (!email) { toast.info("Please sign in to Subscribe securely"); handleSubscribeLogin(); return; }
       executePayment(planId, email);
    }
  };

  // 🚀 FIXED: Handling ₹10 Purchase without email (Using Name and Phone)
  const handleGuestPaySubmit = (e) => {
    e.preventDefault();
    if(!guestPayForm.name || guestPayForm.phone.length < 10) return toast.error("Enter valid name & phone number");
    
    // Create a dummy email based on phone number to store purchases in database securely
    const dummyEmail = `${guestPayForm.phone}@guest.tgtenders.in`;
    localStorage.setItem('guest_email', dummyEmail);
    
    executePayment('single', dummyEmail, guestPayForm.phone);
  };

  // 🚀 FIXED: 3D ANIMATED SPINNER LOADER
  if (status === 'authenticated' && loadingUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
         <div className="relative w-24 h-24 shrink-0 [perspective:1000px] mb-6">
            <div className={`w-full h-full absolute transition-transform duration-1000 [transform-style:preserve-3d] ${logoFlip ? '[transform:rotateX(180deg)]' : ''}`}>
               <div className="absolute inset-0 [backface-visibility:hidden] bg-white rounded-full p-2 border shadow-lg flex items-center justify-center">
                  {brandSettings.logo ? <Image src={brandSettings.logo} alt="" width={96} height={96} className="w-full h-full object-contain"/> : <div className="text-[#16a34a] font-bold text-2xl">TT</div>}
               </div>
               <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateX(180deg)] bg-white rounded-full p-2 border shadow-lg flex items-center justify-center">
                  {brandSettings.gem_logo ? <Image src={brandSettings.gem_logo} alt="" width={96} height={96} className="w-full h-full object-contain"/> : <Image src="https://gem.gov.in/resources/images/gem-new-logo-v6.svg" alt="" width={96} height={96} className="w-full h-full object-contain"/>}
               </div>
            </div>
         </div>
         <Loader2 className="w-6 h-6 animate-spin text-[#0A2647] mb-2"/>
         <p className="text-[#0A2647] font-bold tracking-widest uppercase text-sm animate-pulse">Loading Portal...</p>
      </div>
    );
  }

  if (status === 'authenticated' && userData && (intent === 'client' || intent === 'subscribe')) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-[#0A2647] mb-3" />
        <p className="text-[#0A2647] font-bold">Continuing to the next step...</p>
      </div>
    );
  }

 // ==============================================================================
  // PUBLIC PORTAL
  // ==============================================================================
  return (
    <div className="min-h-screen bg-slate-50 pb-20 relative font-sans w-full overflow-x-hidden">
      
      {/* 🚀 FIXED: RESTORED CLASSIC STATIC HEADER */}
      <header className="border-b bg-white sticky top-0 z-40 shadow-sm w-full">
        <div className="container mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          
          {/* Left Side: Telangana Tenders */}
          <div className="flex items-center gap-3">
             <div className="w-14 h-14 md:w-16 md:h-16 rounded bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
               {brandSettings?.logo ? (
                  <Image
                    src={brandSettings.logo}
                    alt="TG Tenders company logo"
                    width={64}
                    height={64}
                    priority
                    className="w-full h-full object-contain"
                  />
               ) : (
                  <div className="w-full h-full bg-[#16a34a] flex items-center justify-center text-white font-bold text-2xl">TT</div>
               )}
             </div>
             <div className="hidden sm:block">
                <h1 className="text-2xl md:text-3xl font-extrabold leading-tight">
                  <span className="text-[#0A2647]">TG</span> <span className="text-[#16a34a]">Tenders</span>
                </h1>
                <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">Consultancy Services & Corporate Approvals</p>
             </div>
          </div>
          
          {/* Right Side: GeM Logo & Login */}
          <div className="flex items-center gap-4">
            
            {/* GeM Logo Block */}
            <div className="hidden lg:flex flex-col items-center border-r pr-4 mr-1 border-slate-200">
               {brandSettings?.gem_logo ? (
                  <Image
                    src={brandSettings.gem_logo}
                    alt="Government e-Marketplace (GeM) official logo — GeM Tenders bidding partner"
                    width={64}
                    height={64}
                    className="w-14 h-14 md:w-16 md:h-16 object-contain"
                  />
               ) : (
                  <Image
                    src="https://gem.gov.in/resources/images/gem-new-logo-v6.svg"
                    alt="Government e-Marketplace (GeM) official logo — GeM Tenders bidding partner"
                    width={64}
                    height={64}
                    className="w-14 h-14 md:w-16 md:h-16 object-contain"
                    onError={(e) => e.target.style.display='none'}
                  />
               )}
               <span className="text-[10px] md:text-xs font-black text-[#0A2647] uppercase mt-1 tracking-wide">Bidding Service</span>
            </div>

            {subscription?.planType === 'UNLIMITED' && subscription?.status === 'active' ? (
              <Badge className="bg-[#16a34a] hover:bg-[#15803d] text-white text-[10px] sm:text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Participate
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
          {/* End of Right Side */}

        </div>
      </header>

      {/* Main Content follows below... */}
      <section
        className="w-full max-w-none px-0 mx-0 relative overflow-hidden bg-slate-900 group"
        onMouseEnter={() => setBannerPaused(true)}
        onMouseLeave={() => setBannerPaused(false)}
      >
        <div className="relative w-full max-w-none aspect-[3/1]">
        {brandSettings.banners && brandSettings.banners.length > 0 && (
          <>
            {brandSettings.banners.map((imgUrl, idx) => (
              <Image
                key={idx}
                src={imgUrl}
                alt="Telangana Tenders and Andhra Tenders — official B2B Tenders Portal for government & GeM tenders"
                fill
                priority={idx === activeBanner}
                sizes="100vw"
                className={`w-full h-full object-cover object-center transition-opacity duration-200 ${idx === activeBanner ? 'opacity-100' : 'opacity-0'}`}
              />
            ))}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent flex items-end justify-center pb-6 pointer-events-none">
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
        </div>
      </section>

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
        <div className="lg:col-span-3 space-y-6 w-full min-w-0" ref={tendersListRef}>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black text-[#0A2647] uppercase tracking-wide">
              {appliedDay
                ? `Closing on ${appliedDay} ${monthName(appliedMonth - 1)}`
                : (appliedMonth && appliedYear)
                  ? `Active Tenders for ${monthName(appliedMonth - 1)}`
                  : 'All Active Tenders'}
            </h2>
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
             <>
               <div className="grid gap-4 w-full">
                 {paginatedTenders.map(t => (
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
                         <h3 className="font-bold text-slate-800 text-lg mb-1 leading-snug line-clamp-2">{t.title}</h3>
                         <p className="text-sm text-slate-500 flex items-center gap-1 font-semibold"><Building2 className="w-4 h-4 text-slate-400" /> {t.department}</p>
                       </div>
                       <Button onClick={() => tryUnlockPDF(t)} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 text-white shrink-0 w-full sm:w-auto h-11 shadow-md font-bold">
                         <FileText className="w-4 h-4 mr-2" /> View PDF
                       </Button>
                     </CardContent>
                   </Card>
                 ))}
               </div>

               {/* 🚀 Pagination Controls (10 per page) */}
               {totalPages > 1 && (
                 <div className="flex items-center justify-center flex-wrap gap-1.5 pt-4">
                   <Button
                     variant="outline"
                     onClick={() => goToPage(currentPage - 1)}
                     disabled={currentPage === 1}
                     className="border-2 font-bold text-slate-600 disabled:opacity-40"
                   >
                     <ChevronLeft className="w-4 h-4" />
                   </Button>
                   {numberedPageList(currentPage, totalPages).map((p, i, arr) => (
                     <span key={p} className="inline-flex items-center gap-1.5">
                       {i > 0 && p - arr[i - 1] > 1 && <span className="text-xs text-slate-400 px-0.5">…</span>}
                       <Button
                         size="sm"
                         variant={p === currentPage ? 'default' : 'outline'}
                         className={`h-9 w-9 p-0 text-xs font-bold ${p === currentPage ? 'bg-[#0A2647]' : ''}`}
                         onClick={() => goToPage(p)}
                       >
                         {p}
                       </Button>
                     </span>
                   ))}
                   <Button
                     variant="outline"
                     onClick={() => goToPage(currentPage + 1)}
                     disabled={currentPage === totalPages}
                     className="border-2 font-bold text-slate-600 disabled:opacity-40"
                   >
                     <ChevronRight className="w-4 h-4" />
                   </Button>
                 </div>
               )}
             </>
          )}
        </div>

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
                    // 🚀 Explicit "Apply Filter" click — now the fetch/UI is scoped to this month/day
                    setAppliedMonth(uiMonth);
                    setAppliedYear(uiYear);
                    setAppliedDay(selectedDay);
                 }} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-9">Apply Filter</Button>
                 
                 <Button onClick={() => { 
                    // 🚀 "Clear" resets everything back to showing ALL active tenders
                    setSelectedDay(null); 
                    setAppliedDay(null); 
                    setAppliedMonth(null);
                    setAppliedYear(null);
                 }} variant="outline" className="flex-1 border-2 border-slate-200 h-9 font-bold text-slate-600">Clear</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-xl overflow-hidden relative transform transition hover:scale-[1.02] w-full">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl transform translate-x-10 -translate-y-10 pointer-events-none"></div>
            <CardContent className="p-6 relative z-10 w-full">
              <div className="flex items-center gap-2 mb-1">
                <Star className="w-5 h-5 text-yellow-200 fill-yellow-200" />
                <h2 className="font-black text-xl text-white uppercase tracking-wide">Register as Client</h2>
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
              <h2 className="font-black text-xl mb-1 text-emerald-400">Need Expert Help?</h2>
              <p className="text-xs text-slate-300 mb-4 font-medium">Drop your query, and our MD's office will get back to you directly.</p>
              <form onSubmit={handleGuestQuery} className="flex flex-col gap-3 w-full">
                <div><Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Full Name</Label><Input required placeholder="E.g., John Doe" value={queryForm.name} onChange={e => setQueryForm({...queryForm, name: e.target.value})} className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 h-10 w-full" /></div>
                <div><Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Enterprise Name</Label><Input required placeholder="Company name" value={queryForm.enterprise_name} onChange={e => setQueryForm({...queryForm, enterprise_name: e.target.value})} className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 h-10 w-full" /></div>
                <div><Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Phone Number</Label><Input required type="tel" placeholder="+91" value={queryForm.phone} onChange={e => setQueryForm({...queryForm, phone: e.target.value})} className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 h-10 w-full" /></div>
                <div><Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Area</Label><Input required placeholder="City or district" value={queryForm.area} onChange={e => setQueryForm({...queryForm, area: e.target.value})} className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 h-10 w-full" /></div>
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

      <section className="bg-slate-900 py-20 relative overflow-hidden w-full">
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-blue-600/30 blur-[120px] rounded-full mix-blend-screen pointer-events-none"></div>
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-emerald-600/20 blur-[120px] rounded-full mix-blend-screen pointer-events-none"></div>
        
        <div className="container mx-auto px-4 relative z-10 w-full">
           <div className="max-w-4xl mx-auto text-center mb-20 bg-white/5 backdrop-blur-xl border border-white/10 p-10 rounded-3xl shadow-2xl">
              <TrendingUp className="w-14 h-14 mx-auto text-emerald-400 mb-6 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]" />
              <h2 className="text-3xl md:text-5xl font-black text-white mb-6 uppercase tracking-tight">Our Corporate Vision</h2>
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
                  <h3 className="font-bold text-white text-xl mb-2">{svc.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{svc.desc}</p>
                </div>
              ))}
           </div>
        </div>
      </section>

      <GrowthPartnerPricing onSubscribe={chooseCatalogPlan} initialItems={initialItems} />
      <ViewUnlockModal
        open={viewOffer}
        tenderTitle={pendingTender?.title}
        initialItems={initialItems}
        onClose={() => setViewOffer(false)}
        onChoose={(planKey) => {
          setViewOffer(false);
          chooseCatalogPlan({
            planId: planKey,
            tenderId: planKey === 'view_single' ? String(pendingTender?._id || pendingTender?.id || '') : undefined,
          });
        }}
      />

      {/* 🚀 DYNAMIC LEADERS PORTAL */}
      {brandSettings.leaders && brandSettings.leaders.length > 0 && (
        <section className="bg-slate-50 py-20 border-t-4 border-[#0A2647] w-full relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 bg-emerald-500 rounded-b-full"></div>
          <div className="container mx-auto px-4 w-full">
            <div className="text-center mb-16">
               <h2 className="text-3xl md:text-4xl font-black text-[#0A2647] uppercase tracking-wide mb-4">Our Leadership</h2>
               <p className="text-slate-500 font-medium max-w-2xl mx-auto">Meet the visionaries driving our consultancy forward. Connect directly with our core management team.</p>
            </div>
            
            <div className="flex flex-wrap justify-center gap-8 w-full max-w-6xl mx-auto">
              {brandSettings.leaders.map((leader, i) => (
                <div key={i} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xl text-center w-full max-w-sm hover:-translate-y-2 hover:shadow-2xl transition-all duration-300 group">
                  <div className="relative w-36 h-36 mx-auto rounded-full overflow-hidden border-4 border-slate-100 group-hover:border-emerald-500 transition-colors mb-5 shadow-lg bg-white">
                    <Image src={leader.image} alt={`${leader.name} — Telangana Tenders leadership team`} fill sizes="144px" className="object-cover object-top" />
                  </div>
                  <h3 className="font-black text-2xl text-[#0A2647] mb-2">{leader.name}</h3>
                  <Badge className="bg-emerald-100 text-emerald-800 border-0 font-bold px-4 py-1.5 mb-5 text-xs tracking-wide uppercase">
                    {leader.role}
                  </Badge>
                  {(leader.phone || leader.email) && (
                    <div className="border-t border-slate-100 pt-5 flex flex-col gap-3 items-center">
                      {leader.phone && (
                         <a href={`tel:${leader.phone}`} className="flex items-center gap-3 text-slate-600 hover:text-emerald-600 font-bold transition-colors text-sm w-full justify-center">
                           <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-emerald-50 transition-colors"><Phone className="w-4 h-4" /></div>{leader.phone}
                         </a>
                      )}
                      {leader.email && (
                         <a href={`mailto:${leader.email}`} className="flex items-center gap-3 text-slate-600 hover:text-blue-600 font-bold transition-colors text-sm w-full justify-center">
                           <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-blue-50 transition-colors"><Mail className="w-4 h-4" /></div><span className="truncate max-w-[200px]">{leader.email}</span>
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

      {/* 🚀 OUR PRESTIGIOUS CLIENTS SHOWCASE */}
      {brandSettings.clients && brandSettings.clients.length > 0 && (
        <section className="bg-white py-20 border-t-4 border-[#16a34a] w-full relative">
          <div className="container mx-auto px-4 w-full">
            <div className="text-center mb-16">
               <h2 className="text-3xl md:text-4xl font-black text-[#0A2647] uppercase tracking-wide mb-4">Our Prestigious Clients</h2>
               <p className="text-slate-500 font-medium max-w-2xl mx-auto">Proudly serving top enterprises and successfully executing government contracts.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-8 w-full max-w-6xl mx-auto">
              {brandSettings.clients.map((client, i) => (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-2xl p-6 shadow-md text-center w-full max-w-xs hover:-translate-y-2 hover:shadow-xl transition-all duration-300 group">
                  <div className="relative w-24 h-24 mx-auto rounded-full overflow-hidden border-4 border-white shadow-md mb-4 bg-white">
                    <Image src={client.image || 'https://via.placeholder.com/150'} alt={`${client.company_name} — Telangana Tenders client`} fill sizes="96px" className="object-cover" />
                  </div>
                  <h3 className="font-black text-xl text-[#0A2647] mb-1">{client.company_name}</h3>
                  <p className="text-sm font-bold text-slate-600 mb-3">{client.client_name}</p>
                  <Badge className="bg-blue-100 text-blue-800 border-0 font-mono tracking-widest text-[10px]">
                    UDYAM: {client.udyam_no || 'N/A'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

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

      {/* 🚀 FLOATING SOCIAL MEDIA & SHARE BUTTONS */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 items-center">
        {showInstallBtn && (
          <button
            type="button"
            onClick={handleInstallApp}
            className="bg-[#16a34a] text-white p-3 rounded-full shadow-lg hover:scale-110 transition-transform flex items-center justify-center"
            title="Install TG Tenders App"
            aria-label="Install TG Tenders App"
          >
            <Smartphone className="w-6 h-6" />
          </button>
        )}
        {/* Web Share Button */}
        <button onClick={() => {
            if (navigator.share) {
                navigator.share({ title: 'Telangana Tenders', text: 'Check out official B2B tender consultancy services!', url: window.location.href })
                .catch(console.error);
            } else {
                toast.info("Sharing not supported on this browser.");
            }
        }} className="bg-blue-600 text-white p-3 rounded-full shadow-lg hover:scale-110 transition-transform flex items-center justify-center" title="Share Website">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
        </button>
        {/* YouTube */}
        <a href="https://www.youtube.com/@esakafficial1237" target="_blank" rel="noreferrer" className="bg-white text-[#FF0000] p-3 rounded-full shadow-lg hover:scale-110 transition-transform flex items-center justify-center" title="YouTube">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
        </a>
        {/* Instagram */}
        <a href="https://www.instagram.com/telangana_tenders?igsh=MWIzbTAyZmE2OHkyMQ==" target="_blank" rel="noreferrer" className="bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888] text-white p-3 rounded-full shadow-lg hover:scale-110 transition-transform flex items-center justify-center" title="Instagram">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>
        </a>
        {/* WhatsApp */}
        <a href="https://whatsapp.com/channel/0029VbD5F2h2975IQSMPVK2x" target="_blank" rel="noreferrer" className="bg-[#25D366] text-white p-4 rounded-full shadow-2xl hover:scale-110 transition-transform flex items-center justify-center border-2 border-white" title="WhatsApp">
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
