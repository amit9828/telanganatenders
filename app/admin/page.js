'use client';
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react'; 
import BrandLogo from '@/components/BrandLogo';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from 'sonner';
import {
  ShieldCheck, LogOut, Upload, FileText, Users, IndianRupee, Trash2, Plus, PlusCircle,
  Image as ImageIcon, Lock, MessageSquare, Send, TrendingDown, Clock, UserCheck, 
  CheckCircle2, Loader2, Eye, UserPlus, Briefcase, ClipboardList, Key, Mail, 
  Activity, BarChart3, EyeOff, UserCog, MapPin, Target, LogIn, UploadCloud, 
  PhoneCall, Database, Wallet, ArrowDownRight, ArrowUpRight, FileUp, Pencil, 
  FolderPlus, RefreshCw, Trophy, X, XCircle, MonitorPlay, Search, AlertTriangle, Building2, PenTool
} from 'lucide-react';

const DISTRICTS = [
  'Hyderabad', 'Adilabad', 'Nizamabad', 'Karimnagar', 'Medak', 'Ranga Reddy',
  'Mahabubnagar', 'Nalgonda', 'Warangal', 'Khammam', 'Sangareddy',
  'Medchal-Malkajgiri', 'Siddipet', 'Vikarabad',
  'Visakhapatnam', 'Vijayawada (NTR)', 'Guntur', 'Tirupati', 'Nellore',
  'Kurnool', 'Anantapur', 'Kadapa (YSR)', 'Kakinada', 'Eluru',
  'Srikakulam', 'Vizianagaram', 'Prakasam'
];

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

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [authChecking, setAuthChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('reports');

  // --- CORE DATA STATES ---
  const [tenders, setTenders] = useState([]);
  const [stats, setStats] = useState({ tenders: 0, users: 0, payments: 0, revenue: 0 });
  const [tickets, setTickets] = useState([]);
  const [guestQueries, setGuestQueries] = useState([]);
  const [ticketReply, setTicketReply] = useState({}); 
  const [l1Data, setL1Data] = useState({}); 
  const [pendingUsers, setPendingUsers] = useState([]);
  const [approvedClients, setApprovedClients] = useState([]);

  // Reports Filter & Real Data Arrays
  const [timeRange, setTimeRange] = useState('monthly'); 
  const [clientReports, setClientReports] = useState([]);
  const [employeeReports, setEmployeeReports] = useState([]);

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
  const [dispatches, setDispatches] = useState([]);
  const [bidRequests, setBidRequests] = useState([]);
  const [bidReply, setBidReply] = useState({});
  const [bidAssignee, setBidAssignee] = useState({});

  // Tender Publisher State
  const [form, setForm] = useState({
    title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: '', bid_no: ''
  });
  const [pdfBase64, setPdfBase64] = useState('');
  const [pdfName, setPdfName] = useState('');
  const [isEditingTender, setIsEditingTender] = useState(null);
  const [tenderSearch, setTenderSearch] = useState('');

  const [rejectReason, setRejectReason] = useState({});

  // State for aggregating all successful payments live
  const [successfulPaymentsLog, setSuccessfulPaymentsLog] = useState([]);

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('tt_admin') : '';
    if (t) setToken(t);
    setAuthChecking(false);
  }, []);

  // 🚀 FIX: Admin Live Tracking (Auto-Refresh without Cache)
  useEffect(() => {
    if (token) {
      refresh();
      const interval = setInterval(() => { refresh(); }, 10000); 
      return () => clearInterval(interval);
    }
    // eslint-disable-next-line
  }, [token]);

  const refresh = async () => {
    const headers = { Authorization: `Bearer ${token}` };
    try {
      // 🚀 FIX: ఇక్కడ ఆల్ రెడీ నువ్వు t=Date.now() రాసావు, కానీ మనం పైన 12 బదులు 10 సెకన్లకు మార్చాం
      const [tRes, sRes, tkRes, uRes, aRes, reqRes, dispRes, empRes, ledgerRes, guestQRes, finReqRes] = await Promise.all([
        fetch(`/api/tenders?t=${Date.now()}`, { headers }),
        fetch(`/api/admin/stats?t=${Date.now()}`, { headers }),
        fetch(`/api/tickets?role=admin&t=${Date.now()}`, { headers }),
        fetch(`/api/users/pending?t=${Date.now()}`, { headers }),
        fetch(`/api/users/approved?t=${Date.now()}`, { headers }), 
        fetch(`/api/client-requests?t=${Date.now()}`, { headers }),
        fetch(`/api/dispatches?t=${Date.now()}`, { headers }),       
        fetch(`/api/employees?t=${Date.now()}`, { headers }), 
        fetch(`/api/finance/ledger?t=${Date.now()}`, { headers }),
        fetch(`/api/guest-queries?t=${Date.now()}`, { headers }),
        fetch(`/api/payments/requests?t=${Date.now()}`, { headers }).catch(() => ({ ok: false }))
      ]);
      
      if (tRes.status === 401) return logout();
      
      const tJson = await tRes.json();
      const sJson = await sRes.json();
      const tkJson = tkRes.ok ? await tkRes.json() : { tickets: [] };
      const uJson = uRes.ok ? await uRes.json() : { users: [] };
      const aJson = aRes.ok ? await aRes.json() : { users: [] }; 
      const reqJson = reqRes.ok ? await reqRes.json() : { requests: [] };
      const dispJson = dispRes.ok ? await dispRes.json() : { dispatches: [] };
      const empJson = empRes.ok ? await empRes.json() : { team: [] };
      const ledgerJson = ledgerRes.ok ? await ledgerRes.json() : { transactions: [], balance: 0 };
      const guestJson = guestQRes.ok ? await guestQRes.json() : { queries: [] }; 
      const finReqJson = finReqRes.ok ? await finReqRes.json() : { requests: [] };

      setTenders(tJson.tenders || []);
      setStats(sJson || {});
      setTickets(tkJson.tickets || []);
      setGuestQueries(guestJson.queries || guestJson['guest-queries'] || []); 
      setPendingUsers(uJson.users || []);
      setApprovedClients(aJson.users || []); 
      setBidRequests(reqJson.requests || []);
      setDispatches(dispJson.dispatches || []);
      setTeamMembers(empJson.team || []);
      setLedgerTxns(ledgerJson.transactions || []);
      
      setFinancialRequests((finReqJson.requests || []).filter(r => r.status !== 'SUCCESS' && r.status !== 'PAID')); 
      
      const allSuccess = [];
      (aJson.users || []).forEach(client => {
          if (client.payments && client.payments.length > 0) {
              client.payments.filter(p => p.status === 'SUCCESS').forEach(p => {
                  allSuccess.push({ ...p, client_name: client.company_name || client.name, email: client.email });
              });
          }
      });
      setSuccessfulPaymentsLog(allSuccess.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));

      const onlineRevenue = sJson.revenue || 0;
      const offlineBal = ledgerJson.balance || 0;
      setBreakdown({ offline: offlineBal, online: onlineRevenue });
      setLedgerBalance(offlineBal + onlineRevenue);

      setClientReports((aJson.users || []).map(c => {
         const wonBids = (c.bids || []).filter(b => b.status === 'Won').length || c.stats?.won || 0;
         const participated = (c.bids || []).length || c.stats?.participated || 0;
         return {
             id: c.email, name: c.company_name || c.name || 'Unknown',
             total: participated, won: wonBids, lost: participated - wonBids
         };
      }));
      
      setEmployeeReports((empJson.team || []).map(e => {
         const completedTasks = dispJson.dispatches?.filter(d => d.target_id === e.emp_id && d.status === 'Completed').length || 0;
         const assignedTasks = dispJson.dispatches?.filter(d => d.target_id === e.emp_id).length || 1;
         const effScore = Math.min(100, Math.round((completedTasks / assignedTasks) * 100) + 20); 
         return { id: e.emp_id, name: e.name, role: e.role, login: 'Active', efficiency: effScore };
      }));
    } catch (err) { console.error('Refresh failed:', err); }
  };
  const logout = () => {
    if (typeof window !== 'undefined') {
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = '/';
    }
  };

  const onPdfChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') return toast.error('Please upload a PDF file');
    if (file.size > 4 * 1024 * 1024) return toast.error('PDF file is too large! Please upload under 4MB.');
    const reader = new FileReader();
    reader.onload = () => { setPdfBase64(reader.result?.toString().split(',')[1] || ''); setPdfName(file.name); toast.success(`PDF loaded: ${file.name}`); };
    reader.readAsDataURL(file);
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
    if (!form.title || !form.department || !form.last_date || !form.district) return toast.error('Fill all required fields');
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
      if (!r.ok) return toast.error(`Server Error (${r.status})`);
      
      toast.success(isEditingTender ? `Tender updated successfully!` : `Tender published successfully!`);
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

  const filteredTenders = tenders.filter(t => 
     t.bid_no?.toLowerCase().includes(tenderSearch.toLowerCase()) || 
     t.title?.toLowerCase().includes(tenderSearch.toLowerCase()) ||
     t.department?.toLowerCase().includes(tenderSearch.toLowerCase())
  );

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

  const approveClient = async (email) => {
    try {
      await fetch('/api/users/approve', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ email }) });
      toast.success('✅ Client Verified & Portal Unlocked!'); refresh();
    } catch(e) { toast.error('Network Error while approving.'); }
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

  const impersonateUser = async (type, email_or_id) => {
    const toastId = toast.loading(`Authenticating secure MD bypass into ${type} dashboard...`);
    try {
        const res = await signIn('impersonate', { 
           email: email_or_id, 
           adminToken: 'admin_success', 
           redirect: false 
        });

        if (res?.error) {
           toast.error("Bypass Authentication Failed!", { id: toastId });
        } else {
           toast.success("Bypass Successful! Opening Real Dashboard...", { id: toastId });
           setTimeout(() => {
              window.open(`/${type}`, '_blank');
           }, 800);
        }
    } catch (e) {
        toast.error("Network Error during authentication.", { id: toastId });
    }
  };

  const handleVerifyVaultDoc = async (clientEmail, docId, status) => {
      let reason = '';
      if (status === 'rejected') {
          reason = rejectReason[`${clientEmail}_${docId}`];
          if (!reason) return toast.error("Please provide a rejection reason so the client can fix it.");
      }

      try {
          const res = await fetch('/api/vault/verify', {
             method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
             body: JSON.stringify({ email: clientEmail, docId: docId, status: status, reject_reason: reason })
          });
          
          if (res.ok) {
              toast.success(`Document marked as ${status.toUpperCase()}!`);
              if (status === 'rejected') setRejectReason(prev => ({...prev, [`${clientEmail}_${docId}`]: ''}));
              refresh();
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

  const handleProcessBidRequest = async (reqId, status) => {
    const reply = bidReply[reqId];
    const assigneeId = bidAssignee[reqId];
    if(status === 'Assigned' && !assigneeId) return toast.error('Please select an employee from the dropdown to assign.');
    try {
      let endpoint = '/api/client-requests/reply';
      let payload = { req_id: reqId, status: status, reply: reply || 'Processed by MD' };
      if (status === 'Assigned' && assigneeId) {
         const emp = teamMembers.find(t => t.emp_id === assigneeId);
         endpoint = '/api/client-requests/assign';
         payload = { req_id: reqId, emp_id: emp.emp_id, emp_name: emp.name, status: 'Assigned', reply: reply || 'Assigned to Employee' };
      }
      const res = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if(res.ok) { toast.success(`Client Request ${status}!`); setBidReply(prev => ({...prev, [reqId]: ''})); setBidAssignee(prev => ({...prev, [reqId]: ''})); refresh(); } 
      else { toast.error("Failed to update status."); }
    } catch(err) { toast.error("Network Error."); }
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

  const deleteDispatch = async (id, isRequest = true) => {
     if(!confirm("Permanently delete this task?")) return;
     if(isRequest) {
         setBidRequests(prev => prev.filter(r => r._id !== id));
         await fetch(`/api/client-requests?id=${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
     } else {
         setDispatches(prev => prev.filter(d => d._id !== id));
         await fetch(`/api/dispatches?id=${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
     }
     toast.success("Deleted permanently.");
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
const handleViewDocument = (req) => {
    // 🚀 FIX: MongoDB లో క్లయింట్ ఫైల్ సేవ్ అయ్యే అన్ని రకాల పేర్లను ఇక్కడ యాడ్ చేశాను
    const docLink = req.file_url || req.document_url || req.file || req.attachment || req.pdf || req.document || req.uploaded_file || req.client_file;
    
    if (docLink) {
       const finalUrl = docLink.startsWith('http') ? docLink : (docLink.startsWith('/') ? docLink : `/uploads/${docLink}`);
       window.open(finalUrl, '_blank');
    } else if (req.link_or_id && req.link_or_id.startsWith('http')) {
       window.open(req.link_or_id, '_blank');
    } else { 
       toast.info("No file attached. The link/ID reference is shown above."); 
    }
  };;

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
              toast.error("Failed to cancel payment.");
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

  if (authChecking) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/></div>;
  if (!token) { if (typeof window !== 'undefined') window.location.replace('/'); return null; }

  const activeTickets = tickets.filter(t => t.status === 'OPEN');
  const resolvedTickets = tickets.filter(t => t.status === 'RESOLVED');

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="bg-[#0A2647] text-white border-b sticky top-0 z-40 shadow-sm">
        <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
             <ShieldCheck className="w-6 h-6 text-[#16a34a]" />
             <div>
               <h1 className="font-bold text-lg leading-tight tracking-wide">MD Command Center</h1>
               <p className="text-[10px] text-emerald-300 font-mono tracking-widest">ENTERPRISE ADMINISTRATION</p>
             </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={refresh} className="text-xs sm:text-sm text-sky-300 hover:text-white hover:bg-slate-800"><RefreshCw className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">Sync Live</span></Button>
            <Button variant="outline" size="sm" onClick={() => window.open('/', '_blank')} className="text-xs sm:text-sm bg-transparent border-slate-600 text-slate-200 hover:text-white hover:bg-slate-800">View Public Site</Button>
            <Button variant="ghost" size="sm" onClick={logout} className="text-xs sm:text-sm text-red-400 hover:text-red-300 hover:bg-red-900/50"><LogOut className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">Secure Logout</span></Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex flex-wrap w-full bg-white shadow-sm border border-slate-200 h-auto p-1.5 rounded-lg mb-4">
            <TabsTrigger value="reports" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md"><BarChart3 className="w-4 h-4 mr-2 hidden sm:block"/> Master Reports</TabsTrigger>
            <TabsTrigger value="clients" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md"><UserCheck className="w-4 h-4 mr-2 hidden sm:block"/> Client CRM</TabsTrigger>
            <TabsTrigger value="finance" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white font-semibold rounded-md"><IndianRupee className="w-4 h-4 mr-2 hidden sm:block"/> Finance Hub</TabsTrigger>
            <TabsTrigger value="team" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-blue-700 data-[state=active]:text-white font-semibold rounded-md"><UserCog className="w-4 h-4 mr-2 hidden sm:block"/> Team Directory</TabsTrigger>
            <TabsTrigger value="operations" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-purple-700 data-[state=active]:text-white font-semibold rounded-md"><ClipboardList className="w-4 h-4 mr-2 hidden sm:block"/> Operations</TabsTrigger>
            <TabsTrigger value="publisher" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md"><FileText className="w-4 h-4 mr-2 hidden sm:block"/> Publisher</TabsTrigger>
            <TabsTrigger value="tickets" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md"><MessageSquare className="w-4 h-4 mr-2 hidden sm:block"/> Helpdesk</TabsTrigger>
            <TabsTrigger value="settings" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md"><ShieldCheck className="w-4 h-4 mr-2 hidden sm:block"/> Setup</TabsTrigger>
          </TabsList>

          {/* ==================== 1. MASTER REPORTS ==================== */}
          <TabsContent value="reports" className="space-y-4">
            <div className="flex justify-between items-center bg-white p-3 rounded-xl shadow-sm border border-slate-200">
               <h2 className="font-bold text-[#0A2647] flex items-center gap-2"><Activity className="w-5 h-5 text-blue-600"/> Consultancy Performance</h2>
               <div className="bg-slate-100 p-1 rounded-lg flex gap-1">
                  <Button size="sm" variant={timeRange === 'daily' ? 'default' : 'ghost'} onClick={()=>setTimeRange('daily')} className={`h-7 text-xs ${timeRange === 'daily' ? 'bg-[#0A2647] text-white' : ''}`}>Daily</Button>
                  <Button size="sm" variant={timeRange === 'weekly' ? 'default' : 'ghost'} onClick={()=>setTimeRange('weekly')} className={`h-7 text-xs ${timeRange === 'weekly' ? 'bg-[#0A2647] text-white' : ''}`}>Weekly</Button>
                  <Button size="sm" variant={timeRange === 'monthly' ? 'default' : 'ghost'} onClick={()=>setTimeRange('monthly')} className={`h-7 text-xs ${timeRange === 'monthly' ? 'bg-[#0A2647] text-white' : ''}`}>Monthly</Button>
               </div>
            </div>
            
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div onClick={() => setActiveTab('publisher')} className="cursor-pointer transition hover:scale-[1.01]">
                 <StatCard icon={<FileText className="w-4 h-4 text-blue-500" />} label="Tenders" value={tenders.length} />
              </div>
              <div onClick={() => setActiveTab('operations')} className="cursor-pointer transition hover:scale-[1.01]">
                 <StatCard icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} label="Operations" value={dispatches.length + bidRequests.length} />
              </div>
              <div onClick={() => setActiveTab('clients')} className="cursor-pointer transition hover:scale-[1.01]">
                 <StatCard icon={<Users className="w-4 h-4 text-purple-500" />} label="Total Clients" value={approvedClients.length} />
              </div>
              <div onClick={() => setActiveTab('clients')} className="cursor-pointer transition hover:scale-[1.01]">
                 <StatCard icon={<UserPlus className="w-4 h-4 text-orange-500" />} label="Pending Appr." value={pendingUsers.length} accent={pendingUsers.length > 0} />
              </div>
              <div onClick={() => setActiveTab('finance')} className="cursor-pointer transition hover:scale-[1.01]">
                 <StatCard icon={<Wallet className="w-4 h-4 text-emerald-600" />} label="Net Balance" value={`₹${ledgerBalance.toLocaleString()}`} />
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
               <Card className="shadow-sm border-0 ring-1 ring-slate-200">
                  <CardHeader className="bg-slate-50 border-b pb-3"><CardTitle className="text-sm text-[#0A2647] flex items-center gap-2"><Clock className="w-4 h-4 text-slate-500"/> Workforce Efficiency & Logs</CardTitle></CardHeader>
                  <CardContent className="pt-4 space-y-4 max-h-[300px] overflow-y-auto">
                     {employeeReports.length === 0 ? <p className="text-center text-sm text-slate-400 py-6">No active employees found.</p> : (
                       <table className="w-full text-sm text-left border-collapse">
                          <thead className="text-[10px] text-slate-500 uppercase font-bold bg-slate-100 border-b">
                             <tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Efficiency</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                             {employeeReports.map(emp => (
                                <tr key={emp.id} className="hover:bg-slate-50">
                                   <td className="px-3 py-2"><p className="font-bold text-[#0A2647]">{emp.name}</p><p className="text-[9px] text-slate-400">{emp.id} • {emp.role}</p></td>
                                   <td className="px-3 py-2 font-semibold text-emerald-700">{emp.login}</td>
                                   <td className="px-3 py-2"><div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden"><div className={`h-full ${emp.efficiency >= 90 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{width: `${emp.efficiency}%`}}></div></div><span className="font-bold text-xs">{emp.efficiency}%</span></td>
                                </tr>
                             ))}
                          </tbody>
                       </table>
                     )}
                  </CardContent>
               </Card>
               <Card className="shadow-sm border-0 ring-1 ring-slate-200">
                  <CardHeader className="bg-slate-50 border-b pb-3"><CardTitle className="text-sm text-[#0A2647] flex items-center gap-2"><Target className="w-4 h-4 text-slate-500"/> Consultancy Funnel (Business Conversion)</CardTitle></CardHeader>
                  <CardContent className="pt-4 space-y-4 max-h-[300px] overflow-y-auto">
                     {clientReports.length === 0 ? <p className="text-center text-sm text-slate-400 py-6">No verified clients yet.</p> : (
                       <table className="w-full text-sm text-left border-collapse">
                          <thead className="text-[10px] text-slate-500 uppercase font-bold bg-slate-100 border-b">
                             <tr><th className="px-3 py-2">Client</th><th className="px-3 py-2">Applied</th><th className="px-3 py-2 text-emerald-600">Won</th><th className="px-3 py-2 text-red-600">Lost</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                             {clientReports.map(cr => (
                                <tr key={cr.id} className="hover:bg-slate-50">
                                   <td className="px-3 py-2"><p className="font-bold text-[#0A2647]">{cr.name}</p><p className="text-[9px] text-slate-400">{cr.id}</p></td>
                                   <td className="px-3 py-2 font-bold text-slate-700">{cr.total}</td>
                                   <td className="px-3 py-2 font-black text-emerald-600">{cr.won}</td>
                                   <td className="px-3 py-2 font-bold text-red-500">{cr.lost}</td>
                                </tr>
                             ))}
                          </tbody>
                       </table>
                     )}
                  </CardContent>
               </Card>
            </div>
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
                                            <Button size="sm" onClick={() => handleVerifyVaultDoc(client.email, doc.id, 'verified')} className="flex-1 bg-[#16a34a] hover:bg-[#15803d] h-8 text-xs"><CheckCircle2 className="w-3.5 h-3.5 mr-1"/> Approve</Button>
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

            <Card className="tender-shadow border-t-4 border-t-[#16a34a]">
              <CardHeader className="bg-emerald-50/50 border-b pb-4">
                <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><UserCheck className="w-5 h-5 text-[#16a34a]" /> Enterprise Client Approvals</CardTitle>
                <CardDescription>Review and approve new client registrations to unlock their portals.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 max-h-[600px] overflow-y-auto">
                {pendingUsers.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-400 mb-3" />
                    <p className="font-semibold text-lg text-slate-600">Zero Pending Approvals</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {pendingUsers.map(user => {
                      const safeId = user?.email ? `CLI-${user.email.substring(0,4).toUpperCase()}X` : 'CLI-XXXX';
                      return (
                      <div key={user._id} className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm flex flex-col xl:flex-row gap-5 justify-between items-start hover:shadow-md transition">
                        <div className="flex-1 w-full">
                          <div className="flex justify-between items-start mb-3">
                             <div>
                               <h4 className="font-black text-[#0A2647] text-xl">{user.company_name || 'Unnamed Company'}</h4>
                               <div className="flex gap-2 text-xs font-semibold text-slate-500 mt-1">
                                 <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200 font-mono tracking-widest text-[10px]">{safeId}</Badge> 
                                 <span className="flex items-center"><Mail className="w-3 h-3 mr-1 text-slate-400"/>{user.email}</span>
                               </div>
                             </div>
                             <Badge className="bg-amber-100 text-amber-800 border-0 uppercase tracking-widest text-[10px]">Awaiting Approval</Badge>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-xs bg-slate-50 p-4 rounded-lg border border-slate-100">
                             <div><span className="font-bold text-slate-400 uppercase text-[10px] block mb-0.5"><PhoneCall className="w-3 h-3 inline mr-1"/>Contact</span> <span className="text-slate-800 font-semibold text-sm">{user.phone || 'Not Provided'}</span></div>
                             <div><span className="font-bold text-slate-400 uppercase text-[10px] block mb-0.5">Company Type</span> <span className="text-slate-800 font-semibold">{user.company_type || 'N/A'}</span></div>
                             <div className="sm:col-span-2"><span className="font-bold text-slate-400 uppercase text-[10px] block mb-0.5">Interested Services</span> <span className="text-slate-800 font-semibold">{user.tender_interest || user.service_category || 'All Categories'}</span></div>
                          </div>
                        </div>
                        <div className="w-full xl:w-[320px] shrink-0 bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col gap-3 shadow-inner">
                          
                          <div className="flex gap-2 w-full">
                             <Button onClick={() => approveClient(user.email)} className="bg-[#16a34a] hover:bg-[#15803d] flex-1 shadow h-10 text-xs"><CheckCircle2 className="w-4 h-4 mr-1" /> Approve</Button>
                             <Button onClick={() => deleteClientPermanently(user.email)} variant="outline" className="flex-1 border-red-300 text-red-600 hover:bg-red-50 shadow h-10 text-xs"><XCircle className="w-4 h-4 mr-1" /> Reject</Button>
                          </div>

                          <div className="flex items-center gap-2 my-1"><div className="flex-1 border-t border-slate-300"></div><span className="text-[10px] uppercase font-bold text-slate-400">MD Access</span><div className="flex-1 border-t border-slate-300"></div></div>
                          <Button onClick={() => impersonateUser('client', user.email)} variant="outline" className="w-full text-[#0A2647] border-slate-300 hover:bg-slate-100"><LogIn className="w-4 h-4 mr-2" /> Login as Client (Bypass)</Button>
                        </div>
                      </div>
                    )})}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="tender-shadow border-t-4 border-t-blue-600 mt-6 w-full">
              <CardHeader className="bg-blue-50/50 border-b pb-4">
                 <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><Briefcase className="w-5 h-5 text-blue-600" /> Active Verified Clients</CardTitle>
                 <CardDescription>Directory of all approved enterprise clients, their stats, and direct portal/drive access.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 max-h-[600px] overflow-y-auto">
                 {approvedClients.length === 0 ? (
                    <div className="text-center py-8 text-slate-400"><Users className="w-10 h-10 mx-auto mb-2 opacity-30" /><p className="text-sm font-semibold">No active verified clients found.</p></div>
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
                                   </div>
                                   <Badge className="bg-emerald-100 text-emerald-800 border-0 h-fit"><CheckCircle2 className="w-3 h-3 mr-1"/> Active</Badge>
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
          <table className="w-full text-sm text-left">
            <thead className="text-[10px] uppercase bg-slate-100 text-slate-500 sticky top-0 z-10">
              <tr><th className="p-2">Date</th><th className="p-2">Desc & Ref</th><th className="p-2 text-right">Amount</th><th className="p-2 w-10"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ledgerTxns.map((txn) => (
                <tr key={txn._id} className="hover:bg-slate-50 group">
                  <td className="p-2 text-xs text-slate-500 whitespace-nowrap align-top">{new Date(txn.created_at).toLocaleDateString()}</td>
                  <td className="p-2 align-top">
                    <p className="font-semibold text-slate-800 text-xs">{txn.reason}</p>
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
                  <td className={`p-2 text-right font-bold text-sm align-top ${txn.type === 'CREDIT' ? 'text-emerald-600' : 'text-red-500'}`}>
                    {txn.type === 'CREDIT' ? '+' : '-'}₹{txn.amount.toLocaleString()}
                  </td>
                  <td className="p-2 align-top text-right opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    <button onClick={() => handleEditLedger(txn)} className="text-blue-500 hover:text-blue-700 mr-2"><Pencil className="w-3.5 h-3.5"/></button>
                    <button onClick={() => handleDeleteLedger(txn._id)} className="text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5"/></button>
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
          <Badge className="bg-emerald-600 text-white border-0">Total: ₹{successfulPaymentsLog.reduce((sum, p) => sum + (Number(p.amount) || 0), 0).toLocaleString()}</Badge>
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
          {/* ==================== 4. TEAM DIRECTORY ==================== */}
          <TabsContent value="team" className="mt-4">
            <div className="grid lg:grid-cols-2 gap-6">
               <Card className="tender-shadow border-t-4 border-t-blue-600 h-fit">
                  <CardHeader className="bg-blue-50/50 border-b pb-4">
                     <CardTitle className="flex items-center gap-2 text-blue-900 text-lg"><Key className="w-5 h-5 text-blue-600" /> Create Enterprise Login ID</CardTitle>
                     <CardDescription>Generate secure Unique IDs (UIDs) and passwords for your internal workforce.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                     <form onSubmit={handleCreateTeamMember} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                           <div className="col-span-2 sm:col-span-1">
                              <Label className="font-bold text-slate-700">Full Name *</Label>
                              <Input placeholder="e.g. Ramesh" value={officerForm.name} onChange={e => setOfficerForm({...officerForm, name: e.target.value})} required className="mt-1" />
                           </div>
                           <div className="col-span-2 sm:col-span-1">
                              <Label className="font-bold text-slate-700">System Role *</Label>
                              <Select value={officerForm.role} onValueChange={v => setOfficerForm({...officerForm, role: v})}>
                                 <SelectTrigger className="mt-1"><SelectValue placeholder="Role" /></SelectTrigger>
                                 <SelectContent>
                                    <SelectItem value="officer">Tender Officer</SelectItem>
                                    <SelectItem value="employee">Data Entry Emp</SelectItem>
                                    <SelectItem value="admin">Manager (MD)</SelectItem>
                                 </SelectContent>
                              </Select>
                           </div>
                        </div>
                        <div>
                           <Label className="font-bold text-slate-700">Official Email *</Label>
                           <Input type="email" placeholder="name@tgtenders.in" value={officerForm.email} onChange={e => setOfficerForm({...officerForm, email: e.target.value})} required className="mt-1" />
                        </div>
                        <div>
                           <Label className="font-bold text-slate-700">Assign Password *</Label>
                           <Input type="text" placeholder="Pass@123" value={officerForm.password} onChange={e => setOfficerForm({...officerForm, password: e.target.value})} required className="mt-1" />
                        </div>
                        <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 shadow-md h-12 text-base mt-2"><UserPlus className="w-5 h-5 mr-2" /> Save & Auto-Generate ID</Button>
                     </form>
                  </CardContent>
               </Card>

               <Card className="tender-shadow border-0 ring-1 ring-slate-200 h-fit">
                  <CardHeader className="bg-slate-50 border-b pb-4">
                     <CardTitle className="text-[#0A2647] text-lg">Database: Active Team & Passwords</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 max-h-[500px] overflow-y-auto">
                     {teamMembers.length === 0 ? (
                        <div className="text-center py-12 text-slate-400"><ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-sm font-semibold">No Team Members Logged Yet.</p></div>
                     ) : (
                        <div className="space-y-4">
                           {teamMembers.map(off => (
                              <div key={off._id} className="p-4 border border-slate-200 rounded-xl bg-white shadow-sm hover:border-blue-300 transition">
                                 <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                       <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-black text-lg">{(off?.name || 'U').charAt(0)}</div>
                                       <div>
                                          <h4 className="font-bold text-[#0A2647] text-sm flex items-center gap-2">{off.name} <Badge className="bg-emerald-100 text-emerald-800 border-0 h-4 text-[9px] px-1.5 py-0">Active</Badge></h4>
                                          <p className="text-[10px] text-slate-500 font-mono tracking-wider mt-0.5">{off.email}</p>
                                       </div>
                                    </div>
                                    <Badge variant="outline" className="text-[10px] font-mono bg-slate-50 border-slate-300">{off.emp_id}</Badge>
                                 </div>
                                 <div className="bg-slate-50 p-2.5 rounded-lg flex justify-between items-center border border-slate-200 mb-3">
                                    <div className="flex flex-col">
                                       <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Current Password</span>
                                       <span className="text-sm font-mono font-bold text-[#0A2647]">{showPwdId === off.emp_id ? off.password : '••••••••'}</span>
                                    </div>
                                    <Button variant="ghost" size="sm" className="h-7 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 font-semibold" onClick={() => setShowPwdId(showPwdId === off.emp_id ? null : off.emp_id)}>
                                       {showPwdId === off.emp_id ? <EyeOff className="w-3.5 h-3.5 mr-1.5"/> : <Eye className="w-3.5 h-3.5 mr-1.5"/>}
                                       {showPwdId === off.emp_id ? 'Hide' : 'Reveal'}
                                    </Button>
                                 </div>
                                 <div className="flex gap-2">
                                    <Button onClick={() => impersonateUser('employee', off.email)} className="flex-1 bg-[#0A2647] hover:bg-[#144272] h-9 text-xs"><LogIn className="w-3.5 h-3.5 mr-1.5" /> Login as {off.role}</Button>
                                    <Button onClick={() => handleRevokeEmployee(off._id)} variant="outline" className="text-red-500 hover:bg-red-50 border-red-200 h-9 px-4">Delete</Button>
                                 </div>
                              </div>
                           ))}
                        </div>
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
                                           {task.file_base64 && (
                                              <Button size="sm" variant="outline" onClick={() => {
                                                  const byteCharacters = atob(task.file_base64);
                                                  const byteNumbers = new Array(byteCharacters.length);
                                                  for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
                                                  const blob = new Blob([new Uint8Array(byteNumbers)], {type: 'application/pdf'});
                                                  window.open(URL.createObjectURL(blob), '_blank');
                                              }} className="mt-2 h-7 text-[10px] text-blue-600 border-blue-200 bg-white w-fit">
                                                 <FileText className="w-3 h-3 mr-1"/> View Attached PDF
                                              </Button>
                                           )}
                                           {task.file_base64 && (
                                              <Button size="sm" variant="outline" onClick={() => {
                                                  const byteCharacters = atob(task.file_base64);
                                                  const byteNumbers = new Array(byteCharacters.length);
                                                  for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
                                                  const blob = new Blob([new Uint8Array(byteNumbers)], {type: 'application/pdf'});
                                                  window.open(URL.createObjectURL(blob), '_blank');
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
                                               <Button size="sm" variant="ghost" onClick={() => deleteDispatch(task._id, false)} className="h-7 text-[10px] text-slate-500 hover:text-red-600 hover:bg-red-50 px-2"><Trash2 className="w-3 h-3"/></Button>
                                           </div>
                                       </div>
                                   )
                               })}
                           </div>
                        )}
                     </CardContent>
                  </Card>
               </div>

               <Card className="tender-shadow border-0 bg-slate-50/50">
                  <CardHeader className="border-b pb-4">
                     <CardTitle className="text-[#0A2647] text-lg flex items-center gap-2"><UploadCloud className="w-5 h-5 text-blue-600"/> Client Bid Support Requests ({bidRequests.length})</CardTitle>
                     <CardDescription>Live database fetch of requests submitted by clients. Assign to employees to track progress.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4 max-h-[850px] overflow-y-auto">
                     {bidRequests.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-400"><UploadCloud className="w-12 h-12 mb-3 opacity-20"/><p className="text-sm font-semibold">No custom bid requests pending.</p></div>
                     ) : (
                        <div className="space-y-4">
                           {bidRequests.map(req => {
                              // 🚀 FIX: ఇక్కడ క్లయింట్ డాక్యుమెంట్ అప్‌లోడ్ చేశాడో లేదో ఖచ్చితంగా చెక్ చేస్తుంది
                              const hasDoc = req.file_url || req.document_url || req.file || req.attachment || req.pdf || req.document || req.uploaded_file || req.client_file || (req.link_or_id && req.link_or_id.startsWith('http'));
                              
                              const matchedTender = tenders.find(t => t.bid_no === req.link_or_id);
                              // 🚀 FIX: ఇది టెండర్ కాదు, క్లయింట్ సొంతంగా పెట్టిన ఫైల్ అని గుర్తుపట్టడానికి
                              const isClientUpload = hasDoc && !matchedTender;

                              return (
                              <div key={req._id} className="p-4 border border-slate-200 rounded-xl bg-white shadow-sm hover:border-blue-300 transition">
                                 <div className="flex justify-between items-start mb-2">
                                    <div>
                                       <Badge className="mb-2 bg-blue-50 text-blue-700 border-blue-200">{req.client_email}</Badge>
                                       <h4 className="font-bold text-[#0A2647] text-sm break-all">{req.link_or_id}</h4>
                                    </div>
                                    <Badge className={req.status === 'Pending Officer Review' ? 'bg-amber-100 text-amber-800 border-0 animate-pulse' : 'bg-emerald-100 text-emerald-800 border-0'}>{req.status}</Badge>
                                 </div>
                                 <p className="text-xs bg-slate-50 p-3 rounded-md border border-slate-100 text-slate-700 font-medium mb-3">"{req.description}"</p>
                                 
                                 {/* 🚀 FIX: క్లయింట్ అప్‌లోడ్ చేస్తే "View Uploaded Document", లేకపోతే "View Original Tender PDF" */}
                                 <Button variant="outline" size="sm" disabled={!hasDoc && !matchedTender} onClick={() => {
                                     if (isClientUpload || !matchedTender) {
                                         handleViewDocument(req);
                                     } else if (matchedTender) {
                                         handleViewPDF(matchedTender._id || matchedTender.id);
                                     }
                                 }} className={`mb-4 w-full sm:w-auto h-8 text-xs ${hasDoc || matchedTender ? 'border-blue-200 text-blue-700 hover:bg-blue-50' : 'text-slate-400 border-slate-200 bg-slate-100'}`}>
                                    <FileText className="w-3.5 h-3.5 mr-1" /> 
                                    {isClientUpload ? "View Uploaded Document" : (matchedTender ? "View Original Tender PDF" : "No Document Attached")}
                                 </Button>

                                 {req.status === 'Pending Officer Review' ? (
                                    <div className="flex flex-col gap-3 border-t pt-3">
                                       <Input placeholder="MD / Officer Reply or Instructions..." className="h-9 text-xs bg-white" value={bidReply[req._id] || ''} onChange={e => setBidReply({...bidReply, [req._id]: e.target.value})} />
                                       
                                       <div className="flex flex-col sm:flex-row gap-2">
                                          <Select value={bidAssignee[req._id] || ''} onValueChange={v => setBidAssignee({...bidAssignee, [req._id]: v})}>
                                             <SelectTrigger className="flex-1 h-8 text-xs bg-white"><SelectValue placeholder="Assign to Employee..."/></SelectTrigger>
                                             <SelectContent>
                                                {teamMembers.map(emp => <SelectItem key={emp.emp_id} value={emp.emp_id}>{emp.name}</SelectItem>)}
                                             </SelectContent>
                                          </Select>
                                          <Button size="sm" className="bg-[#16a34a] hover:bg-[#15803d] h-8" onClick={() => handleProcessBidRequest(req._id, 'Assigned')}><CheckCircle2 className="w-3.5 h-3.5 mr-1"/> Assign & Notify</Button>
                                       </div>
                                       <Button size="sm" variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 h-8 mt-1" onClick={() => handleProcessBidRequest(req._id, 'Rejected')}>Reject Request</Button>
                                    </div>
                                 ) : (
                                    <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 mt-2">
                                       <p className="text-xs text-emerald-800 font-bold mb-1">Status: {req.status}</p>
                                       <p className="text-xs text-slate-700 font-medium">Reply: {req.reply}</p>
                                       <div className="flex gap-2 mt-3 pt-2 border-t border-emerald-200/50">
                                          <Button size="sm" variant="ghost" onClick={()=>handleProcessBidRequest(req._id, 'Pending Officer Review')} className="h-7 text-[10px] text-amber-600 bg-amber-50 hover:bg-amber-100"><RefreshCw className="w-3 h-3 mr-1"/> Re-Query</Button>
                                          <Button size="sm" variant="ghost" onClick={()=>deleteDispatch(req._id, true)} className="h-7 text-[10px] text-red-600 bg-red-50 hover:bg-red-100"><Trash2 className="w-3 h-3 mr-1"/> Delete Permanently</Button>
                                       </div>
                                    </div>
                                 )}
                              </div>
                           )})}
                        </div>
                     )}
                  </CardContent>
               </Card>
            </div>
          </TabsContent>
          {/* ==================== 6. PUBLISHER ==================== */}
          <TabsContent value="publisher" className="mt-4">
            <div className="grid lg:grid-cols-5 gap-4 sm:gap-6">
              <Card className={`border-0 shadow-md lg:col-span-2 h-fit ${isEditingTender ? 'ring-2 ring-blue-500' : ''}`}>
                <CardHeader className="pb-4 border-b border-slate-100 flex flex-row justify-between items-center">
                   <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
                      {isEditingTender ? <><Pencil className="w-5 h-5 text-blue-600"/> Edit Tender</> : <><PlusCircle className="w-5 h-5"/> Publish New Tender</>}
                   </CardTitle>
                   {isEditingTender && (
                      <Button variant="ghost" size="sm" onClick={() => { setIsEditingTender(null); setForm({ bid_no: '', title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: '' }); }} className="h-7 text-xs text-slate-500 hover:text-red-500">Cancel Edit</Button>
                   )}
                </CardHeader>
                <CardContent className="pt-5">
                  <form onSubmit={publish} className="space-y-4">
                    <div><Label className="text-sm font-bold text-[#0A2647] mb-1 block">Bid Number (Internal Use) *</Label><Input required value={form.bid_no} onChange={e=>setForm({...form, bid_no: e.target.value})} placeholder="e.g. GEM/2026/B/..." className="bg-white h-10"/></div>
                    <div><Label className="text-sm font-bold text-[#0A2647] mb-1 block">Document Title (Work) *</Label><Input required value={form.title} onChange={e=>setForm({...form, title: e.target.value})} className="bg-white h-10"/></div>
                    <div><Label className="text-sm font-bold text-[#0A2647] mb-1 block">Department Name *</Label><Input required value={form.department} onChange={e=>setForm({...form, department: e.target.value})} className="bg-white h-10"/></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div><Label className="text-sm font-bold text-[#0A2647] mb-1 block">Last Date *</Label><Input required type="date" value={form.last_date} onChange={e=>setForm({...form, last_date: e.target.value})} className="bg-white h-10 text-sm"/></div>
                      <div>
                        <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Category *</Label>
                        <Select value={form.category} onValueChange={v=>setForm({...form, category: v})}>
                           <SelectTrigger className="bg-white h-10"><SelectValue placeholder="Product" /></SelectTrigger>
                           <SelectContent><SelectItem value="Product">Product</SelectItem><SelectItem value="Service">Service</SelectItem></SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm font-bold text-[#0A2647] mb-1 block">District (TS & AP) *</Label>
                      <Select value={form.district} onValueChange={v=>setForm({...form, district: v})}>
                         <SelectTrigger className="bg-white h-10"><SelectValue placeholder="Select District" /></SelectTrigger>
                         <SelectContent>{DISTRICTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label className="text-sm font-bold text-[#0A2647] mb-1 block">Supply / Tender Details</Label><textarea className="w-full border rounded-md p-3 h-24 text-sm bg-white outline-none focus:ring-1 focus:ring-slate-300" value={form.supply_details} onChange={e=>setForm({...form, supply_details: e.target.value})}></textarea></div>
                    <div>
                      <Label className="text-sm font-bold text-[#0A2647] mb-1 block">PDF Document {isEditingTender && '(Optional to replace)'}</Label>
                      <div className="border-2 border-dashed border-slate-200 rounded-md p-6 text-center bg-slate-50 hover:bg-slate-100 cursor-pointer transition relative group">
                         <input type="file" accept="application/pdf" onChange={onPdfChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                         <UploadCloud className="w-6 h-6 text-[#16a34a] mx-auto mb-2 group-hover:scale-110 transition-transform" />
                         <span className="text-sm font-bold text-[#0A2647]">{pdfName || (isEditingTender ? 'Upload new PDF to replace old' : 'Click to upload PDF')}</span>
                      </div>
                    </div>
                    <Button type="submit" disabled={loading} className={`w-full h-11 text-base font-bold shadow-md ${isEditingTender ? 'bg-blue-600 hover:bg-blue-700' : 'bg-[#16a34a] hover:bg-[#15803d]'}`}>
                       {loading ? (isEditingTender ? 'Updating...' : 'Publishing...') : (isEditingTender ? 'Save Changes' : 'Publish Tender')}
                    </Button>
                  </form>
                </CardContent>
              </Card>

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
                <CardContent className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                  {filteredTenders.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No matching tenders found.</p>}
                  {filteredTenders.map((t) => (
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
                        <div className="flex flex-col gap-2">
                           <Button variant="ghost" size="icon" onClick={() => handleEditTender(t)} className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 h-8 w-8"><Pencil className="w-4 h-4" /></Button>
                           <Button variant="ghost" size="icon" onClick={() => remove(t._id || t.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50 h-8 w-8"><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      </div>
                      
                      <div className="border-t border-slate-100 pt-3 mt-2 flex flex-col sm:flex-row items-center gap-2">
                         <Button size="sm" onClick={() => handleViewPDF(t._id)} variant="outline" className="h-8 text-xs text-blue-600 border-blue-200 shadow-sm shrink-0">
                            <FileText className="w-3 h-3 mr-1.5"/> View PDF
                         </Button>
                         <div className="bg-emerald-50/50 p-1.5 rounded-md border border-emerald-100 flex flex-1 flex-col sm:flex-row gap-2 items-center w-full">
                            <div className="flex items-center gap-1 w-full sm:w-auto text-emerald-800 text-[10px] uppercase font-bold tracking-wider px-1"><TrendingDown className="w-4 h-4" /> L1 Intel</div>
                            <Input placeholder="Price (₹)" type="number" className="h-8 text-xs bg-white w-full sm:w-24 border-emerald-200 focus-visible:ring-emerald-500" value={l1Data[t._id || t.id]?.price || t.l1_price || ''} onChange={e => setL1Data(prev => ({...prev, [t._id || t.id]: {...(prev[t._id || t.id] || {}), price: e.target.value}}))}/>
                            <Input placeholder="Winner Name" className="h-8 text-xs bg-white w-full sm:flex-1 border-emerald-200 focus-visible:ring-emerald-500" value={l1Data[t._id || t.id]?.winner || t.l1_winner || ''} onChange={e => setL1Data(prev => ({...prev, [t._id || t.id]: {...(prev[t._id || t.id] || {}), winner: e.target.value}}))}/>
                            <Button size="sm" className="h-8 text-[10px] w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 shadow-sm px-2" onClick={() => submitL1Price(t._id || t.id)}>Save</Button>
                         </div>
                      </div>
                    </div>
                  ))}
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
                                <h4 className="font-bold text-[#0A2647] text-base">{gq.name}</h4>
                                <Badge className="bg-purple-100 text-purple-800 border-0">New Lead</Badge>
                             </div>
                             <p className="text-sm text-slate-600 mb-2 font-mono"><PhoneCall className="w-3 h-3 inline mr-1"/> {gq.phone}</p>
                             <div className="bg-slate-50 p-3 rounded border border-slate-100 mb-4">
                                <p className="text-xs text-slate-700 italic">"{gq.query}"</p>
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

          <TabsContent value="settings" className="mt-4"><BrandSettings token={token} /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, accent }) {
  return (
    <Card className={`border-0 shadow-sm ring-1 ${accent ? 'ring-emerald-500/50 bg-emerald-50/80' : 'ring-slate-200 bg-white'}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-2 text-muted-foreground text-[11px] sm:text-xs font-bold uppercase tracking-wider mb-2">{icon} {label}</div>
        <div className={`text-2xl sm:text-3xl font-black ${accent ? 'text-emerald-700' : 'text-[#0A2647]'}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function BrandSettings({ token }) {
  const [logoPreview, setLogoPreview] = useState('');
  const [gemLogoPreview, setGemLogoPreview] = useState('');
  const [mdSignaturePreview, setMdSignaturePreview] = useState(''); 
  const [brandName, setBrandName] = useState('Telangana Tenders');
  const [tagline, setTagline] = useState('Official Government Tender Portal');
  const [visionText, setVisionText] = useState('');
  const [banners, setBanners] = useState([]);
  const [leaders, setLeaders] = useState([]);
  const [clients, setClients] = useState([]); 
  const [saving, setSaving] = useState(false);

  const [newLeader, setNewLeader] = useState({ name: '', role: '', image: '', phone: '', email: '' });
  const [newClient, setNewClient] = useState({ client_name: '', company_name: '', udyam_no: '', image: '' });

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((d) => {
      if (d.settings) {
        if (d.settings.logo) setLogoPreview(d.settings.logo);
        if (d.settings.gem_logo) setGemLogoPreview(d.settings.gem_logo);
        if (d.settings.md_signature) setMdSignaturePreview(d.settings.md_signature); 
        if (d.settings.name) setBrandName(d.settings.name);
        if (d.settings.tagline) setTagline(d.settings.tagline);
        if (d.settings.vision_text) setVisionText(d.settings.vision_text);
        if (d.settings.banners) setBanners(d.settings.banners);
        if (d.settings.leaders) setLeaders(d.settings.leaders);
        if (d.settings.clients) setClients(d.settings.clients);
      }
    }).catch((err) => console.error(err));
  }, []);

  const handleImageUpload = (e, setter) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast.error('Please upload an image file');
    if (f.size > 3 * 1024 * 1024) return toast.error('Image too large. Keep under 3 MB.');
    const reader = new FileReader();
    reader.onload = () => { setter(reader.result?.toString() || ''); };
    reader.readAsDataURL(f);
  };

  const onBannerUpload = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) return toast.error('Banner too large. Keep under 4 MB.');
    const reader = new FileReader();
    reader.onload = () => { setBanners(prev => [...prev, reader.result?.toString() || '']); toast.success('Banner added to preview!'); };
    reader.readAsDataURL(f);
  };

  const removeBanner = (index) => {
    if(!confirm("Remove this banner?")) return;
    setBanners(prev => prev.filter((_, i) => i !== index));
  };

  const addLeader = () => {
    if (!newLeader.name || !newLeader.role || !newLeader.image) return toast.error('Name, Role, and Photo are required!');
    setLeaders(prev => [...prev, newLeader]);
    setNewLeader({ name: '', role: '', image: '', phone: '', email: '' });
    toast.success('Leader added to preview list. Click Save Settings to publish.');
  };

  const removeLeader = (index) => {
    if(!confirm("Remove this leader?")) return;
    setLeaders(prev => prev.filter((_, i) => i !== index));
  };

  const addClient = () => {
    if (!newClient.client_name || !newClient.company_name || !newClient.image) return toast.error('Client Name, Company, and Photo are required!');
    setClients(prev => [...prev, newClient]);
    setNewClient({ client_name: '', company_name: '', udyam_no: '', image: '' });
    toast.success('Client added to showcase. Click Save Settings to publish.');
  };

  const removeClient = (index) => {
    if(!confirm("Remove this client?")) return;
    setClients(prev => prev.filter((_, i) => i !== index));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: brandName, 
        tagline: tagline, 
        logo: logoPreview, 
        gem_logo: gemLogoPreview,
        md_signature: mdSignaturePreview,
        vision_text: visionText,
        banners: banners,
        leaders: leaders,
        clients: clients 
      };

      const r = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!r.ok) return toast.error('Failed to save settings to database.');
      toast.success('All Master Settings published successfully!');
    } catch (error) { toast.error('An error occurred while saving.'); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <Card className="tender-shadow border-0 ring-1 ring-slate-200">
        <CardHeader className="pb-4 bg-slate-50/50 border-b flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><ImageIcon className="w-5 h-5 text-slate-500" /> Brand Identity & Logos</CardTitle>
          <Button onClick={save} disabled={saving} className="bg-[#16a34a] hover:bg-[#15803d] shadow-md h-9 text-xs"><ShieldCheck className="w-4 h-4 mr-2"/> {saving ? 'Saving...' : 'Save All Settings'}</Button>
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
                      <label className="cursor-pointer flex-1 text-[10px] font-bold px-2 py-1.5 bg-[#0A2647] hover:bg-[#144272] text-white rounded text-center transition"><input type="file" onChange={(e)=>handleImageUpload(e, setLogoPreview)} className="hidden" />Upload</label>
                      {logoPreview && <button onClick={() => {if(confirm('Remove?')) setLogoPreview('');}} className="text-[10px] font-bold px-2 py-1.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition">Del</button>}
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-center gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 w-full">
                    <p className="text-xs font-bold text-slate-500 uppercase">GeM / Partner Logo</p>
                    <div className="w-24 h-24 rounded-lg border-2 border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden">
                      {gemLogoPreview ? <img src={gemLogoPreview} alt="gem logo" className="w-full h-full object-contain p-1" /> : <ImageIcon className="w-8 h-8 text-slate-300" />}
                    </div>
                    <div className="flex gap-2 w-full">
                      <label className="cursor-pointer flex-1 text-[10px] font-bold px-2 py-1.5 bg-[#0A2647] hover:bg-[#144272] text-white rounded text-center transition"><input type="file" onChange={(e)=>handleImageUpload(e, setGemLogoPreview)} className="hidden" />Upload</label>
                      {gemLogoPreview && <button onClick={() => {if(confirm('Remove?')) setGemLogoPreview('');}} className="text-[10px] font-bold px-2 py-1.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition">Del</button>}
                    </div>
                  </div>
               </div>
               
               <div className="flex flex-col items-center gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 w-full">
                  <p className="text-xs font-bold text-slate-500 uppercase">MD Signature (For Agreements)</p>
                  <div className="w-full h-24 rounded-lg border-2 border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden">
                    {mdSignaturePreview ? <img src={mdSignaturePreview} alt="MD Signature" className="w-full h-full object-contain p-2" /> : <PenTool className="w-8 h-8 text-slate-300" />}
                  </div>
                  <div className="flex gap-2 w-full">
                    <label className="cursor-pointer flex-1 text-[10px] font-bold px-2 py-1.5 bg-[#0A2647] hover:bg-[#144272] text-white rounded text-center transition"><input type="file" onChange={(e)=>handleImageUpload(e, setMdSignaturePreview)} className="hidden" />Upload</label>
                    {mdSignaturePreview && <button onClick={() => {if(confirm('Remove?')) setMdSignaturePreview('');}} className="text-[10px] font-bold px-2 py-1.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition">Del</button>}
                  </div>
               </div>
            </div>
            
            <div className="space-y-4">
              <div><Label className="text-slate-700 font-bold">Portal Brand Name</Label><Input value={brandName} onChange={e => setBrandName(e.target.value)} className="mt-1" /></div>
              <div><Label className="text-slate-700 font-bold">Portal Tagline / Short Desc</Label><Input value={tagline} onChange={e => setTagline(e.target.value)} className="mt-1" /></div>
              <div><Label className="text-slate-700 font-bold">Corporate Vision Text (Home Page)</Label><Textarea rows={3} value={visionText} onChange={e => setVisionText(e.target.value)} className="mt-1 text-sm bg-white" placeholder="Empowering every young individual..." /></div>
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
                    <img src={b} alt={`Banner ${i}`} className="w-full h-24 object-cover" />
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
                       <input type="file" accept="image/*" onChange={(e)=>handleImageUpload(e, (b64) => setNewLeader({...newLeader, image: b64}))} className="hidden"/>
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
                       <input type="file" accept="image/*" onChange={(e)=>handleImageUpload(e, (b64) => setNewClient({...newClient, image: b64}))} className="hidden"/>
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
