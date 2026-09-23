'use client';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react'; 
import BrandLogo from '@/components/BrandLogo';
import { liveTendersOnly } from '@/lib/tender-sort';
import { consumeClientBypass, clientHeaders, clientSessionIdent, rememberRealClientIdent } from '@/lib/tab-handoff';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { load } from '@cashfreepayments/cashfree-js'; 
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Briefcase, CheckCircle2, AlertTriangle, FileText, Clock, ShieldAlert, Send, 
  MessageSquare, Target, UserCheck, Upload, Banknote, BellRing, Loader2, LogOut, 
  FileUp, Download, Activity, Building2, ChevronDown, UserCircle, UploadCloud, 
  Globe, Database, PhoneCall, Plus, Trash2, Trophy, Eye, ShieldCheck, XCircle,
  IndianRupee, PenTool, Printer, UserCog, Sparkles, Wand2, Lock, FileSignature,
  Handshake, Landmark, Gavel, ScrollText, Search
} from 'lucide-react';
import { formatINR } from '@/lib/format';
import CompactTenderCard, { TrackingProgressBar } from '@/components/workflow/CompactTenderCard';
import ClientWinningBoard from '@/components/workflow/ClientWinningBoard';
import { openClientWorkflowFile } from '@/components/workflow/api';
import { mergeTrackingEvent, useWorkflowStream } from '@/components/workflow/useWorkflowStream';
import { belongsOnInternal } from '@/lib/job-board-state';
import { CLIENT_TRACKING_ORDER, clientTrackingStage } from '@/lib/tracking-status';

function isClientSubmittedTrackingJob(job) {
  if (!job || job.status === 'WON') return false;
  if (job.status === 'SUBMITTED') return true;
  const display = String(job.display_status || '');
  return display === 'Submitted'
    || display === 'Technical Evaluation'
    || display === 'Financial Evaluation'
    || display === 'Technical evaluation'
    || display === 'Financial evaluation'
    || display === 'Bid Awarded';
}

