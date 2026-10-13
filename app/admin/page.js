'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'; 
import { signOut } from 'next-auth/react'; 
import { useServerDeskRole } from '@/components/DeskAuth';
import { clearDeskBypass } from '@/lib/tab-handoff';
import { BrandMark, invalidateSettingsCache } from '@/components/BrandLogo';
import GeminiWorkspace from '@/components/GeminiWorkspace';
import StationeryUploader from '@/components/StationeryUploader';
import L1BenchmarkDropzone from '@/components/L1BenchmarkDropzone';
import CopilotTrainDropzone from '@/components/CopilotTrainDropzone';
import MasterTenderDesk from '@/components/MasterTenderDesk';
import WhatsAppVerifiedBadge from '@/components/WhatsAppVerifiedBadge';
import AiMatchmakerPanel from '@/components/AiMatchmakerPanel';
import DashboardNav from '@/components/DashboardNav';
import PricingMasterPanel from '@/components/PricingMasterPanel';
import ThirdPartyLeadsPanel from '@/components/ThirdPartyLeadsPanel';
import InternalTrackingBoard from '@/components/workflow/InternalTrackingBoard';
import SubmittedTrackingBoard from '@/components/workflow/SubmittedTrackingBoard';
import WinningBidsBoard from '@/components/workflow/WinningBidsBoard';
import CreatePublishTaskForm from '@/components/workflow/CreatePublishTaskForm';
import SuggestClientControls from '@/components/workflow/SuggestClientControls';
import ArchiveBoard from '@/components/workflow/ArchiveBoard';
import StaffChat from '@/components/StaffChat';
import OpsAlerts from '@/components/OpsAlerts';
import TeamDirectoryPanel, { openStaffDesk } from '@/components/TeamDirectoryPanel';
import { deskPathForStaff, DESIGNATIONS, staffRoleOf } from '@/lib/designations';
import { openStaffBypass, openClientBypass } from '@/lib/tab-handoff';
import { formatINR } from '@/lib/format';
import { BID_NUMBER_FORMAT_MESSAGE, DUPLICATE_BID_MESSAGE, bidNumberError } from '@/lib/bid-number';
import { liveTendersOnly } from '@/lib/tender-sort';
import { currentHandler, jobDeadline } from '@/lib/tender-deadline';
import { workflowFetch, fetchWorkflowQueue, openWorkflowFile } from '@/components/workflow/api';
import {
  applyJobToBoard,
  belongsOnInternal,
  belongsOnSubmitted,
  belongsOnSuggestions,
  belongsOnWinning,
  dropJob,
  INTERNAL_BOARD_STATUSES,
  setListIfChanged,
  upsertJob,
} from '@/lib/job-board-state';
import MasterReports from '@/components/reports/MasterReports';
import { useStaffPresence } from '@/components/reports/useStaffPresence';
import { TS_AP_DISTRICTS } from '@/lib/regions';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  ShieldCheck, LogOut, Upload, FileText, Users, IndianRupee, Trash2, Plus, PlusCircle,
  Image as ImageIcon, Lock, MessageSquare, Send, TrendingDown, Clock, UserCheck, 
  CheckCircle2, Loader2, Eye, UserPlus, Briefcase, ClipboardList, Key, Mail, 
  Activity, BarChart3, EyeOff, UserCog, MapPin, Target, LogIn, UploadCloud, 
  PhoneCall, Database, Wallet, ArrowDownRight, ArrowUpRight, FileUp, Pencil, 
  FolderPlus, RefreshCw, Trophy, X, XCircle, MonitorPlay, Search, AlertTriangle, Building2, PenTool, Usercog, Globe,
  ChevronLeft, ChevronRight, Handshake, Sparkles, TrendingUp, Gauge, ShieldAlert, Bot, BellRing, Archive
} from 'lucide-react';

// 🚀 Single source of truth (lib/regions.js) — was hand-duplicated here and had
// drifted from the AP district list used elsewhere.
const DISTRICTS = TS_AP_DISTRICTS;

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