function uniqueClientTrackingJobs(jobs) {
  const seen = new Set();
  return (Array.isArray(jobs) ? jobs : []).filter((job) => {
    if (!belongsOnInternal(job) && !isClientSubmittedTrackingJob(job)) return false;
    const id = String(job._id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const DEFAULT_VAULT_DOCS = [
  { id: 'aadhaar', name: 'Aadhaar Card', status: 'missing', file: null },
  { id: 'pan', name: 'PAN Card', status: 'missing', file: null },
  { id: 'bank_account', name: 'Bank Account Details', status: 'missing', file: null },
  { id: 'cancelled_check', name: 'Cancelled Check', status: 'missing', file: null },
  { id: 'dsc', name: 'DSC (Class 3)', status: 'missing', file: null },
  { id: 'msme', name: 'MSME (Udyam)', status: 'missing', file: null },
  { id: 'iso', name: 'ISO Certificate', status: 'missing', file: null },
  { id: 'ca_turnover', name: 'Last 3 Years CA Turnover', status: 'missing', file: null },
  { id: 'annual_returns', name: 'Annual Returns / ITR', status: 'missing', file: null },
  { id: 'fssai', name: 'FSSAI License', status: 'missing', file: null },
  { id: 'firm_reg', name: 'Firm / Pvt Ltd Registration', status: 'missing', file: null },
  { id: 'other_license', name: 'Other Trade Licenses', status: 'missing', file: null }
];

// Mirrors VAULT_MAX_UPLOAD_BYTES on the server. The ceiling comes from Vercel's ~4.5MB
// serverless request body limit, not from R2 — a larger file is rejected by the platform
// before our handler ever sees it, so we check here first and explain it properly.
const VAULT_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export default function ClientDashboard() {
  const { data: session, status } = useSession(); 
  
  const [isMounted, setIsMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  // 🚀 RBAC: this dashboard has no separate "client" vs "MD"/"employee" route — an
  // MD/employee reaches this exact page via the admin panel's "Login as Client
  // (Bypass)" button (app/admin/page.js -> impersonateUser), which just sets the
  // same `tt_email` this page normally reads for a real client login. The one
  // reliable signal that the current browser tab belongs to staff previewing the
  // client view (rather than an actual client) is that their OWN admin/employee
  // token is also present in localStorage — a real client never has those set.
  const [isStaffPreview, setIsStaffPreview] = useState(false);

  // --- Core State ---
  const [userData, setUserData] = useState(null);
  const [clientId, setClientId] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [publicTenders, setPublicTenders] = useState([]);
  const [liveTenderSearch, setLiveTenderSearch] = useState('');
  const [buying, setBuying] = useState(false);
  const [alertReplyText, setAlertReplyText] = useState({}); 

  // --- Highlight State for UX Scrolling ---
  const [highlightedSection, setHighlightedSection] = useState('');

  // --- Forms State ---
  const [customTenderForm, setCustomTenderForm] = useState({ link_or_id: '', description: '', file: null });
  const [ticketForm, setTicketForm] = useState({ subject: '', message: '' });
  const [ticketReplyClient, setTicketReplyClient] = useState({}); 

  // --- Query Reply State --- 
  const [queryForm, setQueryForm] = useState({ description: '', file: null });
  const [submittingQuery, setSubmittingQuery] = useState(false);

  const [customDocForm, setCustomDocForm] = useState({ name: '', file: null });
  const [uploadingCustom, setUploadingCustom] = useState(false);
  const [uploadingDocId, setUploadingDocId] = useState(null);

  // --- AI Document Generator ---
  const [docTypes, setDocTypes] = useState([]);
  const [docForm, setDocForm] = useState({ doc_type: '', tender_id: '', instructions: '' });
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState(null);

  const [submittingAgreement, setSubmittingAgreement] = useState(false);

  // --- Onboarding Profile State ---
  const [submittingOnboard, setSubmittingOnboard] = useState(false);
  const [localOnboardComplete, setLocalOnboardComplete] = useState(false); 
  const [onboardForm, setOnboardForm] = useState({
    client_name: '', company_name: '', phone: '', company_type: 'Proprietor (Individual)', service: '', 
    has_gst: false, has_esi: false, has_epf: false, has_iso: false, has_bank: false, has_pan: false, 
    has_aadhar: false, has_dsc: false, has_ifsc: false, has_fssai: false, has_cer: false, has_turnover: false, has_annual_returns: false, has_msme: false
  });

  // --- Dynamic Business Profile State (For internal Edit Profile Tab) ---
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    clientName: '', orgType: 'Private Limited', companyName: '',
    phone: '', email: '', gstin: '', incorpDate: '', udyam: '', address: '', 
    services: [{ type: 'Service', name: '' }], description: ''
  });

  // --- Real-time Stats, Vault & Wins State ---
  const [vaultDocs, setVaultDocs] = useState(DEFAULT_VAULT_DOCS);
  const [clientStats, setClientStats] = useState({ recommended: 0, participated: 0, ongoing: 0, won: 0, lost: 0, revenue: 0 });
  const [wonBids, setWonBids] = useState([]);
  const [workflowJobs, setWorkflowJobs] = useState([]);
  const [brandSettings, setBrandSettings] = useState({});

  // 🚀 STAFF-ONLY: AI Win Probability + JV Partner data for the "AI Tender Match & JV
  // Hub" widget. Only ever fetched when isStaffPreview is true — a real client never
  // triggers this call, and the underlying /api/bid-matches route requires the MD's
  // ADMIN_TOKEN anyway, so a real client couldn't read it even if they tried.
  const [staffBidMatches, setStaffBidMatches] = useState([]);
  const [submittingLead, setSubmittingLead] = useState('');

  // Deep-link support for ?tab= — used by the post-payment redirect so a client who
  // paid an invoice lands back on Finance instead of the default dashboard tab.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const requested = new URLSearchParams(window.location.search).get('tab');
    const allowed = ['dashboard', 'live_tenders', 'wins', 'vault', 'finance', 'profile', 'bid_tools'];
    if (requested && allowed.includes(requested)) setActiveTab(requested);
  }, []);

  useEffect(() => {
    setIsMounted(true);
    if (status === "loading") return;

    const bypassIdent = consumeClientBypass();
    const sessionIsClient = Boolean(
      session?.user?.email
      && !session?.user?.emp_id
      && session?.user?.role !== 'MD'
      && session?.user?.role !== 'EMPLOYEE'
    );
    const e = bypassIdent || (sessionIsClient ? String(session.user.email).toLowerCase() : '') || clientSessionIdent();
    setEmail(e);
    setIsStaffPreview(Boolean(bypassIdent) && !sessionIsClient);
    if (sessionIsClient && session?.user?.email) rememberRealClientIdent(session.user.email);

    fetchPublicTenders();
    if (e) fetchClientData(e);
    else setLoading(false);

    fetch('/api/settings').then(r => r.json()).then(d => { if(d.settings) setBrandSettings(d.settings); }).catch(()=>{});
    fetch('/api/ai/generate-doc').then(r => r.json()).then(d => { if(d.doc_types) setDocTypes(d.doc_types); }).catch(()=>{});
  }, [session, status]);

  // 🚀 STAFF-ONLY: fetch the MD's AI matchmaker feed and narrow it to this one client,
  // for the "AI Tender Match & JV Hub" widget. Skipped entirely for real clients.
  useEffect(() => {
    if (!isStaffPreview || !email || typeof window === 'undefined') return;
    const adminToken = localStorage.getItem('tt_admin');
    fetch('/api/bid-matches', {
      headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : {},
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d?.matches) return;
        setStaffBidMatches(
          d.matches.filter(m => (m.client_email || '').toLowerCase() === email.toLowerCase())
        );
      })
      .catch(() => {});
  }, [isStaffPreview, email]);

 // 🚀 FIX: Live Tracking (Auto-Refresh) without external packages
  useEffect(() => {
    if (status === "loading" || !email) return;
    
    // ఒక ఫంక్షన్ క్రియేట్ చేసి, దాన్ని ఫస్ట్ టైమ్ పిలవాలి, ఆపై లూప్ లో పెట్టాలి
    const syncLiveData = async () => {
       try {
         // t=Date.now() వాడటం వల్ల ఎప్పుడూ కొత్త డేటా వస్తుంది, పాత డేటా స్టక్ అవ్వదు
         const r = await fetch(`/api/me?email=${encodeURIComponent(email)}&t=${Date.now()}`, {
           credentials: 'include',
           headers: clientHeaders(),
         });
         if (r.status === 404) return;
         if(r.ok) {
           const d = await r.json();
           
           const hasSignedAgreement = d.vault_docs?.some(doc => doc.id === 'signed_agreement') || false;
           d.agreement_signed = hasSignedAgreement;

           if (d.onboarding_complete) setLocalOnboardComplete(true);

           setUserData(d);
           setClientId(d.client_id || '');

           if(d.stats) setClientStats((prev) => ({ ...prev, ...d.stats, revenue: Number(d.stats.revenue) || 0 }));
           if(d.active_bids) setWonBids(d.active_bids.filter(b => b.status === 'Won'));

           try {
             const wf = await fetch(`/api/workflow/client?email=${encodeURIComponent(email)}&t=${Date.now()}`, {
               credentials: 'include',
               headers: clientHeaders(),
             });
             if (wf.ok) {
               const wfd = await wf.json();
               setWorkflowJobs(wfd.jobs || []);
             }
           } catch (_) { /* workflow queue is additive */ }
           
           // డాక్యుమెంట్స్ అప్‌డేట్
           if (d.vault_docs && d.vault_docs.length > 0) {
               const mergedDocs = DEFAULT_VAULT_DOCS.map(defaultDoc => {
                   const found = d.vault_docs.find(bd => bd.id === defaultDoc.id);
                   return found ? found : defaultDoc;
               });
               const customDocs = d.vault_docs.filter(bd => !DEFAULT_VAULT_DOCS.some(def => def.id === bd.id) && bd.id !== 'signed_agreement');
               setVaultDocs([...mergedDocs, ...customDocs]);
           } else {
               setVaultDocs(DEFAULT_VAULT_DOCS);
           }
         }
       } catch (err) {
         console.error("Live sync failed", err);
       }
    };

    // 🚀 FIX: Poll every 60 seconds instead of 10 — and only while this tab is actually
    // visible, so we stop hammering MongoDB when the user switches away/minimizes.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncLiveData();
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [email, status]);

  const fetchClientData = async (userEmail) => {
    if (!userEmail) {
      setLoading(false);
      return;
    }
    try {
      const r = await fetch(`/api/me?email=${encodeURIComponent(userEmail)}`, {
        credentials: 'include',
        headers: clientHeaders(),
      });
      if (r.status === 404) {
        setLoading(false);
        toast.error('Client not found.');
        return;
      }
      if(r.ok) {
        const d = await r.json();
        
        const hasSignedAgreement = d.vault_docs?.some(doc => doc.id === 'signed_agreement') || false;
        d.agreement_signed = hasSignedAgreement;

        if (d.onboarding_complete) setLocalOnboardComplete(true);

        setUserData(d);
        setClientId(d.client_id || '');

        if(d.stats) setClientStats((prev) => ({ ...prev, ...d.stats, revenue: Number(d.stats.revenue) || 0 }));
        if(d.active_bids) setWonBids(d.active_bids.filter(b => b.status === 'Won'));

        try {
          const wf = await fetch(`/api/workflow/client?email=${encodeURIComponent(userEmail)}`, {
            credentials: 'include',
            headers: clientHeaders(),
          });
          if (wf.ok) {
            const wfd = await wf.json();
            setWorkflowJobs(wfd.jobs || []);
          }
        } catch (_) { /* workflow queue is additive */ }
        
        if (d.vault_docs && d.vault_docs.length > 0) {
            const mergedDocs = DEFAULT_VAULT_DOCS.map(defaultDoc => {
                const found = d.vault_docs.find(bd => bd.id === defaultDoc.id);
                return found ? found : defaultDoc;
            });
            const customDocs = d.vault_docs.filter(bd => !DEFAULT_VAULT_DOCS.some(def => def.id === bd.id) && bd.id !== 'signed_agreement');
            setVaultDocs([...mergedDocs, ...customDocs]);
        } else {
            setVaultDocs(DEFAULT_VAULT_DOCS);
        }

        if(d.profile && !isEditingProfile) {
          setProfileForm(prev => ({
            ...prev,
            email: userEmail,
            clientName: d.profile.client_name || prev.clientName,
            companyName: d.profile.company_name || prev.companyName,
            orgType: d.profile.company_type || prev.orgType,
            phone: d.profile.phone || prev.phone,
            gstin: d.profile.gstin || prev.gstin,
            udyam: d.profile.udyam || prev.udyam,
            address: d.profile.address || prev.address,
            services: d.profile.service_category ? d.profile.service_category.split(',').map(item => ({
                type: item.includes(':') ? item.split(':')[0].trim() : 'Service',
                name: item.includes(':') ? item.split(':')[1].trim() : item.trim()
            })) : prev.services,
            description: d.profile.description || prev.description
          }));
          
          setOnboardForm(prev => ({
            ...prev,
            client_name: d.profile.client_name || session?.user?.name || '',
            company_name: d.profile.company_name || '',
            phone: d.profile.phone || '',
            service: d.profile.service_category || '',
            company_type: d.profile.company_type || 'Proprietor (Individual)'
          }));
        }
      }
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const fetchPublicTenders = async () => {
    try {
      const r = await fetch('/api/tenders');
      const d = await r.json();
      setPublicTenders(liveTendersOnly(d.tenders || []));
    } catch (err) { console.error(err); }
  };

  const handleCardClick = (targetTab, targetSectionId) => {
     setActiveTab(targetTab);
     window.scrollTo({ top: 0, behavior: 'smooth' }); 
     if (targetSectionId) {
        setTimeout(() => {
           const element = document.getElementById(targetSectionId);
           if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setHighlightedSection(targetSectionId);
              setTimeout(() => setHighlightedSection(''), 2000);
           }
        }, 300);
     }
  };

  const handleViewPDF = async (tenderId) => {
    window.open(`/api/tenders/${tenderId}/pdf?email=${email}&role=client`, '_blank');
    toast.success('Opening PDF Document...');
  };

  const bypassLockScreen = () => setUserData(prev => ({ ...prev, is_approved: true }));

  const addServiceRow = () => setProfileForm(prev => ({...prev, services: [...prev.services, { type: 'Service', name: '' }]}));
  const updateService = (index, key, value) => {
    const newServices = [...profileForm.services];
    const currentService = typeof newServices[index] === 'string' ? { type: 'Service', name: newServices[index] } : newServices[index];
    newServices[index] = { ...currentService, [key]: value };
    setProfileForm(prev => ({...prev, services: newServices}));
  };
  const removeService = (index) => {
    const newServices = profileForm.services.filter((_, i) => i !== index);
    setProfileForm(prev => ({...prev, services: newServices}));
  };
  
  // 🚀 FIX: Cancel Profile Edit Restores Original Data properly
  const handleCancelProfileEdit = () => {
     setIsEditingProfile(false);
     fetchClientData(email);
  };
  
  const saveProfile = async (e) => {
    e.preventDefault();
    if (profileForm.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(profileForm.gstin.toUpperCase())) {
       return toast.error("Invalid GSTIN Format (e.g. 36AAAAA0000A1Z5)");
    }
    if (profileForm.udyam && !/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(profileForm.udyam.toUpperCase())) {
       return toast.error("Invalid UDYAM Format (e.g. UDYAM-TS-02-1234567)");
    }

    try {
      const r = await fetch('/api/users/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, client_name: profileForm.clientName, company_name: profileForm.companyName,
          company_type: profileForm.orgType, phone: profileForm.phone, address: profileForm.address,
          gstin: profileForm.gstin.toUpperCase(), udyam: profileForm.udyam.toUpperCase(), incorpDate: profileForm.incorpDate,
          description: profileForm.description, service_category: profileForm.services.map(s => typeof s === 'string' ? `Service: ${s}` : `${s.type}: ${s.name}`).join(',')
        })
      });
      if(r.ok) {
        setIsEditingProfile(false);
        toast.success("Client Profile Updated Successfully! Synced with MD Database.");
        fetchClientData(email); 
      }
    } catch(err) { toast.error("Network Error."); }
  };

  const handleFileUpload = async (docId, e, customName = null) => {
    const file = e?.target?.files?.[0];
    if (!file) return;

    // Check the size before spending the upload: the server rejects anything over this
    // anyway, and a failed 5MB upload on mobile data is a wasted minute.
    if (file.size > VAULT_MAX_UPLOAD_BYTES) {
      return toast.error(
        `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${VAULT_MAX_UPLOAD_BYTES / 1024 / 1024}MB — ` +
        'please compress the scan or split the document into parts.',
        { duration: 9000 }
      );
    }
    if (file.size === 0) return toast.error('That file appears to be empty.');

    setUploadingDocId(docId);
    const toastId = toast.loading(`Uploading ${file.name} to your secure vault...`);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('docId', docId);
    formData.append('email', email);
    formData.append('clientName', profileForm.companyName || profileForm.clientName);
    if (customName) formData.append('customName', customName);

    try {
      const res = await fetch('/api/vault/upload', { method: 'POST', body: formData });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        toast.success('Uploaded securely. Your Operations Officer will verify it shortly.', { id: toastId });
        if (customName) setCustomDocForm({ name: '', file: null });
        fetchClientData(email);
      } else {
        // Surface the server's reason (size, storage outage) instead of a generic failure.
        toast.error(data?.error || `Upload failed (${res.status}). Please try again.`, { id: toastId, duration: 9000 });
      }
    } catch (err) {
      toast.error('Network error during upload. Please check your connection and retry.', { id: toastId });
    } finally {
      setUploadingDocId(null);
    }
  };

  // 🚀 AI Document Generator ------------------------------------------------------
  const handleGenerateDoc = async (e) => {
    e?.preventDefault?.();
    if (!docForm.doc_type) return toast.error('Please choose a document type.');

    setGeneratingDoc(true);
    setGeneratedDoc(null);
    try {
      const res = await fetch('/api/ai/generate-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_email: email,
          doc_type: docForm.doc_type,
          tender_id: docForm.tender_id || undefined,
          instructions: docForm.instructions || undefined,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.error || `Generation failed (${res.status})`, { duration: 9000 });
        return;
      }

      setGeneratedDoc(data);
      toast.success(`${data.doc_type?.label || 'Document'} drafted. Review it before printing.`);
    } catch (err) {
      console.error('Document generation failed:', err);
      toast.error('Network error while generating the document.');
    } finally {
      setGeneratingDoc(false);
    }
  };

  // Print only the A4 sheet. The body class drives the @media print rules in globals.css,
  // which hide the dashboard chrome so the letter lands cleanly on pre-printed letterhead.
  const handlePrintDoc = () => {
    if (typeof document === 'undefined') return;
    document.body.classList.add('printing-document');

    const cleanup = () => {
      document.body.classList.remove('printing-document');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    window.print();
    // Safari/iOS does not always fire afterprint, so remove the class defensively.
    setTimeout(cleanup, 1500);
  };

  const handleSignAgreement = async (e) => {
      e.preventDefault();
      setSubmittingAgreement(true);
      
      try {
          // 🚀 FIX: Generate a Professional PDF Letterhead instead of a .txt file
          const pdfDoc = await PDFDocument.create();
          const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
          const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
          const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

          const page = pdfDoc.addPage([595.28, 841.89]); // Standard A4 Size
          const { width, height } = page.getSize();

          // --- 1. LETTERHEAD TOP STRIP (Navy Blue) ---
          page.drawRectangle({
              x: 0, y: height - 85, width: width, height: 85,
              color: rgb(0.04, 0.15, 0.28) // #0A2647
          });

          // --- 2. BRANDING & CONTACT INFO ---
          page.drawText('TELANGANA TENDERS', { x: 40, y: height - 35, size: 22, font: timesBold, color: rgb(1, 1, 1) });
          page.drawText('CONSULTANCY SERVICES & CORPORATE APPROVALS', { x: 40, y: height - 52, size: 9, font: helvetica, color: rgb(0.8, 0.9, 1) });
          
          // Right Side Details
          page.drawText('Phone: +91 6304486770 | Email: support@tgtenders.in', { x: width - 290, y: height - 30, size: 9, font: helvetica, color: rgb(1, 1, 1) });
          page.drawText('Instagram: @tgtenders | YouTube: TG Tenders', { x: width - 290, y: height - 47, size: 9, font: helvetica, color: rgb(1, 1, 1) });
          page.drawText('Services: e-Procurement, GeM Bidding, L1 Strategy', { x: width - 290, y: height - 64, size: 9, font: helvetica, color: rgb(1, 1, 1) });

          // --- 3. AGREEMENT TITLE ---
          page.drawText('B2B LEGAL SERVICE AGREEMENT', { x: width / 2 - 120, y: height - 130, size: 14, font: timesBold, color: rgb(0, 0, 0) });

          // --- 4. BODY TEXT ---
          const bodyText = `This B2B Legal Service Agreement ("Agreement") is officially entered into by and between\nTelangana Tenders (hereinafter referred to as the "Consultancy") and ${onboardForm.company_name || 'The Client'}\n(hereinafter referred to as the "Client"), effective as of ${new Date().toLocaleDateString()}.\n\n1. SCOPE OF SERVICES & VAULT ACCESS\nThe Consultancy agrees to provide comprehensive bid analysis, documentation support, and \noperational tender management. All financial and proprietary documents uploaded by the \nClient to the Corporate Vault shall remain strictly confidential, stored securely via 256-bit \nencryption, and accessed solely for tender fulfillment purposes on government portals.\n\n2. PROFESSIONAL FEES & CONSULTANCY CHARGES\nThe Client agrees to pay the stipulated processing fees, document unlock fees, and post-win \nsuccess fees (consultancy charges) as mutually agreed upon for each respective tender. The \nClient is also solely responsible for depositing Earnest Money Deposits (EMD) directly or \nvia the Consultancy within the stipulated timeframe.\n\n3. DEFAULT OF PAYMENT & LEGAL RECOURSE\nIn the event of non-payment, delayed payment, or refusal to disburse consultancy charges \npost-service delivery or successful contract award, the Consultancy reserves the absolute \nright to initiate immediate legal proceedings. This includes, but is not limited to, recovery \nactions under Section 73 of the Indian Contract Act, 1872 and Section 138 of the Negotiable \nInstruments Act, 1881. The Client shall be held strictly liable for all legal recovery costs, \nattorney fees, and an interest penalty of 18% per annum on the outstanding amount.\n\n4. OFFICIAL REPRESENTATION & AUTHORIZATION\nThe Client legally authorizes the Consultancy's Managing Director (MD) and assigned \nOperations Officers to represent their firm digitally on government procurement portals \n(including GeM and eProcurement) strictly for the scope of the assigned tenders. \nThe Consultancy is absolved of any liabilities arising from false documents or \nmisrepresented financial data provided by the Client.`;

          page.drawText(bodyText, { x: 40, y: height - 180, size: 11, font: timesRoman, color: rgb(0.1, 0.1, 0.1), lineHeight: 16 });

          // --- 5. SIGNATURES ---
          page.drawLine({ start: { x: 40, y: 220 }, end: { x: width - 40, y: 220 }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });

          page.drawText('DIGITALLY SIGNED BY MANAGING DIRECTOR:', { x: 40, y: 190, size: 10, font: timesBold });
          page.drawText('B. Esak\nTelangana Tenders\n+91 6304486770', { x: 40, y: 170, size: 10, font: timesRoman, lineHeight: 14 });

          page.drawText('AUTHORISED CLIENT SIGNATORY:', { x: 340, y: 190, size: 10, font: timesBold });
          page.drawText(`${onboardForm.client_name || 'Authorised Signatory'}\n${onboardForm.company_name || 'Company Name'}\nDate: ${new Date().toLocaleDateString()}`, { x: 340, y: 170, size: 10, font: timesRoman, lineHeight: 14 });

          // --- 6. FOOTER STRIP ---
          page.drawRectangle({
              x: 0, y: 0, width: width, height: 25,
              color: rgb(0.04, 0.15, 0.28)
          });
          page.drawText(`Telangana Tenders © ${new Date().getFullYear()} | Securely Generated via Enterprise Portal`, { x: width / 2 - 130, y: 8, size: 8, font: helvetica, color: rgb(1, 1, 1) });

          // --- SAVE & EXPORT AS PDF ---
          const pdfBytes = await pdfDoc.save();
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          const file = new File([blob], "Signed_B2B_Legal_Agreement.pdf", { type: "application/pdf" });
          
          const formData = new FormData();
          formData.append('file', file);
          formData.append('docId', 'signed_agreement');
          formData.append('email', email);
          formData.append('clientName', onboardForm.company_name || onboardForm.client_name); 

          // 🚀 FIX: Only proceed to mark the agreement as signed if the vault upload
          // actually succeeded — otherwise the signed PDF could be lost silently.
          const uploadRes = await fetch('/api/vault/upload', { method: 'POST', body: formData });
          if (!uploadRes.ok) {
              throw new Error('Failed to upload signed agreement to the vault.');
          }

          const res = await fetch('/api/users/profile', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, agreement_signed: true })
          });

          if (!res.ok) {
              throw new Error('Failed to update agreement status on profile.');
          }

          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = "Telangana_Tenders_Agreement.pdf";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          toast.success("Professional Legal Agreement PDF Generated & Downloaded!");

          setUserData(prev => ({ ...prev, agreement_signed: true }));
          fetchClientData(email);

          setActiveTab('profile');
          setIsEditingProfile(true);
      } catch (err) {
          console.error("PDF Generation Error:", err);
          toast.error("Network error saving agreement.");
      } finally {
          setSubmittingAgreement(false);
      }
  };
  // 🚀 FIX: Mandatory Profile Validation
  const submitOnboarding = async (e) => {
    e.preventDefault();
    
    // 1. అన్నీ ఫీల్డ్స్ మ్యాండేటరీగా చెక్ చేయడం
    if (!onboardForm.client_name?.trim()) return toast.error("Client / Owner Name is mandatory.");
    if (!onboardForm.company_name?.trim()) return toast.error("Company / Firm Name is mandatory.");
    if (!onboardForm.company_type?.trim()) return toast.error("Company Type is mandatory.");
    if (!onboardForm.service?.trim()) return toast.error("Core Service is mandatory.");
    if (!onboardForm.gstin?.trim()) return toast.error("GSTIN Number is mandatory.");
    if (!onboardForm.udyam?.trim()) return toast.error("UDYAM Registration is mandatory.");
    
    // 2. ఫోన్ నెంబర్ 10 అంకెలు ఉండాలి
    if (!/^\d{10}$/.test(onboardForm.phone)) return toast.error("Invalid Phone Number. Must be exactly 10 digits.");
    
    setSubmittingOnboard(true);
    try {
      const res = await fetch('/api/users/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email, client_name: onboardForm.client_name, company_name: onboardForm.company_name, phone: onboardForm.phone, 
          company_type: onboardForm.company_type, service_category: onboardForm.service, 
          gstin: onboardForm.gstin, udyam: onboardForm.udyam, // 🚀 క్రొత్త ఫీల్డ్స్ యాడ్ చేసాం
          documents: { 
            has_gst: onboardForm.has_gst, has_esi: onboardForm.has_esi, has_epf: onboardForm.has_epf, has_iso: onboardForm.has_iso,
            has_bank: onboardForm.has_bank, has_pan: onboardForm.has_pan, has_aadhar: onboardForm.has_aadhar, has_dsc: onboardForm.has_dsc,
            has_ifsc: onboardForm.has_ifsc, has_fssai: onboardForm.has_fssai, has_cer: onboardForm.has_cer, 
            has_turnover: onboardForm.has_turnover, has_annual_returns: onboardForm.has_annual_returns, has_msme: onboardForm.has_msme
          }, 
          status: 'active',
          onboarding_complete: true 
        })
      });
      if(res.ok) {
        toast.success('Profile created successfully! Dashboard Unlocked.');
        setLocalOnboardComplete(true);
        setUserData(prev => ({ ...prev, onboarding_complete: true }));
      } else {
        toast.error('Failed to create profile. Server Error.');
      }
    } catch (err) { 
      toast.error('Network error submitting profile'); 
    }
    setSubmittingOnboard(false);
  };
  const requestBidSupportForTender = async (t) => {
      const pdfLink = `${window.location.origin}/api/tenders/${t._id}/pdf?email=${email}&role=client`;
      const desc = `Please support bidding for this public tender: ${t.title}. \n\nDirect PDF Link: ${pdfLink}`;
      const link_or_id = t.bid_no || t._id;
      try {
        const res = await fetch('/api/client-requests', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_email: email, client_id: clientId, link_or_id, description: desc })
        });
        if(res.ok) {
          toast.success("Request sent to Operations/MD successfully! Check Helpdesk for updates.");
          fetchClientData(email);
        } else { toast.error("Failed to submit request."); }
      } catch(e) { toast.error("Network Error"); }
  };

  const handleCustomTenderSubmit = async (e) => { 
    e.preventDefault(); 
    if(!customTenderForm.link_or_id || !customTenderForm.description) return toast.error("Please fill all details");
    if (customTenderForm.file && customTenderForm.file.size > VAULT_MAX_UPLOAD_BYTES) {
      return toast.error(
        `${customTenderForm.file.name} is ${(customTenderForm.file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${VAULT_MAX_UPLOAD_BYTES / 1024 / 1024}MB — please compress or split the file.`
      );
    }
    try {
      const form = new FormData();
      form.append('client_email', email);
      form.append('client_id', clientId || '');
      form.append('link_or_id', customTenderForm.link_or_id);
      form.append('description', customTenderForm.description);
      if (customTenderForm.file) form.append('file', customTenderForm.file);
      const res = await fetch('/api/client-requests', {
        method: 'POST',
        credentials: 'include',
        headers: clientHeaders(),
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if(res.ok) {
        toast.success("Custom tender request submitted successfully to Operations Team!"); 
        setCustomTenderForm({ link_or_id: '', description: '', file: null }); 
        fetchClientData(email); 
      } else { toast.error(data.error || "Failed to submit request."); }
    } catch(err) { toast.error("Network Error."); }
  };
  
  const handleTicketSubmit = async (e) => { 
    e.preventDefault(); 
    if(!ticketForm.subject || !ticketForm.message) return toast.error('Fill subject and message');
    try {
      const r = await fetch('/api/tickets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, department: 'Support', subject: ticketForm.subject, message: ticketForm.message })
      });
      if(r.ok) {
        toast.success('24/7 SLA Ticket raised successfully!'); 
        setTicketForm({ subject: '', message: '' }); 
        fetchClientData(email); 
      }
    } catch(err) { toast.error("Network Error."); }
  };

  // 🚀 STAFF-ONLY: "Apply for EMD Loan" / "GeM Sahay" have no real lender/partner
  // integration yet, so both are lead-capture — they raise a normal support ticket
  // (visible to the MD in the Helpdesk tab) tagged under Finance, rather than
  // fabricating loan numbers or a fake partner API.
  const submitLeadRequest = async (kind) => {
    const subject = kind === 'emd_loan' ? 'EMD Loan Request' : 'GeM Sahay Bill Discounting Request';
    setSubmittingLead(kind);
    try {
      const r = await fetch('/api/tickets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, department: 'Finance', subject,
          message: `Client requested more information about ${subject.toLowerCase()} from the dashboard.`,
        })
      });
      if (r.ok) {
        toast.success(`${subject} sent to the Finance desk. The MD will follow up shortly.`);
        fetchClientData(email);
      } else {
        toast.error('Could not submit the request. Please try again.');
      }
    } catch (err) {
      toast.error('Network error.');
    } finally {
      setSubmittingLead('');
    }
  };

  const submitTicketReplyClient = async (ticket_id) => {
    const replyText = ticketReplyClient[ticket_id];
    if(!replyText) return toast.error('Please write a reply first.');
    try {
      const r = await fetch('/api/tickets/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id, reply: `CLIENT REPLY: ${replyText}`, admin_email: 'Client (Action Needed)' })
      });
      if(r.ok) { 
         toast.success('Reply Sent to MD successfully!'); 
         setTicketReplyClient(prev => ({...prev, [ticket_id]: ''})); 
         fetchClientData(email); 
      } else { toast.error('Failed to send reply'); }
    } catch(e) { toast.error('Error resolving ticket'); }
  };

  const handleDeleteTicketClient = async (ticket_id) => {
    if(!confirm("Are you sure you want to permanently close and mark this query as resolved?")) return;
    try {
       const res = await fetch(`/api/tickets?id=${ticket_id}`, { method: 'DELETE' });
       if(res.ok) { toast.success("Query Closed & Resolved"); fetchClientData(email); } 
       else { toast.error("Failed to delete"); }
    } catch(e) { toast.error("Network error"); }
  };

  const handleQuerySubmit = async (e, queryId) => {
    e.preventDefault();
    if(!queryForm.description) return toast.error("Please provide an explanation.");
    setSubmittingQuery(true);
    try {
      let uploadedFileName = '';
      if (queryForm.file) {
        toast.info("Uploading document...");
        const formData = new FormData();
        formData.append('file', queryForm.file);
        formData.append('docId', `query_response_${queryId}`);
        formData.append('email', email);
        formData.append('clientName', profileForm.companyName || profileForm.clientName); 
        
        const res = await fetch('/api/vault/upload', { method: 'POST', body: formData });
        if(res.ok) uploadedFileName = queryForm.file.name;
      }

      const r = await fetch('/api/queries/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryId, email, description: queryForm.description, fileName: uploadedFileName })
      });

      if(r.ok) {
        toast.success("Reply & Document submitted to the Officer successfully!");
        setQueryForm({ description: '', file: null });
        fetchClientData(email); 
      } else { toast.error("Failed to submit reply."); }
    } catch(err) { toast.error("Network error."); }
    setSubmittingQuery(false);
  };

  const handleAlertReply = async (alertId) => {
     const replyMsg = alertReplyText[alertId];
     try {
       const res = await fetch('/api/dispatches/update', {
         method: 'PUT', headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ task_id: alertId, status: 'Completed', reply: replyMsg || 'Client acknowledged the alert.' })
       });
       if(res.ok) {
          toast.success("Alert resolved and dismissed.");
          setAlertReplyText({...alertReplyText, [alertId]: ''});
          fetchClientData(email);
       }
     } catch (e) { toast.error("Network error"); }
  };

  const handleAcceptWorkflowJob = async (job) => {
    try {
      const res = await fetch(`/api/workflow/jobs/${job._id}/client-approve`, {
        method: 'POST',
        headers: clientHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Approve failed');
      toast.success('Approved. Status is now In Progress.');
      fetchClientData(email);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handleRejectWorkflowJob = async (job) => {
    if (!confirm('Reject this tender suggestion? It will leave your Recommended list.')) return;
    try {
      const res = await fetch(`/api/workflow/jobs/${job._id}/client-reject`, {
        method: 'POST',
        headers: clientHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Reject failed');
      toast.success('Rejected. The tender is no longer on your Recommended list.');
      fetchClientData(email);
    } catch (e) {
      toast.error(e.message);
    }
  };

 const executePayment = async (payRecord) => {
    setBuying(true);
    try {
      const r1 = await fetch('/api/payment/order', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        // 🚀 FIX: reason ని కూడా పంపాలి
        body: JSON.stringify({ 
            email: email, 
            plan: 'single', 
            tenderId: payRecord.tenderId || null,
            pending_payment_id: payRecord.id,
            customAmount: payRecord.amount,
            reason: payRecord.reason,
            // 🚀 FIX: after Cashfree verification the client used to be dropped on the
            // public home page, which looks like being logged out. Send them straight
            // back to the finance tab they paid from.
            return_to: '/client?tab=finance'
        }) 
      });
      const d1 = await r1.json();
      if (!r1.ok) { setBuying(false); return toast.error(d1.error || 'Failed to initialize payment'); }
      
      const cashfree = await load({ mode: "production" });
      const checkoutOptions = { paymentSessionId: d1.payment_session_id, returnUrl: `https://www.tgtenders.in/payment-status?order_id={order_id}` };
      await cashfree.checkout(checkoutOptions);
    } catch (e) { toast.error('Could not start payment'); } finally { setBuying(false); }
  };

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') localStorage.clear();
    await signOut({ redirect: false });
    window.location.href = '/';
  };

  const visibleLiveTenders = useMemo(() => {
    const needle = liveTenderSearch.trim().toLowerCase();
    if (!needle) return publicTenders;
    return publicTenders.filter((t) =>
      [t.bid_no, t.title, t.department, t.district].some((v) => String(v || '').toLowerCase().includes(needle))
    );
  }, [publicTenders, liveTenderSearch]);

  useWorkflowStream((event) => {
    if (!event?.jobId) return;
    setWorkflowJobs((prev) => {
      if (event.archived) return prev.filter((job) => String(job._id) !== String(event.jobId));
      const found = prev.find((job) => String(job._id) === String(event.jobId));
      if (!found) return prev;
      const merged = mergeTrackingEvent(found, event);
      return prev.map((job) => (job === found ? merged : job));
    });
  }, { audience: 'client', enabled: Boolean(email) });

  if (!isMounted || status === "loading" || loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/></div>;

  if (userData && (userData.onboarding_complete || localOnboardComplete) && !userData.is_approved && !session?.user?.is_bypass) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A2647] p-4 bg-[url('/grid-pattern.svg')]">
        <Card className="max-w-md w-full shadow-2xl border-t-8 border-t-amber-500 bg-white">
           <CardHeader className="text-center pb-2 border-b">
             <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4 ring-4 ring-amber-50">
                <ShieldAlert className="w-8 h-8 text-amber-600" />
             </div>
             <CardTitle className="text-2xl font-black text-[#0A2647]">Account Under Verification</CardTitle>
             <CardDescription className="text-sm mt-2">Welcome to Enterprise Portal.</CardDescription>
           </CardHeader>
           <CardContent className="pt-6">
             <p className="text-center text-slate-600 text-sm font-medium mb-6">
                Your registration was successful. As part of our strict MNC compliance, your dashboard access is currently locked pending <strong className="text-slate-800">MD Approval</strong>.
             </p>
             <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 text-center flex flex-col items-center gap-3 shadow-inner">
                <PhoneCall className="w-8 h-8 text-blue-600 animate-pulse" />
                <div>
                   <p className="text-xs text-blue-800 font-bold uppercase tracking-wider mb-1">For Immediate Approval Call MD:</p>
                   <p className="text-3xl font-black text-[#0A2647] tracking-wider">+91 6304486770</p>
                </div>
             </div>
             <div className="mt-8 flex justify-between items-center">
                <Button variant="ghost" onClick={handleSignOut} className="text-slate-500 hover:text-slate-700">Log Out</Button>
             </div>
           </CardContent>
        </Card>
      </div>
    );
  }

if (userData && (userData.onboarding_complete || localOnboardComplete) && userData.is_approved && !userData.agreement_signed && !session?.user?.is_bypass) {
      return (
        <div className="min-h-screen flex flex-col items-center bg-slate-100 p-4 sm:py-10">
          <Card className="max-w-4xl w-full shadow-2xl border-t-8 border-t-emerald-600 bg-white print:border-none print:shadow-none mx-auto">
             <CardHeader className="border-b bg-white pb-6 print:bg-white text-center pt-8">
                <div className="flex justify-between items-center px-2 sm:px-8">
                   <div className="flex items-center gap-3">
                      {brandSettings.logo ? <img src={brandSettings.logo} className="w-16 h-16 object-contain" alt="Logo"/> : <ShieldCheck className="w-12 h-12 text-emerald-600" />}
                      <div className="text-left">
                         <p className="font-black text-2xl text-[#0A2647] tracking-tight">Telangana Tenders</p>
                         <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Consultancy Services</p>
                      </div>
                   </div>
                   {brandSettings.gem_logo && <img src={brandSettings.gem_logo} className="w-16 h-16 object-contain hidden sm:block" alt="GeM"/>}
                </div>
             </CardHeader>
             
             <CardContent className="pt-8 px-6 sm:px-12 space-y-4">
                <h3 className="text-2xl font-black text-center text-[#0A2647] uppercase bg-slate-100 py-3 rounded border border-slate-200 shadow-sm">
                   B2B Legal Service Agreement
                </h3>
                <hr className="border-t-2 border-[#0A2647] my-6" />

                <div className="text-sm text-slate-700 leading-relaxed text-justify font-medium">
                   <p className="mb-4">
                     This B2B Legal Service Agreement ("Agreement") is entered into by and between <strong>Telangana Tenders</strong> (hereinafter referred to as the "Consultancy") and <strong>{onboardForm.company_name || 'The Client'}</strong> (hereinafter referred to as the "Client"), effective as of <strong>{new Date().toLocaleDateString()}</strong>.
                   </p>
                   
                   <h5 className="font-black text-slate-900 mt-6 mb-2">1. Scope of Services & Vault Access</h5>
                   <p className="mb-4">The Consultancy agrees to provide comprehensive bid analysis, documentation support, and operational tender management. All financial and proprietary documents uploaded by the Client to the Corporate Vault shall remain strictly confidential, stored securely via 256-bit encryption, and accessed solely for tender fulfillment purposes on government portals.</p>
                   
                   <h5 className="font-black text-slate-900 mt-6 mb-2">2. Professional Fees & Consultancy Charges</h5>
                   <p className="mb-4">The Client agrees to pay the stipulated processing fees, document unlock fees, and post-win success fees (consultancy charges) as mutually agreed upon for each respective tender. The Client is also solely responsible for depositing Earnest Money Deposits (EMD) directly or via the Consultancy within the stipulated timeframe.</p>
                   
                   <h5 className="font-black text-slate-900 mt-6 mb-2">3. Default of Payment & Legal Recourse</h5>
                   <p className="mb-4">
                     In the event of non-payment, delayed payment, or refusal to disburse consultancy charges post-service delivery or successful contract award, the Consultancy reserves the absolute right to initiate immediate legal proceedings. This includes, but is not limited to, recovery actions under <strong>Section 73 of the Indian Contract Act, 1872</strong> (Compensation for loss or damage caused by breach of contract) and <strong>Section 138 of the Negotiable Instruments Act, 1881</strong> (in the event of any dishonored payments or cheques). The Client shall be held strictly liable for all legal recovery costs, attorney fees, and an interest penalty of 18% per annum on the outstanding amount until full realization.
                   </p>

                   <h5 className="font-black text-slate-900 mt-6 mb-2">4. Official Representation & Authorization</h5>
                   <p className="mb-4">The Client legally authorizes the Consultancy's Managing Director (MD) and assigned Operations Officers to represent their firm digitally on government procurement portals (including GeM and eProcurement) strictly for the scope of the assigned tenders. The Consultancy is absolved of any liabilities arising from false documents or misrepresented financial data provided by the Client.</p>
                   
                   <div className="mt-16 border-t-2 border-slate-300 pt-8 flex justify-between items-end">
                       <div className="text-left">
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-2">Digitally Signed By</p>
                          {brandSettings.md_signature ? (
                             <img src={brandSettings.md_signature} alt="MD Signature" className="h-14 object-contain mb-2" />
                          ) : (
                             <p className="font-black text-blue-900 text-3xl font-signature italic mb-2">B. Esak</p>
                          )}
                          <p className="text-sm font-black text-slate-800">Managing Director</p>
                          <p className="text-[10px] font-semibold text-slate-500">Telangana Tenders</p>
                          <p className="text-[10px] font-semibold text-slate-500">+91 6304486770</p>
                       </div>
                       <div className="text-right">
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-2">Authorised Client Signatory</p>
                          <p className="font-black text-slate-800 text-xl italic font-serif mb-2">{onboardForm.client_name || 'Pending'}</p>
                          <p className="text-sm font-black text-slate-800">{onboardForm.company_name || 'Company Name'}</p>
                          <p className="text-[10px] font-semibold text-slate-500">Date: {new Date().toLocaleDateString()}</p>
                       </div>
                   </div>
                </div>
                
                <div className="print:hidden mt-10 pt-6 border-t border-slate-200">
                   <form onSubmit={handleSignAgreement} className="flex flex-col items-center gap-5">
                      <label className="flex items-center gap-3 cursor-pointer bg-emerald-50 p-4 rounded-xl border border-emerald-200 w-full sm:w-auto shadow-sm hover:shadow-md transition">
                         <input type="checkbox" required className="w-6 h-6 accent-emerald-600 cursor-pointer" />
                         <span className="font-bold text-emerald-900 text-sm">I have read, understood, and legally accept the terms of this B2B Agreement.</span>
                      </label>
                      <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto mt-2">
                         <Button type="submit" disabled={submittingAgreement} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-12 px-10 shadow-lg w-full">
                            {submittingAgreement ? <Loader2 className="w-5 h-5 animate-spin mr-2"/> : <PenTool className="w-5 h-5 mr-2"/>}
                            {submittingAgreement ? 'Generating Record...' : 'Sign Agreement & Enter Profile'}
                         </Button>
                      </div>
                   </form>
                </div>
             </CardContent>
          </Card>
        </div>
      );
  }

  if (userData && (!userData.onboarding_complete && !localOnboardComplete) && !session?.user?.is_bypass) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 py-10 w-full overflow-x-hidden">
        <Card className="max-w-3xl mx-auto shadow-2xl border-t-8 border-t-blue-600">
          <CardHeader className="border-b bg-white text-center pb-6">
             <UserCog className="w-10 h-10 mx-auto text-blue-600 mb-2" />
             <CardTitle className="text-2xl font-black text-[#0A2647]">Complete Your Business Profile</CardTitle>
             <CardDescription className="text-sm mt-1 text-slate-500 font-semibold">Step 2 of 2: Setup your portal identity to unlock dashboard access.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 bg-slate-50/50">
             <form onSubmit={submitOnboarding}>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><Label>Client / Owner Name *</Label><Input required value={onboardForm.client_name} onChange={e => setOnboardForm({...onboardForm, client_name: e.target.value})} className="mt-1"/></div>
                  <div><Label>Contact Number *</Label><Input required type="tel" placeholder="10 Digit Mobile" value={onboardForm.phone} onChange={e => setOnboardForm({...onboardForm, phone: e.target.value})} className="mt-1"/></div>
                  <div className="sm:col-span-2"><Label>Company / Firm Name *</Label><Input required value={onboardForm.company_name} onChange={e => setOnboardForm({...onboardForm, company_name: e.target.value})} className="mt-1"/></div>
                  <div>
                    <Label>Company Type *</Label>
                    <select required className="w-full border rounded-md p-2 mt-1 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500" value={onboardForm.company_type} onChange={e => setOnboardForm({...onboardForm, company_type: e.target.value})}>
                      <option value="Proprietor (Individual)">Proprietor (Individual)</option>
                      <option value="Partnership">Partnership</option>
                      <option value="Private Limited">Private Limited</option>
                      <option value="Public Limited">Public Limited</option>
                      <option value="LLP">LLP</option>
                    </select>
                  </div>
                  <div><Label>Core Service *</Label><Input required value={onboardForm.service} onChange={e => setOnboardForm({...onboardForm, service: e.target.value})} className="mt-1"/></div>
                  <div><Label>GSTIN Number *</Label><Input required placeholder="e.g. 36AAAAA0000A1Z5" value={onboardForm.gstin} onChange={e => setOnboardForm({...onboardForm, gstin: e.target.value})} className="mt-1 uppercase font-mono"/></div>
                  <div><Label>UDYAM Registration *</Label><Input required placeholder="e.g. UDYAM-TS-02-1234567" value={onboardForm.udyam} onChange={e => setOnboardForm({...onboardForm, udyam: e.target.value})} className="mt-1 uppercase font-mono"/></div>
                </div>
                <div className="border-t pt-5 mt-5">
                  <Label className="text-[#0A2647] font-semibold block mb-2">Do you have these basic documents?</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    <label className="flex items-center gap-2 text-sm bg-white p-2.5 border rounded-lg cursor-pointer hover:border-[#16a34a] shadow-sm"><input type="checkbox" className="w-4 h-4 accent-[#16a34a]" checked={onboardForm.has_pan} onChange={e => setOnboardForm({...onboardForm, has_pan: e.target.checked})} /> PAN Card</label>
                    <label className="flex items-center gap-2 text-sm bg-white p-2.5 border rounded-lg cursor-pointer hover:border-[#16a34a] shadow-sm"><input type="checkbox" className="w-4 h-4 accent-[#16a34a]" checked={onboardForm.has_gst} onChange={e => setOnboardForm({...onboardForm, has_gst: e.target.checked})} /> GST Cert.</label>
                    <label className="flex items-center gap-2 text-sm bg-white p-2.5 border rounded-lg cursor-pointer hover:border-[#16a34a] shadow-sm"><input type="checkbox" className="w-4 h-4 accent-[#16a34a]" checked={onboardForm.has_bank} onChange={e => setOnboardForm({...onboardForm, has_bank: e.target.checked})} /> Bank Details</label>
                    <label className="flex items-center gap-2 text-sm bg-white p-2.5 border rounded-lg cursor-pointer hover:border-[#16a34a] shadow-sm"><input type="checkbox" className="w-4 h-4 accent-[#16a34a]" checked={onboardForm.has_ifsc} onChange={e => setOnboardForm({...onboardForm, has_ifsc: e.target.checked})} /> IFSC Details</label>
                    <label className="flex items-center gap-2 text-sm bg-white p-2.5 border rounded-lg cursor-pointer hover:border-[#16a34a] shadow-sm"><input type="checkbox" className="w-4 h-4 accent-[#16a34a]" checked={onboardForm.has_aadhar} onChange={e => setOnboardForm({...onboardForm, has_aadhar: e.target.checked})} /> Aadhar</label>
                    <label className="flex items-center gap-2 text-sm bg-white p-2.5 border rounded-lg cursor-pointer hover:border-[#16a34a] shadow-sm"><input type="checkbox" className="w-4 h-4 accent-[#16a34a]" checked={onboardForm.has_msme} onChange={e => setOnboardForm({...onboardForm, has_msme: e.target.checked})} /> MSME (Udyam)</label>
                    <label className="flex items-center gap-2 text-sm bg-white p-2.5 border rounded-lg cursor-pointer hover:border-[#16a34a] shadow-sm"><input type="checkbox" className="w-4 h-4 accent-[#16a34a]" checked={onboardForm.has_dsc} onChange={e => setOnboardForm({...onboardForm, has_dsc: e.target.checked})} /> DSC Class 3</label>
                    <label className="flex items-center gap-2 text-sm bg-white p-2.5 border rounded-lg cursor-pointer hover:border-[#16a34a] shadow-sm"><input type="checkbox" className="w-4 h-4 accent-[#16a34a]" checked={onboardForm.has_turnover} onChange={e => setOnboardForm({...onboardForm, has_turnover: e.target.checked})} /> Turnover Cert.</label>
                  </div>
                </div>
                <Button type="submit" disabled={submittingOnboard} className="w-full bg-[#16a34a] hover:bg-[#15803d] h-14 text-lg font-bold mt-8 shadow-md">
                  {submittingOnboard ? <Loader2 className="w-5 h-5 animate-spin mr-2"/> : <CheckCircle2 className="w-5 h-5 mr-2"/>}
                  {submittingOnboard ? 'Creating Profile...' : 'Save Profile & Enter Dashboard'}
                </Button>
             </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  const queries = userData?.officer_queries || [];
  const activeLockingQuery = queries.find(q => !q.reply_submitted);

  if (userData && userData.is_approved && userData.agreement_signed && (userData.onboarding_complete || localOnboardComplete) && activeLockingQuery && !session?.user?.is_bypass) {
    const q = activeLockingQuery; 
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A2647] p-4 bg-[url('/grid-pattern.svg')]">
        <Card className="max-w-2xl w-full shadow-2xl border-t-8 border-t-red-600 bg-white">
           <CardHeader className="border-b bg-red-50/50">
             <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center ring-4 ring-red-50 shrink-0">
                   <AlertTriangle className="w-7 h-7 text-red-600" />
                </div>
                <div>
                  <CardTitle className="text-xl font-black text-[#0A2647]">Action Required: Officer Query</CardTitle>
                  <CardDescription className="text-sm mt-1 text-red-600 font-semibold">You must resolve this query to unlock your dashboard.</CardDescription>
                </div>
             </div>
           </CardHeader>
           <CardContent className="pt-6 space-y-6">
             <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 shadow-inner">
               <div className="flex justify-between items-start mb-3">
                  <p className="font-bold text-slate-800 text-lg">{q.subject}</p>
                  <Badge className="bg-red-100 text-red-800 border border-red-300 animate-pulse"><Clock className="w-3 h-3 mr-1"/> Action Needed</Badge>
               </div>
               <p className="text-sm text-slate-700 leading-relaxed">{q.message}</p>
             </div>
             
             <form onSubmit={(e) => handleQuerySubmit(e, q.id)} className="space-y-5">
                <div>
                  <Label className="text-sm font-bold text-[#0A2647]">Your Explanation / Description *</Label>
                  <Textarea required rows={4} placeholder="Please explain or clarify the issue here..." className="mt-2 bg-white focus:ring-2 focus:ring-red-500" value={queryForm.description} onChange={e => setQueryForm({...queryForm, description: e.target.value})} />
                </div>
                <div>
                   <Label className="text-sm font-bold text-[#0A2647] mb-2 block">Upload Supporting Document (If any)</Label>
                   <div className="border-2 border-dashed border-slate-300 rounded-xl p-5 text-center bg-slate-50 hover:bg-slate-100 transition cursor-pointer relative">
                      <Input type="file" accept=".pdf,.jpg,.png,.zip" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={e => setQueryForm({...queryForm, file: e.target.files[0]})} />
                      <div className="flex flex-col items-center pointer-events-none">
                         <UploadCloud className="w-6 h-6 text-slate-400 mb-2" />
                         <span className="text-sm font-semibold text-[#0A2647]">{queryForm.file ? queryForm.file.name : "Click to upload document"}</span>
                         <span className="text-[10px] text-slate-500 mt-1">PDF, JPG or ZIP (Max 10MB)</span>
                      </div>
                   </div>
                </div>
                <Button type="submit" disabled={submittingQuery} className="w-full bg-[#16a34a] hover:bg-[#15803d] h-12 text-base mt-2 shadow-md">
                  {submittingQuery ? <Loader2 className="w-5 h-5 animate-spin mr-2"/> : <Send className="w-5 h-5 mr-2"/>} 
                  {submittingQuery ? 'Uploading & Submitting...' : 'Submit Reply & Unlock Dashboard'}
                </Button>
             </form>
           </CardContent>
        </Card>
      </div>
    );
  }

  const customRequests = userData?.custom_requests || [];
  const trackingJobs = uniqueClientTrackingJobs(workflowJobs);

  const clientWorkflowDocActions = (job) => {
    const actions = [];
    if (job?.sow) {
      actions.push({
        label: 'View SOW / Tender Guide',
        icon: 'eye',
        onClick: () => openClientWorkflowFile(job._id, 'sow').catch((err) => toast.error(err.message)),
      });
    }
    if (job?.tender_id || job?.tender_pdf) {
      actions.push({
        label: 'Tender File',
        icon: 'file',
        onClick: () => openClientWorkflowFile(job._id, 'tender').catch((err) => toast.error(err.message)),
      });
    }
    if (job?.receipt && (job.status === 'SUBMITTED' || job.status === 'WON')) {
      actions.push({
        label: 'Receipt',
        icon: 'download',
        onClick: () => openClientWorkflowFile(job._id, 'receipt').catch((err) => toast.error(err.message)),
      });
    }
    return actions;
  };
  const criticalAlerts = userData?.action_alerts?.filter(a => a?.subject && !a.subject.includes('Suggestion') && a.status !== 'Completed') || [];
  
  // 🚀 FIX: Automatically filter out payments that match a SUCCESS status in the main payments array
  const pendingPayments = userData?.pending_payments?.filter(p => {
      const st = String(p.status || '').toUpperCase();
      if (st === 'SUCCESS' || st === 'PAID' || st === 'CANCELLED' || st === 'FAILED') return false;
      const paidById = (userData?.payments || []).some(past =>
        past.pending_payment_id && p.id && String(past.pending_payment_id) === String(p.id) && String(past.status).toUpperCase() === 'SUCCESS'
      );
      if (paidById) return false;
      return !(userData?.payments || []).some(past => past.amount == p.amount && past.reason == p.reason && past.status === 'SUCCESS');
  }) || []; 

  const totalEmd = userData?.emd_ledger?.total_paid || 0;

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="bg-white/95 backdrop-blur-sm border-b border-slate-200/80 sticky top-0 z-40 tender-shadow">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <BrandLogo subtitle="Enterprise Portal" />
          
          <div className="flex items-center gap-4">
             <Button variant="outline" size="sm" onClick={() => window.open('/', '_blank')} className="hidden sm:flex border-slate-300 text-slate-700 font-bold hover:bg-slate-100 transition-all duration-200">
                <Globe className="w-4 h-4 mr-2" /> View Public Site
             </Button>

             <div className="hidden md:flex flex-col items-end mr-2">
               <span className="text-sm font-bold text-[#0A2647]">{profileForm.companyName || 'Guest Company'}</span>
               <span className="text-[10px] font-mono text-slate-500 tracking-widest">{clientId}</span>
             </div>
             
             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="ghost" size="icon" className="relative text-slate-700">
                     <BellRing className="w-5 h-5"/> 
                     {(queries.length > 0 || pendingPayments.length > 0 || criticalAlerts.length > 0) && (
                        <Badge className="absolute -top-1 -right-1 bg-red-500 h-4 w-4 p-0 flex justify-center items-center text-[10px] animate-pulse">
                           {queries.length + pendingPayments.length + criticalAlerts.length}
                        </Badge>
                     )}
                   </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                   <DropdownMenuLabel>Alerts & Notifications</DropdownMenuLabel>
                   <DropdownMenuSeparator />
                   {criticalAlerts.map((alert, i) => (
                      <DropdownMenuItem key={`alert-${i}`} className="text-xs text-red-600 font-medium whitespace-normal cursor-pointer flex flex-col items-start gap-1">
                         <span>🚨 {alert.subject}</span>
                      </DropdownMenuItem>
                   ))}
                   {queries.map((q, i) => (
                      <DropdownMenuItem key={`q-${i}`} className="text-xs text-orange-600 font-medium whitespace-normal cursor-pointer flex flex-col items-start gap-1">
                         <span>⚠️ {q.subject}</span>
                      </DropdownMenuItem>
                   ))}
                   {pendingPayments.map((p, i) => (
                      <DropdownMenuItem key={`p-${i}`} className="text-xs text-amber-600 font-medium whitespace-normal cursor-pointer">
                         💰 Fee Due: {p.reason}
                      </DropdownMenuItem>
                   ))}
                   {queries.length === 0 && pendingPayments.length === 0 && criticalAlerts.length === 0 && (
                      <DropdownMenuItem className="text-muted-foreground text-xs justify-center py-4">No active alerts.</DropdownMenuItem>
                   )}
                </DropdownMenuContent>
             </DropdownMenu>

             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="outline" className="flex items-center gap-2 border-slate-200 bg-slate-50">
                     <UserCircle className="w-5 h-5 text-[#0A2647]" />
                     <div className="hidden md:flex flex-col items-start text-left">
                       <span className="text-xs font-bold text-[#0A2647] leading-none">{profileForm.clientName || 'User'}</span>
                       <span className="text-[9px] text-slate-500 font-semibold">{profileForm.companyName}</span>
                     </div>
                     <ChevronDown className="w-3 h-3 text-slate-400" />
                   </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 p-2">
                   <div className="p-2 border-b mb-2 bg-slate-50 rounded-md">
                     <p className="font-bold text-[#0A2647]">{profileForm.clientName}</p>
                     <p className="text-xs font-mono text-slate-500">{clientId} • {email}</p>
                     <Badge className="mt-2 bg-blue-100 text-blue-800 border-0">{userData?.profile?.category || 'Vendor'}</Badge>
                   </div>
                   <DropdownMenuItem className="text-red-600 cursor-pointer font-medium" onClick={handleSignOut}>
                     <LogOut className="w-4 h-4 mr-2" /> Secure Sign Out
                   </DropdownMenuItem>
                </DropdownMenuContent>
             </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        
        {/* MD CRITICAL ALERTS WITH REPLY & DISMISS */}
        {criticalAlerts.length > 0 && (
          <div className="bg-red-600 text-white rounded-xl p-4 shadow-lg flex items-start gap-4 animate-in fade-in slide-in-from-top-4">
             <AlertTriangle className="w-8 h-8 shrink-0 text-red-200" />
             <div className="flex-1">
                <h3 className="font-black text-lg uppercase tracking-wide mb-3">Action Required from Operations Team</h3>
                <div className="space-y-3">
                   {criticalAlerts.map((alert, idx) => (
                     <div key={idx} className="bg-red-700/50 p-4 rounded-lg border border-red-500/50 flex flex-col gap-3">
                        <p className="font-bold text-sm bg-red-800 p-2 rounded">{alert.subject}: <span className="font-normal text-red-100">{alert.message}</span></p>
                        <div className="flex flex-col sm:flex-row gap-2">
                           <Input placeholder="Type your reply here..." className="flex-1 bg-white text-slate-800 h-9 focus-visible:ring-red-300" value={alertReplyText[alert._id] || ''} onChange={e => setAlertReplyText({...alertReplyText, [alert._id]: e.target.value})} />
                           <Button size="sm" onClick={() => handleAlertReply(alert._id)} className="h-9 shrink-0 bg-white text-red-700 hover:bg-red-50">Send Reply & Dismiss</Button>
                        </div>
                     </div>
                   ))}
                </div>
             </div>
          </div>
        )}

        {/* --- TOP FUNNEL METRICS --- */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
           <Card onClick={() => handleCardClick('dashboard', 'recommended-section')} className="border-0 ring-1 ring-slate-200/80 bg-white cursor-pointer premium-hover hover:ring-blue-300">
              <CardContent className="p-4 flex flex-col items-center text-center">
                 <Target className="w-5 h-5 text-blue-500 mb-2"/>
                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Recommended</p>
                 <p className="text-2xl font-black text-[#0A2647]">{clientStats.recommended}</p>
              </CardContent>
           </Card>
           <Card onClick={() => handleCardClick('dashboard', 'tracking-section')} className="border-0 ring-1 ring-slate-200/80 bg-white cursor-pointer premium-hover hover:ring-blue-300">
              <CardContent className="p-4 flex flex-col items-center text-center">
                 <FileText className="w-5 h-5 text-slate-500 mb-2"/>
                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Participated</p>
                 <p className="text-2xl font-black text-[#0A2647]">{clientStats.participated}</p>
              </CardContent>
           </Card>
           {/* 🚀 FIX: Live Tenders Routing & Real Public Tenders Count */}
           <Card onClick={() => { setActiveTab('live_tenders'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="border-0 ring-1 ring-blue-500/40 bg-blue-50/50 cursor-pointer premium-hover hover:ring-blue-500">
              <CardContent className="p-4 flex flex-col items-center text-center">
                 <Activity className="w-5 h-5 text-blue-600 mb-2"/>
                 <p className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">Live Tenders</p>
                 <p className="text-2xl font-black text-blue-700">{publicTenders.length}</p>
              </CardContent>
           </Card>
           <Card onClick={() => handleCardClick('wins', '')} className="border-0 ring-1 ring-emerald-500/40 bg-emerald-50/80 cursor-pointer premium-hover hover:ring-emerald-500">
              <CardContent className="p-4 flex flex-col items-center text-center">
                 <Trophy className="w-5 h-5 text-emerald-600 mb-2"/>
                 <p className="text-[10px] font-bold text-emerald-900 uppercase tracking-wider">Tenders Won</p>
                 <p className="text-2xl font-black text-emerald-700">{clientStats.won}</p>
              </CardContent>
           </Card>
           <Card onClick={() => handleCardClick('finance', '')} className="border-0 ring-1 ring-emerald-400 bg-gradient-to-br from-emerald-500 to-emerald-700 text-white col-span-2 lg:col-span-1 cursor-pointer premium-hover hover:ring-emerald-300">
              <CardContent className="p-4 flex flex-col items-center text-center">
                 <Banknote className="w-5 h-5 text-emerald-200 mb-2"/>
                 <p className="text-[10px] font-bold text-emerald-100 uppercase tracking-wider">Project Revenue</p>
                 <p className="text-xl sm:text-2xl font-black">₹{(Number(clientStats.revenue) || 0).toLocaleString()}</p>
              </CardContent>
           </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mt-6">
          {/* Order per Enterprise UI/UX Blueprint (section A): the two most frequent
              client actions — checking their dashboard and browsing live tenders — come
              first, followed by wins/vault/finance/profile. Flat bar (no grouping) since
              6-7 items doesn't need it. Staff-only "Bid Tools" stays last. */}
          <TabsList className="flex flex-wrap w-full bg-white tender-shadow border border-slate-200/80 h-auto p-1.5 rounded-xl mb-6">
            <TabsTrigger value="dashboard" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <Activity className="w-4 h-4 mr-2 hidden sm:block"/> Active Dashboard
            </TabsTrigger>
            <TabsTrigger value="live_tenders" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <Globe className="w-4 h-4 mr-2 hidden sm:block"/> Live Tenders
            </TabsTrigger>
            <TabsTrigger value="wins" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white font-semibold rounded-md">
              <Trophy className="w-4 h-4 mr-2 hidden sm:block"/> Winning Bids
            </TabsTrigger>
            <TabsTrigger value="vault" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <Lock className="w-4 h-4 mr-2 hidden sm:block"/> My Secure Vault
            </TabsTrigger>
            <TabsTrigger value="finance" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <Banknote className="w-4 h-4 mr-2 hidden sm:block"/> Finance/SLA
            </TabsTrigger>
            <TabsTrigger value="profile" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <Building2 className="w-4 h-4 mr-2 hidden sm:block"/> Client Profile
            </TabsTrigger>
            {/* 🚀 RBAC: "Bid Tools" hidden exclusively for real clients — still fully
                present in the DOM/functional for MD/employee staff-preview sessions,
                and its TabsContent below is untouched (nothing deleted). */}
            {isStaffPreview && (
              <TabsTrigger value="bid_tools" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-indigo-700 data-[state=active]:text-white font-semibold rounded-md">
                <Wand2 className="w-4 h-4 mr-2 hidden sm:block"/> Bid Tools
              </TabsTrigger>
            )}
          </TabsList>

          {/* ============================================================================== */}
          {/* TAB 1: DYNAMIC BUSINESS PROFILE */}
          {/* ============================================================================== */}
          <TabsContent value="profile" className="space-y-6">
             <Card className="tender-shadow border-t-4 border-t-blue-600">
                <CardHeader className="bg-slate-50 border-b pb-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                   <div>
                     <CardTitle className="text-[#0A2647] text-lg flex items-center gap-2"><Building2 className="w-5 h-5 text-blue-600"/> Client Business Profile</CardTitle>
                   </div>
                   {!isEditingProfile && (
                      <Button onClick={() => setIsEditingProfile(true)} className="bg-[#0A2647] hover:bg-[#144272] shrink-0">Edit Profile</Button>
                   )}
                </CardHeader>
                <CardContent className="pt-6">
                   <form onSubmit={saveProfile} className="space-y-6">
                      <div className="grid md:grid-cols-2 gap-5">
                         <div>
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Authorised Person</Label>
                            {isEditingProfile ? <Input value={profileForm.clientName} onChange={e=>setProfileForm({...profileForm, clientName: e.target.value})} className="mt-1"/> : <p className="font-semibold text-[#0A2647] bg-slate-50 p-2.5 rounded border mt-1">{profileForm.clientName}</p>}
                         </div>
                         <div>
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Organisation Type</Label>
                            {isEditingProfile ? (
                               <Select value={profileForm.orgType} onValueChange={v=>setProfileForm({...profileForm, orgType: v})}>
                                  <SelectTrigger className="mt-1"><SelectValue/></SelectTrigger>
                                  <SelectContent><SelectItem value="Proprietor">Proprietor</SelectItem><SelectItem value="Partnership">Partnership</SelectItem><SelectItem value="Private Limited">Private Limited</SelectItem></SelectContent>
                               </Select>
                            ) : <p className="font-semibold text-[#0A2647] bg-slate-50 p-2.5 rounded border mt-1">{profileForm.orgType}</p>}
                         </div>
                         <div className="md:col-span-2">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Registered Company Name</Label>
                            {isEditingProfile ? <Input value={profileForm.companyName} onChange={e=>setProfileForm({...profileForm, companyName: e.target.value})} className="mt-1 font-bold text-lg"/> : <p className="font-bold text-lg text-[#0A2647] bg-blue-50 p-3 rounded border border-blue-100 mt-1">{profileForm.companyName}</p>}
                         </div>
                         <div>
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Contact Number</Label>
                            {isEditingProfile ? <Input value={profileForm.phone} onChange={e=>setProfileForm({...profileForm, phone: e.target.value})} className="mt-1"/> : <p className="font-semibold text-[#0A2647] bg-slate-50 p-2.5 rounded border mt-1">{profileForm.phone}</p>}
                         </div>
                         <div>
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Registered Email ID</Label>
                            <p className="font-semibold text-slate-500 bg-slate-100 p-2.5 rounded border mt-1 cursor-not-allowed">{profileForm.email}</p>
                         </div>
                         <div className="md:col-span-2">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Registered Address</Label>
                            {isEditingProfile ? <Textarea value={profileForm.address} onChange={e=>setProfileForm({...profileForm, address: e.target.value})} className="mt-1" rows={2}/> : <p className="font-semibold text-[#0A2647] bg-slate-50 p-2.5 rounded border mt-1">{profileForm.address || 'Not provided'}</p>}
                         </div>
                         <div>
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">GSTIN Number</Label>
                            {isEditingProfile ? <Input placeholder="e.g. 36AAAAA0000A1Z5" value={profileForm.gstin} onChange={e=>setProfileForm({...profileForm, gstin: e.target.value})} className="mt-1 uppercase font-mono"/> : <p className="font-semibold text-[#0A2647] font-mono bg-slate-50 p-2.5 rounded border mt-1">{profileForm.gstin || 'Not provided'}</p>}
                         </div>
                         <div>
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Date of Incorporation</Label>
                            {isEditingProfile ? <Input type="date" value={profileForm.incorpDate} onChange={e=>setProfileForm({...profileForm, incorpDate: e.target.value})} className="mt-1"/> : <p className="font-semibold text-[#0A2647] bg-slate-50 p-2.5 rounded border mt-1">{profileForm.incorpDate}</p>}
                         </div>
                         <div className="md:col-span-2">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Udyam Registration Number</Label>
                            {isEditingProfile ? <Input placeholder="e.g. UDYAM-TS-02-1234567" value={profileForm.udyam} onChange={e=>setProfileForm({...profileForm, udyam: e.target.value})} className="mt-1 uppercase font-mono"/> : <p className="font-semibold text-[#0A2647] font-mono bg-slate-50 p-2.5 rounded border mt-1">{profileForm.udyam || 'Not provided'}</p>}
                         </div>
                      </div>

                      <div className="border-t border-slate-100 pt-5">
                         <div className="flex justify-between items-center mb-4">
                            <Label className="text-xs font-bold text-[#0A2647] uppercase tracking-wider">Primary Services / Products Offered</Label>
                            {isEditingProfile && <Button type="button" size="sm" onClick={addServiceRow} variant="outline" className="h-8 text-xs border-blue-300 text-blue-700 hover:bg-blue-50 font-semibold"><Plus className="w-3 h-3 mr-1"/> Add Row</Button>}
                         </div>
                         <div className="space-y-3">
                            {profileForm.services.map((service, index) => (
                               <div key={index} className="flex gap-3 items-center">
                                  <div className="bg-slate-100 border text-slate-500 flex items-center justify-center w-10 h-10 shrink-0 rounded-md text-xs font-bold">{index + 1}</div>
                                  
                                  {isEditingProfile ? (
                                     <>
                                        <div className="flex-1 flex items-center border border-slate-300 rounded-md bg-white focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all h-10 overflow-hidden relative">
                                           <Select 
                                              value={typeof service === 'string' ? 'Service' : (service.type || 'Service')} 
                                              onValueChange={(v) => updateService(index, 'type', v)}
                                           >
                                              <SelectTrigger className="w-[110px] sm:w-[130px] shrink-0 border-0 border-r border-slate-200 focus:ring-0 focus:ring-offset-0 bg-slate-50 shadow-none font-semibold text-[#0A2647] h-full rounded-none">
                                                 <SelectValue placeholder="Type" />
                                              </SelectTrigger>
                                              <SelectContent>
                                                 <SelectItem value="Service">Service</SelectItem>
                                                 <SelectItem value="Product">Product</SelectItem>
                                              </SelectContent>
                                           </Select>
                                           
                                           <input 
                                              type="text"
                                              value={typeof service === 'string' ? service : service.name} 
                                              onChange={(e) => updateService(index, 'name', e.target.value)} 
                                              placeholder={`Enter ${typeof service === 'string' ? 'Service' : service.type} description...`} 
                                              className="flex-1 h-full px-3 text-sm text-[#0A2647] outline-none bg-transparent placeholder:text-slate-400"
                                              required
                                           />
                                        </div>

                                        {profileForm.services.length > 1 && (
                                           <Button type="button" variant="ghost" size="icon" onClick={() => removeService(index)} className="text-red-400 hover:text-red-600 hover:bg-red-50 h-10 w-10 shrink-0"><Trash2 className="w-4 h-4"/></Button>
                                        )}
                                     </>
                                  ) : (
                                     <p className="flex-1 h-10 font-semibold text-[#0A2647] bg-slate-50 px-3 rounded-md border flex items-center overflow-hidden">
                                        <Badge className="mr-3 bg-blue-100 text-blue-800 border-0 shrink-0">{typeof service === 'string' ? 'Service' : (service.type || 'Service')}</Badge>
                                        <span className="truncate">{typeof service === 'string' ? service : (service.name || 'Not specified')}</span>
                                     </p>
                                  )}
                               </div>
                            ))}
                         </div>
                      </div>

                      <div className="border-t border-slate-100 pt-5">
                         <Label className="text-xs font-bold text-[#0A2647] uppercase tracking-wider">Overall Business Description</Label>
                         {isEditingProfile ? (
                            <Textarea rows={4} value={profileForm.description} onChange={e=>setProfileForm({...profileForm, description: e.target.value})} className="mt-2" placeholder="Briefly describe your company's expertise..."/>
                         ) : <p className="text-sm text-slate-700 bg-slate-50 p-4 rounded-lg border mt-2 leading-relaxed">{profileForm.description}</p>}
                      </div>

                      {isEditingProfile && (
                         <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
                            {/* 🚀 FIX: Cancel Button resets Data back to original DB state */}
                            <Button type="button" variant="outline" onClick={handleCancelProfileEdit} className="h-11">Cancel</Button>
                            <Button type="submit" className="bg-[#16a34a] hover:bg-[#15803d] h-11 px-8 shadow-md"><CheckCircle2 className="w-4 h-4 mr-2"/> Save Profile</Button>
                         </div>
                      )}
                   </form>
                </CardContent>
             </Card>
          </TabsContent>

          {/* ============================================================================== */}
          {/* TAB 2: INTERACTIVE VAULT */}
          {/* ============================================================================== */}
          <TabsContent value="vault" className="space-y-6">
            <Card className="tender-shadow border-t-4 border-t-[#16a34a]">
              <CardHeader className="bg-slate-50 border-b pb-4">
                <CardTitle className="text-[#0A2647] flex items-center gap-2"><Lock className="w-5 h-5 text-[#16a34a]"/> My Secure Vault</CardTitle>
                <CardDescription>
                  Your KYC and business documents, held in encrypted cloud storage and released only to your
                  Operations Officer. Approved documents are synced to your private Google Drive folder.
                  Accepted formats: PDF or image scan, up to {VAULT_MAX_UPLOAD_BYTES / 1024 / 1024}MB per file.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-8">
                 
                 {/* MISSING OR REJECTED DOCS */}
                 <div>
                    <h4 className="font-black text-slate-700 mb-3 flex items-center gap-2 border-b pb-2"><AlertTriangle className="w-4 h-4 text-amber-500"/> Action Required (Pending Uploads)</h4>
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                       {vaultDocs.filter(d => d.status === 'missing' || d.status === 'rejected').map((doc) => (
                         <div key={doc.id} className={`bg-white p-4 border rounded-xl shadow-sm ${doc.status === 'rejected' ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50/30'} transition hover:shadow-md`}>
                            <div className="flex justify-between items-start mb-3">
                              <Label className="font-bold text-slate-800 text-sm">{doc.name}</Label>
                              <Badge className={doc.status === 'rejected' ? 'bg-red-100 text-red-800 border-0 text-[10px]' : 'bg-amber-100 text-amber-800 border-0 text-[10px]'}>
                                {doc.status === 'rejected' ? 'Rejected' : 'Missing'}
                              </Badge>
                            </div>
                            {doc.status === 'rejected' && doc.reject_reason && (
                               <div className="bg-red-100 border border-red-300 rounded-lg p-2.5 mb-3">
                                  <p className="text-[10px] font-black uppercase tracking-wider text-red-600 flex items-center gap-1 mb-0.5">
                                     <XCircle className="w-3 h-3"/> Rejected by Verification Officer
                                  </p>
                                  <p className="text-xs text-red-800 font-semibold leading-snug">{doc.reject_reason}</p>
                                  <p className="text-[10px] text-red-600 mt-1">Please correct this and upload the document again.</p>
                               </div>
                            )}
                            <label className={`flex items-center justify-center w-full text-white p-2.5 rounded-lg transition text-xs font-semibold shadow-sm ${
                               uploadingDocId === doc.id ? 'bg-slate-400 cursor-wait' : 'bg-[#0A2647] hover:bg-[#144272] cursor-pointer'
                            }`}>
                              {uploadingDocId === doc.id
                                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading securely...</>
                                : <><UploadCloud className="w-4 h-4 mr-2" /> {doc.status === 'rejected' ? 'Re-upload Document' : 'Upload PDF / Scan'}</>}
                              <input type="file" className="hidden" disabled={uploadingDocId === doc.id} accept=".pdf, image/*" onChange={(e) => handleFileUpload(doc.id, e)} />
                            </label>
                         </div>
                       ))}
                    </div>
                 </div>

                 {/* UPLOADED (UNDER REVIEW) DOCS */}
                 <div>
                    <h4 className="font-black text-blue-900 mb-3 flex items-center gap-2 border-b pb-2"><Clock className="w-4 h-4 text-blue-500"/> Uploaded (Pending MD Verification)</h4>
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                       {vaultDocs.filter(d => d.status === 'uploaded').map((doc) => (
                         <div key={doc.id} className="bg-white p-4 border rounded-xl shadow-sm border-blue-200 bg-blue-50/50">
                            <div className="flex justify-between items-center mb-3">
                              <Label className="font-bold text-blue-900 text-sm">{doc.name}</Label>
                              <Badge className="bg-blue-100 text-blue-800 border-0 text-[10px] uppercase font-bold tracking-wider">Under Review</Badge>
                            </div>
                            <div className="bg-white p-2.5 border border-blue-100 rounded-lg flex items-center justify-between shadow-inner">
                               <span className="text-xs font-mono text-slate-500 truncate max-w-[120px]" title={doc.file_name}>{doc.file_name || doc.file}</span>
                               <span className="text-[9px] text-slate-400 font-semibold">{doc.upload_date}</span>
                            </div>
                         </div>
                       ))}
                    </div>
                 </div>

                 {/* VERIFIED DOCUMENTS */}
                 <div>
                    <h4 className="font-black text-emerald-900 mb-3 flex items-center gap-2 border-b pb-2"><ShieldCheck className="w-4 h-4 text-emerald-500"/> Verified & Secured Documents</h4>
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                       {vaultDocs.filter(d => d.status === 'verified').map((doc) => (
                         <div key={doc.id} className="bg-white p-4 border rounded-xl shadow-sm border-emerald-200 bg-emerald-50/30">
                            <div className="flex justify-between items-center mb-3">
                              <Label className="font-bold text-emerald-900 text-sm">{doc.name}</Label>
                              <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] uppercase font-bold tracking-wider"><CheckCircle2 className="w-3 h-3 mr-1"/> MD Approved</Badge>
                            </div>
                            <div className="bg-white p-2.5 border border-emerald-100 rounded-lg flex flex-col gap-2 shadow-inner">
                               <div className="flex justify-between items-center">
                                  <span className="text-xs font-mono text-slate-500 truncate max-w-[120px]" title={doc.file_name}>{doc.file_name || doc.file}</span>
                                  <span className="text-[9px] text-slate-400 font-semibold">{doc.upload_date}</span>
                               </div>
                               <div className="flex items-center gap-2 mt-1">
                                <Button size="sm" variant="ghost" onClick={() => {
                                    window.open(`/api/vault/document?email=${encodeURIComponent(email)}&docId=${encodeURIComponent(doc.id)}`, '_blank');
                                }} className="flex-1 h-7 text-[10px] px-2 font-bold bg-slate-100 hover:bg-slate-200 text-[#0A2647]">
                                   <Eye className="w-3 h-3 mr-1"/> View
                                </Button>

                                {doc.drive_link && (
                                   <Button size="sm" variant="ghost" onClick={() => window.open(doc.drive_link, '_blank')} className="h-7 text-[10px] px-2 font-bold bg-blue-50 hover:bg-blue-100 text-blue-700" title="Open in Google Drive">
                                      <Database className="w-3 h-3 mr-1"/> Drive
                                   </Button>
                                )}
                              </div>
                            </div>
                         </div>
                       ))}
                    </div>
                 </div>

                 {/* CUSTOM DOCUMENT UPLOAD AREA */}
                 <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mt-6 shadow-sm">
                    <h4 className="font-bold text-[#0A2647] flex items-center gap-2 mb-4"><Plus className="w-4 h-4 text-blue-600"/> Add Additional Custom Document</h4>
                    <form onSubmit={(e) => {
                       e.preventDefault();
                       if (!customDocForm.name || !customDocForm.file) return toast.error("Please provide both name and file.");
                       setUploadingCustom(true);
                       const customDocId = customDocForm.name.replace(/\s+/g, '_').toLowerCase();
                       handleFileUpload(customDocId, { target: { files: [customDocForm.file] } }, customDocForm.name).finally(() => setUploadingCustom(false));
                    }} className="flex flex-col sm:flex-row gap-4 items-end">
                       <div className="flex-1 w-full">
                          <Label className="text-xs font-bold text-slate-600 mb-1 block">Custom Document Name *</Label>
                          <Input required placeholder="e.g. Character Certificate" value={customDocForm.name} onChange={e=>setCustomDocForm({...customDocForm, name: e.target.value})} className="h-10 bg-white" />
                       </div>
                       <div className="flex-1 w-full">
                          <Label className="text-xs font-bold text-slate-600 mb-1 block">Select File (PDF/Image) *</Label>
                          <div className="border border-slate-300 bg-white h-10 rounded-md flex items-center px-3 cursor-pointer hover:bg-slate-50 transition relative">
                             <input type="file" required accept=".pdf, image/*" className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" onChange={e => setCustomDocForm({...customDocForm, file: e.target.files[0]})} />
                             <UploadCloud className="w-4 h-4 text-slate-400 mr-2 shrink-0"/>
                             <span className="text-sm text-slate-600 truncate">{customDocForm.file ? customDocForm.file.name : 'Choose file...'}</span>
                          </div>
                       </div>
                       <Button type="submit" disabled={uploadingCustom} className="bg-blue-600 hover:bg-blue-700 h-10 w-full sm:w-auto shadow-sm">
                          {uploadingCustom ? <Loader2 className="w-4 h-4 animate-spin"/> : 'Upload to Vault'}
                       </Button>
                    </form>
                 </div>

              </CardContent>
            </Card>
          </TabsContent>
          
          {/* ============================================================================== */}
          {/* TAB 3: WINNING BIDS LEDGER */}
          {/* ============================================================================== */}
          <TabsContent value="wins" className="space-y-6">
            <ClientWinningBoard jobs={Array.isArray(workflowJobs) ? workflowJobs : []} actionsFor={clientWorkflowDocActions} />
            <Card className="tender-shadow border-t-4 border-t-emerald-500">
              <CardHeader className="bg-emerald-50/50 border-b pb-4">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg"><Trophy className="w-5 h-5 text-emerald-600"/> Successful Bid Allocations</CardTitle>
                <CardDescription>Tenders officially awarded to your company. This data is managed securely by your designated Operations Officer.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                 {wonBids.length === 0 ? (
                    <div className="text-center p-10 bg-slate-50 border border-dashed rounded-xl"><Trophy className="w-12 h-12 mx-auto text-slate-300 mb-3"/><p className="text-sm font-semibold text-slate-500">Awaiting your first win!</p></div>
                 ) : (
                    <div className="space-y-5">
                       {wonBids.map((bid, i) => (
                          <div key={i} className="border border-emerald-200 rounded-xl bg-white shadow-sm overflow-hidden relative transition hover:shadow-md">
                             <div className="absolute top-0 left-0 w-2 h-full bg-emerald-500"></div>
                             <div className="p-5 pl-6 flex flex-col md:flex-row justify-between md:items-center gap-5">
                                <div className="flex-1">
                                   <div className="flex justify-between items-start mb-2">
                                      <Badge className="bg-slate-100 text-slate-600 font-mono text-[10px] border border-slate-200">{bid.bid_no}</Badge>
                                      <Badge className="bg-emerald-100 text-emerald-800 border-0 uppercase tracking-widest text-[9px] font-bold"><CheckCircle2 className="w-3 h-3 mr-1"/> Contract Awarded</Badge>
                                   </div>
                                   <h4 className="font-black text-[#0A2647] text-lg mb-1 leading-tight">{bid.description || bid.title}</h4>
                                   <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Date of Award: {new Date(bid.updated_at || bid.created_at).toLocaleDateString()}</p>
                                </div>
                                <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 min-w-[220px] shrink-0 text-center md:text-right">
                                   <p className="text-[10px] text-emerald-800 font-bold uppercase mb-1 tracking-wider">Contract Value</p>
                                   <p className="text-2xl font-black text-emerald-700">{bid.contract_value || '₹ --'}</p>
                                   <div className="border-t border-emerald-200 mt-2 pt-2">
                                      <p className="text-[10px] text-emerald-800 font-bold uppercase">Valid Until: <span className="text-emerald-900">{bid.validity || 'Pending Info'}</span></p>
                                   </div>
                                </div>
                             </div>
                          </div>
                       ))}
                    </div>
                 )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================================== */}
          {/* TAB 4: ACTIVE DASHBOARD */}
          {/* ============================================================================== */}
          <TabsContent value="dashboard" className="space-y-6">
            
            {/* 🚀 FIX: RECOMMENDED TENDERS BLOCK (Now Fetches Full Tender Data & Has View PDF) */}
            <Card id="recommended-section" className={`tender-shadow border-t-4 border-t-blue-500 bg-blue-50/20 transition-all duration-500 ${highlightedSection === 'recommended-section' ? 'ring-4 ring-blue-500 transform scale-[1.01]' : ''}`}>
              <CardHeader className="border-b pb-4 bg-white">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
                  <Target className="w-5 h-5 text-blue-600"/> Recommended For You
                </CardTitle>
                <CardDescription>Handpicked high-probability tenders assigned by your MD/Operations Officer.</CardDescription>
              </CardHeader>
              <CardContent className="p-5">
                 {/* 🚀 STAFF-ONLY: AI Tender Match & JV Hub — surfaces the MD's AI matchmaker
                     feed (confidence score + JV partner suggestion) for this one client.
                     Invisible to real clients; nothing below this block changes for them. */}
                 {isStaffPreview && staffBidMatches.length > 0 && (
                    <div className="mb-5 space-y-3">
                       <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                          <Sparkles className="w-3.5 h-3.5" /> AI Tender Match & JV Hub
                          <Badge className="bg-indigo-100 text-indigo-700 border-0 text-[9px] font-bold">Staff Only</Badge>
                       </div>
                       <div className="grid md:grid-cols-2 gap-3">
                          {staffBidMatches.map((m) => (
                             <div key={m._id || m.tender_id} className="border-t-4 border-t-indigo-600 border border-indigo-100 rounded-xl p-4 bg-indigo-50/30 tender-shadow">
                                <div className="flex justify-between items-start gap-2 mb-2 flex-wrap">
                                   <Badge className="bg-indigo-600 text-white border-0 text-[10px] font-bold">
                                      AI Win Probability: {Math.round((Number(m.confidence) || 0) * 100)}%
                                   </Badge>
                                   {m.match_type === 'JV' && (
                                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">JV Opportunity</Badge>
                                   )}
                                </div>
                                <h4 className="font-bold text-[#0A2647] text-sm leading-tight mb-1">{m.tender_title}</h4>
                                <p className="text-xs text-slate-500">
                                   {m.tender_department}{m.tender_bid_no ? ` • ${m.tender_bid_no}` : ''}
                                </p>
                                {m.match_type === 'JV' && m.jv_partner && (
                                   <div className="mt-3 bg-amber-50 border border-amber-200 rounded-md p-2.5">
                                      <div className="text-[9px] font-bold uppercase tracking-wider text-amber-600 flex items-center gap-1">
                                         <Handshake className="w-3 h-3" /> Find JV Partner
                                      </div>
                                      <div className="text-xs font-semibold text-amber-900 mt-0.5">{m.jv_partner.company_name}</div>
                                      <div className="text-[10px] text-amber-700">Combined Capacity: {formatINR(m.jv_partner.combined_capacity)}</div>
                                   </div>
                                )}
                             </div>
                          ))}
                       </div>
                    </div>
                 )}
                 {workflowJobs.filter(j => j.status === 'AWAITING_CLIENT' || j.display_status === 'Pending Approval').length > 0 ? (
                    <div className="grid md:grid-cols-2 gap-4">
                      {workflowJobs.filter(j => j.status === 'AWAITING_CLIENT' || j.display_status === 'Pending Approval').map((job) => (
                        <CompactTenderCard
                          key={job._id}
                          job={job}
                          actions={[
                            ...clientWorkflowDocActions(job),
                            { label: 'Public In Progress', variant: 'default', onClick: () => handleAcceptWorkflowJob(job) },
                            { label: 'Reject', onClick: () => handleRejectWorkflowJob(job) },
                          ]}
                        />
                      ))}
                    </div>
                 ) : (
                    <div className="text-center py-6 text-slate-400 border-2 border-dashed rounded-xl border-blue-200 bg-white">
                      <Target className="w-8 h-8 mx-auto text-blue-200 mb-2" />
                      <p className="text-sm font-semibold">No new recommendations right now.</p>
                    </div>
                 )}
              </CardContent>
            </Card>

            {/* Visual Stepper Logic UI */}
            <Card id="tracking-section" className={`tender-shadow transition-all duration-500 ${highlightedSection === 'tracking-section' ? 'ring-4 ring-blue-500 transform scale-[1.01]' : ''}`}>
              <CardHeader className="border-b pb-4 bg-slate-50">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg"><Activity className="w-5 h-5 text-blue-600"/> Tenders Tracking</CardTitle>
              </CardHeader>
              <CardContent className="p-5">
                 {trackingJobs.length === 0 ? (
                    <div className="text-center py-6 text-slate-400">
                      <p className="text-sm font-semibold">No active bids in progress.</p>
                    </div>
                 ) : (
                    <div className="grid sm:grid-cols-2 gap-3">
                      {trackingJobs.map((job) => {
                        const stageLabel = clientTrackingStage(job);
                        return (
                        <CompactTenderCard
                          key={job._id}
                          job={stageLabel ? { ...job, display_status: stageLabel } : job}
                          showClientName={false}
                          progress={<TrackingProgressBar job={job} stages={CLIENT_TRACKING_ORDER} activeLabel={stageLabel} />}
                          actions={clientWorkflowDocActions(job)}
                        />
                        );
                      })}
                    </div>
                 )}
              </CardContent>
            </Card>

            {/* Custom Tender Request */}
            <Card className="tender-shadow border-t-4 border-t-blue-500">
              <CardHeader className="bg-blue-50/40 pb-4 border-b">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
                  <UploadCloud className="w-5 h-5 text-blue-600"/> Found a Tender? Request Bid Support
                </CardTitle>
                <CardDescription>Upload tender details you found externally. Track our officer's reply here and in your MD Operations.</CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
                <form onSubmit={handleCustomTenderSubmit} className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                       <Label className="text-slate-600 text-xs font-bold">Tender Link / ID / Reference *</Label>
                       <Input required placeholder="e.g. https://eprocure.gov.in/..." value={customTenderForm.link_or_id} onChange={e => setCustomTenderForm({...customTenderForm, link_or_id: e.target.value})} className="mt-1 bg-white text-sm" />
                    </div>
                    <div>
                       <Label className="text-slate-600 text-xs font-bold">Brief Description of Work *</Label>
                       <textarea required placeholder="Short description..." value={customTenderForm.description} onChange={e => setCustomTenderForm({...customTenderForm, description: e.target.value})} className="w-full border border-slate-200 rounded-md p-2 mt-1 h-24 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"></textarea>
                    </div>
                  </div>
                  <div className="space-y-4 flex flex-col justify-between bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div>
                       <Label className="text-slate-600 text-xs font-bold mb-2 block">Upload Reference Document (Optional)</Label>
                       <div className="border-2 border-dashed border-blue-300 rounded-xl p-6 text-center bg-white hover:bg-blue-50/50 transition cursor-pointer relative">
                          <Input type="file" accept=".pdf,.zip" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={e => setCustomTenderForm({...customTenderForm, file: e.target.files[0]})} />
                          <div className="flex flex-col items-center pointer-events-none">
                             <FileUp className="w-8 h-8 text-blue-500 mb-2" />
                             <span className="text-sm font-semibold text-[#0A2647]">{customTenderForm.file ? customTenderForm.file.name : "Click here to upload PDF/ZIP"}</span>
                             <span className="text-[10px] text-slate-500 mt-1">Max file size {VAULT_MAX_UPLOAD_BYTES / 1024 / 1024}MB</span>
                          </div>
                       </div>
                    </div>
                    <Button type="submit" className="w-full bg-[#0A2647] hover:bg-[#144272] h-11 shadow-sm text-white">
                      <Send className="w-4 h-4 mr-2"/> Submit Tender to Operations Team
                    </Button>
                  </div>
                </form>

                {userData?.custom_requests?.length > 0 && (
                  <div className="mt-6 border-t pt-6 space-y-4">
                     <h4 className="font-bold text-[#0A2647]">My Submitted Requests ({userData.custom_requests.length})</h4>
                     {userData.custom_requests.map((req, i) => (
                        <div key={req._id || i} className="p-4 border border-slate-200 rounded-xl bg-white shadow-sm flex flex-col md:flex-row justify-between md:items-center gap-4">
                           <div className="flex-1">
                              <div className="flex justify-between items-start">
                                 <h4 className="font-bold text-[#0A2647] text-sm break-all mb-1">{req.link_or_id}</h4>
                                 <Badge className={req.status === 'Pending Officer Review' ? 'bg-amber-100 text-amber-800 border-0' : 'bg-emerald-100 text-emerald-800 border-0'}>{req.status}</Badge>
                              </div>
                              <p className="text-xs text-slate-500 mt-1">"{req.description}"</p>

                              {req.reply && (
                                 <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 mt-2">
                                    <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest block mb-1">Status Update / Reply:</span>
                                    <p className="text-xs font-medium text-emerald-800">{req.reply}</p>
                                 </div>
                              )}

                              {(req.has_file || req.file_base64 || req.file_url) && (
                                 <Button size="sm" variant="outline" onClick={async () => {
                                     try {
                                       const res = await fetch(`/api/client-requests/${req._id}/file`, {
                                         credentials: 'include',
                                         headers: clientHeaders(),
                                       });
                                       if (!res.ok) {
                                         const data = await res.json().catch(() => ({}));
                                         throw new Error(data.error || 'Could not open document.');
                                       }
                                       const blob = await res.blob();
                                       window.open(URL.createObjectURL(blob), '_blank');
                                     } catch (err) {
                                       toast.error(err.message);
                                     }
                                 }} className="mt-2 h-7 text-[10px] text-blue-600 border-blue-200 bg-white w-fit">
                                    <FileText className="w-3 h-3 mr-1"/> View Attached Document
                                 </Button>
                              )}
                           </div>
                        </div>
                     ))}
                  </div>
                )}
              </CardContent>
            </Card>

          </TabsContent>

          {/* ============================================================================== */}
          {/* TAB 5: PUBLIC TENDERS */}
          {/* ============================================================================== */}
          <TabsContent value="live_tenders" className="space-y-6">
            <Card className="tender-shadow">
              <CardHeader className="bg-slate-50 border-b flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                <CardTitle className="text-[#0A2647] text-lg flex items-center gap-2"><Globe className="w-5 h-5 text-blue-600"/> Public Procurement Tenders</CardTitle>
                <div className="relative w-full sm:w-[240px]">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="Search bid or title..."
                    value={liveTenderSearch}
                    onChange={(e) => setLiveTenderSearch(e.target.value)}
                    className="pl-9 h-9 text-xs"
                  />
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-4 max-h-[750px] overflow-y-auto">
                 {visibleLiveTenders.length === 0 && (
                   <p className="text-sm text-slate-400 text-center py-8">No matching tenders found.</p>
                 )}
                 {visibleLiveTenders.map((t) => (
                   <div key={t._id || t.id} className="border border-slate-200 rounded-lg p-4 bg-white hover:border-[#0A2647]/30 transition shadow-sm flex flex-col gap-3">
                     <div className="flex items-start justify-between gap-3">
                       <div className="flex-1 min-w-0">
                         <div className="flex items-center gap-2 mb-2">
                           <Badge className="bg-[#0A2647]">{t.district}</Badge>
                           {t.category && <Badge variant="outline" className="text-[10px]">{t.category}</Badge>}
                           {t.bid_no && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800 border-amber-200">Bid: {t.bid_no}</Badge>}
                           <span className="text-[10px] text-red-600 font-bold flex items-center bg-red-50 px-1.5 py-0.5 rounded"><Clock className="w-3 h-3 mr-1"/> Ends: {t.last_date && !isNaN(new Date(t.last_date)) ? new Date(t.last_date).toLocaleDateString() : 'N/A'}</span>
                         </div>
                         <p className="font-bold text-[#0A2647] text-base leading-tight line-clamp-2">{t.title}</p>
                         <p className="text-xs text-slate-500 mt-1">{t.department}</p>
                       </div>
                     </div>
                     
                     <div className="border-t border-slate-100 pt-3 mt-2 flex flex-col sm:flex-row items-center gap-2">
                        <Button size="sm" onClick={() => handleViewPDF(t._id)} variant="outline" className="h-8 text-xs text-blue-600 border-blue-200 shadow-sm shrink-0 w-full sm:w-auto">
                           <FileText className="w-3 h-3 mr-1.5"/> View PDF Document
                        </Button>
                        <Button size="sm" onClick={() => requestBidSupportForTender(t)} className="bg-[#0A2647] hover:bg-[#144272] h-8 text-xs flex-1 w-full shadow-sm text-white">
                           <UploadCloud className="w-3 h-3 mr-1.5"/> Request MD to Bid This
                        </Button>
                     </div>
                   </div>
                 ))}
              </CardContent>
            </Card>
          </TabsContent>

         {/* ============================================================================== */}
          {/* TAB 6: FINANCE & SLA (ALERTS AND QUERIES COMBINED HERE) */}
          {/* ============================================================================== */}
          <TabsContent value="finance" className="space-y-6">
             <div className="grid lg:grid-cols-2 gap-6">
                
                {/* 1. FINANCIAL LEDGER CARD */}
                <Card className="tender-shadow border-t-4 border-t-amber-500 h-fit">
                  <CardHeader className="pb-4 border-b bg-amber-50/30">
                    <CardTitle className="text-lg flex items-center gap-2"><Banknote className="w-5 h-5 text-amber-600"/> Financial Ledger</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-4">
                       <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border">
                          <span className="text-sm font-semibold text-slate-700">Total EMD Paid</span>
                          <span className="text-lg font-black text-slate-800">₹{totalEmd.toLocaleString()}</span>
                       </div>

                       {/* 🚀 STAFF-ONLY: Financial Powerhouse — EMD Loan / GeM Sahay have no
                           real lender integration yet, so both are lead-capture (raise a
                           Finance ticket to the MD). Invisible to real clients. */}
                       {isStaffPreview && (
                          <div className="border-t pt-4">
                             <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                                <Landmark className="w-4 h-4 text-amber-600"/> Working Capital & Funding
                                <Badge className="bg-indigo-100 text-indigo-700 border-0 text-[9px] font-bold">Staff Only</Badge>
                             </h4>
                             <div className="space-y-2">
                                <Button
                                  onClick={() => submitLeadRequest('emd_loan')}
                                  disabled={submittingLead === 'emd_loan'}
                                  className="w-full bg-[#0A2647] hover:bg-[#144272] h-10 justify-between"
                                >
                                   <span className="flex items-center gap-2">
                                      {submittingLead === 'emd_loan' ? <Loader2 className="w-4 h-4 animate-spin"/> : <IndianRupee className="w-4 h-4"/>}
                                      Apply for EMD Loan
                                   </span>
                                </Button>
                                <Button
                                  onClick={() => submitLeadRequest('gem_sahay')}
                                  disabled={submittingLead === 'gem_sahay'}
                                  variant="outline"
                                  className="w-full h-10 justify-between border-amber-200 text-amber-800 hover:bg-amber-50"
                                >
                                   <span className="flex items-center gap-2">
                                      {submittingLead === 'gem_sahay' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Landmark className="w-4 h-4"/>}
                                      GeM Sahay (Bill Discounting)
                                   </span>
                                </Button>
                             </div>
                          </div>
                       )}
                       
                       <div className="border-t pt-4">
                          <h4 className="font-bold text-slate-700 mb-3">Pending Payment Requests</h4>
                          {!pendingPayments || pendingPayments.length === 0 ? (
                             <p className="text-xs text-slate-500 text-center py-2">No pending fees requested.</p>
                          ) : (
                             pendingPayments
                               .map((pay, i) => (
                               <div key={i} className="mb-2 border border-red-200 bg-red-50 p-3 rounded-lg flex flex-col gap-2">
                                  <div className="flex justify-between items-center text-sm">
                                     <span className="font-semibold text-red-900">{pay.reason}</span>
                                     <span className="font-bold text-red-700">₹{pay.amount}</span>
                                  </div>
                                  <Button onClick={() => executePayment(pay)} disabled={buying} size="sm" className="w-full bg-[#0A2647] hover:bg-[#144272] h-9 shadow-md">
                                    {buying ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <IndianRupee className="w-4 h-4 mr-2"/>} 
                                    {buying ? 'Connecting...' : 'Pay via Cashfree'}
                                  </Button>
                               </div>
                             ))
                          )}
                       </div>
                       
                       <div className="border-t pt-4 mt-4">
                          <h4 className="font-bold text-slate-700 mb-3 flex items-center justify-between">
                             Payment History
                             <Badge className="bg-emerald-100 text-emerald-800 border-0">
                                Gross: ₹{userData?.payments?.reduce((sum, p) => sum + (Number(p.amount) || 0), 0).toLocaleString() || 0}
                             </Badge>
                          </h4>
                          {!userData?.payments || userData.payments.length === 0 ? (
                             <p className="text-xs text-slate-500 text-center py-2">No past payments found.</p>
                          ) : (
                            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                              {userData.payments.map((pay, i) => (
                                <div key={i} className="border border-slate-200 bg-white p-3 rounded-lg flex flex-col gap-1 shadow-sm">
                                   <div className="flex justify-between items-center text-sm">
                                      <span className="font-bold text-[#0A2647]">{pay.plan === 'single' ? 'Document Unlock Fee' : pay.plan === 'month' ? 'Monthly Premium' : pay.plan === 'year' ? 'Yearly Premium' : (pay.reason || 'Service Fee')}</span>
                                      <span className="font-black text-emerald-600">₹{pay.amount}</span>
                                   </div>
                                   <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
                                      <span>{new Date(pay.paid_at || pay.created_at).toLocaleDateString()}</span>
                                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">SUCCESS</Badge>
                                   </div>
                                </div>
                              ))}
                            </div>
                          )}
                       </div>
                  </CardContent>
                </Card>

                {/* 2. SLA SUPPORT DESK CARD */}
                <Card className="tender-shadow border-t-4 border-t-slate-800 h-fit">
                  <CardHeader className="pb-4 bg-slate-50 border-b">
                    <CardTitle className="text-lg flex items-center gap-2"><MessageSquare className="w-5 h-5 text-slate-700"/> 24/7 SLA Support Desk</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-5 space-y-6">
                    {/* 🚀 STAFF-ONLY: Legal Defense & Support quick action — deep-links into the
                        existing Bid Tools document generator with the new "GeM Show-Cause Notice
                        Reply" doc type preselected. No new API route; reuses handleGenerateDoc. */}
                    {isStaffPreview && (
                       <div className="border border-slate-200 bg-slate-50 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-start gap-2.5">
                             <Gavel className="w-5 h-5 text-slate-700 shrink-0 mt-0.5"/>
                             <div>
                                <p className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                   Legal Defense & Support
                                   <Badge className="bg-indigo-100 text-indigo-700 border-0 text-[9px] font-bold">Staff Only</Badge>
                                </p>
                                <p className="text-xs text-slate-500 mt-0.5">Draft a formal reply to a GeM Show-Cause Notice on this client's behalf.</p>
                             </div>
                          </div>
                          <Button
                            onClick={() => { setDocForm(prev => ({ ...prev, doc_type: 'scn_reply' })); setActiveTab('bid_tools'); }}
                            className="bg-slate-800 hover:bg-slate-900 h-10 shrink-0 w-full sm:w-auto"
                          >
                             <ScrollText className="w-4 h-4 mr-2"/> Generate GeM SCN Reply Draft
                          </Button>
                       </div>
                    )}
                    <form onSubmit={handleTicketSubmit} className="space-y-4 border-b pb-6">
                      <div>
                        <Label className="text-xs text-slate-600 font-bold">Ticket Subject *</Label>
                        <Input placeholder="e.g., Portal Login Issue" value={ticketForm.subject} onChange={e=>setTicketForm({...ticketForm, subject: e.target.value})} required className="mt-1" />
                      </div>
                      <div>
                        <Label className="text-xs text-slate-600 font-bold">Describe Issue *</Label>
                        <textarea className="w-full border border-slate-200 rounded-md p-2 text-sm h-24 mt-1 focus:ring-2 focus:ring-slate-800 outline-none" placeholder="Describe requirement..." value={ticketForm.message} onChange={e=>setTicketForm({...ticketForm, message: e.target.value})} required></textarea>
                      </div>
                      <Button type="submit" className="w-full bg-slate-800 hover:bg-slate-900 h-11">
                        <Send className="w-4 h-4 mr-2"/> Submit Ticket
                      </Button>
                    </form>

                    {/* Client Side Active & Resolved Ticket Management */}
                    <div>
                       <h4 className="font-bold text-slate-700 mb-3">Your Tickets History</h4>
                       {userData?.tickets && userData.tickets.length > 0 ? (
                          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                             {userData.tickets.map((tkt, i) => (
                                <div key={tkt._id || i} className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm">
                                   <div className="flex justify-between items-start mb-2">
                                      <h5 className="font-bold text-[#0A2647]">{tkt.subject}</h5>
                                      <Badge className={tkt.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-800 border-0' : 'bg-amber-100 text-amber-800 border-0'}>{tkt.status}</Badge>
                                   </div>
                                   <p className="text-xs text-slate-600 mb-3 bg-white p-2 rounded border border-slate-100">Me: {tkt.message}</p>
                                   
                                   {tkt.reply && (
                                      <div className="mb-3 text-xs font-semibold bg-emerald-50 text-emerald-800 p-2 rounded border border-emerald-100">
                                         Support: {tkt.reply}
                                      </div>
                                   )}

                                   <div className="flex flex-col sm:flex-row gap-2 border-t pt-3 mt-1">
                                      <Input placeholder="Reply to Support..." className="h-8 text-xs bg-white flex-1" value={ticketReplyClient[tkt._id] || ''} onChange={(e) => setTicketReplyClient({...ticketReplyClient, [tkt._id]: e.target.value})} />
                                      <div className="flex gap-2 shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
                                         <Button size="sm" onClick={() => submitTicketReplyClient(tkt._id)} className="flex-1 sm:flex-none bg-slate-800 hover:bg-slate-900 h-8 text-xs text-white px-3"><Send className="w-3 h-3 mr-1"/> Reply Again</Button>
                                         <Button size="sm" onClick={() => handleDeleteTicketClient(tkt._id)} variant="outline" className="flex-1 sm:flex-none border-red-200 text-red-600 hover:bg-red-50 h-8 text-xs px-2"><XCircle className="w-3 h-3 mr-1"/> Close Query</Button>
                                      </div>
                                   </div>
                                </div>
                             ))}
                          </div>
                       ) : (
                          <p className="text-xs text-slate-500 text-center py-4">No ticket history found.</p>
                       )}
                    </div>
                  </CardContent>
                </Card>
             </div>


             {/* 3. OFFICER DOCUMENT QUERIES TRACKER CARD */}
             <Card className="tender-shadow border-t-4 border-t-orange-500">
               <CardHeader className="pb-4 border-b bg-orange-50/50">
                  <CardTitle className="text-lg flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-orange-600"/> Officer Document Queries Tracker</CardTitle>
                  <CardDescription>Track the status of documentation requested by the operations team.</CardDescription>
               </CardHeader>
               <CardContent className="pt-5">
                  {userData?.officer_queries?.length === 0 ? (
                      <p className="text-sm text-slate-500 py-6 text-center">No queries pending from operations.</p>
                  ) : (
                      <div className="space-y-4">
                         {userData?.officer_queries?.map((q, idx) => (
                            <div key={idx} className="border border-orange-200 bg-orange-50/50 rounded-xl p-4 flex flex-col gap-3">
                               <div className="flex justify-between items-start">
                                  <h4 className="font-bold text-[#0A2647]">{q.subject}</h4>
                                  <Badge className={q.reply_submitted ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800 animate-pulse'}>
                                     {q.reply_submitted ? 'Reply Sent' : 'Action Required'}
                                  </Badge>
                               </div>
                               <p className="text-sm text-slate-700 bg-white p-3 rounded border border-orange-100">"{q.message}"</p>
                               
                               {q.reply_submitted ? (
                                  <p className="text-xs text-emerald-600 font-bold bg-emerald-50 p-2 rounded">✓ You have submitted the explanation/document. Pending MD verification.</p>
                               ) : (
                                  <form onSubmit={(e) => handleQuerySubmit(e, q.id)} className="border-t border-orange-100 pt-3 mt-1 space-y-3">
                                     <Textarea required placeholder="Provide explanation or details..." value={queryForm.description} onChange={e => setQueryForm({...queryForm, description: e.target.value})} className="bg-white focus:ring-orange-500"/>
                                     <div className="flex flex-col sm:flex-row gap-3">
                                        <div className="flex-1 relative border border-slate-300 bg-white rounded-md flex items-center px-3 cursor-pointer hover:bg-slate-50 h-10">
                                           <input type="file" accept=".pdf,.jpg,.png,.zip" className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" onChange={e => setQueryForm({...queryForm, file: e.target.files[0]})} />
                                           <UploadCloud className="w-4 h-4 text-slate-400 mr-2 shrink-0"/>
                                           <span className="text-xs text-slate-600 truncate">{queryForm.file ? queryForm.file.name : "Attach Document (Optional)"}</span>
                                        </div>
                                        <Button type="submit" disabled={submittingQuery} className="bg-orange-600 hover:bg-orange-700 sm:w-auto w-full h-10 shrink-0">
                                           {submittingQuery ? <Loader2 className="w-4 h-4 animate-spin"/> : 'Send Reply'}
                                        </Button>
                                     </div>
                                  </form>
                               )}
                            </div>
                         ))}
                      </div>
                  )}
               </CardContent>
             </Card>

          </TabsContent>

        </Tabs>
      </main>
    </div>
  );
}