// 🚀 Skeleton shown while the auth check resolves — shaped like the real header
// + stat-card row + tab bar so the transition into real data feels instant
// rather than a spinner-then-pop.
function AdminDashboardSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="navy-gradient text-white border-b border-white/10 sticky top-0 z-40 shadow-lg">
        <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Skeleton className="w-9 h-9 rounded-xl bg-white/10" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40 bg-white/10" />
              <Skeleton className="h-2.5 w-28 bg-white/10" />
            </div>
          </div>
          <Skeleton className="h-8 w-24 rounded-md bg-white/10 hidden sm:block" />
        </div>
      </header>
      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-0 ring-1 ring-slate-200/80 bg-white">
              <CardContent className="p-4 sm:p-5 space-y-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <Card className="border-0 ring-1 ring-slate-200/80">
          <CardContent className="p-5 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export default function AdminPage() {
  const deskRole = useServerDeskRole();
  const mdDesk = deskRole === 'md';
  const [token, setToken] = useState('');
  const [authChecking, setAuthChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('reports');
  useStaffPresence(activeTab, { enabled: mdDesk });

  // --- CORE DATA STATES ---
  const [tenders, setTenders] = useState([]);
  const [stats, setStats] = useState({ tenders: 0, users: 0, payments: 0, revenue: 0 });
  const [tickets, setTickets] = useState([]);
  const [guestQueries, setGuestQueries] = useState([]);
  const [ticketReply, setTicketReply] = useState({}); 
  const [l1Data, setL1Data] = useState({}); 
  const [approvedClients, setApprovedClients] = useState([]);

  // Team & Credentials
  const [officerForm, setOfficerForm] = useState({ name: '', email: '', password: '', role: 'employee' });
  const [teamMembers, setTeamMembers] = useState([]); 
  const [showPwdId, setShowPwdId] = useState(null); 

  // Finance Ledger & Progress States
  const [paymentRequestForm, setPaymentRequestForm] = useState({ client_id: '', amount: '', reason: '' });
  const [financialRequests, setFinancialRequests] = useState([]);
  const [ledgerTxns, setLedgerTxns] = useState([]);
  const [ledgerBalance, setLedgerBalance] = useState(0);
  const [breakdown, setBreakdown] = useState({ offline: 0, online: 0 }); // 🚀 FIX: For Balance Breakdown
  const [ledgerForm, setLedgerForm] = useState({ type: 'CREDIT', amount: '', reason: '', client_id: 'N/A', payment_mode: 'OFFLINE' });
  const [ledgerProof, setLedgerProof] = useState('');
  const [ledgerProofName, setLedgerProofName] = useState('');
  const [editingLedgerId, setEditingLedgerId] = useState(null);

  // --- PERMANENT BACKEND STATES ---
  const [taskForm, setTaskForm] = useState({ target_type: 'client_alert', target_id: '', subject: '', message: '' });
  const [queryForm, setQueryForm] = useState({ client_email: '', subject: '', message: '' });
  const [dispatches, setDispatches] = useState([]);
  // Tender Publisher State
  const [form, setForm] = useState({
    title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: '', bid_no: ''
  });
  const [pdfBase64, setPdfBase64] = useState('');
  const [pdfName, setPdfName] = useState('');
  const [isEditingTender, setIsEditingTender] = useState(null);
  const [tenderSearch, setTenderSearch] = useState('');
  // 🚀 Pagination for the Published Tenders list (20 per page)
  const [tenderPage, setTenderPage] = useState(1);
  const tendersPerPage = 10;
  const tendersListRef = useRef(null);

  // === దీని కింద పేస్ట్ చెయ్ (పాత కోడ్) ===
  const [rejectReason, setRejectReason] = useState({});
  const [successfulPaymentsLog, setSuccessfulPaymentsLog] = useState([]);

  // 🚀 ఇక్కడ పేస్ట్ చెయ్ (కొత్త కోడ్) 🚀
  const [analyzingFiles, setAnalyzingFiles] = useState(false);
  const [analyzingTender, setAnalyzingTender] = useState(false);
  const [bulkDragActive, setBulkDragActive] = useState(false);
  const [bulkFileCount, setBulkFileCount] = useState(0);
  const [wfSuggestions, setWfSuggestions] = useState([]);
  const [wfInternal, setWfInternal] = useState([]);
  const [wfSubmitted, setWfSubmitted] = useState([]);
  const [wfWinning, setWfWinning] = useState([]);
  const [wfArchive, setWfArchive] = useState([]);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const patchJob = useCallback((job) => {
    if (!job) return;
    setWfSuggestions((prev) => applyJobToBoard(prev, job, belongsOnSuggestions));
    setWfInternal((prev) => applyJobToBoard(prev, job, belongsOnInternal));
    setWfSubmitted((prev) => applyJobToBoard(prev, job, belongsOnSubmitted));
    setWfWinning((prev) => applyJobToBoard(prev, job, belongsOnWinning));
  }, []);
  const removeJob = useCallback((id) => {
    setWfSuggestions((prev) => dropJob(prev, id));
    setWfInternal((prev) => dropJob(prev, id));
    setWfSubmitted((prev) => dropJob(prev, id));
    setWfWinning((prev) => dropJob(prev, id));
    setWfArchive((prev) => dropJob(prev, id));
  }, []);
  const archiveJob = useCallback((job) => {
    if (!job) return;
    removeJob(job._id);
    setWfArchive((prev) => upsertJob(prev, { ...job, archive_reason: job.archive_reason || 'Lost' }));
  }, [removeJob]);

  // 🚀 AI Matchmaker & Competitor Intel
  const [bidMatches, setBidMatches] = useState([]);
  const [matchSummary, setMatchSummary] = useState({ total: 0, new: 0, jv: 0 });
  const [matchTypeFilter, setMatchTypeFilter] = useState('all'); // all | DIRECT | JV
  const [runningMatchmaker, setRunningMatchmaker] = useState(false);
  const [launchingGem, setLaunchingGem] = useState(false);
  const [predictingMatchId, setPredictingMatchId] = useState(null);
  const [predictionOpen, setPredictionOpen] = useState(false);
  const [prediction, setPrediction] = useState(null); // { match, tender, history, prediction }
  const [stationeryClient, setStationeryClient] = useState(null);

  // 🚀 Today's Live Scraped Tenders (text-only GeM hunter feed)
  const [liveScrapedTenders, setLiveScrapedTenders] = useState([]);
  const [liveFeedToday, setLiveFeedToday] = useState('');
  const [liveFeedLoading, setLiveFeedLoading] = useState(false);

  // MD Team Activity: parked + AWAITING_CLIENT vs internal pipeline (MD_CHECKLIST..AWAITING_RECEIPT).
  const [teamActivityLoading, setTeamActivityLoading] = useState(false);

  const suggestionBoardJobs = useMemo(
    () => wfSuggestions.filter(belongsOnSuggestions),
    [wfSuggestions],
  );
  const masterLiveJobs = useMemo(
    () => wfInternal.filter((job) => INTERNAL_BOARD_STATUSES.includes(job.status)),
    [wfInternal],
  );

  useEffect(() => {
    if (!mdDesk) {
      setAuthChecking(false);
      return;
    }
    const t = typeof window !== 'undefined' ? localStorage.getItem('tt_admin') : '';
    if (t) setToken(t);
    setAuthChecking(false);
  }, [mdDesk]);

  // 🚀 FIX: Admin Live Tracking (Auto-Refresh without Cache)
  useEffect(() => {
    if (!mdDesk) return undefined;
    refresh(activeTab);
      const interval = setInterval(() => {
        if (document.visibilityState === 'visible') {
          refresh(activeTabRef.current);
        }
      }, 60000);
      return () => clearInterval(interval);
    // eslint-disable-next-line
  }, [mdDesk, token, activeTab]);

  // 🚀 Reset the Published Tenders pagination back to page 1 whenever the search changes
  useEffect(() => { setTenderPage(1); }, [tenderSearch]);

  // 🚀 Lazy-load the Team Activity module only when its tab opens — same
  // "independent of the main refresh cycle" pattern as refreshLiveFeed().
  useEffect(() => {
    if (activeTab === 'team-activity' && mdDesk) {
      fetchTeamActivity();
    }
    // eslint-disable-next-line
  }, [activeTab, mdDesk]);

  // 🚀 FIX: Bulletproof refresh — one blocked/failing route (e.g. expired-tender
  // filter accidentally hiding admin data, a network blip, a non-JSON error page)
  // used to throw inside Promise.all and take the ENTIRE dashboard down to zeros.
  // safeFetch isolates each request so a single failure never crashes the rest.
  const refresh = async (tab = activeTabRef.current) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const safeFetch = async (url) => {
      try {
        const res = await fetch(url, { credentials: 'include', headers });
        if (!res.ok) return { ok: false, status: res.status };
        return { ok: true, data: await res.json() };
      } catch (e) {
        return { ok: false };
      }
    };

    const want = new Set();
    if (tab === 'reports') ['tenders', 'clients', 'ledger'].forEach((k) => want.add(k));
    else if (tab === 'finance') ['ledger', 'payments', 'clients'].forEach((k) => want.add(k));
    else if (tab === 'clients') want.add('clients');
    else if (tab === 'matchmaker') want.add('matches');
    else if (tab === 'internal') ['employees', 'wfInternal'].forEach((k) => want.add(k));
    else if (tab === 'team-activity') ['wfInternal', 'wfParked', 'wfSuggestions'].forEach((k) => want.add(k));
    else if (tab === 'submitted') ['employees', 'wfSubmitted', 'wfWinning'].forEach((k) => want.add(k));
    else if (tab === 'archive') want.add('wfArchive');
    else if (tab === 'publisher') want.add('tenders');
    else if (tab === 'team') want.add('employees');
    else if (tab === 'tickets' || tab === 'client-queries') ['tickets', 'guests'].forEach((k) => want.add(k));
    else if (tab === 'live-scraped') { refreshLiveFeed(token, { silent: true }); return; }
    if (want.size === 0) return;

    try {
      const stamp = Date.now();
      const tasks = {};
      if (want.has('tenders')) tasks.tenders = safeFetch(`/api/tenders?t=${stamp}`);
      if (want.has('stats')) tasks.stats = safeFetch(`/api/admin/stats?t=${stamp}`);
      if (want.has('tickets')) tasks.tickets = safeFetch(`/api/tickets?role=admin&t=${stamp}`);
      if (want.has('clients')) tasks.clients = safeFetch(`/api/users/approved?t=${stamp}`);
      if (want.has('dispatches')) tasks.dispatches = safeFetch(`/api/dispatches?t=${stamp}`);
      if (want.has('employees')) tasks.employees = safeFetch(`/api/employees?t=${stamp}`);
      if (want.has('ledger')) tasks.ledger = safeFetch(`/api/finance/ledger?t=${stamp}`);
      if (want.has('guests')) tasks.guests = safeFetch(`/api/guest-queries?t=${stamp}`);
      if (want.has('payments')) tasks.payments = safeFetch(`/api/payments/requests?t=${stamp}`);
      if (want.has('matches')) tasks.matches = safeFetch(`/api/bid-matches?t=${stamp}`);
      if (want.has('wfInternal')) tasks.wfInternal = fetchWorkflowQueue('internal').then((data) => ({ ok: true, data })).catch(() => ({ ok: false }));
      if (want.has('wfParked')) tasks.wfParked = fetchWorkflowQueue('parked').then((data) => ({ ok: true, data })).catch(() => ({ ok: false }));
      if (want.has('wfSuggestions')) tasks.wfSuggestions = fetchWorkflowQueue('suggestions').then((data) => ({ ok: true, data })).catch(() => ({ ok: false }));
      if (want.has('wfSubmitted')) tasks.wfSubmitted = fetchWorkflowQueue('submitted').then((data) => ({ ok: true, data })).catch(() => ({ ok: false }));
      if (want.has('wfWinning')) tasks.wfWinning = fetchWorkflowQueue('winning').then((data) => ({ ok: true, data })).catch(() => ({ ok: false }));
      if (want.has('wfArchive')) tasks.wfArchive = workflowFetch(`/api/workflow/archive?t=${stamp}`).then((data) => ({ ok: true, data })).catch(() => ({ ok: false }));

      const keys = Object.keys(tasks);
      const results = await Promise.all(keys.map((k) => tasks[k]));
      const got = Object.fromEntries(keys.map((k, i) => [k, results[i]]));

      if (got.tenders?.status === 401) return logout();
      if (got.tenders?.ok) setListIfChanged(setTenders, got.tenders.data.tenders || []);
      if (got.stats?.ok) setStats(got.stats.data || {});
      if (got.tickets?.ok) setListIfChanged(setTickets, got.tickets.data.tickets || []);
      if (got.guests?.ok) setListIfChanged(setGuestQueries, got.guests.data.queries || got.guests.data['guest-queries'] || []);
      if (got.clients?.ok) {
        setListIfChanged(setApprovedClients, got.clients.data.users || []);
      }
      if (got.dispatches?.ok) setListIfChanged(setDispatches, got.dispatches.data.dispatches || []);
      if (got.employees?.ok) setListIfChanged(setTeamMembers, got.employees.data.team || []);
      if (got.ledger?.ok) {
        setListIfChanged(setLedgerTxns, got.ledger.data.transactions || []);
        setSuccessfulPaymentsLog(got.ledger.data.online_payments || []);
        setLedgerBalance(got.ledger.data.balance || 0);
        setBreakdown(got.ledger.data.breakdown || { offline: 0, online: 0 });
      }
      if (got.payments?.ok) {
        setFinancialRequests((got.payments.data.requests || []).filter((r) => r.status !== 'SUCCESS' && r.status !== 'PAID'));
      }
      if (got.matches?.ok) {
        setBidMatches(got.matches.data.matches || []);
        setMatchSummary(got.matches.data.summary || { total: 0, new: 0, jv: 0 });
      }
      if (got.wfInternal?.ok) setListIfChanged(setWfInternal, (got.wfInternal.data.jobs || []).filter(belongsOnInternal));
      if (got.wfParked?.ok || got.wfSuggestions?.ok) {
        const parked = got.wfParked?.ok ? (got.wfParked.data.jobs || []) : [];
        const waiting = got.wfSuggestions?.ok ? (got.wfSuggestions.data.jobs || []) : [];
        const merged = [...parked, ...waiting].filter(belongsOnSuggestions);
        const seen = new Set();
        const unique = merged.filter((job) => {
          const id = String(job._id || job.id || '');
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        setListIfChanged(setWfSuggestions, unique);
      }
      if (got.wfSubmitted?.ok) setListIfChanged(setWfSubmitted, got.wfSubmitted.data.jobs || []);
      if (got.wfWinning?.ok) setListIfChanged(setWfWinning, (got.wfWinning.data.jobs || []).filter(belongsOnWinning));
      if (got.wfArchive?.ok) setListIfChanged(setWfArchive, got.wfArchive.data.jobs || []);

      if (tab === 'reports') refreshLiveFeed(token, { silent: true });
    } catch (err) { console.error('Refresh failed:', err); }
  };

  // Independent of full-dashboard refresh — pulls only /api/tenders/live-feed.
  const refreshLiveFeed = async (authToken = token, { silent = false } = {}) => {
    if (!authToken) return;
    setLiveFeedLoading(true);
    try {
      const res = await fetch(`/api/tenders/live-feed?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (!silent && res.status !== 401) {
          toast.error(data?.error || `Live feed failed (${res.status})`);
        }
        return;
      }
      setLiveScrapedTenders(data?.tenders || []);
      setLiveFeedToday(data?.today || '');
    } catch (e) {
      console.error('Live feed refresh failed:', e);
      if (!silent) toast.error('Network error while loading live scraped tenders.');
    } finally {
      setLiveFeedLoading(false);
    }
  };

  // 🚀 RBAC: MD-only global attribution views — independent of the main refresh()
  // Promise.all so every employee's suggestions/tracking don't get pulled on every
  // 60s poll; only fetched when the "Team Activity" tab is actually open.
  const fetchTeamActivity = async () => {
    if (!mdDesk) return;
    setTeamActivityLoading(true);
    try {
      const [parked, waiting, internal] = await Promise.all([
        fetchWorkflowQueue('parked').catch(() => ({ jobs: [] })),
        fetchWorkflowQueue('suggestions').catch(() => ({ jobs: [] })),
        fetchWorkflowQueue('internal').catch(() => ({ jobs: [] })),
      ]);
      const merged = [...(parked.jobs || []), ...(waiting.jobs || [])].filter(belongsOnSuggestions);
      const seen = new Set();
      const unique = merged.filter((job) => {
        const id = String(job._id || job.id || '');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      setListIfChanged(setWfSuggestions, unique);
      setListIfChanged(setWfInternal, (internal.jobs || []).filter(belongsOnInternal));
    } catch (e) {
      console.error('Team activity refresh failed:', e);
      toast.error('Network error while loading team activity.');
    } finally {
      setTeamActivityLoading(false);
    }
  };

  const logout = async () => {
    if (typeof window === 'undefined') return;
    try {
      await fetch('/api/system/logout', { method: 'POST', credentials: 'include' });
    } catch { /* the cookie clear is best-effort */ }
    clearDeskBypass();
    localStorage.clear();
    sessionStorage.clear();
    try { await signOut({ redirect: false }); } catch { /* already signed out */ }
    window.location.href = '/';
  };

  const onPdfChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') return toast.error('Please upload a PDF file');
    // 🚀 FIX: this file is sent as a base64 string inside the tender's JSON payload,
    // which inflates it by ~33%. Vercel hard-caps the whole serverless request body at
    // ~4.5MB, so a 4MB raw PDF (≈5.3MB once base64-encoded) used to fail with an opaque
    // 413 after the toast already said it was fine. 3MB raw stays safely under that cap.
    if (file.size > 3 * 1024 * 1024) return toast.error('PDF file is too large! Please upload under 3MB.');
    const reader = new FileReader();
    reader.onload = () => {
      const base64Str = reader.result?.toString().split(',')[1] || '';
      setPdfBase64(base64Str);
      setPdfName(file.name);
      toast.success(`PDF loaded: ${file.name}`);
      handleAdminPdfAnalysis(file);
    };
    reader.readAsDataURL(file);
  };

  const handleAdminPdfAnalysis = async (file) => {
    if (!file) return;
    setAnalyzingTender(true);
    toast.info('AI is reading the document. Please wait...', { duration: 3000 });
    try {
      const payload = new FormData();
      payload.append('file', file);
      payload.append('saveToDraft', 'false');
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        credentials: 'include',
        body: payload,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const fallback = res.status === 429
          ? 'AI limit reached. Please wait a moment and try again, or fill the form manually.'
          : 'AI analysis failed. Enter details manually.';
        const msg = String(body.error || fallback);
        toast.error(msg.length > 180 ? fallback : msg, { duration: 6000 });
        return;
      }
      const data = body.data || {};
      const isoDate = String(data.last_date || '').match(/\d{4}-\d{2}-\d{2}/);
      const category = ['Product', 'Service', 'Works'].find((c) => c.toLowerCase() === String(data.category || '').toLowerCase());
      const district = DISTRICTS.find((d) => d.toLowerCase() === String(data.district || '').toLowerCase());
      setForm(prev => ({
        ...prev,
        bid_no: data.bid_no || prev.bid_no,
        title: data.title || prev.title,
        department: data.department || prev.department,
        last_date: isoDate ? isoDate[0] : (data.last_date || prev.last_date),
        district: district || prev.district,
        category: category || prev.category,
        supply_details: prev.supply_details || [
          data.emd_amount ? `EMD: ${data.emd_amount}` : '',
          data.turnover_req ? `Turnover Req: ${data.turnover_req}` : '',
          (data.mandatory_docs || []).length ? `Mandatory Docs: ${data.mandatory_docs.join(', ')}` : '',
        ].filter(Boolean).join('\n')
      }));
      toast.success('AI Successfully auto-filled the tender details!');
    } catch (err) {
      toast.error('Network error during AI analysis. Enter details manually.', { duration: 6000 });
    } finally {
      setAnalyzingTender(false);
    }
  };

  const onLedgerProofChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast.error('Image/PDF too large! Keep under 2MB.');
    const reader = new FileReader();
    reader.onload = () => { setLedgerProof(reader.result?.toString() || ''); setLedgerProofName(file.name); toast.success(`Proof loaded: ${file.name}`); };
    reader.readAsDataURL(file);
  };

  const handleViewPDF = async (tenderId) => {
    window.open(`/api/tenders/${tenderId}/pdf?email=${process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'admin'}&role=admin`, '_blank');
    toast.success('Opening PDF Document...');
  };

  const publish = async (e) => {
    e.preventDefault();
    if (!form.title || !form.department || !form.last_date || !form.district || !form.bid_no) return toast.error('Fill all required fields');
    if (bidNumberError(form.bid_no)) return toast.error(BID_NUMBER_FORMAT_MESSAGE);
    setLoading(true);
    try {
      const endpoint = isEditingTender ? `/api/tenders/${isEditingTender}` : '/api/tenders';
      const method = isEditingTender ? 'PUT' : 'POST';
      const payload = { ...form, pdf_filename: pdfName || 'tender.pdf' };
      if (pdfBase64) payload.pdf_base64 = pdfBase64; 

      const r = await fetch(endpoint, {
        method: method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const result = await r.json().catch(() => null);
      if (r.status === 409) return toast.error(DUPLICATE_BID_MESSAGE);
      // Show the server's actual reason (e.g. an unreadable PDF) instead of a bare status code.
      if (!r.ok) return toast.error(result?.error || `Server Error (${r.status})`);

      toast.success(isEditingTender ? `Tender updated successfully!` : `Tender published successfully!`);
      // A failed R2 upload still saves the tender, but silently — surface it so the
      // storage misconfiguration gets fixed instead of accumulating fragile records.
      if (result?.storage_warning) toast.warning(result.storage_warning, { duration: 8000 });
      setForm({ title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: '', bid_no: '' });
      setPdfBase64(''); setPdfName(''); setIsEditingTender(null); refresh();
    } catch (err) { toast.error('Network Error.'); } finally { setLoading(false); }
  };

  const handleEditTender = (t) => {
    setForm({
      title: t.title || '', department: t.department || '', last_date: t.last_date ? new Date(t.last_date).toISOString().split('T')[0] : '', 
      district: t.district || '', category: t.category || 'Product', supply_details: t.supply_details || '', bid_no: t.bid_no || ''
    });
    setIsEditingTender(t._id || t.id);
    toast.info("Edit mode active. Update details and click save.");
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (id) => {
    if (!confirm('Delete this tender permanently?')) return;
    await fetch(`/api/tenders/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    toast.success('Deleted'); refresh();
  };

  const submitL1Price = async (tender_id) => {
    const data = l1Data[tender_id];
    if (!data?.price) return toast.error('Please enter the L1 Price');
    try {
      await fetch(`/api/tenders/${tender_id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ l1_price: data.price, l1_winner: data.winner })
      });
      toast.success('L1 Intel saved successfully!'); refresh();
    } catch(e) { toast.error('Error saving L1 Price'); }
  };

  // 🚀 AI Matchmaker & Competitor Intel ------------------------------------------------
  // Triggers the same job Vercel Cron runs nightly, so the MD never has to wait for the
  // schedule after publishing a batch of tenders.
  const runMatchmakerNow = async () => {
    setRunningMatchmaker(true);
    const toastId = toast.loading('Scanning open TS/AP tenders against client profiles...');
    try {
      const res = await fetch('/api/cron/matchmaker', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.error || `Matchmaker failed (${res.status})`, { id: toastId, duration: 9000 });
        return;
      }

      const s = data?.stats || {};
      if (!s.matches_found) {
        // Zero matches is a valid outcome; the API explains which rule filtered
        // everything out so this doesn't look like a broken job.
        toast.info(
          data?.explanation || `Scanned ${s.tenders_in_ts_ap || 0} open TS/AP tenders — no matches this time.`,
          { id: toastId, duration: 12000 }
        );
      } else {
        toast.success(
          `${s.matches_found} match(es) across ${s.tenders_in_ts_ap || 0} open TS/AP tenders` +
          `${s.jv_opportunities ? ` — ${s.jv_opportunities} JV opportunity(ies)` : ''}.`,
          { id: toastId, duration: 8000 }
        );
      }
      // A failed WhatsApp send is reported separately: the matches are still saved.
      if (data?.alert?.error) toast.warning(`Matches saved, but the WhatsApp alert failed: ${data.alert.error}`, { duration: 9000 });
      else if (data?.alert?.skipped && s.inserted > 0) toast.info(`WhatsApp alert skipped: ${data.alert.reason}`);

      refresh();
    } catch (e) {
      console.error('Matchmaker run failed:', e);
      toast.error('Network error while running the matchmaker.', { id: toastId });
    } finally {
      setRunningMatchmaker(false);
    }
  };

  const runL1Prediction = async (match) => {
    const matchId = match._id || match.tender_id;
    setPredictingMatchId(matchId);
    try {
      const res = await fetch('/api/ai/predict-l1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tender_id: match.tender_id }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.error || `Prediction failed (${res.status})`, { duration: 9000 });
        return;
      }

      setPrediction({ match, ...data });
      setPredictionOpen(true);
    } catch (e) {
      console.error('L1 prediction failed:', e);
      toast.error('Network error while running the prediction.');
    } finally {
      setPredictingMatchId(null);
    }
  };

  const updateMatchStatus = async (match, status) => {
    const id = match._id;
    if (!id) return;
    // Optimistic: dismissed matches leave the feed immediately, reviewed ones stay but
    // lose their "New" badge.
    setBidMatches(prev => status === 'dismissed'
      ? prev.filter(m => m._id !== id)
      : prev.map(m => (m._id === id ? { ...m, status } : m)));

    try {
      const res = await fetch('/api/bid-matches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error('Update rejected');
      toast.success(status === 'dismissed' ? 'Match dismissed.' : 'Match marked as reviewed.');
    } catch (e) {
      toast.error('Could not update the match. Reloading.');
      refresh();
    }
  };

  const visibleMatches = matchTypeFilter === 'all'
    ? bidMatches
    : bidMatches.filter(m => m.match_type === matchTypeFilter);
  
  const handleSyncDrive = async (email, companyName) => {
     const toastId = toast.loading("Creating Google Drive Workspace...");
     try {
        const res = await fetch('/api/drive/create-folder', {
           method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
           body: JSON.stringify({ email, folderName: `Client - ${companyName}` })
        });
        const data = await res.json();
        if(res.ok) { toast.success("Drive Synced & Created Successfully!", { id: toastId }); refresh(); } 
        else { toast.error(data.error || "Drive Sync Failed.", { id: toastId }); }
     } catch(e) { toast.error("Network Error.", { id: toastId }); }
  };

  const deleteClientPermanently = async (email) => {
    if (!confirm("🚨 WARNING: Are you sure you want to PERMANENTLY delete this client and ALL their associated data? This action CANNOT be undone.")) return;
    try {
      const res = await fetch(`/api/users?email=${encodeURIComponent(email)}`, { 
         method: 'DELETE', 
         headers: { Authorization: `Bearer ${token}` } 
      });
      if (res.ok) { 
         toast.success("Client and all data permanently wiped out!"); 
         refresh(); 
      } else { 
         toast.error("Failed to delete client."); 
      }
    } catch(e) { toast.error('Network Error while deleting.'); }
  };

// 🚀 FIX: LocalStorage Injection for Instant MD Bypass
  const impersonateUser = async (type, email_or_id, designation) => {
    const toastId = toast.loading(`Bypassing secure access to ${type} dashboard...`);
    try {
        if (type === 'client') {
            toast.success("Bypass Successful! Opening Real Dashboard...", { id: toastId });
            openClientBypass(email_or_id);
        } else if (type === 'employee') {
            toast.success("Bypass Successful! Opening Real Dashboard...", { id: toastId });
            openStaffBypass(deskPathForStaff({ designation, email: email_or_id, emp_id: email_or_id }), email_or_id);
        }
    } catch (e) {
        toast.error("Error during authentication bypass.", { id: toastId });
    }
  };

  const [approvalModal, setApprovalModal] = useState({ open: false, email: '', docId: '', docName: '', clientName: '' });
  const [customFileName, setCustomFileName] = useState('');
  const [overwriteDoc, setOverwriteDoc] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState('');

  const openApprovalModal = (client, doc) => {
      const cleanClientName = (client.company_name || client.client_name || 'Client').replace(/\s+/g, '_');
      const cleanDocName = doc.name.replace(/\s+/g, '_');
      setCustomFileName(`${cleanClientName}_${cleanDocName}`);
      setDuplicateWarning('');
      setOverwriteDoc(false);
      setApprovalModal({ open: true, email: client.email, docId: doc.id, docName: doc.name, clientName: client.company_name || client.client_name });
  };

  const handleVerifyVaultDoc = async (clientEmail, docId, status, customName = null, overwrite = false) => {
      let reason = '';
      if (status === 'rejected') {
          reason = rejectReason[`${clientEmail}_${docId}`];
          if (!reason) return toast.error("Please provide a rejection reason so the client can fix it.");
      }

      try {
          const res = await fetch('/api/vault/verify', {
             method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
             body: JSON.stringify({ 
                 email: clientEmail, docId: docId, status: status, reject_reason: reason,
                 custom_file_name: customName, overwrite: overwrite 
             })
          });
          
          const data = await res.json();

          if (res.ok) {
              toast.success(`Document marked as ${status.toUpperCase()}!`);
              if (status === 'rejected') setRejectReason(prev => ({...prev, [`${clientEmail}_${docId}`]: ''}));
              if (status === 'verified') setApprovalModal({ open: false, email: '', docId: '', docName: '', clientName: '' });
              refresh();
          } else if (res.status === 409) {
              setDuplicateWarning(data.message || 'Duplicate found. Replace it?');
          } else {
              toast.error("Failed to update status.");
          }
      } catch (err) {
          toast.error("Network error while updating vault document.");
      }
  };

  const resolveGuestQuery = async (id) => {
      try {
          await fetch(`/api/guest-queries?id=${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
          toast.success("Guest query marked as resolved and removed!");
          refresh();
      } catch (e) { toast.error("Error updating query."); }
  };

  const submitTicketReply = async (ticket_id) => {
    const replyText = ticketReply[ticket_id];
    if(!replyText) return toast.error('Please write a reply first.');
    try {
      const r = await fetch('/api/tickets/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ticket_id, reply: replyText, admin_email: 'MD Admin' })
      });
      if(r.ok) { toast.success('Reply Sent & Ticket Resolved!'); setTicketReply(prev => ({...prev, [ticket_id]: ''})); refresh(); } else toast.error('Failed to send reply');
    } catch(e) { toast.error('Error resolving ticket'); }
  };

  const deleteTicket = async (ticket_id) => {
    if(!confirm("Permanently delete this helpdesk conversation?")) return;
    try {
       const res = await fetch(`/api/tickets?id=${ticket_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
       if(res.ok) { toast.success("Ticket deleted"); refresh(); } else toast.error("Failed to delete");
    } catch(e) { toast.error("Network error"); }
  };
  // 🚀 MD Bulk AI Upload — sends the raw PDFs as multipart/form-data to the bulk
  // pipeline, which stores each document in Cloudflare R2 and keeps only the extracted
  // JSON + R2 pointers in MongoDB. (The previous version base64-encoded every file into
  // a JSON body, which bloated MongoDB and made large batches time out.)
  const processBulkFiles = async (fileList) => {
      const files = Array.from(fileList || []);
      if (files.length === 0) return;

      const validFiles = files.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      const rejectedCount = files.length - validFiles.length;
      if (validFiles.length === 0) return toast.error('Only PDF files are allowed.');
      if (rejectedCount > 0) toast.warning(`${rejectedCount} non-PDF file(s) were skipped.`);

      setAnalyzingFiles(true);
      setBulkFileCount(validFiles.length);

      try {
          const formData = new FormData();
          validFiles.forEach(file => formData.append('files', file));
          formData.append('uploadedBy', 'MD Admin');

          const res = await fetch('/api/ai/bulk-upload', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
              body: formData,
          });

          const data = await res.json().catch(() => null);

          if (!res.ok) {
              toast.error(data?.error || `Bulk upload failed (${res.status})`, { duration: 9000 });
              return;
          }

          const { saved = 0, duplicates = 0, failed = 0 } = data?.summary || {};

          if (saved > 0) {
              toast.success(`${saved} tender(s) sent to the employee review queue.`);
          }
          if (duplicates > 0) {
              toast.warning(`${duplicates} file(s) skipped — already in drafts or already live.`);
          }
          if (failed > 0) {
              const firstError = (data?.results || []).find(r => r.status === 'failed');
              toast.error(
                  `${failed} file(s) failed${firstError ? `: ${firstError.fileName} — ${firstError.error}` : '.'}`,
                  { duration: 9000 }
              );
          }
          if (saved === 0 && duplicates === 0 && failed === 0) {
              toast.info('No files were processed.');
          }
      } catch (error) {
          console.error('Bulk upload error:', error);
          toast.error('Network error while uploading. Please try again.');
      } finally {
          setAnalyzingFiles(false);
          setBulkFileCount(0);
      }
  };

  const handleBulkAIUpload = async (e) => {
      await processBulkFiles(e.target.files);
      e.target.value = ''; // allow re-selecting the same file after a failure
  };

  const handleBulkDrop = async (e) => {
      e.preventDefault();
      setBulkDragActive(false);
      if (analyzingFiles) return;
      await processBulkFiles(e.dataTransfer?.files);
  };
  const handleDispatchTask = async (e) => {
    e.preventDefault();
    if(!taskForm.target_id || !taskForm.subject || !taskForm.message) return toast.error("Fill all details to dispatch");
    try {
      const res = await fetch('/api/dispatches', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(taskForm) });
      if(res.ok) { toast.success('Dispatch Sent!'); setTaskForm({ target_type: 'client_alert', target_id: '', subject: '', message: '' }); refresh(); } 
      else toast.error('Failed to dispatch');
    } catch (err) { toast.error('Network Error.'); }
  };

  const deleteDispatch = async (id) => {
     if(!confirm("Permanently delete this task?")) return;
     setDispatches(prev => prev.filter(d => d._id !== id));
     await fetch(`/api/dispatches?id=${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
     toast.success("Deleted permanently.");
  };
  const handleCloseQuery = async (queryId, clientEmail) => {
    if(!confirm("Are you sure you want to close this query?")) return;
    try {
      const res = await fetch('/api/queries/close', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryId, email: clientEmail })
      });
      if (res.ok) {
        toast.success(`Query Closed successfully.`);
        refresh();
      }
    } catch (err) { toast.error('Network Error.'); }
  };
  const handleRaiseQuery = async (e) => {
    e.preventDefault();
    if(!queryForm.client_email || !queryForm.subject || !queryForm.message) return toast.error('Please select client and fill query');
    try {
      const res = await fetch('/api/queries/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queryForm)
      });
      if (res.ok) {
        toast.success(`Query Raised! Client's dashboard is now locked until they reply.`);
        setQueryForm({ client_email: '', subject: '', message: '' });
        refresh();
      } else { toast.error('Failed to raise query.'); }
    } catch (err) { toast.error('Network Error while raising query.'); }
  };
  const handleGiveWarning = async (id) => {
    try {
      await fetch('/api/dispatches/update', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ task_id: id, status: 'Warning Issued' })
      });
      toast.success("Warning issued successfully!"); refresh();
    } catch(e) { toast.error("Network error"); }
  };

  const handleForceClose = async (id) => {
    if(!confirm("Are you sure you want to force close this task?")) return;
    try {
      await fetch('/api/dispatches/update', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ task_id: id, status: 'Force Closed (SLA Breach)' })
      });
      toast.success("Task force closed."); refresh();
    } catch(e) { toast.error("Network error"); }
  };
  const handleLedgerSubmit = async (e) => {
    e.preventDefault();
    if(!ledgerForm.amount || !ledgerForm.reason) return toast.error("Amount and Reason are required");
    try {
      const method = editingLedgerId ? 'PUT' : 'POST';
      const payload = { ...ledgerForm, proof_base64: ledgerProof };
      if (editingLedgerId) payload.id = editingLedgerId;

      const res = await fetch('/api/finance/ledger', { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if(res.ok) { 
         toast.success(editingLedgerId ? `Ledger Updated!` : `Ledger Entry saved!`); 
         setLedgerForm({ type: 'CREDIT', amount: '', reason: '', client_id: 'N/A', payment_mode: 'OFFLINE' }); 
         setLedgerProof(''); setLedgerProofName(''); setEditingLedgerId(null); 
         refresh(); 
      } 
      else toast.error("Failed to save entry");
    } catch(err) { toast.error("Network Error"); }
  };

  const handleEditLedger = (txn) => {
      setLedgerForm({ type: txn.type, amount: txn.amount, reason: txn.reason, client_id: txn.client_id, payment_mode: txn.payment_mode });
      setEditingLedgerId(txn._id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast.info("Edit Ledger Entry Active.");
  };

  const handleDeleteLedger = async (id) => {
      if(!confirm("Permanently delete this ledger entry?")) return;
      setLedgerTxns(prev => prev.filter(t => t._id !== id)); 
      await fetch(`/api/finance/ledger?id=${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      toast.success("Entry Deleted"); refresh();
  };

 const handleSendPaymentRequest = async (e) => {
    e.preventDefault();
    if(!paymentRequestForm.client_id || !paymentRequestForm.amount || !paymentRequestForm.reason) return toast.error("Fill all details");
    
    try {
        const res = await fetch('/api/users/request-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ email: paymentRequestForm.client_id, amount: paymentRequestForm.amount, reason: paymentRequestForm.reason })
        });
        
        if (res.ok) {
            const data = await res.json(); // Backend పంపే రెస్పాన్స్ చదవడం
            toast.success(`Online payment link dispatched securely to client!`);
            
            // 🚀 FIX: డిస్పాచ్ చేయగానే Live Tracking లో వెంటనే కనిపించడానికి ఆటోమేటిక్ అప్‌డేట్
            const newReq = {
                id: data.id || Date.now(),
                client_id: paymentRequestForm.client_id,
                amount: paymentRequestForm.amount,
                reason: paymentRequestForm.reason,
                status: 'sent',
                sent_time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
            };
            setFinancialRequests(prev => [newReq, ...prev]);
            
            setPaymentRequestForm({ client_id: '', amount: '', reason: '' });
            refresh(); // ఇది బ్యాలెన్స్ షీట్ మరియు ఇతర డేటాను అప్‌డేట్ చేస్తుంది
        } else {
            toast.error("Failed to dispatch payment link.");
        }
    } catch(err) {
        toast.error("Network error while sending request.");
    }
  };

  const handleOfflinePayment = async (req) => {
      if(!confirm("Mark this payment as collected offline? It will be added to the Balance Sheet.")) return;
      setFinancialRequests(prev => prev.filter(r => r.id !== req.id)); 
      try {
          await fetch('/api/payments/offline', {
              method: 'PUT', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
              body: JSON.stringify({ id: req.db_id || null, amount: req.amount, reason: req.reason, client_id: req.client_id })
          });
          toast.success("Payment Marked Offline & Ledger Updated"); refresh();
      } catch(e) { toast.error("Network Error"); }
  };

  const handleCancelPayment = async (reqId) => {
      if(!confirm("Are you sure you want to cancel this payment link?")) return;
      try {
          const res = await fetch(`/api/payments/requests?id=${reqId}`, { 
              method: 'DELETE', headers: { Authorization: `Bearer ${token}` } 
          });
          if(res.ok) {
              setFinancialRequests(prev => prev.filter(r => r.id !== reqId));
              toast.success("Payment Link Cancelled & Removed");
          } else {
              // 🚀 FIX: show the server's actual error instead of a fixed generic
              // string, so a future failure (DB hiccup, bad id, etc.) is diagnosable
              // straight from the toast instead of a dead end.
              const data = await res.json().catch(() => null);
              toast.error(data?.error || `Failed to cancel payment (${res.status}).`);
          }
      } catch(e) {
          toast.error("Network Error");
      }
  };

  const handleCreateTeamMember = async (e) => {
    e.preventDefault();
    if(!officerForm.name || !officerForm.email || !officerForm.password) return toast.error("Fill all fields");
    try {
      const res = await fetch('/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(officerForm) });
      const data = await res.json();
      if(res.ok) { toast.success(`Created! UID: ${data.emp_id}`); setOfficerForm({ name: '', email: '', password: '', role: 'employee' }); refresh(); } 
      else toast.error('Failed to create member');
    } catch(err) { toast.error('Network Error'); }
  };

  const handleRevokeEmployee = async (id) => {
    if(!confirm("Are you sure you want to permanently delete this employee account?")) return;
    try {
      const res = await fetch(`/api/employees?id=${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if(res.ok) { toast.success("Employee removed successfully"); refresh(); } else toast.error("Failed to remove employee");
    } catch(err) { toast.error("Network error"); }
  };

  // 🚀 FIX (guideline #20): a bare spinner blanks the whole screen and gives no
  // sense of what's about to load. This skeleton mirrors the real header/stat-card/
  // tab layout below, so the dashboard feels instant and never "pops" into place.
  if (!mdDesk) { if (typeof window !== 'undefined') window.location.replace('/'); return null; }
  if (authChecking) return <AdminDashboardSkeleton />;

  const activeTickets = tickets.filter(t => t.status === 'OPEN');
  const resolvedTickets = tickets.filter(t => t.status === 'RESOLVED');
  const livePublished = liveTendersOnly(tenders || []);
  const tenderNeedle = (tenderSearch || '').trim().toLowerCase();
  const filteredTenders = !tenderNeedle
    ? livePublished
    : livePublished.filter((t) =>
        [t.bid_no, t.title, t.department].some((v) => String(v || '').toLowerCase().includes(tenderNeedle))
      );
  // 🚀 Pagination: slice filteredTenders into pages of `tendersPerPage`
  const totalTenderPages = Math.max(1, Math.ceil(filteredTenders.length / tendersPerPage));
  const paginatedTenders = filteredTenders.slice((tenderPage - 1) * tendersPerPage, tenderPage * tendersPerPage);
  const goToTenderPage = (page) => {
    const safePage = Math.min(Math.max(1, page), totalTenderPages);
    setTenderPage(safePage);
    // Smoothly scroll the (internally scrollable) tenders list back to the top
    tendersListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Grouped nav (Enterprise UI/UX Blueprint, section A) — replaces the old single-row
  // flat TabsList (10 tabs wrapping into 2-3 ragged rows) with a left rail on desktop
  // and a Sheet drawer on tablet/mobile. Same `activeTab` values as before, so every
  // <TabsContent value="..."> below is untouched.
  const ADMIN_NAV_GROUPS = [
    { id: 'overview', label: 'Overview', items: [
      { value: 'reports', label: 'Master Reports', icon: BarChart3, color: 'navy' },
    ] },
    { id: 'revenue-clients', label: 'Revenue & Clients', items: [
      { value: 'finance', label: 'Finance Hub', icon: IndianRupee, color: 'emerald' },
      { value: 'clients', label: 'Client CRM', icon: UserCheck, color: 'navy' },
    ] },
    { id: 'ai-operations', label: 'AI & Operations', items: [
      { value: 'matchmaker', label: 'AI Matchmaker', icon: Target, color: 'indigo', badge: matchSummary.new },
      { value: 'master-tenders', label: 'Master Tenders', icon: FileText, color: 'teal' },
      { value: 'copilot-desk', label: 'Co-Pilot Chat Desk', icon: Bot, color: 'violet' },
    ] },
    // 🚀 RBAC: MD-only oversight into per-employee work — Global Suggestions +
    // Master Live Tracking — kept as its own focused group rather than sprawling
    // the "Team & Support" group with two more tabs (see Team Directory below).
    { id: 'team-activity', label: 'Team Activity', items: [
      { value: 'team-activity', label: 'Team Activity', icon: Users, color: 'blue' },
    ] },
    { id: 'workflow', label: 'Tender Workflow', items: [
      { value: 'internal', label: 'Internal Board', icon: ClipboardList, color: 'blue' },
      { value: 'submitted', label: 'Submitted Board', icon: FileText, color: 'emerald' },
      { value: 'archive', label: 'Archive', icon: Archive, color: 'slate' },
    ] },
    { id: 'publishing', label: 'Live Tenders', items: [
      { value: 'publisher', label: 'Live Tenders', icon: FileText, color: 'navy' },
    ] },
    { id: 'team-support', label: 'Team & Support', items: [
      { value: 'team', label: 'Team Directory', icon: UserCog, color: 'blue' },
      { value: 'alerts', label: 'Alerts', icon: BellRing, color: 'navy' },
      { value: 'client-queries', label: 'Client Queries', icon: BellRing, color: 'navy' },
      { value: 'chat', label: 'Staff Chat', icon: MessageSquare, color: 'navy' },
      { value: 'tickets', label: 'Helpdesk', icon: MessageSquare, color: 'navy', badge: activeTickets.length },
    ] },
    { id: 'setup', label: 'Setup', items: [
      { value: 'pricing', label: 'PricingMaster', icon: IndianRupee, color: 'emerald' },
      { value: 'leads', label: 'Third-party leads', icon: Users, color: 'purple' },
      { value: 'settings', label: 'Setup', icon: ShieldCheck, color: 'navy' },
    ] },
  ];

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="navy-gradient text-white border-b border-white/10 sticky top-0 z-40 shadow-lg">
        <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
             <div>
               <h1 className="font-bold text-lg leading-tight tracking-wide">MD Command Center</h1>
               <p className="text-[10px] text-emerald-300 font-mono tracking-widest">ENTERPRISE ADMINISTRATION</p>
             </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <BrandMark size="md" />
            <Button variant="ghost" size="sm" onClick={refresh} className="text-xs sm:text-sm text-sky-300 hover:text-white hover:bg-white/10 transition-all duration-200"><RefreshCw className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">Sync Live</span></Button>
            <Button variant="outline" size="sm" onClick={() => window.open('/', '_blank')} className="text-xs sm:text-sm bg-transparent border-white/20 text-slate-200 hover:text-white hover:bg-white/10 transition-all duration-200">View Public Site</Button>
            <Button variant="ghost" size="sm" onClick={logout} className="text-xs sm:text-sm text-red-300 hover:text-red-200 hover:bg-red-500/15 transition-all duration-200"><LogOut className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">Secure Logout</span></Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 items-start">
        <DashboardNav groups={ADMIN_NAV_GROUPS} activeTab={activeTab} onChange={setActiveTab} title="MD Command Center" />
        <div className="flex-1 w-full min-w-0 space-y-4 sm:space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">

          {/* ==================== 1. MASTER REPORTS ==================== */}
          <TabsContent value="reports" className="space-y-4">
            <MasterReports
              active={activeTab === 'reports'}
              onOpenTab={setActiveTab}
              liveTenders={tenders.length}
              clients={approvedClients.length}
              balance={ledgerBalance}
            />
          </TabsContent>

          {/* ==================== 2. CLIENT CRM & VAULT VERIFICATION ==================== */}
          <TabsContent value="clients" className="mt-4">
            
            <Card className="tender-shadow border-t-4 border-t-orange-500 mb-6">
              <CardHeader className="bg-orange-50/50 border-b pb-4">
                <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><Database className="w-5 h-5 text-orange-600" /> Pending Vault Approvals</CardTitle>
                <CardDescription>Verify KYC and Business documents uploaded by clients before syncing to their permanent drive.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 max-h-[600px] overflow-y-auto">
                 {approvedClients.filter(c => c.vault_docs?.some(d => d.status === 'uploaded')).length === 0 ? (
                    <div className="text-center py-8 text-slate-400">
                       <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-30 text-emerald-500" />
                       <p className="text-sm font-semibold">All client documents have been verified.</p>
                    </div>
                 ) : (
                    <div className="space-y-6">
                       {approvedClients.map(client => {
                          const pendingDocs = client.vault_docs?.filter(d => d.status === 'uploaded') || [];
                          if (pendingDocs.length === 0) return null;
                          
                          return (
                          <div key={client.email} className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
                             <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                                <div>
                                   <h4 className="font-bold text-[#0A2647] text-base">{client.company_name || client.client_name}</h4>
                                   <p className="text-xs font-mono text-slate-500">{client.email}</p>
                                </div>
                                <Badge className="bg-orange-100 text-orange-800 border-0">{pendingDocs.length} Docs Pending</Badge>
                             </div>
                             
                             <div className="grid md:grid-cols-2 gap-4">
                                {pendingDocs.map(doc => {
                                   let formattedName = doc.name;
                                   if (doc.id === 'signed_agreement') formattedName = `${client.company_name || client.client_name} - Legal Agreement`;

                                   return (
                                   <div key={doc.id} className={`p-3 rounded-lg flex flex-col justify-between gap-3 ${doc.id === 'signed_agreement' ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200'}`}>
                                      <div>
                                         <p className="font-bold text-slate-800 text-sm">{formattedName}</p>
                                         <p className="text-xs text-slate-500 font-mono truncate">{doc.file_name}</p>
                                      </div>
                                      
                                      <Button size="sm" variant="outline" className={`w-full ${doc.id === 'signed_agreement' ? 'text-emerald-700 border-emerald-300 hover:bg-emerald-100' : 'text-blue-600 border-blue-200 hover:bg-blue-50'}`} onClick={() => {
                                          if (doc.drive_link) {
                                              window.open(doc.drive_link, '_blank');
                                          } else {
                                              window.open(`/api/vault/document?email=${client.email}&docId=${doc.id}`, '_blank');
                                          }
                                      }}>
                                         <Eye className="w-4 h-4 mr-2"/> View Document
                                      </Button>

                                      <div className="flex flex-col gap-2 border-t border-slate-200 pt-3">
                                         <Input placeholder="Rejection reason (if rejecting)..." className="h-8 text-xs bg-white" value={rejectReason[`${client.email}_${doc.id}`] || ''} onChange={e => setRejectReason({...rejectReason, [`${client.email}_${doc.id}`]: e.target.value})} />
                                         <div className="flex gap-2">
                                            <Button size="sm" onClick={() => openApprovalModal(client, doc)} className="flex-1 bg-[#16a34a] hover:bg-[#15803d] h-8 text-xs"><CheckCircle2 className="w-3.5 h-3.5 mr-1"/> Approve</Button>
                                            <Button size="sm" onClick={() => handleVerifyVaultDoc(client.email, doc.id, 'rejected')} variant="outline" className="flex-1 border-red-200 text-red-600 hover:bg-red-50 h-8 text-xs"><XCircle className="w-3.5 h-3.5 mr-1"/> Reject</Button>
                                         </div>
                                      </div>
                                   </div>
                                )})}
                             </div>
                          </div>
                          );
                       })}
                    </div>
                 )}
              </CardContent>
            </Card>

            <Card className="tender-shadow border-t-4 border-t-blue-600 mt-6 w-full">
              <CardHeader className="bg-blue-50/50 border-b pb-4">
                 <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><Briefcase className="w-5 h-5 text-blue-600" /> Active Clients</CardTitle>
                 <CardDescription>Every client who completed a business profile, paid or not.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 max-h-[600px] overflow-y-auto">
                 {approvedClients.length === 0 ? (
                    <div className="text-center py-8 text-slate-400"><Users className="w-10 h-10 mx-auto mb-2 opacity-30" /><p className="text-sm font-semibold">No clients with a complete profile yet.</p></div>
                 ) : (
                    <div className="grid xl:grid-cols-2 gap-4">
                       {approvedClients.map(client => {
                          const safeId = client?.email ? `CLI-${client.email.substring(0,4).toUpperCase()}X` : 'CLI-XXXX';
                          const wonBidsCount = client.bids ? client.bids.filter(b => b.status === 'Won').length : (client.stats?.won || 0);
                          const totalRevenue = client.payments ? client.payments.filter(p => p.status === 'SUCCESS').reduce((sum, p) => sum + (Number(p.amount) || 0), 0) : (client.stats?.total_paid || 0);

                          return (
                          <div key={client._id} className="border border-slate-200 rounded-xl p-5 bg-white shadow-sm flex flex-col justify-between hover:shadow-md transition">
                             <div>
                                <div className="flex justify-between items-start mb-2">
                                   <div>
                                      <h4 className="font-black text-[#0A2647] text-lg">{client.company_name || client.name || 'Unnamed Client'}</h4>
                                      <p className="text-[10px] text-slate-500 font-mono tracking-widest">{client.client_id || safeId} • {client.email}</p>
                                      {client.phone && (
                                        <div className="mt-1">
                                          <WhatsAppVerifiedBadge
                                            email={client.email}
                                            phone={client.phone}
                                            verified={client.whatsapp_verified === true}
                                            onChanged={(v) => setApprovedClients(prev => prev.map(c => c.email === client.email ? { ...c, whatsapp_verified: v } : c))}
                                          />
                                        </div>
                                      )}
                                   </div>
                                   <Badge className={`border-0 h-fit ${client.billing_paid ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{client.billing_paid ? 'Paid' : 'Unpaid'}</Badge>
                                </div>
                                <div className="grid grid-cols-2 gap-2 my-4 text-xs bg-slate-50 p-3 rounded-lg border border-slate-100 shadow-inner">
                                   <div><span className="text-slate-400 block text-[9px] uppercase font-bold">Approved Date</span><span className="font-semibold text-slate-700">{client.approved_at ? new Date(client.approved_at).toLocaleDateString() : '--'}</span></div>
                                   <div><span className="text-slate-400 block text-[9px] uppercase font-bold">Total Bids Won</span><span className="font-black text-emerald-600 text-sm">{wonBidsCount}</span></div>
                                   <div className="col-span-2 border-t border-slate-200 pt-2 mt-1 flex justify-between items-center"><span className="text-slate-500 uppercase font-bold text-[10px]">Total Revenue</span><span className="font-black text-emerald-700 text-lg">₹{totalRevenue.toLocaleString()}</span></div>
                                </div>
                             </div>
                             
                             <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-4 border-t border-slate-100">
                                {client.drive_folder_link || client.drive_link ? (
                                   <Button size="sm" onClick={() => window.open(client.drive_folder_link || client.drive_link, '_blank')} variant="outline" className="flex-1 text-blue-600 border-blue-200 hover:bg-blue-50 h-9">
                                      <Database className="w-4 h-4 mr-2" /> Open Drive
                                   </Button>
                                ) : (
                                   <Button size="sm" onClick={() => handleSyncDrive(client.email, client.company_name || client.name)} variant="outline" className="flex-1 text-amber-600 border-amber-200 hover:bg-amber-50 h-9">
                                      <Database className="w-4 h-4 mr-2" /> Sync Drive Space
                                   </Button>
                                )}
                                <Button size="sm" onClick={() => setStationeryClient(client)} variant="outline" className="flex-1 text-indigo-700 border-indigo-200 hover:bg-indigo-50 h-9">
                                   <PenTool className="w-4 h-4 mr-2" /> Upload Stationery
                                </Button>
                                <Button size="sm" onClick={() => impersonateUser('client', client.email)} className="flex-1 bg-[#0A2647] hover:bg-[#144272] h-9 shadow-sm">
                                   <LogIn className="w-4 h-4 mr-2" /> Login as Client
                                </Button>
                                <Button size="sm" onClick={() => deleteClientPermanently(client.email)} variant="outline" className="flex-none px-3 text-red-600 border-red-200 hover:bg-red-50 h-9 shadow-sm" title="Delete Permanently">
                                   <Trash2 className="w-4 h-4" />
                                </Button>
                             </div>
                          </div>
                       )})}
                    </div>
                 )}
              </CardContent>
            </Card>
          </TabsContent>
{/* ==================== 3. FINANCE HUB ==================== */}
<TabsContent value="finance" className="mt-4">
  <div className="grid lg:grid-cols-2 gap-6 mb-6">
    
    {/* --- 1. OFFLINE LEDGER ENTRY --- */}
    <Card className="shadow-sm border-t-4 border-t-blue-600 h-fit">
      <CardHeader className="bg-blue-50/50 border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-blue-900 text-lg">
          <Wallet className="w-5 h-5 text-blue-600" /> {editingLedgerId ? 'Update Ledger Entry' : 'Offline Ledger Entry'}
        </CardTitle>
        <CardDescription>Record manual transactions (Cash/PhonePe/Bank Transfer).</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <form onSubmit={handleLedgerSubmit} className="space-y-4">
          <div className="flex gap-4 p-1 bg-slate-100 rounded-lg">
            <label className={`flex-1 flex items-center justify-center gap-2 cursor-pointer p-2.5 rounded-md transition ${ledgerForm.type === 'CREDIT' ? 'bg-white shadow-sm border border-slate-200 text-emerald-700' : 'text-slate-500 hover:bg-slate-200'}`}>
              <input type="radio" name="ledgerType" value="CREDIT" checked={ledgerForm.type === 'CREDIT'} onChange={e => setLedgerForm({...ledgerForm, type: e.target.value})} className="hidden" />
              <ArrowDownRight className="w-4 h-4"/> <span className="text-sm font-bold">Credit (Income)</span>
            </label>
            <label className={`flex-1 flex items-center justify-center gap-2 cursor-pointer p-2.5 rounded-md transition ${ledgerForm.type === 'DEBIT' ? 'bg-white shadow-sm border border-slate-200 text-red-600' : 'text-slate-500 hover:bg-slate-200'}`}>
              <input type="radio" name="ledgerType" value="DEBIT" checked={ledgerForm.type === 'DEBIT'} onChange={e => setLedgerForm({...ledgerForm, type: e.target.value})} className="hidden" />
              <ArrowUpRight className="w-4 h-4"/> <span className="text-sm font-bold">Debit (Expense)</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <Label className="font-bold text-slate-700">Amount (₹) *</Label>
              <Input type="number" placeholder="5000" value={ledgerForm.amount} onChange={e => setLedgerForm({...ledgerForm, amount: e.target.value})} required className="mt-1 font-bold text-lg text-[#0A2647]" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label className="font-bold text-slate-700">Client / Ref (Optional)</Label>
              <Select value={ledgerForm.client_id} onValueChange={v => setLedgerForm({...ledgerForm, client_id: v})}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select Client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="N/A">General / Office Expense</SelectItem>
                  {approvedClients.map(c => <SelectItem key={c.email} value={c.email}>{c.company_name} ({c.email})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="font-bold text-slate-700">Reason / Description *</Label>
            <Input placeholder="e.g. Received Cash for DSC, Paid Internet Bill..." value={ledgerForm.reason} onChange={e => setLedgerForm({...ledgerForm, reason: e.target.value})} required className="mt-1" />
          </div>
          <div>
            <Label className="font-bold text-slate-700">Attach Proof (Receipt / Screenshot)</Label>
            <div className="mt-1 border-2 border-dashed rounded-md p-3 text-center bg-slate-50 hover:bg-slate-100 cursor-pointer">
              <input type="file" accept="image/*,application/pdf" onChange={onLedgerProofChange} className="hidden" id="proof-input" />
              <label htmlFor="proof-input" className="cursor-pointer flex flex-col items-center">
                <FileUp className="w-5 h-5 text-slate-400 mb-1" />
                <span className="text-xs font-medium text-[#0A2647]">{ledgerProofName || 'Upload Image/PDF'}</span>
              </label>
            </div>
          </div>
          <Button type="submit" className={`w-full h-11 text-base shadow-md ${ledgerForm.type === 'CREDIT' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>
            {editingLedgerId ? 'Update Entry' : (ledgerForm.type === 'CREDIT' ? '+ Add Income to Ledger' : '- Record Expense')}
          </Button>
          {editingLedgerId && <Button type="button" variant="outline" className="w-full mt-2" onClick={() => { setEditingLedgerId(null); setLedgerForm({ type: 'CREDIT', amount: '', reason: '', client_id: 'N/A', payment_mode: 'OFFLINE' }); }}>Cancel Edit</Button>}
        </form>
      </CardContent>
    </Card>

    {/* --- 2. BALANCE SHEET BOOK (With Running Balance) --- */}
    <Card className="shadow-sm border-t-4 border-t-slate-800">
      <CardHeader className="bg-slate-50 border-b pb-4 flex flex-row items-center justify-between">
        <CardTitle className="text-[#0A2647] text-lg">Balance Sheet Book</CardTitle>
        <div className="text-right">
          <p className="text-[10px] text-slate-500 uppercase font-bold">Net Balance</p>
          <h3 className={`text-2xl font-black ${ledgerBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>₹{ledgerBalance.toLocaleString()}</h3>
          <p className="text-[9px] text-slate-400 font-mono mt-1">Offline: ₹{breakdown.offline.toLocaleString()} | Online: ₹{breakdown.online.toLocaleString()}</p>
        </div>
      </CardHeader>
      <CardContent className="pt-4 max-h-[450px] overflow-y-auto pr-2">
        {ledgerTxns.length === 0 ? (
          <div className="text-center py-12 text-slate-400"><Database className="w-10 h-10 mx-auto mb-2 opacity-30"/><p className="text-sm">No ledger entries found.</p></div>
        ) : (
          <table className="premium-table text-sm text-left">
            <thead>
              <tr><th>Date</th><th>Desc & Ref</th><th className="text-right">Amount</th><th className="w-10"></th></tr>
            </thead>
            <tbody>
              {ledgerTxns.map((txn) => (
                <tr key={txn._id} className="group">
                  <td className="text-xs text-slate-500 whitespace-nowrap align-top">{new Date(txn.created_at).toLocaleDateString()}</td>
                  <td className="align-top">
                    <p className="font-semibold text-slate-800 text-xs">
                      {txn.reason}
                      {txn.source === 'cashfree' && (
                        <Badge className="ml-2 bg-sky-100 text-sky-800 border border-sky-200 text-[8px] px-1 py-0 align-middle">Cashfree</Badge>
                      )}
                    </p>
                    {txn.client_id !== 'N/A' && <p className="text-[9px] text-slate-400 font-mono">{txn.client_id}</p>}
                    
                    <p className="text-[10px] font-bold text-slate-500 mt-1">
                      Balance: <span className={txn.running_balance >= 0 ? 'text-emerald-600' : 'text-red-500'}>₹{txn.running_balance?.toLocaleString() || '---'}</span>
                    </p>

                    {txn.proof_base64 && <Badge variant="outline" className="text-[8px] px-1 mt-1 bg-blue-50 cursor-pointer hover:bg-blue-100" onClick={() => {
                        let finalUrl = txn.proof_base64;
                        if (!finalUrl.startsWith('http') && !finalUrl.startsWith('data:') && !finalUrl.startsWith('/')) {
                            finalUrl = `data:image/jpeg;base64,${finalUrl}`;
                        }
                        if (finalUrl.startsWith('data:')) {
                            const newTab = window.open();
                            if (newTab) newTab.document.write(`<iframe src="${finalUrl}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
                        } else {
                            window.open(finalUrl, '_blank');
                        }
                    }}>View Proof</Badge>}
                  </td>
                  <td className={`text-right font-bold text-sm align-top ${txn.type === 'CREDIT' ? 'text-emerald-600' : 'text-red-500'}`}>
                    {txn.type === 'CREDIT' ? '+' : '-'}₹{txn.amount.toLocaleString()}
                  </td>
                  <td className="align-top text-right opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    {/* Cashfree rows are projected from the payments collection, not
                        ledger documents — there is nothing to edit or delete. */}
                    {!txn.readonly && (
                      <>
                        <button onClick={() => handleEditLedger(txn)} className="text-blue-500 hover:text-blue-700 mr-2"><Pencil className="w-3.5 h-3.5"/></button>
                        <button onClick={() => handleDeleteLedger(txn._id)} className="text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5"/></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  </div>

  <div className="grid lg:grid-cols-2 gap-6">
    
    {/* --- 3. DISPATCH PAYMENT LINK (Push to Client Dashboard) --- */}
    <Card className="shadow-sm border-t-4 border-t-emerald-500 h-fit">
      <CardHeader className="bg-emerald-50/50 border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-emerald-900 text-lg"><IndianRupee className="w-5 h-5 text-emerald-600" /> Request Payment (Cashfree)</CardTitle>
        <CardDescription>Push a payment request directly to the client's dashboard.</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <form onSubmit={handleSendPaymentRequest} className="space-y-4">
          <div>
            <Label className="font-bold text-slate-700">Select Client *</Label>
            <Select value={paymentRequestForm.client_id} onValueChange={v => setPaymentRequestForm({...paymentRequestForm, client_id: v})}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Choose client..." /></SelectTrigger>
              <SelectContent>
                {approvedClients.map(c => <SelectItem key={c.email} value={c.email}>{c.company_name} ({c.email})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <Label className="font-bold text-slate-700">Amount (₹) *</Label>
              <Input type="number" placeholder="5000" value={paymentRequestForm.amount} onChange={e => setPaymentRequestForm({...paymentRequestForm, amount: e.target.value})} required className="mt-1 font-bold text-lg text-[#0A2647] bg-white border-slate-300" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              {/* మీ రిక్వెస్ట్ ప్రకారం ఇక్కడ డ్రాప్ డౌన్ తీసేసి మాన్యువల్ ఇన్‌పుట్ పెట్టాను */}
              <Label className="font-bold text-slate-700">Reason / Purpose *</Label>
              <Input placeholder="Enter purpose of payment..." value={paymentRequestForm.reason} onChange={e => setPaymentRequestForm({...paymentRequestForm, reason: e.target.value})} required className="mt-1 bg-white border-slate-300" />
            </div>
          </div>
          <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 h-11 text-base shadow-md">
            <Send className="w-4 h-4 mr-2" /> Push to Client App
          </Button>
        </form>
      </CardContent>
    </Card>

    <div className="flex flex-col gap-6">
      
      {/* --- 4. LIVE TRACKING (Only shows Pending/Opened) --- */}
      <Card className="shadow-sm h-fit">
        <CardHeader className="bg-slate-50 border-b pb-4">
          <CardTitle className="text-[#0A2647] text-lg">Live Payment Tracking (Pending)</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 max-h-[400px] overflow-y-auto">
          {financialRequests.filter(req => req.status !== 'paid').length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <IndianRupee className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-semibold">No pending payment requests.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {financialRequests.filter(req => req.status !== 'paid').map(req => (
                <div key={req.id} className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm hover:border-blue-300 transition">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="font-bold text-[#0A2647] text-base">₹{req.amount} <span className="text-xs font-normal text-slate-500 ml-1">({req.reason})</span></h4>
                    <Badge className="bg-slate-100 text-slate-600 font-mono text-[10px] hover:bg-slate-200">{req.client_id}</Badge>
                  </div>
                  <div className="relative pt-2 pb-1 mx-2">
                    <div className="absolute top-4 left-0 right-0 h-1.5 bg-slate-100 rounded-full z-0"></div>
                    <div className={`absolute top-4 left-0 h-1.5 rounded-full z-0 transition-all duration-1000 ${req.status === 'opened' ? 'w-[50%] bg-blue-500' : 'w-0'}`}></div>
                    <div className="relative z-10 flex justify-between px-1">
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center shadow ring-4 ring-white"><CheckCircle2 className="w-3.5 h-3.5"/></div>
                        <span className="text-[10px] font-bold text-slate-600 uppercase">Sent</span><span className="text-[9px] text-slate-400 font-mono">{req.sent_time || '--:--'}</span>
                      </div>
                      <div className="flex flex-col items-center gap-1.5">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center shadow ring-4 ring-white transition ${req.status === 'opened' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-300'}`}>
                          {req.status === 'opened' ? <CheckCircle2 className="w-3.5 h-3.5"/> : <Clock className="w-3 h-3"/>}
                        </div>
                        <span className={`text-[10px] font-bold uppercase ${req.status === 'opened' ? 'text-slate-600' : 'text-slate-400'}`}>Opened</span><span className="text-[9px] text-slate-400 font-mono">{req.open_time || '--:--'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
                    <Button size="sm" onClick={() => handleCancelPayment(req.id)} variant="outline" className="w-full text-red-600 border-red-200 hover:bg-red-50 h-8 text-xs shadow-sm"><X className="w-3 h-3 mr-1"/> Cancel Request</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- 5. SUCCESSFUL PAYMENTS (Online Only) --- */}
      <Card className="shadow-sm border-t-4 border-t-emerald-500">
        <CardHeader className="bg-emerald-50/50 border-b pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-emerald-900 text-base flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> Successful Online Payments</CardTitle>
          <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold shadow-sm">Total: ₹{successfulPaymentsLog.reduce((sum, p) => sum + (Number(p.amount) || 0), 0).toLocaleString()}</Badge>
        </CardHeader>
        <CardContent className="pt-4 max-h-[300px] overflow-y-auto">
          {successfulPaymentsLog.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No successful online payments yet.</p>
          ) : (
            <div className="space-y-3">
              {successfulPaymentsLog.map((pay, i) => (
                <div key={i} className="bg-slate-50 border border-emerald-100 p-3 rounded-lg shadow-sm flex flex-col gap-2 border-l-4 border-l-emerald-500">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-[#0A2647]">{pay.client_name} <span className="text-slate-400 font-normal">({pay.email})</span></span>
                    <span className="font-black text-emerald-600">₹{pay.amount}</span>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
                    <span>{pay.reason || 'Service Fee'} (Cashfree)</span>
                    <span>{new Date(pay.paid_at || pay.created_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  </div>
</TabsContent>
          <TabsContent value="team" className="mt-4">
            <TeamDirectoryPanel actorDesk="md" team={teamMembers} onRefresh={() => refresh('team')} impersonate={openStaffDesk} />
          </TabsContent>

          <TabsContent value="internal" className="mt-4 space-y-6">
            <CreatePublishTaskForm
              actorDesk="md"
              tls={teamMembers.filter((t) => staffRoleOf(t) === DESIGNATIONS.DOC_TEAM_TL)}
              members={teamMembers.filter((t) => staffRoleOf(t) === DESIGNATIONS.DOC_TEAM_MEMBER)}
              onCreated={patchJob}
            />
            <InternalTrackingBoard
              desk="md"
              jobs={wfInternal}
              tls={teamMembers.filter((t) => staffRoleOf(t) === DESIGNATIONS.DOC_TEAM_TL)}
              members={teamMembers.filter((t) => staffRoleOf(t) === DESIGNATIONS.DOC_TEAM_MEMBER)}
              team={teamMembers}
              onPatchJob={patchJob}
              onRemoveJob={removeJob}
              actorEmpId=""
            />
          </TabsContent>
          <TabsContent value="submitted" className="mt-4 space-y-6">
            <SubmittedTrackingBoard jobs={wfSubmitted} onPatchJob={patchJob} onRemoveJob={removeJob} onArchiveJob={archiveJob} canDelete />
            <WinningBidsBoard jobs={wfWinning} showClientName />
          </TabsContent>
          <TabsContent value="archive" className="mt-4">
            <ArchiveBoard jobs={wfArchive} canDelete onRemoveJob={removeJob} />
          </TabsContent>
          <TabsContent value="alerts" className="mt-4"><OpsAlerts roster={teamMembers} /></TabsContent>
          <TabsContent value="client-queries" className="mt-4">
            <div className="grid lg:grid-cols-2 gap-6">
              <Card className="shadow-sm border-t-4 border-t-red-500">
                <CardHeader className="bg-red-50/50 pb-4 border-b">
                  <CardTitle className="text-red-900 flex items-center gap-2"><BellRing className="w-5 h-5 text-red-600"/> Push Action Request</CardTitle>
                  <CardDescription>Send a direct red-alert banner to the client's portal screen.</CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    if (!taskForm.target_id || !taskForm.subject || !taskForm.message) return toast.error("Fill all details to dispatch");
                    try {
                      const res = await fetch('/api/dispatches', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...taskForm, target_type: 'client_alert' }) });
                      if (res.ok) { toast.success('Dispatch Sent!'); setTaskForm({ target_type: 'client_alert', target_id: '', subject: '', message: '' }); refresh(); }
                      else toast.error('Failed to dispatch');
                    } catch (err) { toast.error('Network Error.'); }
                  }} className="space-y-4">
                    <div>
                      <Label className="text-slate-600 text-xs font-bold">Select Client ID *</Label>
                      <Select required value={taskForm.target_id} onValueChange={(v) => setTaskForm({ ...taskForm, target_type: 'client_alert', target_id: v })}>
                         <SelectTrigger className="mt-1 bg-white h-9"><SelectValue placeholder="Choose Client" /></SelectTrigger>
                         <SelectContent>
                            {approvedClients.map(c => <SelectItem key={c.email} value={c.email}>{c.client_id} ({c.company_name || c.name})</SelectItem>)}
                         </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-slate-600 text-xs font-bold">Subject *</Label>
                      <Input required value={taskForm.subject} onChange={(e) => setTaskForm({ ...taskForm, subject: e.target.value })} className="mt-1 bg-white h-9" />
                    </div>
                    <div>
                      <Label className="text-slate-600 text-xs font-bold">Requirement / Message *</Label>
                      <textarea required className="w-full border rounded-md p-2 mt-1 h-24 text-sm bg-white" value={taskForm.message} onChange={(e) => setTaskForm({ ...taskForm, message: e.target.value })} />
                    </div>
                    <Button type="submit" className="w-full bg-red-600 hover:bg-red-700 h-10 shadow-md">
                      <Send className="w-4 h-4 mr-2"/> Push Alert
                    </Button>
                  </form>
                  <div className="mt-8">
                     <h4 className="font-bold text-slate-700 text-sm mb-3">Pending Action Alerts</h4>
                     {dispatches.filter(t => t.target_type === 'client_alert' && t.status !== 'Completed').length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-4 bg-slate-50 rounded border border-dashed">No active alerts pushed to clients.</p>
                     ) : (
                        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                           {dispatches.filter(t => t.target_type === 'client_alert' && t.status !== 'Completed').map(alert => (
                              <div key={alert._id} className="bg-red-50 border border-red-100 p-3 rounded-lg">
                                 <span className="text-[9px] text-red-400 font-bold mb-1">To: {alert.target_id}</span>
                                 <p className="text-xs text-red-900 mb-2">"{alert.message}"</p>
                              </div>
                           ))}
                        </div>
                     )}
                  </div>
                </CardContent>
              </Card>
              <Card className="shadow-sm border-t-4 border-t-orange-500">
                <CardHeader className="bg-orange-50/50 pb-4 border-b">
                  <CardTitle className="text-orange-900 flex items-center gap-2"><Lock className="w-5 h-5 text-orange-600"/> Raise Document Query</CardTitle>
                  <CardDescription>Missing documents? This will lock the client's screen until they reply.</CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  <form onSubmit={handleRaiseQuery} className="space-y-4">
                    <div>
                      <Label className="text-slate-600 text-xs font-bold">Select Client *</Label>
                      <Select required value={queryForm.client_email} onValueChange={(v) => setQueryForm({ ...queryForm, client_email: v })}>
                         <SelectTrigger className="mt-1 bg-white h-9"><SelectValue placeholder="Choose Client" /></SelectTrigger>
                         <SelectContent>
                            {approvedClients.map(c => <SelectItem key={c.email} value={c.email}>{c.client_id} ({c.company_name || c.name})</SelectItem>)}
                         </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-slate-600 text-xs font-bold">Query Subject *</Label>
                      <Input required placeholder="e.g., PAN Card Missing" value={queryForm.subject} onChange={(e) => setQueryForm({ ...queryForm, subject: e.target.value })} className="mt-1 bg-white h-9 text-sm"/>
                    </div>
                    <div>
                      <Label className="text-slate-600 text-xs font-bold">Detailed Description *</Label>
                      <textarea required className="w-full border rounded-md p-2 mt-1 h-[68px] text-sm bg-white" value={queryForm.message} onChange={(e) => setQueryForm({ ...queryForm, message: e.target.value })} />
                    </div>
                    <Button type="submit" className="w-full bg-orange-600 hover:bg-orange-700 h-10 shadow-md">
                      <Lock className="w-4 h-4 mr-2"/> Lock Client & Send Query
                    </Button>
                  </form>
                  <div className="mt-8">
                     <h4 className="font-bold text-slate-700 text-sm mb-3">Active Client Queries</h4>
                     <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                        {approvedClients.filter(c => c.officer_queries && c.officer_queries.some(q => !q.is_closed)).length === 0 ? (
                           <p className="text-xs text-slate-400 text-center py-4 bg-slate-50 rounded border border-dashed">No active queries pending.</p>
                        ) : (
                           approvedClients.filter(c => c.officer_queries && c.officer_queries.some(q => !q.is_closed)).map(client => (
                              client.officer_queries.filter(q => !q.is_closed).map((q, idx) => (
                                 <div key={`${client.email}-${idx}`} className="bg-orange-50 border border-orange-200 p-3 rounded-lg">
                                    <span className="text-[9px] text-orange-500 font-bold">To: {client.company_name || client.email}</span>
                                    <p className="text-xs font-bold text-orange-900 mb-1">{q.subject}</p>
                                    <p className="text-xs text-orange-800 mb-2">"{q.message}"</p>
                                    <Button size="sm" onClick={() => handleCloseQuery(q.id, client.email)} className="h-7 text-[10px] bg-[#16a34a] hover:bg-[#15803d]">
                                      <CheckCircle2 className="w-3 h-3 mr-1"/> {q.reply_submitted ? 'Verify & Close' : 'Force Close Query'}
                                    </Button>
                                 </div>
                              ))
                           ))
                        )}
                     </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          <TabsContent value="chat" className="mt-4 w-full overflow-hidden"><StaffChat selfId="MD" roster={teamMembers} /></TabsContent>

          {/* ==================== 4b. TEAM ACTIVITY (MD-ONLY GLOBAL ATTRIBUTION) ====================
              Net-new, additive module: every officer's client_alert suggestions and every
              live (non-Won/Lost) bid, across the whole team, each row attributed to the
              employee who owns it. Employee dashboards never see this — GET /api/dispatches
              and GET /api/bids strictly isolate each officer to their own employee_id there. */}
          <TabsContent value="team-activity" className="mt-4">
            <div className="space-y-6">
              <Card className="shadow-sm border-t-4 border-t-blue-600">
                <CardHeader className="bg-blue-50/50 border-b pb-4 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-[#0A2647] text-lg flex items-center gap-2"><Send className="w-5 h-5 text-blue-600"/> Global Suggestions</CardTitle>
                    <CardDescription>Waiting for client approval only — parked LIVE tenders and AWAITING_CLIENT. Approved jobs leave this table at MD_CHECKLIST.</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => fetchTeamActivity()} disabled={teamActivityLoading}>
                    <RefreshCw className={`w-4 h-4 ${teamActivityLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </CardHeader>
                <CardContent className="pt-4 max-h-[450px] overflow-y-auto pr-2">
                  {teamActivityLoading ? (
                    <div className="text-center py-12 text-slate-400"><Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin"/><p className="text-sm">Loading team suggestions...</p></div>
                  ) : suggestionBoardJobs.length === 0 ? (
                    <div className="text-center py-12 text-slate-400"><Send className="w-10 h-10 mx-auto mb-2 opacity-30"/><p className="text-sm">No tenders waiting for client approval.</p></div>
                  ) : (
                    <table className="premium-table text-sm text-left">
                      <thead>
                        <tr><th>Client</th><th>Bid</th><th>Status</th><th>Last date</th><th>Current handler</th><th>Date</th></tr>
                      </thead>
                      <tbody>
                        {suggestionBoardJobs.map((job) => {
                          const deadline = jobDeadline(job);
                          return (
                          <tr key={job._id || job.id} className={deadline?.urgent ? 'bg-red-50' : undefined}>
                            <td className="align-top">
                              <p className="font-semibold text-slate-800 text-xs">{job.parked_client_name || job.client_name || job.parked_client_email || job.client_email || '—'}</p>
                              <p className="text-[9px] text-slate-400 font-mono">{job.parked_client_email || job.client_email || ''}</p>
                            </td>
                            <td className="align-top">
                              <p className="font-semibold text-xs">{job.bid_no || 'PENDING'}</p>
                              <p className="text-[10px] text-slate-500 line-clamp-1">{job.title}</p>
                            </td>
                            <td className="align-top">
                              <Badge className="text-[10px] border bg-amber-100 text-amber-800 border-amber-200">
                                {job.status === 'AWAITING_CLIENT' ? 'AWAITING_CLIENT' : 'LIVE (parked)'}
                              </Badge>
                            </td>
                            <td className={`align-top text-xs whitespace-nowrap ${deadline?.urgent ? 'font-bold text-red-600' : 'text-slate-600'}`}>{deadline?.text || '—'}</td>
                            <td className="align-top text-xs font-semibold text-slate-700 whitespace-nowrap">{currentHandler(job)}</td>
                            <td className="align-top text-[10px] text-slate-500 whitespace-nowrap">{job.updated_at || job.created_at ? new Date(job.updated_at || job.created_at).toLocaleDateString() : '—'}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm border-t-4 border-t-purple-600">
                <CardHeader className="bg-purple-50/50 border-b pb-4">
                  <CardTitle className="text-[#0A2647] text-lg flex items-center gap-2"><Briefcase className="w-5 h-5 text-purple-600"/> Master Live Tracking</CardTitle>
                    <CardDescription>Internal operations only — MD_CHECKLIST through AWAITING_RECEIPT. SUBMITTED moves to Submitted Tracking; WON stays there; Lost goes to Archive.</CardDescription>
                </CardHeader>
                <CardContent className="pt-4 max-h-[450px] overflow-y-auto pr-2">
                  {teamActivityLoading ? (
                    <div className="text-center py-12 text-slate-400"><Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin"/><p className="text-sm">Loading live tracking...</p></div>
                  ) : masterLiveJobs.length === 0 ? (
                    <div className="text-center py-12 text-slate-400"><Briefcase className="w-10 h-10 mx-auto mb-2 opacity-30"/><p className="text-sm">No jobs in the internal pipeline.</p></div>
                  ) : (
                    <table className="premium-table text-sm text-left">
                      <thead>
                        <tr><th>Client</th><th>Bid</th><th>Status</th><th>Last date</th><th>Current handler</th><th>SOW</th><th></th></tr>
                      </thead>
                      <tbody>
                        {masterLiveJobs.map((job) => {
                          const deadline = jobDeadline(job);
                          return (
                          <tr key={job._id || job.id} className={deadline?.urgent ? 'bg-red-50' : undefined}>
                            <td className="align-top text-xs font-semibold">{job.client_name || job.client_email || '—'}</td>
                            <td className="align-top">
                              <p className="font-semibold text-xs">{job.bid_no || 'PENDING'}</p>
                              <p className="text-[10px] text-slate-500 line-clamp-1">{job.title}</p>
                            </td>
                            <td className="align-top"><Badge variant="outline" className="text-[10px]">{job.status}</Badge></td>
                            <td className={`align-top text-xs whitespace-nowrap ${deadline?.urgent ? 'font-bold text-red-600' : 'text-slate-600'}`}>{deadline?.text || '—'}</td>
                            <td className="align-top text-xs">{currentHandler(job)}</td>
                            <td className="align-top">
                              {job.sow ? (
                                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => openWorkflowFile(job._id, 'sow')}>View SOW</Button>
                              ) : '—'}
                            </td>
                            <td className="align-top">
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 text-[10px]"
                                onClick={async () => {
                                  const name = job.bid_no || job.title || 'this card';
                                  if (!window.confirm(`Delete ${name}? It is removed from every board. This cannot be undone.`)) return;
                                  try {
                                    await workflowFetch(`/api/workflow/jobs/${job._id}`, { method: 'DELETE' });
                                    toast.success('Card deleted.');
                                    removeJob(job._id);
                                  } catch (err) {
                                    toast.error(err.message || 'Delete failed.');
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ==================== 5. OPERATIONS (WITH SLA TRACKER) ==================== */}
          <TabsContent value="operations" className="mt-4">
            <div className="grid lg:grid-cols-2 gap-6">
               <div className="flex flex-col gap-6">
                  <Card className="tender-shadow border-t-4 border-t-purple-600">
                     <CardHeader className="bg-purple-50/30 border-b pb-4">
                        <CardTitle className="flex items-center gap-2 text-purple-900 text-lg"><Send className="w-5 h-5 text-purple-600" /> MD Operations Dispatch</CardTitle>
                        <CardDescription>Push alerts directly to a Client's screen or assign tasks to Employees.</CardDescription>
                     </CardHeader>
                     <CardContent className="pt-6">
                        <form onSubmit={handleDispatchTask} className="space-y-5">
                           <div className="flex gap-4 p-1 bg-slate-100 rounded-lg">
                              <label className={`flex-1 flex items-center justify-center gap-2 cursor-pointer p-2.5 rounded-md transition ${taskForm.target_type === 'client_alert' ? 'bg-white shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-slate-200'}`}>
                                 <input type="radio" name="target" value="client_alert" checked={taskForm.target_type === 'client_alert'} onChange={e => setTaskForm({...taskForm, target_type: e.target.value, target_id: ''})} className="hidden" />
                                 <span className={`w-2 h-2 rounded-full ${taskForm.target_type === 'client_alert' ? 'bg-red-500' : 'bg-slate-300'}`}></span>
                                 <span className="text-sm font-bold">Client Alert</span>
                              </label>
                              <label className={`flex-1 flex items-center justify-center gap-2 cursor-pointer p-2.5 rounded-md transition ${taskForm.target_type === 'employee_task' ? 'bg-white shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-slate-200'}`}>
                                 <input type="radio" name="target" value="employee_task" checked={taskForm.target_type === 'employee_task'} onChange={e => setTaskForm({...taskForm, target_type: e.target.value, target_id: ''})} className="hidden" />
                                 <span className={`w-2 h-2 rounded-full ${taskForm.target_type === 'employee_task' ? 'bg-blue-500' : 'bg-slate-300'}`}></span>
                                 <span className="text-sm font-bold">Employee Task</span>
                              </label>
                           </div>
                           <div>
                              <Label className="text-slate-600 font-bold">{taskForm.target_type === 'client_alert' ? 'Select Target Client *' : 'Select Target Employee *'}</Label>
                              {taskForm.target_type === 'client_alert' ? (
                                 <Select value={taskForm.target_id} onValueChange={v => setTaskForm({...taskForm, target_id: v})}>
                                    <SelectTrigger className="mt-1 bg-white border-slate-300"><SelectValue placeholder="Choose Client..." /></SelectTrigger>
                                    <SelectContent>
                                       {approvedClients.map(c => <SelectItem key={c.email} value={c.email}>{c.company_name} ({c.email})</SelectItem>)}
                                    </SelectContent>
                                 </Select>
                              ) : (
                                 <Select value={taskForm.target_id} onValueChange={v => setTaskForm({...taskForm, target_id: v})}>
                                    <SelectTrigger className="mt-1 bg-white border-slate-300"><SelectValue placeholder="Choose Employee..." /></SelectTrigger>
                                    <SelectContent>
                                       {teamMembers.map(emp => <SelectItem key={emp.emp_id} value={emp.emp_id}>{emp.name} ({emp.emp_id})</SelectItem>)}
                                    </SelectContent>
                                 </Select>
                              )}
                           </div>
                           <div><Label className="text-slate-600 font-bold">Subject / Title *</Label><Input placeholder="e.g. Upload GST Certificate" value={taskForm.subject} onChange={e => setTaskForm({...taskForm, subject: e.target.value})} required className="mt-1" /></div>
                           <div><Label className="text-slate-600 font-bold">Detailed Instructions *</Label><Textarea rows={4} placeholder="Describe exactly what needs to be done..." value={taskForm.message} onChange={e => setTaskForm({...taskForm, message: e.target.value})} required className="mt-1" /></div>
                           <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 shadow-md h-12 text-base"><ClipboardList className="w-5 h-5 mr-2" /> Dispatch Now</Button>
                        </form>
                     </CardContent>
                  </Card>

                  <Card className="tender-shadow border-t-4 border-t-red-500">
                     <CardHeader className="bg-red-50/30 border-b pb-4">
                        <CardTitle className="flex items-center gap-2 text-red-900 text-lg"><Clock className="w-5 h-5 text-red-600"/> Dispatch SLA Tracker</CardTitle>
                        <CardDescription>Monitor task deadlines (24h warning, 48h force close).</CardDescription>
                     </CardHeader>
                     <CardContent className="pt-4 max-h-[400px] overflow-y-auto">
                        {dispatches.filter(d => d.status !== 'Completed' && d.status !== 'Force Closed (SLA Breach)').length === 0 ? (
                           <p className="text-center text-sm text-slate-400 py-6">No active dispatches pending.</p>
                        ) : (
                           <div className="space-y-4">
                               {dispatches.filter(d => d.status !== 'Completed' && d.status !== 'Force Closed (SLA Breach)').map(task => {
                                   const hoursElapsed = (Date.now() - new Date(task.created_at).getTime()) / (1000 * 60 * 60);
                                   let statusColor = "bg-blue-100 text-blue-800";
                                   let barColor = "bg-blue-500";
                                   let progress = "w-[30%]";
                                   
                                   if(task.status === 'Warning Issued' || (hoursElapsed > 24 && hoursElapsed <= 48)) {
                                       statusColor = "bg-amber-100 text-amber-800"; barColor = "bg-amber-500"; progress = "w-[70%]";
                                   } else if (hoursElapsed > 48) {
                                       statusColor = "bg-red-100 text-red-800"; barColor = "bg-red-500"; progress = "w-[100%]";
                                   }

                                   return (
                                       <div key={task._id} className="border border-slate-200 p-3 rounded-lg bg-white shadow-sm">
                                           <div className="flex justify-between items-start mb-2">
                                               <Badge className={`border-0 ${statusColor}`}>
                                                  {task.status === 'Sent' && hoursElapsed > 24 ? 'SLA Breached' : task.status}
                                               </Badge>
                                               <span className="text-[10px] text-slate-500">{Math.floor(hoursElapsed)}h ago</span>
                                           </div>
                                           <p className="font-bold text-[#0A2647] text-sm">{task.subject}</p>
                                           <p className="text-[10px] text-slate-500 mt-1">Assigned To: <span className="font-mono bg-slate-100 px-1 rounded">{task.target_id}</span></p>
                                           
                                         {task.client_reply && (
                                              <div className="mt-2 bg-blue-50 border border-blue-100 p-2 rounded-md">
                                                <span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest block mb-1">Client/Emp Reply:</span>
                                                <span className="text-xs font-medium text-slate-700">"{task.client_reply}"</span>
                                              </div>
                                           )}
                                           
                                           {/* 🚀 FIX: అటాచ్ చేసిన PDF ని వ్యూ చేసే ఆప్షన్ */}
                                           {task.file_name && (
                                              <Button size="sm" variant="outline" onClick={() => {
                                                  window.open(`/api/dispatches/${task._id || task.id}/file`, '_blank');
                                              }} className="mt-2 h-7 text-[10px] text-blue-600 border-blue-200 bg-white w-fit">
                                                 <FileText className="w-3 h-3 mr-1"/> View Attached PDF
                                              </Button>
                                           )}
                                           {task.file_name && (
                                              <Button size="sm" variant="outline" onClick={() => {
                                                  window.open(`/api/dispatches/${task._id || task.id}/file`, '_blank');
                                              }} className="mt-2 h-7 text-[10px] text-blue-600 border-blue-200 bg-white w-fit">
                                                 <FileText className="w-3 h-3 mr-1"/> View Attached PDF
                                              </Button>
                                           )}

                                           <div className="w-full bg-slate-100 h-1.5 rounded-full mt-3 mb-3">
                                               <div className={`h-1.5 rounded-full ${barColor} ${progress}`}></div>
                                           </div>

                                           <div className="flex gap-2">
                                               {hoursElapsed > 24 && hoursElapsed <= 48 && task.status !== 'Warning Issued' && (
                                                   <Button size="sm" variant="outline" onClick={() => handleGiveWarning(task._id)} className="flex-1 h-7 text-[10px] text-amber-600 border-amber-200 hover:bg-amber-50"><AlertTriangle className="w-3 h-3 mr-1"/> Give Warning</Button>
                                               )}
                                               {hoursElapsed > 48 && (
                                                   <Button size="sm" onClick={() => handleForceClose(task._id)} className="flex-1 h-7 text-[10px] bg-red-600 hover:bg-red-700 text-white"><XCircle className="w-3 h-3 mr-1"/> Force Close</Button>
                                               )}
                                               <Button size="sm" variant="ghost" onClick={() => deleteDispatch(task._id)} className="h-7 text-[10px] text-slate-500 hover:text-red-600 hover:bg-red-50 px-2"><Trash2 className="w-3 h-3"/></Button>
                                           </div>
                                       </div>
                                   )
                               })}
                           </div>
                        )}
                     </CardContent>
                  </Card>
               </div>

            </div>
          </TabsContent>
          {/* ==================== 6. PUBLISHER ==================== */}
          {/* 🚀 AI MATCHMAKER & COMPETITOR INTEL — matches produced by the nightly
              /api/cron/matchmaker job, plus on-demand L1 price prediction. */}
          <TabsContent value="matchmaker" className="mt-4">

            <AiMatchmakerPanel />

            <div className="mb-6 mt-6">
              <CopilotTrainDropzone />
            </div>

            <div className="mb-6 mt-6">
              <L1BenchmarkDropzone />
            </div>

            <Card className="tender-shadow border-t-4 border-t-indigo-600 w-full mb-6">
              <CardHeader className="bg-indigo-50/40 border-b pb-4">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg">
                      <Target className="w-5 h-5 text-indigo-600" /> Legacy Match Feed &amp; L1 Prediction
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Nightly cron matches with on-demand L1 competitor intel. Prefer the Suggested Bids panel above for
                      manual WhatsApp alerts.
                    </CardDescription>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    <Button
                      onClick={runMatchmakerNow}
                      disabled={runningMatchmaker}
                      className="bg-indigo-700 hover:bg-indigo-800 text-white shadow-sm"
                    >
                      {runningMatchmaker
                        ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scanning tenders...</>
                        : <><RefreshCw className="w-4 h-4 mr-2" /> Refresh Cron Matches</>}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-5">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Live Matches</div>
                    <div className="text-2xl font-extrabold text-[#0A2647] mt-0.5">{bidMatches.length}</div>
                  </div>
                  <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Awaiting Review</div>
                    <div className="text-2xl font-extrabold text-indigo-700 mt-0.5">{matchSummary.new || 0}</div>
                  </div>
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-amber-500">JV Opportunities</div>
                    <div className="text-2xl font-extrabold text-amber-700 mt-0.5">{matchSummary.jv || 0}</div>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">Est. Pipeline</div>
                    <div className="text-lg font-extrabold text-emerald-700 mt-1 truncate">
                      {formatINR(bidMatches.reduce((sum, m) => sum + (Number(m.estimated_value) || 0), 0))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Filter</span>
                  {[
                    { id: 'all', label: `All (${bidMatches.length})` },
                    { id: 'DIRECT', label: `Direct (${bidMatches.filter(m => m.match_type === 'DIRECT').length})` },
                    { id: 'JV', label: `Joint Venture (${bidMatches.filter(m => m.match_type === 'JV').length})` },
                  ].map(opt => (
                    <Button
                      key={opt.id}
                      size="sm"
                      variant={matchTypeFilter === opt.id ? 'default' : 'outline'}
                      onClick={() => setMatchTypeFilter(opt.id)}
                      className={`h-7 text-xs ${matchTypeFilter === opt.id ? 'bg-[#0A2647] hover:bg-[#0A2647]/90' : 'text-slate-600'}`}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="tender-shadow w-full">
              <CardHeader className="border-b pb-4">
                <CardTitle className="flex items-center gap-2 text-[#0A2647] text-base">
                  <Handshake className="w-5 h-5 text-indigo-600" /> Matched Opportunities
                </CardTitle>
                <CardDescription>
                  Confidence blends category overlap, district presence, vault completeness and proven contract value.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {visibleMatches.length === 0 ? (
                  <div className="p-10 text-center">
                    <Target className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="font-bold text-slate-700">No matches to show yet</p>
                    <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                      {bidMatches.length === 0
                        ? 'Run the matchmaker to score today\u2019s open TS/AP tenders against your approved clients. Matches need a client service-category overlap to qualify.'
                        : 'No matches of this type. Try a different filter.'}
                    </p>
                  </div>
                ) : (
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Target Client</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Bid Details</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Value / Turnover</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Fit</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleMatches.map((m) => {
                        const matchId = m._id || m.tender_id;
                        const isPredicting = predictingMatchId === matchId;
                        return (
                          <TableRow key={matchId} className="align-top hover:bg-indigo-50/30">
                            <TableCell className="py-3">
                              <div className="font-bold text-sm text-[#0A2647] flex items-center gap-1.5">
                                {m.client_company}
                                {m.status === 'new' && (
                                  <Badge className="bg-indigo-600 text-white text-[9px] px-1.5 py-0 h-4">NEW</Badge>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500">{m.client_email}</div>
                              <div className="text-[11px] text-slate-500 mt-1">
                                Proven value: <span className="font-semibold text-slate-700">{formatINR(m.client_capacity)}</span>
                              </div>
                              {m.match_type === 'JV' && m.jv_partner && (
                                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-md p-2">
                                  <div className="text-[9px] font-bold uppercase tracking-wider text-amber-600 flex items-center gap-1">
                                    <Handshake className="w-3 h-3" /> JV Partner
                                  </div>
                                  <div className="text-xs font-semibold text-amber-900">{m.jv_partner.company_name}</div>
                                  <div className="text-[10px] text-amber-700">
                                    Combined: {formatINR(m.jv_partner.combined_capacity)}
                                  </div>
                                </div>
                              )}
                            </TableCell>

                            <TableCell className="py-3 max-w-[320px]">
                              <div className="font-semibold text-sm text-slate-800 leading-snug">{m.tender_title}</div>
                              <div className="text-[11px] text-slate-500 mt-1 space-y-0.5">
                                {m.tender_bid_no && <div className="font-mono">{m.tender_bid_no}</div>}
                                {m.tender_department && <div>{m.tender_department}</div>}
                                <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                  {m.tender_district && (
                                    <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {m.tender_district}</span>
                                  )}
                                  {m.tender_last_date && (
                                    <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {m.tender_last_date}</span>
                                  )}
                                </div>
                              </div>
                            </TableCell>

                            <TableCell className="py-3">
                              <div className="text-sm font-bold text-emerald-700">{formatINR(m.estimated_value)}</div>
                              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Est. value</div>
                              {m.required_turnover ? (
                                <div className="text-[11px] text-slate-600 mt-1.5">
                                  Turnover req: <span className="font-semibold">{formatINR(m.required_turnover)}</span>
                                </div>
                              ) : (
                                <div className="text-[11px] text-slate-400 mt-1.5">No turnover clause found</div>
                              )}
                            </TableCell>

                            <TableCell className="py-3">
                              <div className="flex items-center gap-2">
                                <span className={`text-lg font-extrabold ${
                                  m.confidence >= 75 ? 'text-emerald-600' : m.confidence >= 60 ? 'text-blue-600' : 'text-amber-600'
                                }`}>{m.confidence}%</span>
                                <Badge variant="outline" className={
                                  m.match_type === 'JV'
                                    ? 'border-amber-300 text-amber-700 bg-amber-50 text-[10px]'
                                    : 'border-emerald-300 text-emerald-700 bg-emerald-50 text-[10px]'
                                }>
                                  {m.match_type === 'JV' ? 'JV' : 'DIRECT'}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap gap-1 mt-1.5 max-w-[180px]">
                                {(m.category_hits || []).slice(0, 4).map(hit => (
                                  <span key={hit} className="text-[9px] bg-slate-100 border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
                                    {hit}
                                  </span>
                                ))}
                              </div>
                            </TableCell>

                            <TableCell className="py-3">
                              <div className="flex flex-col items-end gap-1.5">
                                <Button
                                  size="sm"
                                  onClick={() => runL1Prediction(m)}
                                  disabled={isPredicting}
                                  className="h-8 text-xs bg-indigo-700 hover:bg-indigo-800 text-white w-full sm:w-auto shadow-sm"
                                >
                                  {isPredicting
                                    ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Predicting...</>
                                    : <><Sparkles className="w-3 h-3 mr-1.5" /> Run L1 Prediction</>}
                                </Button>
                                <div className="flex gap-1">
                                  {m.status === 'new' && (
                                    <Button size="sm" variant="outline" onClick={() => updateMatchStatus(m, 'reviewed')} className="h-7 text-[10px] text-slate-600">
                                      <CheckCircle2 className="w-3 h-3 mr-1" /> Reviewed
                                    </Button>
                                  )}
                                  <Button size="sm" variant="outline" onClick={() => updateMatchStatus(m, 'dismissed')} className="h-7 text-[10px] text-red-600 border-red-200 hover:bg-red-50">
                                    <X className="w-3 h-3 mr-1" /> Dismiss
                                  </Button>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>


          <TabsContent value="master-tenders" className="mt-4">
            <MasterTenderDesk />
          </TabsContent>

          <TabsContent value="copilot-desk" className="mt-4">
            <GeminiWorkspace
              embedded
              tenderId={isEditingTender || null}
              tenderLabel={isEditingTender ? (form.title || form.bid_no || 'this tender') : null}
              clients={approvedClients}
              tenders={tenders}
            />
          </TabsContent>

          <TabsContent value="publisher" className="mt-4">
            <Card className="mb-6 border-amber-200 bg-amber-50">
              <CardContent className="pt-4 text-sm text-amber-900">
                Publishing and bulk AI dropzone live on the TL and Employee desks. MD uses this list for live tenders only (10 per page).
              </CardContent>
            </Card>
            <L1BenchmarkDropzone />

            <div className="grid gap-4 sm:gap-6 mt-6">
              <Card className="lg:col-span-3 tender-shadow">
                <CardHeader className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                   <div>
                      <CardTitle className="text-[#0A2647] flex items-center gap-2">Published Tenders <Badge variant="outline">{filteredTenders.length}</Badge></CardTitle>
                   </div>
                   <div className="relative shrink-0 w-full sm:w-[250px]">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <Input placeholder="Search Bid No or Title..." value={tenderSearch} onChange={e=>setTenderSearch(e.target.value)} className="pl-9 h-9 w-full bg-white shadow-sm text-xs" />
                   </div>
                </CardHeader>
                <CardContent ref={tendersListRef} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                  {filteredTenders.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No matching tenders found.</p>}
                  {paginatedTenders.map((t) => (
                    <div
                      key={t._id || t.id}
                      className="border border-slate-200 rounded-lg p-4 bg-white hover:border-[#0A2647]/30 transition shadow-sm flex flex-col gap-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => handleViewPDF(t._id || t.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleViewPDF(t._id || t.id); } }}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className="bg-[#0A2647]">{t.district}</Badge>
                            {t.category && <Badge variant="outline" className="text-[10px]">{t.category}</Badge>}
                            {t.bid_no && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800 border-amber-200">Bid: {t.bid_no}</Badge>}
                            <span className="text-[10px] text-red-600 font-bold flex items-center bg-red-50 px-1.5 py-0.5 rounded"><Clock className="w-3 h-3 mr-1"/> Ends: {t.last_date && !isNaN(new Date(t.last_date)) ? new Date(t.last_date).toLocaleDateString() : 'N/A'}</span>
                          </div>
                          <p className="font-bold text-[#0A2647] text-base leading-tight line-clamp-2">{t.title}</p>
                          <p className="text-xs text-slate-500 mt-1">{t.department}</p>
                        </div>
                        <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                           <Button variant="ghost" size="icon" onClick={() => handleEditTender(t)} className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 h-8 w-8"><Pencil className="w-4 h-4" /></Button>
                           <Button variant="ghost" size="icon" onClick={() => remove(t._id || t.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50 h-8 w-8"><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      </div>
                      
                      <div className="border-t border-slate-100 pt-3 mt-2 flex flex-col sm:flex-row items-center gap-2" onClick={(e) => e.stopPropagation()}>
                         <Button size="sm" onClick={() => handleViewPDF(t._id || t.id)} variant="outline" className="h-8 text-xs text-blue-600 border-blue-200 shadow-sm shrink-0">
                            <FileText className="w-3 h-3 mr-1.5"/> View PDF
                         </Button>
                         <SuggestClientControls tender={t} clients={approvedClients} onDone={patchJob} />
                         <div className="bg-emerald-50/50 p-1.5 rounded-md border border-emerald-100 flex flex-1 flex-col sm:flex-row gap-2 items-center w-full">
                            <div className="flex items-center gap-1 w-full sm:w-auto text-emerald-800 text-[10px] uppercase font-bold tracking-wider px-1"><TrendingDown className="w-4 h-4" /> L1 Intel</div>
                            <Input placeholder="Price (₹)" type="number" className="h-8 text-xs bg-white w-full sm:w-24 border-emerald-200 focus-visible:ring-emerald-500" value={l1Data[t._id || t.id]?.price || t.l1_price || ''} onChange={e => setL1Data(prev => ({...prev, [t._id || t.id]: {...(prev[t._id || t.id] || {}), price: e.target.value}}))}/>
                            <Input placeholder="Winner Name" className="h-8 text-xs bg-white w-full sm:flex-1 border-emerald-200 focus-visible:ring-emerald-500" value={l1Data[t._id || t.id]?.winner || t.l1_winner || ''} onChange={e => setL1Data(prev => ({...prev, [t._id || t.id]: {...(prev[t._id || t.id] || {}), winner: e.target.value}}))}/>
                            <Button size="sm" className="h-8 text-[10px] w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 shadow-sm px-2" onClick={() => submitL1Price(t._id || t.id)}>Save</Button>
                         </div>
                      </div>
                    </div>
                  ))}

                  {/* 🚀 Pagination Controls (20 per page) */}
                  {totalTenderPages > 1 && (
                    <div className="flex items-center justify-center gap-4 pt-2 pb-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => goToTenderPage(tenderPage - 1)}
                        disabled={tenderPage === 1}
                        className="border-2 font-bold text-slate-600 disabled:opacity-40"
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                      </Button>
                      <span className="text-xs font-black text-[#0A2647] whitespace-nowrap">
                        Page {tenderPage} of {totalTenderPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => goToTenderPage(tenderPage + 1)}
                        disabled={tenderPage === totalTenderPages}
                        className="border-2 font-bold text-slate-600 disabled:opacity-40"
                      >
                        Next <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ==================== 7. HELPDESK (WITH GUEST QUERIES) ==================== */}
          <TabsContent value="tickets" className="mt-4">
            
            <Card className="tender-shadow border-t-4 border-t-purple-500 w-full mb-6">
              <CardHeader className="bg-purple-50/30 border-b pb-4">
                 <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><Users className="w-5 h-5 text-purple-600" /> Public Visitor Queries (Leads)</CardTitle>
                 <CardDescription>Questions and Contact Requests submitted from the Guest Home Page.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 max-h-[500px] overflow-y-auto">
                 {guestQueries.length === 0 ? (
                    <div className="text-center py-8 text-slate-400"><MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-30"/><p className="text-sm font-semibold">No public queries pending.</p></div>
                 ) : (
                    <div className="grid md:grid-cols-2 gap-4">
                       {guestQueries.map(gq => (
                          <div key={gq._id} className="border border-purple-200 bg-white rounded-lg p-4 shadow-sm relative">
                             <div className="flex justify-between items-start mb-2">
                                <div>
                                  <h4 className="font-bold text-[#0A2647] text-base">{gq.name || '—'}</h4>
                                  <p className="text-[10px] text-slate-400">{gq.created_at ? new Date(gq.created_at).toLocaleString() : '—'}</p>
                                </div>
                                <Badge className="bg-purple-100 text-purple-800 border-0">New Lead</Badge>
                             </div>
                             <p className="text-sm text-slate-600 font-mono"><PhoneCall className="w-3 h-3 inline mr-1"/> {gq.phone || '—'}</p>
                             <p className="text-xs text-slate-600 mt-1"><span className="font-bold text-slate-400">Enterprise</span> {gq.enterprise_name || '—'}</p>
                             <p className="text-xs text-slate-600"><span className="font-bold text-slate-400">Area</span> {gq.area || '—'}</p>
                             <div className="bg-slate-50 p-3 rounded border border-slate-100 my-3">
                                <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Required services</p>
                                <p className="text-xs text-slate-700">{(Array.isArray(gq.services) && gq.services.length ? gq.services : [gq.query].filter(Boolean)).join(', ') || '—'}</p>
                             </div>
                             <div className="flex gap-2">
                                <a href={`tel:${gq.phone}`} className="flex-1"><Button size="sm" className="w-full bg-purple-600 hover:bg-purple-700 h-8 text-xs"><PhoneCall className="w-3 h-3 mr-1"/> Call Lead</Button></a>
                                <Button size="sm" onClick={() => resolveGuestQuery(gq._id)} variant="outline" className="border-slate-300 text-slate-600 hover:bg-slate-100 h-8 text-xs"><CheckCircle2 className="w-3 h-3 mr-1"/> Mark Resolved</Button>
                             </div>
                          </div>
                       ))}
                    </div>
                 )}
              </CardContent>
            </Card>

            <Card className="tender-shadow border-t-4 border-t-amber-500 w-full">
              <CardHeader className="bg-amber-50/30 border-b pb-4">
                 <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><MessageSquare className="w-5 h-5 text-amber-600" /> Client Helpdesk & SLA Tracker</CardTitle>
                 <CardDescription>Resolve queries within 24 hours or escalate issues.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 max-h-[800px] overflow-y-auto">
                 
                 {activeTickets.length > 0 && (
                    <div className="mb-8 space-y-4">
                       <h3 className="font-bold text-slate-700 mb-2 border-b pb-2">Active Action Required</h3>
                       <div className="grid md:grid-cols-2 gap-4">
                       {activeTickets.map(ticket => (
                          <div key={ticket._id} className="border border-amber-200 bg-white rounded-lg p-4 relative overflow-hidden shadow-sm hover:shadow-md transition flex flex-col justify-between">
                             <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                             <div>
                                <div className="flex justify-between items-start mb-2">
                                   <div>
                                     <Badge variant="outline" className="mb-1 bg-slate-100">{ticket.department}</Badge>
                                     <p className="text-xs text-muted-foreground">{ticket.client_email}</p>
                                   </div>
                                   <div className="flex gap-2 items-center">
                                      <Badge className="bg-amber-100 text-amber-800 border-0 animate-pulse shrink-0">Action Required</Badge>
                                      <Button variant="ghost" size="icon" onClick={() => deleteTicket(ticket._id)} className="h-6 w-6 p-0 text-red-400 hover:text-red-600 bg-white"><Trash2 className="w-3 h-3"/></Button>
                                   </div>
                                </div>
                                <div className="bg-amber-50 border border-amber-100 p-3 rounded-tr-xl rounded-br-xl rounded-bl-xl shadow-inner mb-4 mt-2">
                                   <p className="text-[10px] text-amber-500 font-bold uppercase mb-1">{new Date(ticket.created_at).toLocaleString()}</p>
                                   <h4 className="font-bold text-[#0A2647] text-sm mb-1">{ticket.subject}</h4>
                                   <p className="text-xs text-amber-900 leading-relaxed">"{ticket.message}"</p>
                                </div>
                             </div>
                             
                             <div className="flex flex-col gap-2 mt-4 pt-3 border-t">
                                <div className="flex gap-2">
                                   <Input placeholder="Type resolution note..." className="text-sm flex-1 bg-white focus-visible:ring-amber-500 h-9" value={ticketReply[ticket._id] || ''} onChange={(e) => setTicketReply(prev => ({...prev, [ticket._id]: e.target.value}))}/>
                                   <Button onClick={() => submitTicketReply(ticket._id)} className="bg-[#16a34a] hover:bg-[#15803d] shrink-0 h-9"><CheckCircle2 className="w-4 h-4 mr-1"/>Resolve</Button>
                                </div>
                                <Button onClick={() => impersonateUser('client', ticket.client_email)} variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50 w-full h-9"><LogIn className="w-4 h-4 mr-1"/> Login as Client to Fix</Button>
                             </div>
                          </div>
                       ))}
                       </div>
                    </div>
                 )}

                 <div>
                    <h3 className="font-bold text-emerald-700 mb-3 border-b pb-2">Resolved Tickets History</h3>
                    {resolvedTickets.length === 0 ? (
                       <p className="text-sm text-slate-400">No resolved tickets yet.</p>
                    ) : (
                       <div className="space-y-2">
                          {resolvedTickets.map(ticket => (
                             <div key={ticket._id} className="bg-slate-50 border border-slate-200 rounded-md p-2 px-3 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-slate-100 transition shadow-sm">
                                <Badge className="bg-emerald-100 text-emerald-800 border-0 shrink-0 shadow-sm w-fit">Resolved</Badge>
                                
                                <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-2">
                                   <span className="text-xs font-bold text-[#0A2647] w-full sm:w-[150px] truncate">{ticket.subject}</span>
                                   <span className="text-xs text-slate-600 truncate flex-1">
                                      <b>Q:</b> {ticket.message} <span className="text-slate-300 mx-1">|</span> <b>A:</b> <span className="text-emerald-700 font-semibold">{ticket.reply || 'Resolved by Support'}</span>
                                   </span>
                                </div>

                                <div className="shrink-0 flex items-center gap-3">
                                   <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{new Date(ticket.created_at).toLocaleDateString()} - {ticket.replied_at ? new Date(ticket.replied_at).toLocaleDateString() : 'N/A'}</span>
                                   <Button variant="ghost" size="icon" onClick={() => deleteTicket(ticket._id)} className="h-6 w-6 p-0 text-red-400 hover:text-red-600 bg-white border border-slate-200 shadow-sm"><Trash2 className="w-3 h-3"/></Button>
                                </div>
                             </div>
                          ))}
                       </div>
                    )}
                 </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pricing" className="mt-4">
            <PricingMasterPanel token={token} canEdit />
          </TabsContent>

          <TabsContent value="leads" className="mt-4">
            <ThirdPartyLeadsPanel token={token} />
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <BrandSettings token={token} />
          </TabsContent>
        </Tabs>
        </div>
        </div>

        {/* 🚀 MD Vault Approval Dialog */}
        <Dialog open={approvalModal.open} onOpenChange={(val) => !val && setApprovalModal({ open: false, email: '', docId: '', docName: '', clientName: '' })}>
          <DialogContent className="sm:max-w-md border-0 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="text-lg font-black text-[#0A2647] flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600"/> Approve & Save Document
              </DialogTitle>
              <DialogDescription>Review the file name before saving it to the database and client's drive.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
               <div>
                  <Label className="font-bold text-slate-700">Client Name</Label>
                  <Input type="text" value={approvalModal.clientName} disabled className="mt-1 bg-slate-50 text-slate-500" />
               </div>
               <div>
                  <Label className="font-bold text-slate-700">File Name (Auto-Generated) *</Label>
                  <Input type="text" value={customFileName} onChange={e => setCustomFileName(e.target.value)} required className="mt-1 border-2 h-11" />
                  <p className="text-[10px] text-slate-500 mt-1">Note: .pdf extension will be added automatically if missing.</p>
               </div>
               
               {duplicateWarning && (
                  <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex flex-col gap-2">
                     <div className="flex items-center gap-2 text-amber-800 text-sm font-bold">
                        <AlertTriangle className="w-4 h-4"/> {duplicateWarning}
                     </div>
                     <label className="flex items-center gap-2 text-sm cursor-pointer font-semibold text-amber-900 mt-1">
                        <input type="checkbox" checked={overwriteDoc} onChange={e => setOverwriteDoc(e.target.checked)} className="w-4 h-4 accent-amber-600" />
                        Yes, replace the existing file.
                     </label>
                  </div>
               )}

               <Button 
                  onClick={() => handleVerifyVaultDoc(approvalModal.email, approvalModal.docId, 'verified', customFileName, overwriteDoc)} 
                  className="w-full bg-[#16a34a] hover:bg-[#15803d] h-12 mt-2 font-bold text-lg shadow-md"
                  disabled={duplicateWarning && !overwriteDoc}
               >
                  Confirm & Save File
               </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* 🚀 L1 PREDICTION — competitor intel and a suggested quote for one matched bid. */}
        <Dialog open={predictionOpen} onOpenChange={setPredictionOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[#0A2647]">
                <Gauge className="w-5 h-5 text-indigo-600" /> L1 Prediction &amp; Competitor Intel
              </DialogTitle>
              <DialogDescription className="leading-snug">
                {prediction?.tender?.title || 'Selected tender'}
                {prediction?.tender?.bid_no ? ` · ${prediction.tender.bid_no}` : ''}
              </DialogDescription>
            </DialogHeader>

            {prediction && (
              <div className="space-y-4 pt-1">
                {/* Headline numbers */}
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">Suggested Quote</div>
                    <div className="text-xl font-extrabold text-emerald-700 mt-0.5">
                      {formatINR(prediction.prediction?.suggested_quote_inr)}
                    </div>
                  </div>
                  <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Below Estimate By</div>
                    <div className="text-xl font-extrabold text-indigo-700 mt-0.5 flex items-center gap-1">
                      <TrendingDown className="w-4 h-4" />
                      {prediction.prediction?.suggested_l1_percentage != null
                        ? `${prediction.prediction.suggested_l1_percentage}%`
                        : '—'}
                    </div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Confidence</div>
                    <div className={`text-xl font-extrabold mt-0.5 capitalize ${
                      prediction.prediction?.confidence === 'high' ? 'text-emerald-700'
                        : prediction.prediction?.confidence === 'medium' ? 'text-amber-600' : 'text-slate-500'
                    }`}>
                      {prediction.prediction?.confidence || 'low'}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {prediction.history?.comparable_records || 0} comparable record(s)
                    </div>
                  </div>
                </div>

                {/* Historical baseline — the numbers the model was given, so the MD can
                    sanity-check the recommendation rather than trust it blindly. */}
                <div className="bg-white border rounded-lg p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                    <BarChart3 className="w-3.5 h-3.5" /> Historical L1 Margins (our records)
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-base font-bold text-slate-800">
                        {prediction.history?.median_margin_pct != null ? `${prediction.history.median_margin_pct}%` : '—'}
                      </div>
                      <div className="text-[10px] text-slate-400 uppercase">Median</div>
                    </div>
                    <div>
                      <div className="text-base font-bold text-slate-800">
                        {prediction.history?.average_margin_pct != null ? `${prediction.history.average_margin_pct}%` : '—'}
                      </div>
                      <div className="text-[10px] text-slate-400 uppercase">Average</div>
                    </div>
                    <div>
                      <div className="text-base font-bold text-slate-800">{formatINR(prediction.tender?.estimated_value)}</div>
                      <div className="text-[10px] text-slate-400 uppercase">Est. Value</div>
                    </div>
                  </div>
                </div>

                {/* Competitors */}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                    <Users className="w-3.5 h-3.5" /> Likely Competitors
                  </div>
                  {(prediction.prediction?.likely_competitors || []).length === 0 ? (
                    <p className="text-sm text-slate-500 bg-slate-50 border rounded-lg p-3">
                      No competitor names appear in our historical records for this category yet. Record L1 winners
                      on lost bids to build this intel up.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {prediction.prediction.likely_competitors.map((c, i) => (
                        <div key={`${c.name}-${i}`} className="flex items-start justify-between gap-3 bg-slate-50 border rounded-lg p-2.5">
                          <div className="min-w-0">
                            <div className="font-bold text-sm text-[#0A2647]">{c.name}</div>
                            {c.typical_behaviour && (
                              <div className="text-[11px] text-slate-600 leading-snug">{c.typical_behaviour}</div>
                            )}
                          </div>
                          <Badge variant="outline" className="shrink-0 text-[10px] border-slate-300">
                            <Trophy className="w-3 h-3 mr-1 text-amber-500" /> {c.wins_observed} win(s)
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Rationale */}
                {prediction.prediction?.rationale && (
                  <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-500 flex items-center gap-1.5 mb-1">
                      <TrendingUp className="w-3.5 h-3.5" /> Strategy
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">{prediction.prediction.rationale}</p>
                  </div>
                )}

                {/* JV recommendation — pre-seeded from the matchmaker where it found a pair. */}
                <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600 flex items-center gap-1.5 mb-1">
                    <Handshake className="w-3.5 h-3.5" /> Joint Venture
                  </div>
                  {prediction.match?.match_type === 'JV' && prediction.match?.jv_partner ? (
                    <p className="text-sm text-amber-900 leading-relaxed">
                      <span className="font-bold">{prediction.match.client_company}</span> cannot meet the{' '}
                      {formatINR(prediction.match.required_turnover)} turnover requirement alone
                      ({formatINR(prediction.match.client_capacity)} proven). Pair with{' '}
                      <span className="font-bold">{prediction.match.jv_partner.company_name}</span> for a combined{' '}
                      {formatINR(prediction.match.jv_partner.combined_capacity)}.
                    </p>
                  ) : (
                    <p className="text-sm text-amber-900 leading-relaxed">
                      {prediction.prediction?.jv_recommendation || 'Not required'}
                    </p>
                  )}
                </div>

                {/* Risks */}
                {(prediction.prediction?.risks || []).length > 0 && (
                  <div className="bg-red-50/60 border border-red-100 rounded-lg p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-red-500 flex items-center gap-1.5 mb-1.5">
                      <ShieldAlert className="w-3.5 h-3.5" /> Risks
                    </div>
                    <ul className="space-y-1">
                      {prediction.prediction.risks.map((risk, i) => (
                        <li key={i} className="text-sm text-slate-700 flex gap-2">
                          <span className="text-red-400 shrink-0">•</span> {risk}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-[11px] text-slate-400 leading-snug border-t pt-3">
                  AI-generated guidance based only on L1 outcomes recorded in this platform. Estimated values are
                  derived from EMD at the standard 2% convention where the tender does not state a value. Verify
                  against the tender document before quoting.
                </p>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setPredictionOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <StationeryUploader
          client={stationeryClient}
          open={!!stationeryClient}
          onOpenChange={(open) => { if (!open) setStationeryClient(null); }}
        />

        <GeminiWorkspace
          tenderId={isEditingTender || null}
          tenderLabel={isEditingTender ? (form.title || form.bid_no || 'this tender') : null}
          clients={approvedClients}
          tenders={tenders}
        />
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, accent }) {
  return (
    <Card className={`border-0 ring-1 premium-hover ${accent ? 'ring-emerald-500/40 bg-emerald-50/60' : 'ring-slate-200/80 bg-white'}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-2 text-muted-foreground text-[11px] sm:text-xs font-bold uppercase tracking-wider mb-2">{icon} {label}</div>
        <div className={`text-2xl sm:text-3xl font-black ${accent ? 'text-emerald-700' : 'text-[#0A2647]'}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

const MAX_BRAND_IMAGE_BYTES = 2 * 1024 * 1024;

function imageFormRef(value, originIndex) {
  const s = String(value || '').trim();
  if (!s || s.startsWith('data:') || s.startsWith('blob:') || s.length > 2048) {
    return originIndex != null && originIndex >= 0 ? `__keep__:${originIndex}` : '';
  }
  if (/^https?:\/\//i.test(s) || s.startsWith('/')) return s;
  return originIndex != null && originIndex >= 0 ? `__keep__:${originIndex}` : '';
}

function BrandSettings({ token }) {
  const [logoPreview, setLogoPreview] = useState('');
  const [gemLogoPreview, setGemLogoPreview] = useState('');
  const [mdSignaturePreview, setMdSignaturePreview] = useState(''); 
  const [brandName, setBrandName] = useState('Telangana Tenders');
  const [tagline, setTagline] = useState('Official Government Tender Portal');
  const [visionText, setVisionText] = useState('');
  const [aboutUs, setAboutUs] = useState('');
  const [banners, setBanners] = useState([]);
  const [leaders, setLeaders] = useState([]);
  const [clients, setClients] = useState([]); 
  const [logoFile, setLogoFile] = useState(null);
  const [gemFile, setGemFile] = useState(null);
  const [sigFile, setSigFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveBlocked, setSaveBlocked] = useState(false);
  const [logoOrigin, setLogoOrigin] = useState(null);
  const [gemOrigin, setGemOrigin] = useState(null);
  const [sigOrigin, setSigOrigin] = useState(null);

  const [newLeader, setNewLeader] = useState({ name: '', role: '', image: '', imageFile: null, phone: '', email: '' });
  const [newClient, setNewClient] = useState({ client_name: '', company_name: '', udyam_no: '', image: '', imageFile: null });

  useEffect(() => {
    fetch('/api/settings').then(async (r) => {
      const d = await r.json().catch(() => ({}));
      const settings = d?.settings;
      if (!settings) return;
      if (settings.logo) { setLogoPreview(settings.logo); setLogoOrigin(0); }
      if (settings.gem_logo) { setGemLogoPreview(settings.gem_logo); setGemOrigin(0); }
      if (settings.md_signature) { setMdSignaturePreview(settings.md_signature); setSigOrigin(0); }
      if (settings.name) setBrandName(settings.name);
      if (settings.tagline) setTagline(settings.tagline);
      if (settings.vision_text) setVisionText(settings.vision_text);
      if (settings.about_us) setAboutUs(settings.about_us);
      if (Array.isArray(settings.banners)) {
        setBanners(settings.banners.map((src, i) => ({ src, file: null, originIndex: i })));
      }
      if (Array.isArray(settings.leaders)) {
        setLeaders(settings.leaders.map((row, i) => ({ ...row, imageFile: null, originIndex: i })));
      }
      if (Array.isArray(settings.clients)) {
        setClients(settings.clients.map((row, i) => ({ ...row, imageFile: null, originIndex: i })));
      }
    }).catch((err) => console.error(err));
  }, []);

  const takeImageFile = (e, onAccepted) => {
    const input = e.target;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return null;
    if (!f.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return null;
    }
    if (f.size > MAX_BRAND_IMAGE_BYTES) {
      toast.error('Image size must be under 2MB');
      setSaveBlocked(true);
      return null;
    }
    setSaveBlocked(false);
    onAccepted({ url: URL.createObjectURL(f), file: f });
    return f;
  };

  const handleImageUpload = (e, previewSetter, fileSetter) => {
    takeImageFile(e, ({ url, file }) => {
      previewSetter(url);
      fileSetter?.(file);
    });
  };

  const onBannerUpload = (e) => {
    takeImageFile(e, ({ url, file }) => {
      setBanners((prev) => [...prev, { src: url, file, originIndex: null }]);
      toast.success('Banner added to preview!');
    });
  };

  const removeBanner = (index) => {
    if(!confirm("Remove this banner?")) return;
    setBanners(prev => prev.filter((_, i) => i !== index));
  };

  const addLeader = () => {
    if (!newLeader.name || !newLeader.role || (!newLeader.imageFile && !newLeader.image)) return toast.error('Name, Role, and Photo are required!');
    setLeaders(prev => [...prev, { ...newLeader, originIndex: null }]);
    setNewLeader({ name: '', role: '', image: '', imageFile: null, phone: '', email: '' });
    toast.success('Leader added to preview list. Click Save Settings to publish.');
  };

  const removeLeader = (index) => {
    if(!confirm("Remove this leader?")) return;
    setLeaders(prev => prev.filter((_, i) => i !== index));
  };

  const addClient = () => {
    if (!newClient.client_name || !newClient.company_name || (!newClient.imageFile && !newClient.image)) return toast.error('Client Name, Company, and Photo are required!');
    setClients(prev => [...prev, { ...newClient, originIndex: null }]);
    setNewClient({ client_name: '', company_name: '', udyam_no: '', image: '', imageFile: null });
    toast.success('Client added to showcase. Click Save Settings to publish.');
  };

  const removeClient = (index) => {
    if(!confirm("Remove this client?")) return;
    setClients(prev => prev.filter((_, i) => i !== index));
  };

  const save = async () => {
    if (saveBlocked) return toast.error('Image size must be under 2MB');
    setSaving(true);
    try {
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const uploadAsset = async (file) => {
        if (!(file instanceof File)) return '';
        if (file.size > MAX_BRAND_IMAGE_BYTES) {
          throw new Error('Image size must be under 2MB');
        }
        const assetForm = new FormData();
        assetForm.append('file', file);
        const res = await fetch('/api/settings/asset', {
          method: 'POST',
          credentials: 'include',
          headers,
          body: assetForm,
        });
        if (res.status === 413) {
          throw new Error('This image is too large for the server. Use a file under 2MB.');
        }
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error(payload?.error || `Upload failed (HTTP ${res.status}).`);
        const url = String(payload?.url || '');
        if (!url || url.startsWith('data:') || url.startsWith('blob:')) {
          throw new Error('Upload did not return a stored image URL. Check Cloudflare R2.');
        }
        return url;
      };

      const logoUrl = logoFile ? await uploadAsset(logoFile) : '';
      const gemUrl = gemFile ? await uploadAsset(gemFile) : '';
      const sigUrl = sigFile ? await uploadAsset(sigFile) : '';

      const bannerUrls = [];
      for (const banner of banners) {
        if (banner?.file instanceof File) bannerUrls.push(await uploadAsset(banner.file));
        else bannerUrls.push(imageFormRef(typeof banner === 'string' ? banner : banner?.src, banner?.originIndex));
      }

      const leaderRows = [];
      for (let i = 0; i < leaders.length; i += 1) {
        const ld = leaders[i];
        const image = ld.imageFile instanceof File
          ? await uploadAsset(ld.imageFile)
          : imageFormRef(ld.image, ld.originIndex);
        leaderRows.push({
          name: ld.name || '',
          role: ld.role || '',
          phone: ld.phone || '',
          email: ld.email || '',
          image,
        });
      }

      const clientRows = [];
      for (let i = 0; i < clients.length; i += 1) {
        const cl = clients[i];
        const image = cl.imageFile instanceof File
          ? await uploadAsset(cl.imageFile)
          : imageFormRef(cl.image, cl.originIndex);
        clientRows.push({
          client_name: cl.client_name || '',
          company_name: cl.company_name || '',
          udyam_no: cl.udyam_no || '',
          image,
        });
      }

      const payload = {
        name: brandName,
        tagline,
        vision_text: visionText,
        about_us: aboutUs,
        logo: logoUrl || imageFormRef(logoPreview, logoOrigin),
        gem_logo: gemUrl || imageFormRef(gemLogoPreview, gemOrigin),
        md_signature: sigUrl || imageFormRef(mdSignaturePreview, sigOrigin),
        banners: bannerUrls,
        leaders: leaderRows,
        clients: clientRows,
      };
      const body = JSON.stringify(payload);
      if (body.length > 100_000) {
        throw new Error('Settings payload is too large. Upload images individually, then save.');
      }

      const r = await fetch('/api/settings', {
        method: 'POST',
        credentials: 'include',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body,
      });
      if (!r.ok) {
        const payload = await r.json().catch(() => null);
        const apiError = payload?.error || payload?.details || payload?.message;
        return toast.error(apiError
          ? `Could not save settings: ${apiError}`
          : r.status === 413
            ? 'Could not save settings: the request is too large. Upload fewer or smaller images.'
            : `Could not save settings (HTTP ${r.status}).`);
      }

      if (logoUrl) { setLogoPreview(logoUrl); setLogoFile(null); setLogoOrigin(null); }
      if (gemUrl) { setGemLogoPreview(gemUrl); setGemFile(null); setGemOrigin(null); }
      if (sigUrl) { setMdSignaturePreview(sigUrl); setSigFile(null); setSigOrigin(null); }
      setBanners(bannerUrls.map((src) => ({ src, file: null, originIndex: null })));
      setLeaders(leaderRows.map((row) => ({ ...row, imageFile: null, originIndex: null })));
      setClients(clientRows.map((row) => ({ ...row, imageFile: null, originIndex: null })));

      invalidateSettingsCache();
      toast.success('All Master Settings published successfully!');
    } catch (error) {
      const msg = error?.message || 'Network request failed';
      toast.error(msg.startsWith('Image') || msg.startsWith('This image') || msg.startsWith('Upload') || msg.startsWith('Please')
        ? msg
        : `Network Error: Cannot reach database. ${msg}`);
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <Card className="tender-shadow border-0 ring-1 ring-slate-200">
        <CardHeader className="pb-4 bg-slate-50/50 border-b flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><ImageIcon className="w-5 h-5 text-slate-500" /> Brand Identity & Logos</CardTitle>
          <Button type="button" onClick={save} disabled={saving || saveBlocked} className="bg-[#16a34a] hover:bg-[#15803d] shadow-md h-9 text-xs"><ShieldCheck className="w-4 h-4 mr-2"/> {saving ? 'Saving...' : 'Save All Settings'}</Button>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid lg:grid-cols-2 gap-8 items-start">
            <div className="flex flex-col gap-4">
               <div className="flex gap-4">
                  <div className="flex flex-col items-center gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 w-full">
                    <p className="text-xs font-bold text-slate-500 uppercase">Main Logo</p>
                    <div className="w-24 h-24 rounded-lg border-2 border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden">
                      {logoPreview ? <img src={logoPreview} alt="logo" className="w-full h-full object-contain p-1" /> : <ImageIcon className="w-8 h-8 text-slate-300" />}
                    </div>
                    <div className="flex gap-2 w-full">
                      <label className="cursor-pointer flex-1 text-[10px] font-bold px-2 py-1.5 bg-[#0A2647] hover:bg-[#144272] text-white rounded text-center transition"><input type="file" accept="image/*" onChange={(e)=>handleImageUpload(e, (url) => { setLogoPreview(url); setLogoOrigin(null); }, setLogoFile)} className="hidden" />Upload</label>
                      {logoPreview && <button onClick={() => {if(confirm('Remove?')) { setLogoPreview(''); setLogoFile(null); }}} className="text-[10px] font-bold px-2 py-1.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition">Del</button>}
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-center gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 w-full">
                    <p className="text-xs font-bold text-slate-500 uppercase">GeM / Partner Logo</p>
                    <div className="w-24 h-24 rounded-lg border-2 border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden">
                      {gemLogoPreview ? <img src={gemLogoPreview} alt="gem logo" className="w-full h-full object-contain p-1" /> : <ImageIcon className="w-8 h-8 text-slate-300" />}
                    </div>
                    <div className="flex gap-2 w-full">
                      <label className="cursor-pointer flex-1 text-[10px] font-bold px-2 py-1.5 bg-[#0A2647] hover:bg-[#144272] text-white rounded text-center transition"><input type="file" accept="image/*" onChange={(e)=>handleImageUpload(e, (url) => { setGemLogoPreview(url); setGemOrigin(null); }, setGemFile)} className="hidden" />Upload</label>
                      {gemLogoPreview && <button onClick={() => {if(confirm('Remove?')) { setGemLogoPreview(''); setGemFile(null); }}} className="text-[10px] font-bold px-2 py-1.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition">Del</button>}
                    </div>
                  </div>
               </div>
               
               <div className="flex flex-col items-center gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 w-full">
                  <p className="text-xs font-bold text-slate-500 uppercase">MD Signature (For Agreements)</p>
                  <div className="w-full h-24 rounded-lg border-2 border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden">
                    {mdSignaturePreview ? <img src={mdSignaturePreview} alt="MD Signature" className="w-full h-full object-contain p-2" /> : <PenTool className="w-8 h-8 text-slate-300" />}
                  </div>
                  <div className="flex gap-2 w-full">
                    <label className="cursor-pointer flex-1 text-[10px] font-bold px-2 py-1.5 bg-[#0A2647] hover:bg-[#144272] text-white rounded text-center transition"><input type="file" accept="image/*" onChange={(e)=>handleImageUpload(e, (url) => { setMdSignaturePreview(url); setSigOrigin(null); }, setSigFile)} className="hidden" />Upload</label>
                    {mdSignaturePreview && <button onClick={() => {if(confirm('Remove?')) { setMdSignaturePreview(''); setSigFile(null); }}} className="text-[10px] font-bold px-2 py-1.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition">Del</button>}
                  </div>
               </div>
            </div>
            
            <div className="space-y-4">
              <div><Label className="text-slate-700 font-bold">Portal Brand Name</Label><Input value={brandName} onChange={e => setBrandName(e.target.value)} className="mt-1" /></div>
              <div><Label className="text-slate-700 font-bold">Portal Tagline / Short Desc</Label><Input value={tagline} onChange={e => setTagline(e.target.value)} className="mt-1" /></div>
              <div><Label className="text-slate-700 font-bold">Corporate Vision Text (Home Page)</Label><Textarea rows={3} value={visionText} onChange={e => setVisionText(e.target.value)} className="mt-1 text-sm bg-white" placeholder="Empowering every young individual..." /></div>
              <div><Label className="text-slate-700 font-bold">About Us (Home Page)</Label><Textarea rows={8} value={aboutUs} onChange={e => setAboutUs(e.target.value)} className="mt-1 text-sm bg-white" placeholder="Write the About Us text shown on the public homepage." /></div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="tender-shadow border-0 ring-1 ring-slate-200">
        <CardHeader className="pb-4 bg-slate-50/50 border-b">
          <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><MonitorPlay className="w-5 h-5 text-slate-500" /> Auto-Sliding Home Banners</CardTitle>
          <CardDescription>Upload wide/horizontal images to slide on the public home page.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
           <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
              {banners.map((b, i) => (
                 <div key={i} className="relative group rounded-lg overflow-hidden border-2 border-slate-200 shadow-sm">
                    <img src={typeof b === 'string' ? b : b.src} alt={`Banner ${i}`} className="w-full h-24 object-cover" />
                    <button onClick={() => removeBanner(i)} className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white p-1.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition"><Trash2 className="w-3 h-3"/></button>
                 </div>
              ))}
              <label className="border-2 border-dashed border-blue-300 bg-blue-50 rounded-lg flex flex-col items-center justify-center h-24 cursor-pointer hover:bg-blue-100 transition shadow-sm">
                 <UploadCloud className="w-6 h-6 text-blue-500 mb-1"/>
                 <span className="text-[10px] font-bold text-blue-700 uppercase">Upload Banner</span>
                 <input type="file" accept="image/*" onChange={onBannerUpload} className="hidden"/>
              </label>
           </div>
        </CardContent>
      </Card>

      <Card className="tender-shadow border-0 ring-1 ring-slate-200">
        <CardHeader className="pb-4 bg-slate-50/50 border-b">
          <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><Trophy className="w-5 h-5 text-slate-500" /> "Our Leaders" Profiles</CardTitle>
          <CardDescription>Add MDs, Directors, or core team members to show on the website.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
           {leaders.length > 0 && (
             <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6 pb-6 border-b border-slate-100">
                {leaders.map((ld, i) => (
                   <div key={i} className="flex items-center gap-3 bg-white p-3 rounded-xl border border-slate-200 relative shadow-sm group">
                      <img src={ld.image} alt={ld.name} className="w-14 h-14 rounded-full object-cover border-2 border-emerald-100 shrink-0" />
                      <div className="min-w-0 pr-6">
                         <h5 className="font-black text-sm text-[#0A2647] truncate">{ld.name}</h5>
                         <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-wider mb-1">{ld.role}</p>
                         <p className="text-[9px] text-slate-500 truncate flex items-center gap-1"><PhoneCall className="w-2.5 h-2.5"/> {ld.phone || 'N/A'}</p>
                         <p className="text-[9px] text-slate-500 truncate flex items-center gap-1"><Mail className="w-2.5 h-2.5"/> {ld.email || 'N/A'}</p>
                      </div>
                      <button onClick={() => removeLeader(i)} className="absolute top-2 right-2 text-red-300 hover:text-red-600 bg-slate-50 hover:bg-red-50 p-1.5 rounded opacity-0 group-hover:opacity-100 transition"><Trash2 className="w-3.5 h-3.5"/></button>
                   </div>
                ))}
             </div>
           )}

           <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
              <h5 className="font-bold text-sm text-slate-700 flex items-center gap-2 mb-4"><UserPlus className="w-4 h-4 text-blue-600"/> Add New Leader Profile</h5>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                 <div><Label className="text-xs font-bold text-slate-600">Full Name *</Label><Input placeholder="e.g. John Doe" value={newLeader.name} onChange={e=>setNewLeader({...newLeader, name: e.target.value})} className="h-9 text-xs bg-white mt-1"/></div>
                 <div><Label className="text-xs font-bold text-slate-600">Designation / Role *</Label><Input placeholder="e.g. Managing Director" value={newLeader.role} onChange={e=>setNewLeader({...newLeader, role: e.target.value})} className="h-9 text-xs bg-white mt-1"/></div>
                 <div><Label className="text-xs font-bold text-slate-600">Phone (Optional)</Label><Input placeholder="+91 00000 00000" value={newLeader.phone} onChange={e=>setNewLeader({...newLeader, phone: e.target.value})} className="h-9 text-xs bg-white mt-1"/></div>
                 <div><Label className="text-xs font-bold text-slate-600">Email (Optional)</Label><Input placeholder="email@tgtenders.in" value={newLeader.email} onChange={e=>setNewLeader({...newLeader, email: e.target.value})} className="h-9 text-xs bg-white mt-1"/></div>
                 
                 <div className="sm:col-span-2 lg:col-span-4 flex flex-col sm:flex-row gap-3 items-center mt-2 border-t border-slate-200 pt-4">
                    <label className={`flex-1 w-full border ${newLeader.image ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white hover:bg-slate-100'} px-4 py-2 rounded-md text-xs font-bold cursor-pointer transition flex items-center justify-center gap-2`}>
                       <UploadCloud className="w-4 h-4"/> {newLeader.image ? 'Professional Photo Selected ✓' : 'Upload Professional Photo *'}
                       <input type="file" accept="image/*" onChange={(e)=>takeImageFile(e, ({ url, file }) => setNewLeader((prev) => ({ ...prev, image: url, imageFile: file })))} className="hidden"/>
                    </label>
                    <Button type="button" onClick={addLeader} className="flex-1 w-full bg-blue-600 hover:bg-blue-700 h-9 text-xs shadow-sm"><Plus className="w-4 h-4 mr-1"/> Add to Leaders List</Button>
                 </div>
              </div>
           </div>
        </CardContent>
      </Card>

      <Card className="tender-shadow border-0 ring-1 ring-slate-200">
        <CardHeader className="pb-4 bg-slate-50/50 border-b">
          <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><Building2 className="w-5 h-5 text-emerald-600" /> "Our Clients" Showcase</CardTitle>
          <CardDescription>Add prestigious clients to display on the public homepage.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
           {clients.length > 0 && (
             <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6 pb-6 border-b border-slate-100">
                {clients.map((cl, i) => (
                   <div key={i} className="flex items-center gap-3 bg-white p-3 rounded-xl border border-slate-200 relative shadow-sm group">
                      <img src={cl.image} alt={cl.company_name} className="w-14 h-14 rounded-md object-cover border border-slate-200 shrink-0 p-1" />
                      <div className="min-w-0 pr-6">
                         <h5 className="font-black text-sm text-[#0A2647] truncate">{cl.company_name}</h5>
                         <p className="text-[10px] text-slate-500 font-bold mb-1 truncate">{cl.client_name}</p>
                         <Badge className="bg-slate-100 text-slate-700 border-0 h-4 text-[9px] px-1.5 py-0 font-mono">UDYAM: {cl.udyam_no || 'N/A'}</Badge>
                      </div>
                      <button onClick={() => removeClient(i)} className="absolute top-2 right-2 text-red-300 hover:text-red-600 bg-slate-50 hover:bg-red-50 p-1.5 rounded opacity-0 group-hover:opacity-100 transition"><Trash2 className="w-3.5 h-3.5"/></button>
                   </div>
                ))}
             </div>
           )}

           <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
              <h5 className="font-bold text-sm text-slate-700 flex items-center gap-2 mb-4"><PlusCircle className="w-4 h-4 text-emerald-600"/> Add New Client to Showcase</h5>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                 <div><Label className="text-xs font-bold text-slate-600">Company Name *</Label><Input placeholder="e.g. Tata Projects" value={newClient.company_name} onChange={e=>setNewClient({...newClient, company_name: e.target.value})} className="h-9 text-xs bg-white mt-1"/></div>
                 <div><Label className="text-xs font-bold text-slate-600">Client / Owner Name *</Label><Input placeholder="e.g. Mr. Sharma" value={newClient.client_name} onChange={e=>setNewClient({...newClient, client_name: e.target.value})} className="h-9 text-xs bg-white mt-1"/></div>
                 <div><Label className="text-xs font-bold text-slate-600">UDYAM / Registration No</Label><Input placeholder="e.g. UDYAM-TS-02-XXXX" value={newClient.udyam_no} onChange={e=>setNewClient({...newClient, udyam_no: e.target.value})} className="h-9 text-xs bg-white mt-1"/></div>
                 
                 <div className="sm:col-span-2 lg:col-span-3 flex flex-col sm:flex-row gap-3 items-center mt-2 border-t border-slate-200 pt-4">
                    <label className={`flex-1 w-full border ${newClient.image ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white hover:bg-slate-100'} px-4 py-2 rounded-md text-xs font-bold cursor-pointer transition flex items-center justify-center gap-2`}>
                       <UploadCloud className="w-4 h-4"/> {newClient.image ? 'Company Logo Selected ✓' : 'Upload Company Logo *'}
                       <input type="file" accept="image/*" onChange={(e)=>takeImageFile(e, ({ url, file }) => setNewClient((prev) => ({ ...prev, image: url, imageFile: file })))} className="hidden"/>
                    </label>
                    <Button type="button" onClick={addClient} className="flex-1 w-full bg-emerald-600 hover:bg-emerald-700 h-9 text-xs shadow-sm"><Plus className="w-4 h-4 mr-1"/> Add to Public Showcase</Button>
                 </div>
              </div>
           </div>
        </CardContent>
      </Card>
      
      <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg text-center flex items-center justify-center gap-3">
         <AlertTriangle className="w-5 h-5 text-amber-500"/>
         <span className="text-xs font-bold text-amber-800">Don't forget to click <strong className="text-[#0A2647]">Save All Settings</strong> at the top after making changes!</span>
      </div>
    </div>
  );
}
