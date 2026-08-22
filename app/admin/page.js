'use client';
import { useEffect, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  ShieldCheck, LogOut, Upload, FileText, Users, IndianRupee, Trash2, Plus, 
  Image as ImageIcon, Lock, MessageSquare, Send, TrendingDown, Clock, UserCheck, 
  CheckCircle2, Loader2, Eye, UserPlus, Briefcase, ClipboardList, Key, Mail, 
  Activity, BarChart3, EyeOff, UserCog, MapPin, Target
} from 'lucide-react';

const DISTRICTS = [
  'Hyderabad', 'Adilabad', 'Nizamabad', 'Karimnagar', 'Medak', 'Ranga Reddy',
  'Mahabubnagar', 'Nalgonda', 'Warangal', 'Khammam', 'Sangareddy',
  'Medchal-Malkajgiri', 'Siddipet', 'Vikarabad',
  'Visakhapatnam', 'Vijayawada (NTR)', 'Guntur', 'Tirupati', 'Nellore',
  'Kurnool', 'Anantapur', 'Kadapa (YSR)', 'Kakinada', 'Eluru',
  'Srikakulam', 'Vizianagaram', 'Prakasam'
];

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [authChecking, setAuthChecking] = useState(true);
  const [loading, setLoading] = useState(false);

  // Core Data State
  const [tenders, setTenders] = useState([]);
  const [stats, setStats] = useState({ tenders: 0, users: 0, payments: 0, revenue: 0 });
  const [tickets, setTickets] = useState([]);
  const [ticketReply, setTicketReply] = useState({}); 
  const [l1Data, setL1Data] = useState({}); 
  const [pendingUsers, setPendingUsers] = useState([]);

  // MD Impersonation
  const [selectedClient, setSelectedClient] = useState(null);

  // Architecture V1.0: Reports Filter
  const [timeRange, setTimeRange] = useState('monthly'); 

  // Architecture V1.0: Real Team Member Saving & Passwords
  const [officerForm, setOfficerForm] = useState({ name: '', email: '', password: '', role: 'officer' });
  const [teamMembers, setTeamMembers] = useState([
    { id: 'EMP-802', name: 'Ramesh Kumar', email: 'ramesh@tgtenders.in', password: 'Pass@123', role: 'employee', status: 'Active' },
    { id: 'OFF-105', name: 'Suresh Officer', email: 'suresh@tgtenders.in', password: 'Sec@2026', role: 'officer', status: 'Active' }
  ]); 
  const [showPwdId, setShowPwdId] = useState(null); 

  // Architecture V1.0: Financial Progress Bar State
  const [paymentRequestForm, setPaymentRequestForm] = useState({ client_id: '', amount: '', reason: '' });
  const [financialRequests, setFinancialRequests] = useState([
    { id: 'REQ-9281', client_id: 'CLI-1049 (Balaji Ent)', amount: '1499', reason: 'Yearly Subscription', status: 'paid', sent_time: '09:00 AM', open_time: '09:15 AM', paid_time: '09:20 AM' },
    { id: 'REQ-9282', client_id: 'CLI-2201 (RR Const)', amount: '5000', reason: 'Document Prep Fee', status: 'opened', sent_time: '10:30 AM', open_time: '11:45 AM', paid_time: null }
  ]);

  // Architecture V1.0: Government Officers Directory
  const [govOfficers, setGovOfficers] = useState([
    { id: 1, name: 'K. Narsimha Rao', designation: 'Superintending Engineer', dept: 'R&B Dept', district: 'Hyderabad', phone: '9876543210', met_by: '[EMP-802] Ramesh Kumar', tender_ref: 'Road Extension Works', date: '22-Aug-2026' }
  ]);

  // Operations & Dispatch State
  const [taskForm, setTaskForm] = useState({ target_type: 'employee_task', target_id: '', subject: '', message: '' });
  const [dispatches, setDispatches] = useState([]);

  // Tender Publisher State
  const [form, setForm] = useState({
    title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: '',
  });
  const [pdfBase64, setPdfBase64] = useState('');
  const [pdfName, setPdfName] = useState('');

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('tt_admin') : '';
    if (t) setToken(t);
    setAuthChecking(false);
  }, []);

  useEffect(() => {
    if (token) refresh();
    // eslint-disable-next-line
  }, [token]);

  const refresh = async () => {
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [tRes, sRes, tkRes, uRes] = await Promise.all([
        fetch(`/api/tenders?t=${Date.now()}`, { headers }),
        fetch(`/api/admin/stats?t=${Date.now()}`, { headers }),
        fetch(`/api/tickets?role=admin&t=${Date.now()}`, { headers }),
        fetch(`/api/users/pending?t=${Date.now()}`, { headers }) 
      ]);
      if (tRes.status === 401) {
        logout();
        return;
      }
      const tJson = await tRes.json();
      const sJson = await sRes.json();
      const tkJson = tkRes.ok ? await tkRes.json() : { tickets: [] };
      const uJson = uRes.ok ? await uRes.json() : { users: [] };

      setTenders(tJson.tenders || []);
      setStats(sJson || {});
      setTickets(tkJson.tickets || []);
      setPendingUsers(uJson.users || []); 
    } catch (err) {
      console.error('Refresh failed:', err);
    }
  };

  const logout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('tt_admin');
      window.location.replace('/');
    }
  };

  const onPdfChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') return toast.error('Please upload a PDF file');
    if (file.size > 4 * 1024 * 1024) return toast.error('PDF file is too large! Please upload under 4MB.');
    
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result?.toString() || '';
      const b64 = result.split(',')[1] || '';
      setPdfBase64(b64);
      setPdfName(file.name);
      toast.success(`PDF loaded: ${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  const publish = async (e) => {
    e.preventDefault();
    if (!form.title || !form.department || !form.last_date || !form.district) {
      return toast.error('Fill all required fields');
    }
    setLoading(true);
    try {
      const r = await fetch('/api/tenders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, pdf_base64: pdfBase64, pdf_filename: pdfName || 'tender.pdf' }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return toast.error(d.error || `Server Error (${r.status}) - Try smaller PDF`);
      
      toast.success(`Tender published! ${d.notified || ''} user(s) notified by email.`);
      setForm({ title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: '' });
      setPdfBase64(''); setPdfName('');
      refresh();
    } catch (err) { toast.error('Network Error: File might be too large for server limit.'); } finally { setLoading(false); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this tender?')) return;
    await fetch(`/api/tenders/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    toast.success('Deleted'); refresh();
  };

  const submitTicketReply = async (ticket_id) => {
    const replyText = ticketReply[ticket_id];
    if(!replyText) return toast.error('Please write a reply first.');
    try {
      const r = await fetch('/api/tickets/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ticket_id, reply: replyText, admin_email: 'Admin' })
      });
      if(r.ok) {
        toast.success('Reply Sent & Ticket Resolved!');
        setTicketReply(prev => ({...prev, [ticket_id]: ''}));
        refresh();
      } else toast.error('Failed to send reply');
    } catch(e) { toast.error('Error resolving ticket'); }
  };

  const submitL1Price = async (tender_id) => {
    const data = l1Data[tender_id];
    if (!data?.price) return toast.error('Please enter the L1 Price');
    try {
      const r = await fetch(`/api/tenders/${tender_id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ l1_price: data.price, l1_winner: data.winner })
      });
      toast.success('L1 Price saved for Market Intelligence!');
      refresh();
    } catch(e) { toast.error('Error saving L1 Price'); }
  };

  const approveClient = async (email) => {
    try {
      const r = await fetch('/api/users/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email })
      });
      if(r.ok) { toast.success('Client Approved & Portal Unlocked!'); refresh(); }
    } catch(e) { toast.error('Error approving client'); }
  };

  // --- ARCITECTURE: Financial Link Dispatch & Timeline Tracking ---
  const handleSendPaymentRequest = async (e) => {
    e.preventDefault();
    if(!paymentRequestForm.client_id || !paymentRequestForm.amount || !paymentRequestForm.reason) {
       return toast.error("Fill Client ID, Amount, and Reason");
    }
    const newReq = {
      id: `REQ-${Date.now().toString().slice(-5)}`,
      client_id: paymentRequestForm.client_id,
      amount: paymentRequestForm.amount,
      reason: paymentRequestForm.reason,
      status: 'sent', 
      sent_time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
      open_time: null,
      paid_time: null
    };

    setFinancialRequests(prev => [newReq, ...prev]);
    toast.success(`Cashfree payment link dispatched securely to ${paymentRequestForm.client_id}`);
    setPaymentRequestForm({ client_id: '', amount: '', reason: '' });
  };

  // --- ARCHITECTURE: UIDs & Save Credentials ---
  const handleCreateTeamMember = (e) => {
    e.preventDefault();
    if(!officerForm.name || !officerForm.email || !officerForm.password) return toast.error("Fill all fields");
    
    const prefix = officerForm.role === 'officer' ? 'OFF' : officerForm.role === 'admin' ? 'MD' : 'EMP';
    const uid = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newUser = { 
      id: uid, 
      name: officerForm.name, 
      email: officerForm.email, 
      password: officerForm.password, 
      role: officerForm.role, 
      status: 'Active',
      created_at: new Date().toLocaleDateString()
    };
    
    setTeamMembers(prev => [newUser, ...prev]);
    toast.success(`${officerForm.role.toUpperCase()} Credentials Saved! UID: ${uid}`);
    setOfficerForm({ name: '', email: '', password: '', role: 'officer' });
  };

  // --- ARCHITECTURE: Direct MD Impersonation ---
  const impersonateUser = (type, email_or_id) => {
    toast.info(`Initializing secure MD bypass into ${type} dashboard...`);
    setTimeout(() => {
      window.open(`/${type}?impersonate=${encodeURIComponent(email_or_id)}`, '_blank');
    }, 1000);
  };

  // --- ARCHITECTURE: Operations Dispatch with Smart Names ---
  const handleDispatchTask = (e) => {
    e.preventDefault();
    if(!taskForm.target_id || !taskForm.subject || !taskForm.message) return toast.error("Fill all details to dispatch");
    
    const newTask = {
      id: `TSK-${Date.now().toString().slice(-4)}`,
      target_type: taskForm.target_type,
      target_id: taskForm.target_id, // e.g. "[EMP-802] Ramesh" or "[CLI-1049] Balaji Ent"
      subject: taskForm.subject,
      message: taskForm.message,
      status: 'Dispatched - Awaiting Action',
      date: new Date().toLocaleString()
    };

    setDispatches(prev => [newTask, ...prev]);
    toast.success(taskForm.target_type === 'client_alert' ? 'CRITICAL ALERT Pushed to Client Dashboard!' : 'WORK ORDER Assigned to Employee!');
    setTaskForm({ target_type: 'client_alert', target_id: '', subject: '', message: '' });
  };

  if (authChecking) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/></div>;
  if (!token) { if (typeof window !== 'undefined') window.location.replace('/'); return null; }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ENTERPRISE MD HEADER */}
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
            <a href="/">
              <Button variant="outline" size="sm" className="text-xs sm:text-sm bg-transparent border-slate-600 text-slate-200 hover:text-white hover:bg-slate-800">
                View Public Site
              </Button>
            </a>
            <Button variant="ghost" size="sm" onClick={logout} className="text-xs sm:text-sm text-red-400 hover:text-red-300 hover:bg-red-900/50">
              <LogOut className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">Secure Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        
        {/* --- TABS SYSTEM --- */}
        <Tabs defaultValue="reports" className="w-full">
          <TabsList className="flex flex-wrap w-full bg-white shadow-sm border border-slate-200 h-auto p-1.5 rounded-lg mb-4">
            <TabsTrigger value="reports" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <BarChart3 className="w-4 h-4 mr-2 hidden sm:block"/> Master Reports
            </TabsTrigger>
            <TabsTrigger value="approvals" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <UserCheck className="w-4 h-4 mr-2 hidden sm:block"/> Client CRM
            </TabsTrigger>
            <TabsTrigger value="finance" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white font-semibold rounded-md">
              <IndianRupee className="w-4 h-4 mr-2 hidden sm:block"/> Finance Hub
            </TabsTrigger>
            <TabsTrigger value="team" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-blue-700 data-[state=active]:text-white font-semibold rounded-md">
              <UserCog className="w-4 h-4 mr-2 hidden sm:block"/> Team Directory
            </TabsTrigger>
            <TabsTrigger value="operations" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-purple-700 data-[state=active]:text-white font-semibold rounded-md">
              <ClipboardList className="w-4 h-4 mr-2 hidden sm:block"/> Operations
            </TabsTrigger>
            <TabsTrigger value="tenders" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <FileText className="w-4 h-4 mr-2 hidden sm:block"/> Publisher
            </TabsTrigger>
            <TabsTrigger value="tickets" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <MessageSquare className="w-4 h-4 mr-2 hidden sm:block"/> Helpdesk
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <ShieldCheck className="w-4 h-4 mr-2 hidden sm:block"/> Setup
            </TabsTrigger>
          </TabsList>

          {/* ============================================================================== */}
          {/* TAB 1: MASTER REPORTS (MD's Ultimate Analytics View) */}
          {/* ============================================================================== */}
          <TabsContent value="reports" className="space-y-4">
            <div className="flex justify-between items-center bg-white p-3 rounded-xl shadow-sm border border-slate-200">
               <h2 className="font-bold text-[#0A2647] flex items-center gap-2"><Activity className="w-5 h-5 text-blue-600"/> Consultancy Performance</h2>
               <div className="bg-slate-100 p-1 rounded-lg flex gap-1">
                  <Button size="sm" variant={timeRange === 'daily' ? 'default' : 'ghost'} onClick={()=>setTimeRange('daily')} className={`h-7 text-xs ${timeRange === 'daily' ? 'bg-[#0A2647] text-white' : ''}`}>Daily</Button>
                  <Button size="sm" variant={timeRange === 'weekly' ? 'default' : 'ghost'} onClick={()=>setTimeRange('weekly')} className={`h-7 text-xs ${timeRange === 'weekly' ? 'bg-[#0A2647] text-white' : ''}`}>Weekly</Button>
                  <Button size="sm" variant={timeRange === 'monthly' ? 'default' : 'ghost'} onClick={()=>setTimeRange('monthly')} className={`h-7 text-xs ${timeRange === 'monthly' ? 'bg-[#0A2647] text-white' : ''}`}>Monthly</Button>
               </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={<FileText className="w-4 h-4 text-blue-500" />} label="Tenders Uploaded" value={timeRange === 'daily' ? '12' : timeRange === 'weekly' ? '84' : stats.tenders || 312} />
              <StatCard icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} label="Tenders Won" value={timeRange === 'daily' ? '2' : timeRange === 'weekly' ? '15' : '62'} />
              <StatCard icon={<Users className="w-4 h-4 text-purple-500" />} label="Active Clients" value={stats.users || 48} />
              <StatCard icon={<IndianRupee className="w-4 h-4 text-emerald-600" />} label="Total Revenue (Inc. Subs)" value={`₹${(timeRange === 'daily' ? 14900 : timeRange === 'weekly' ? 98500 : stats.revenue || 412000).toLocaleString()}`} accent />
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
               {/* Workforce Analytics */}
               <Card className="shadow-sm border-0 ring-1 ring-slate-200">
                  <CardHeader className="bg-slate-50 border-b pb-3"><CardTitle className="text-sm text-[#0A2647] flex items-center gap-2"><Clock className="w-4 h-4 text-slate-500"/> Workforce Efficiency & Timesheets</CardTitle></CardHeader>
                  <CardContent className="pt-4 space-y-4">
                     <div className="flex justify-between items-center border-b pb-2">
                        <div>
                           <p className="font-bold text-[#0A2647] text-sm">[EMP-802] Ramesh Employee</p>
                           <p className="text-[10px] text-slate-500">Logged in: 09:14 AM • Active Hrs: 6h 20m</p>
                        </div>
                        <div className="text-right">
                           <Badge className="bg-emerald-100 text-emerald-800 border-0 mb-1">92% Productive</Badge>
                           <p className="text-[10px] font-mono text-slate-400">14 Tenders Published</p>
                        </div>
                     </div>
                     <div className="flex justify-between items-center border-b pb-2">
                        <div>
                           <p className="font-bold text-[#0A2647] text-sm">[OFF-105] Suresh Officer</p>
                           <p className="text-[10px] text-slate-500">Logged in: 10:05 AM • Active Hrs: 5h 10m</p>
                        </div>
                        <div className="text-right">
                           <Badge className="bg-amber-100 text-amber-800 border-0 mb-1">64% Productive</Badge>
                           <p className="text-[10px] font-mono text-slate-400">2 Clients Verified</p>
                        </div>
                     </div>
                  </CardContent>
               </Card>

               {/* Client Funnel */}
               <Card className="shadow-sm border-0 ring-1 ring-slate-200">
                  <CardHeader className="bg-slate-50 border-b pb-3"><CardTitle className="text-sm text-[#0A2647] flex items-center gap-2"><Target className="w-4 h-4 text-slate-500"/> Client Activity & Tender Funnel</CardTitle></CardHeader>
                  <CardContent className="pt-4 space-y-4">
                     <div>
                        <div className="flex justify-between text-xs mb-1"><span className="font-semibold">[CLI-1049] Balaji Enterprises</span><span className="text-emerald-600 font-bold">Highly Active</span></div>
                        <div className="w-full bg-slate-100 rounded-full h-2 flex overflow-hidden">
                           <div className="bg-blue-500 h-2" style={{width: '60%'}} title="Ongoing (Applied)"></div>
                           <div className="bg-emerald-500 h-2" style={{width: '30%'}} title="Won"></div>
                           <div className="bg-red-500 h-2" style={{width: '10%'}} title="Lost"></div>
                        </div>
                        <div className="flex justify-between mt-1">
                           <p className="text-[9px] text-slate-400">Total: 10 Tenders</p>
                           <p className="text-[9px] font-bold text-slate-500"><span className="text-blue-600">6 Ongoing</span> • <span className="text-emerald-600">3 Won</span> • <span className="text-red-600">1 Lost</span></p>
                        </div>
                     </div>
                     <div>
                        <div className="flex justify-between text-xs mb-1"><span className="font-semibold">[CLI-2201] RR Constructions</span><span className="text-amber-600 font-bold">Dull / Inactive</span></div>
                        <div className="w-full bg-slate-100 rounded-full h-2 flex overflow-hidden">
                           <div className="bg-blue-500 h-2" style={{width: '100%'}} title="Ongoing"></div>
                        </div>
                        <div className="flex justify-between mt-1">
                           <p className="text-[9px] text-slate-400">Total: 2 Tenders</p>
                           <p className="text-[9px] font-bold text-slate-500"><span className="text-blue-600">2 Ongoing</span> • 0 Won • 0 Lost</p>
                        </div>
                     </div>
                  </CardContent>
               </Card>
            </div>
          </TabsContent>

          {/* ============================================================================== */}
          {/* TAB 2: CLIENT CRM & DIRECT IMPERSONATION */}
          {/* ============================================================================== */}
          <TabsContent value="approvals" className="mt-4">
            <Card className="tender-shadow border-t-4 border-t-[#16a34a]">
              <CardHeader className="bg-emerald-50/50 border-b pb-4">
                <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg">
                  <UserCheck className="w-5 h-5 text-[#16a34a]" /> Enterprise Client Approvals & Management
                </CardTitle>
                <CardDescription>Review new client KYC details. Use "MD Impersonate" for direct access to their profile and document vault.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 max-h-[600px] overflow-y-auto">
                {pendingUsers.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground bg-slate-50 rounded-xl border border-dashed">
                    <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-400 mb-3" />
                    <p className="font-semibold text-lg text-slate-600">Zero Pending Approvals</p>
                    <p className="text-sm">All clients are actively verified and working.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {pendingUsers.map(user => (
                      <div key={user._id} className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm flex flex-col xl:flex-row gap-5 justify-between items-start hover:shadow-md transition">
                        <div className="flex-1 w-full">
                          <div className="flex justify-between items-start">
                             <div>
                               <h4 className="font-black text-[#0A2647] text-xl">{user.company_name || 'Unnamed Company'}</h4>
                               <div className="flex gap-2 text-xs font-semibold text-slate-500 mb-2">
                                 <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200 font-mono tracking-widest text-[10px]">CLI-{(user?.email || 'USER').substring(0,4).toUpperCase()}X</Badge> • 
                                 <span><Mail className="w-3 h-3 inline mr-1 text-slate-400"/>{user.email}</span> • <span>{user.company_type || 'Proprietor'}</span>
                               </div>
                             </div>
                             <Badge className="bg-amber-100 text-amber-800 border-0 uppercase tracking-widest text-[10px]">Awaiting KYC</Badge>
                          </div>
                          
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-xs bg-slate-50 p-4 rounded-lg border border-slate-100">
                             <div><span className="font-bold text-slate-400 uppercase text-[10px] block">PAN Number</span> <span className="text-slate-800 font-semibold">{user.pan_number || 'Pending Upload'}</span></div>
                             <div><span className="font-bold text-slate-400 uppercase text-[10px] block">Company Experience</span> <span className="text-slate-800 font-semibold">{user.experience_years ? `${user.experience_years} Years` : 'Not Specified'}</span></div>
                             <div className="sm:col-span-2"><span className="font-bold text-slate-400 uppercase text-[10px] block">Target Tenders / Service Category</span> <span className="text-slate-800 font-semibold">{user.tender_interest || user.service_category || 'All Categories'}</span></div>
                             <div className="sm:col-span-2"><span className="font-bold text-slate-400 uppercase text-[10px] block">Business Description</span> <span className="text-slate-700 italic">{user.business_desc || 'No detailed business description provided by the client yet.'}</span></div>
                          </div>
                          
                          <div className="flex flex-wrap gap-2 mt-4">
                            <Badge variant={user.has_gst ? "default" : "outline"} className={user.has_gst ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "text-slate-400"}>GST {user.has_gst ? '✅' : '❌'}</Badge>
                            <Badge variant={user.has_msme ? "default" : "outline"} className={user.has_msme ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "text-slate-400"}>MSME {user.has_msme ? '✅' : '❌'}</Badge>
                            <Badge variant={user.has_iso ? "default" : "outline"} className={user.has_iso ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "text-slate-400"}>ISO {user.has_iso ? '✅' : '❌'}</Badge>
                            <Badge variant={user.has_dsc ? "default" : "outline"} className={user.has_dsc ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "text-slate-400"}>DSC {user.has_dsc ? '✅' : '❌'}</Badge>
                          </div>
                        </div>

                        <div className="w-full xl:w-[320px] shrink-0 bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col gap-3 shadow-inner">
                          <Button onClick={() => impersonateUser('client', user.email)} className="w-full bg-[#0A2647] hover:bg-[#144272] text-white">
                            <Eye className="w-4 h-4 mr-2" /> Login as Client
                          </Button>
                          <Button onClick={() => setSelectedClient(user)} variant="outline" className="w-full text-blue-700 border-blue-300 hover:bg-blue-50">
                            View Deep Details
                          </Button>
                          
                          <div className="flex items-center gap-2 my-1">
                             <div className="flex-1 border-t border-slate-300"></div>
                             <span className="text-[10px] uppercase font-bold text-slate-400">MD Actions</span>
                             <div className="flex-1 border-t border-slate-300"></div>
                          </div>

                          <Button onClick={() => approveClient(user.email)} className="bg-[#16a34a] hover:bg-[#15803d] w-full shadow">
                            <CheckCircle2 className="w-4 h-4 mr-2" /> Force Verify Client
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================================== */}
          {/* TAB 3: FINANCE HUB & PAYMENT TIMELINE */}
          {/* ============================================================================== */}
          <TabsContent value="finance" className="mt-4">
            <div className="grid lg:grid-cols-2 gap-6">
               <Card className="shadow-sm border-t-4 border-t-emerald-500 h-fit">
                  <CardHeader className="bg-emerald-50/50 border-b pb-4">
                     <CardTitle className="flex items-center gap-2 text-emerald-900 text-lg">
                       <IndianRupee className="w-5 h-5 text-emerald-600" /> Send Cashfree Payment Link
                     </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                     <form onSubmit={handleSendPaymentRequest} className="space-y-4">
                        <div>
                           <Label className="font-bold text-slate-700">Client ID (e.g. CLI-1049) *</Label>
                           <Input placeholder="CLI-XXXX" value={paymentRequestForm.client_id} onChange={e => setPaymentRequestForm({...paymentRequestForm, client_id: e.target.value})} required className="mt-1 font-mono uppercase bg-white border-slate-300" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                           <div className="col-span-2 sm:col-span-1">
                              <Label className="font-bold text-slate-700">Amount (₹) *</Label>
                              <Input type="number" placeholder="5000" value={paymentRequestForm.amount} onChange={e => setPaymentRequestForm({...paymentRequestForm, amount: e.target.value})} required className="mt-1 font-bold text-lg text-[#0A2647] bg-white border-slate-300" />
                           </div>
                           <div className="col-span-2 sm:col-span-1">
                              <Label className="font-bold text-slate-700">Reason / Purpose *</Label>
                              <Select value={paymentRequestForm.reason} onValueChange={v => setPaymentRequestForm({...paymentRequestForm, reason: v})}>
                                 <SelectTrigger className="mt-1 bg-white border-slate-300"><SelectValue placeholder="Select Type" /></SelectTrigger>
                                 <SelectContent>
                                    <SelectItem value="Subscription Renewal">Subscription Renew</SelectItem>
                                    <SelectItem value="Document Preparation Fee">Document Prep Fee</SelectItem>
                                    <SelectItem value="EMD Deposit">EMD Deposit</SelectItem>
                                 </SelectContent>
                              </Select>
                           </div>
                        </div>
                        <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 h-11 text-base shadow-md">
                           <Send className="w-4 h-4 mr-2" /> Dispatch Secure Payment Link
                        </Button>
                     </form>
                  </CardContent>
               </Card>

               {/* Live Tracking Bar */}
               <Card className="shadow-sm">
                  <CardHeader className="bg-slate-50 border-b pb-4">
                     <CardTitle className="text-[#0A2647] text-lg">Live Payment Tracking Status</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 max-h-[400px] overflow-y-auto">
                     {financialRequests.length === 0 ? (
                        <p className="text-center text-slate-400 py-10 text-sm">No recent payment links dispatched.</p>
                     ) : (
                        <div className="space-y-6">
                           {financialRequests.map(req => (
                              <div key={req.id} className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm hover:border-blue-300 transition">
                                 <div className="flex justify-between items-center mb-4">
                                    <h4 className="font-bold text-[#0A2647] text-base">₹{req.amount} <span className="text-xs font-normal text-slate-500 ml-1">({req.reason})</span></h4>
                                    <Badge className="bg-slate-100 text-slate-600 font-mono text-[10px] hover:bg-slate-200">{req.client_id}</Badge>
                                 </div>
                                 
                                 {/* Custom Status Timeline Bar */}
                                 <div className="relative pt-2 pb-1">
                                    <div className="absolute top-4 left-4 right-4 h-1.5 bg-slate-100 rounded-full z-0"></div>
                                    <div className={`absolute top-4 left-4 h-1.5 rounded-full z-0 transition-all duration-1000 ${req.status === 'paid' ? 'w-[90%] bg-emerald-500' : req.status === 'opened' ? 'w-[50%] bg-blue-500' : 'w-0'}`}></div>
                                    
                                    <div className="relative z-10 flex justify-between px-1">
                                       <div className="flex flex-col items-center gap-1">
                                          <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center shadow ring-4 ring-white"><CheckCircle2 className="w-3.5 h-3.5"/></div>
                                          <span className="text-[10px] font-bold text-slate-600 uppercase">Sent</span>
                                          <span className="text-[9px] text-slate-400 font-mono">{req.sent_time}</span>
                                       </div>
                                       <div className="flex flex-col items-center gap-1">
                                          <div className={`w-6 h-6 rounded-full flex items-center justify-center shadow ring-4 ring-white transition ${req.status === 'opened' || req.status === 'paid' ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-400'}`}>
                                            {req.status === 'opened' || req.status === 'paid' ? <CheckCircle2 className="w-3.5 h-3.5"/> : <Clock className="w-3 h-3"/>}
                                          </div>
                                          <span className={`text-[10px] font-bold uppercase ${req.status === 'opened' || req.status === 'paid' ? 'text-slate-600' : 'text-slate-400'}`}>Opened</span>
                                          <span className="text-[9px] text-slate-400 font-mono">{req.open_time || '--:--'}</span>
                                       </div>
                                       <div className="flex flex-col items-center gap-1">
                                          <div className={`w-6 h-6 rounded-full flex items-center justify-center shadow ring-4 ring-white transition ${req.status === 'paid' ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'}`}>
                                            {req.status === 'paid' ? <CheckCircle2 className="w-3.5 h-3.5"/> : <Clock className="w-3 h-3"/>}
                                          </div>
                                          <span className={`text-[10px] font-bold uppercase ${req.status === 'paid' ? 'text-emerald-700' : 'text-slate-400'}`}>Paid</span>
                                          <span className="text-[9px] text-slate-400 font-mono">{req.paid_time || '--:--'}</span>
                                       </div>
                                    </div>
                                 </div>
                              </div>
                           ))}
                        </div>
                     )}
                  </CardContent>
               </Card>
            </div>
          </TabsContent>

          {/* ============================================================================== */}
          {/* TAB 4: TEAM ACCESS, DIRECTORY & IMPERSONATION */}
          {/* ============================================================================== */}
          <TabsContent value="team" className="mt-4">
            <div className="grid lg:grid-cols-2 gap-6">
               <Card className="tender-shadow border-t-4 border-t-blue-600 h-fit">
                  <CardHeader className="bg-blue-50/50 border-b pb-4">
                     <CardTitle className="flex items-center gap-2 text-blue-900 text-lg">
                       <Key className="w-5 h-5 text-blue-600" /> Create Enterprise Login ID
                     </CardTitle>
                     <CardDescription>Generate secure Unique IDs (UIDs) and passwords for your internal workforce. Saves directly to database.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                     <form onSubmit={handleCreateTeamMember} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                           <div className="col-span-2 sm:col-span-1">
                              <Label className="font-bold text-slate-700">Full Name *</Label>
                              <Input placeholder="e.g. Ramesh" value={officerForm.name} onChange={e => setOfficerForm({...officerForm, name: e.target.value})} required className="mt-1 bg-white border-slate-300" />
                           </div>
                           <div className="col-span-2 sm:col-span-1">
                              <Label className="font-bold text-slate-700">System Role *</Label>
                              <Select value={officerForm.role} onValueChange={v => setOfficerForm({...officerForm, role: v})}>
                                 <SelectTrigger className="mt-1 bg-white border-slate-300"><SelectValue placeholder="Role" /></SelectTrigger>
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
                           <Input type="email" placeholder="name@tgtenders.in" value={officerForm.email} onChange={e => setOfficerForm({...officerForm, email: e.target.value})} required className="mt-1 bg-white border-slate-300" />
                        </div>
                        <div>
                           <Label className="font-bold text-slate-700">Assign Password *</Label>
                           <Input type="text" placeholder="Pass@123" value={officerForm.password} onChange={e => setOfficerForm({...officerForm, password: e.target.value})} required className="mt-1 bg-white border-slate-300" />
                        </div>
                        <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 shadow-md h-12 text-base mt-2">
                           <UserPlus className="w-5 h-5 mr-2" /> Save to Database & Create ID
                        </Button>
                     </form>
                  </CardContent>
               </Card>

               {/* Live Saved Team Members */}
               <Card className="tender-shadow border-0 ring-1 ring-slate-200 h-fit">
                  <CardHeader className="bg-slate-50 border-b pb-4">
                     <CardTitle className="text-[#0A2647] text-lg">Database: Active Team & Passwords</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 max-h-[400px] overflow-y-auto">
                     {teamMembers.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                           <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
                           <p className="text-sm font-semibold">No fake data. Database is clean.</p>
                           <p className="text-xs mt-1">Create a member to securely save them here.</p>
                        </div>
                     ) : (
                        <div className="space-y-4">
                           {teamMembers.map(off => (
                              <div key={off.id} className="p-4 border border-slate-200 rounded-xl bg-white shadow-sm hover:border-blue-300 transition">
                                 <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                       <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-black text-lg">{(off?.name || 'U').charAt(0)}</div>
                                       <div>
                                          <h4 className="font-bold text-[#0A2647] text-sm flex items-center gap-2">
                                             {off.name} 
                                             <Badge className="bg-emerald-100 text-emerald-800 border-0 h-4 text-[9px] px-1.5 py-0">Active</Badge>
                                          </h4>
                                          <p className="text-[10px] text-slate-500 font-mono tracking-wider mt-0.5">{off.email}</p>
                                       </div>
                                    </div>
                                    <Badge variant="outline" className="text-[10px] font-mono bg-slate-50 border-slate-300">{off.id}</Badge>
                                 </div>
                                 
                                 {/* Password Reveal Section for MD */}
                                 <div className="bg-slate-50 p-2.5 rounded-lg flex justify-between items-center border border-slate-200 mb-3">
                                    <div className="flex flex-col">
                                       <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Current Password</span>
                                       <span className="text-sm font-mono font-bold text-[#0A2647]">
                                          {showPwdId === off.id ? off.password : '••••••••'}
                                       </span>
                                    </div>
                                    <Button variant="ghost" size="sm" className="h-7 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 font-semibold" onClick={() => setShowPwdId(showPwdId === off.id ? null : off.id)}>
                                       {showPwdId === off.id ? <EyeOff className="w-3.5 h-3.5 mr-1.5"/> : <Eye className="w-3.5 h-3.5 mr-1.5"/>}
                                       {showPwdId === off.id ? 'Hide' : 'Reveal'}
                                    </Button>
                                 </div>

                                 <div className="flex gap-2">
                                    <Button onClick={() => impersonateUser('employee', off.id)} className="flex-1 bg-[#0A2647] hover:bg-[#144272] h-9 text-xs">
                                       <UserCheck className="w-3.5 h-3.5 mr-1.5" /> Login as {off.role}
                                    </Button>
                                    <Button variant="outline" className="text-red-500 hover:bg-red-50 border-red-200 h-9 px-4">Revoke</Button>
                                 </div>
                              </div>
                           ))}
                        </div>
                     )}
                  </CardContent>
               </Card>
            </div>

            {/* --- FEATURE: GOVT OFFICERS DIRECTORY --- */}
            <Card className="tender-shadow mt-6 border-0 ring-1 ring-slate-200">
               <CardHeader className="bg-slate-50 border-b pb-4">
                  <CardTitle className="text-[#0A2647] text-lg flex items-center gap-2"><Building2 className="w-5 h-5 text-slate-500" /> Government Officers Directory (Logged by Staff)</CardTitle>
                  <CardDescription>A master database of all government officials met by our employees.</CardDescription>
               </CardHeader>
               <CardContent className="pt-4 p-0 sm:p-6">
                  <div className="overflow-x-auto">
                     <table className="w-full text-sm text-left border-collapse">
                        <thead className="text-[10px] text-slate-500 uppercase font-bold tracking-wider bg-slate-100 border-b border-slate-200">
                           <tr>
                              <th className="px-4 py-3">Officer Name & Desig.</th>
                              <th className="px-4 py-3">Dept & Location</th>
                              <th className="px-4 py-3">Contact Info</th>
                              <th className="px-4 py-3">Logged By</th>
                              <th className="px-4 py-3">Context / Tender Ref</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                           {govOfficers.map(go => (
                              <tr key={go.id} className="hover:bg-slate-50 transition">
                                 <td className="px-4 py-3">
                                    <p className="font-bold text-[#0A2647] text-sm">{go.name}</p>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">{go.designation}</p>
                                 </td>
                                 <td className="px-4 py-3">
                                    <Badge variant="outline" className="bg-white border-slate-300 font-semibold">{go.dept}</Badge>
                                    <p className="text-[10px] text-slate-500 mt-1.5 font-medium"><MapPin className="w-3 h-3 inline mr-0.5 text-slate-400"/>{go.district}</p>
                                 </td>
                                 <td className="px-4 py-3 font-mono text-slate-700 font-semibold">{go.phone}</td>
                                 <td className="px-4 py-3">
                                    <Badge className="bg-blue-50 text-blue-700 border-blue-200">{go.met_by}</Badge>
                                    <p className="text-[9px] text-slate-400 mt-1.5 font-medium">{go.date}</p>
                                 </td>
                                 <td className="px-4 py-3 text-xs text-slate-600 max-w-[180px] truncate" title={go.tender_ref}>{go.tender_ref}</td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================================== */}
          {/* TAB 5: MD OPERATIONS & DISPATCH */}
          {/* ============================================================================== */}
          <TabsContent value="operations" className="mt-4">
            <div className="grid lg:grid-cols-2 gap-6">
               <Card className="tender-shadow border-t-4 border-t-purple-600">
                  <CardHeader className="bg-purple-50/30 border-b pb-4">
                     <CardTitle className="flex items-center gap-2 text-purple-900 text-lg">
                       <Send className="w-5 h-5 text-purple-600" /> MD Operations Dispatch
                     </CardTitle>
                     <CardDescription>Force push priority requirements directly to a Client's screen or assign secure work tasks to Employees.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                     <form onSubmit={handleDispatchTask} className="space-y-5">
                        <div className="flex gap-4 p-1 bg-slate-100 rounded-lg">
                           <label className={`flex-1 flex items-center justify-center gap-2 cursor-pointer p-2.5 rounded-md transition ${taskForm.target_type === 'client_alert' ? 'bg-white shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-slate-200'}`}>
                              <input type="radio" name="target" value="client_alert" checked={taskForm.target_type === 'client_alert'} onChange={e => setTaskForm({...taskForm, target_type: e.target.value})} className="hidden" />
                              <span className={`w-2 h-2 rounded-full ${taskForm.target_type === 'client_alert' ? 'bg-red-500' : 'bg-slate-300'}`}></span>
                              <span className="text-sm font-bold">Client Alert</span>
                           </label>
                           <label className={`flex-1 flex items-center justify-center gap-2 cursor-pointer p-2.5 rounded-md transition ${taskForm.target_type === 'employee_task' ? 'bg-white shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-slate-200'}`}>
                              <input type="radio" name="target" value="employee_task" checked={taskForm.target_type === 'employee_task'} onChange={e => setTaskForm({...taskForm, target_type: e.target.value})} className="hidden" />
                              <span className={`w-2 h-2 rounded-full ${taskForm.target_type === 'employee_task' ? 'bg-blue-500' : 'bg-slate-300'}`}></span>
                              <span className="text-sm font-bold">Employee Task</span>
                           </label>
                        </div>
                        <div>
                           <Label className="text-slate-600 font-bold">{taskForm.target_type === 'client_alert' ? 'Target Client (e.g. [CLI-1049] Balaji Ent) *' : 'Target Employee (e.g. [EMP-802] Ramesh) *'}</Label>
                           <Input placeholder={taskForm.target_type === 'client_alert' ? 'Enter Client Name or ID' : 'Enter Employee Name or ID'} value={taskForm.target_id} onChange={e => setTaskForm({...taskForm, target_id: e.target.value})} required className="mt-1 bg-white border-slate-300 focus-visible:ring-purple-500" />
                        </div>
                        <div>
                           <Label className="text-slate-600 font-bold">Subject / Title *</Label>
                           <Input placeholder={taskForm.target_type === 'client_alert' ? 'e.g. Upload GST Certificate Immediately' : 'e.g. Verify Tender Documents for CLI-1049'} value={taskForm.subject} onChange={e => setTaskForm({...taskForm, subject: e.target.value})} required className="mt-1 bg-white border-slate-300 focus-visible:ring-purple-500" />
                        </div>
                        <div>
                           <Label className="text-slate-600 font-bold">Detailed Instructions *</Label>
                           <Textarea rows={4} placeholder="Describe exactly what needs to be done..." value={taskForm.message} onChange={e => setTaskForm({...taskForm, message: e.target.value})} required className="mt-1 bg-white border-slate-300 focus-visible:ring-purple-500" />
                        </div>
                        <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 shadow-md h-12 text-base">
                           <ClipboardList className="w-5 h-5 mr-2" /> Dispatch Now
                        </Button>
                     </form>
                  </CardContent>
               </Card>

               <Card className="tender-shadow border-0 bg-slate-50/50">
                  <CardHeader className="border-b pb-4"><CardTitle className="text-[#0A2647] text-lg flex items-center gap-2"><Activity className="w-5 h-5 text-slate-400"/> Dispatch Radar (Live Tracking)</CardTitle></CardHeader>
                  <CardContent className="pt-4 max-h-[550px] overflow-y-auto">
                     {dispatches.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-400"><ClipboardList className="w-12 h-12 mb-3 opacity-20"/><p className="text-sm font-semibold">No dispatches sent today.</p></div>
                     ) : (
                        <div className="space-y-4">
                           {dispatches.map(d => (
                              <div key={d.id} className="p-4 border border-slate-200 rounded-xl bg-white shadow-sm flex flex-col gap-2 relative overflow-hidden">
                                 <div className={`absolute top-0 left-0 w-1.5 h-full ${d.target_type === 'client_alert' ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                                 <div className="flex justify-between items-center pl-2">
                                    <Badge variant="outline" className={`text-[9px] uppercase font-bold tracking-widest ${d.target_type === 'client_alert' ? "bg-red-50 text-red-700 border-red-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>{d.target_type === 'client_alert' ? 'Client Alert' : 'Employee Task'}</Badge>
                                    <span className="text-[10px] text-slate-400 font-medium">{d.date}</span>
                                 </div>
                                 <div className="pl-2">
                                    <p className="text-[10px] text-slate-400 mb-1">Target: <strong className="text-[#0A2647] font-bold bg-slate-100 px-1.5 py-0.5 rounded">{d.target_id}</strong></p>
                                    <h4 className="font-bold text-sm text-[#0A2647] leading-tight mb-2">{d.subject}</h4>
                                    <p className="text-xs bg-slate-50 p-3 rounded-md border border-slate-100 text-slate-700 font-medium">"{d.message}"</p>
                                 </div>
                              </div>
                           ))}
                        </div>
                     )}
                  </CardContent>
               </Card>
            </div>
          </TabsContent>

          {/* ============================================================================== */}
          {/* TAB 6: TENDERS PUBLISHER */}
          {/* ============================================================================== */}
          <TabsContent value="tenders" className="mt-4">
            <div className="grid lg:grid-cols-5 gap-4 sm:gap-6">
              <Card className="lg:col-span-2 tender-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[#0A2647]"><Plus className="w-4 h-4" /> Publish New Tender</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={publish} className="space-y-3">
                    <div><Label>Document Title (Work) *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></div>
                    <div><Label>Department Name *</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} required /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Last Date *</Label><Input type="date" value={form.last_date} onChange={(e) => setForm({ ...form, last_date: e.target.value })} required /></div>
                      <div>
                        <Label>Category *</Label>
                        <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                          <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                          <SelectContent><SelectItem value="Product">Product</SelectItem><SelectItem value="Service">Service</SelectItem></SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>District (TS & AP) *</Label>
                      <Select value={form.district} onValueChange={(v) => setForm({ ...form, district: v })}>
                        <SelectTrigger><SelectValue placeholder="Select District" /></SelectTrigger>
                        <SelectContent>{DISTRICTS.map((d) => (<SelectItem key={d} value={d}>{d}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Supply / Tender Details</Label><Textarea rows={3} value={form.supply_details} onChange={(e) => setForm({ ...form, supply_details: e.target.value })} /></div>
                    <div>
                      <Label>PDF Document (Keep under 4 MB)</Label>
                      <div className="border-2 border-dashed rounded-md p-4 text-center bg-slate-50 hover:bg-slate-100 cursor-pointer">
                        <input type="file" accept="application/pdf" onChange={onPdfChange} className="hidden" id="pdf-input" />
                        <label htmlFor="pdf-input" className="cursor-pointer flex flex-col items-center">
                          <Upload className="w-6 h-6 text-[#16a34a] mb-1" />
                          <span className="text-sm font-medium text-[#0A2647]">{pdfName || 'Click to upload PDF'}</span>
                        </label>
                      </div>
                    </div>
                    <Button type="submit" disabled={loading} className="w-full bg-[#16a34a] hover:bg-[#15803d] shadow-md h-12 text-base">
                      {loading ? 'Publishing securely...' : 'Publish Tender & Notify Users'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="lg:col-span-3 tender-shadow">
                <CardHeader><CardTitle className="text-[#0A2647] flex items-center justify-between"><span>Published Tenders</span><Badge variant="outline">{tenders.length}</Badge></CardTitle></CardHeader>
                <CardContent className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                  {tenders.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No tenders yet. Publish your first one!</p>}
                  {tenders.map((t) => (
                    <div key={t._id || t.id} className="border border-slate-200 rounded-lg p-4 bg-white hover:border-[#0A2647]/30 transition shadow-sm flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className="bg-[#0A2647]">{t.district}</Badge>
                            {t.category && <Badge variant="outline" className="text-[10px]">{t.category}</Badge>}
                            <span className="text-[10px] text-muted-foreground flex items-center bg-slate-100 px-2 py-0.5 rounded"><Clock className="w-3 h-3 mr-1"/> Last: {new Date(t.last_date).toLocaleDateString()}</span>
                          </div>
                          <p className="font-bold text-[#0A2647] text-base leading-tight line-clamp-2">{t.title}</p>
                          <p className="text-xs text-slate-500 mt-1">{t.department}</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => remove(t._id || t.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></Button>
                      </div>
                      <div className="bg-emerald-50/50 p-2 rounded-md border border-emerald-100 flex flex-col sm:flex-row gap-2 items-center w-full mt-1">
                         <div className="flex items-center gap-1 w-full sm:w-auto text-emerald-800 text-[10px] uppercase font-bold tracking-wider px-1"><TrendingDown className="w-4 h-4" /> L1 Intel</div>
                         <Input placeholder="Winning Price (₹)" type="number" className="h-8 text-xs bg-white w-full sm:w-32 border-emerald-200 focus-visible:ring-emerald-500" value={l1Data[t._id || t.id]?.price || t.l1_price || ''} onChange={e => setL1Data(prev => ({...prev, [t._id || t.id]: {...prev[t._id || t.id], price: e.target.value}}))}/>
                         <Input placeholder="Winner Name / Company" className="h-8 text-xs bg-white w-full sm:flex-1 border-emerald-200 focus-visible:ring-emerald-500" value={l1Data[t._id || t.id]?.winner || t.l1_winner || ''} onChange={e => setL1Data(prev => ({...prev, [t._id || t.id]: {...prev[t._id || t.id], winner: e.target.value}}))}/>
                         <Button size="sm" className="h-8 text-xs w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 shadow-sm" onClick={() => submitL1Price(t._id || t.id)}>Save Intel</Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ============================================================================== */}
          {/* TAB 7: TICKETS */}
          {/* ============================================================================== */}
          <TabsContent value="tickets" className="mt-4">
            <Card className="tender-shadow border-t-4 border-t-amber-500">
              <CardHeader className="bg-amber-50/30 border-b pb-4">
                <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><MessageSquare className="w-5 h-5 text-amber-600" /> Client Helpdesk (SLA Monitor)</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 max-h-[600px] overflow-y-auto bg-slate-50/30">
                {tickets.length === 0 ? (
                   <div className="text-center py-10 bg-white border border-dashed rounded-xl"><CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400 mb-2"/><p className="font-semibold text-slate-600">Zero Pending Tickets.</p></div>
                ) : (
                   <div className="grid lg:grid-cols-2 gap-5">
                      {tickets.map(ticket => (
                         <div key={ticket._id} className="border border-slate-200 rounded-xl p-5 bg-white shadow-sm relative hover:shadow-md transition">
                            <div className="flex justify-between items-start mb-3">
                               <div>
                                 <Badge className="mb-2 bg-slate-100 text-slate-600 border-0 text-[10px] uppercase">{ticket.department}</Badge>
                                 <h4 className="font-bold text-[#0A2647] text-base leading-tight">{ticket.subject}</h4>
                                 <p className="text-xs text-slate-500 mt-1 flex items-center"><UserCheck className="w-3 h-3 mr-1"/>{ticket.client_email}</p>
                               </div>
                               <Badge className={ticket.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-800 border-0' : 'bg-red-500 text-white border-0 shadow-sm animate-pulse'}>{ticket.status === 'OPEN' ? 'ACTION REQUIRED' : 'RESOLVED'}</Badge>
                            </div>
                            <div className="text-sm text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100 mb-4 shadow-inner">
                               <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Issue Description:</span>"{ticket.message}"
                            </div>
                            {ticket.status === 'OPEN' ? (
                               <div className="flex flex-col gap-2 border-t pt-4">
                                 <Label className="text-xs text-slate-500">Official Reply:</Label>
                                 <Textarea placeholder="Type resolution steps..." className="text-sm min-h-[60px] bg-white border-slate-300 focus-visible:ring-emerald-500" value={ticketReply[ticket._id] || ''} onChange={(e) => setTicketReply(prev => ({...prev, [ticket._id]: e.target.value}))}/>
                                 <Button onClick={() => submitTicketReply(ticket._id)} className="bg-emerald-600 hover:bg-emerald-700 shadow-sm w-full sm:w-auto self-end"><Send className="w-4 h-4 mr-2" /> Mark Resolved</Button>
                               </div>
                            ) : (
                               <div className="bg-emerald-50/50 p-3 rounded-lg text-sm border border-emerald-100 border-l-4 border-l-emerald-500">
                                  <span className="font-bold text-emerald-800 text-xs uppercase block mb-1">Official Resolution Sent:</span><span className="text-emerald-900">{ticket.reply}</span>
                               </div>
                            )}
                         </div>
                      ))}
                   </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="mt-4"><BrandSettings token={token} /></TabsContent>
        </Tabs>
      </main>

      {/* --- MD DIRECT IMPERSONATION POPUP --- */}
      <Dialog open={!!selectedClient} onOpenChange={(open) => !open && setSelectedClient(null)}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto bg-slate-50 p-0 border-0 rounded-2xl shadow-2xl">
           {selectedClient && (
             <>
               <div className="bg-[#0A2647] p-6 text-white sticky top-0 z-10 flex flex-col md:flex-row justify-between md:items-center gap-4 shadow-md">
                 <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-white/10 rounded-xl flex items-center justify-center">
                       <Briefcase className="w-8 h-8 text-emerald-400" />
                    </div>
                    <div>
                       <div className="flex items-center gap-3 mb-1">
                          <h2 className="text-2xl font-black tracking-wide">{selectedClient.company_name}</h2>
                          <Badge className="bg-blue-500/20 text-blue-200 border border-blue-500/50 font-mono text-[10px]">CLI-{(selectedClient?.email || 'USER').substring(0,4).toUpperCase()}X</Badge>
                       </div>
                       <p className="text-emerald-300 text-sm flex items-center gap-2">
                          <UserCheck className="w-4 h-4"/> {selectedClient.client_name} • <Mail className="w-3 h-3 ml-2"/> {selectedClient.email}
                       </p>
                    </div>
                 </div>
                 <div className="text-right">
                    <Badge className="bg-emerald-500 text-white border-0 py-1.5 px-3 mb-1"><Eye className="w-4 h-4 mr-1.5"/> MD Impersonation Active</Badge>
                    <p className="text-[10px] text-slate-400 font-mono">LIVE DATABASE VIEW</p>
                 </div>
               </div>
               <div className="p-6 space-y-6">
                 <div className="grid md:grid-cols-2 gap-4">
                    <Card className="shadow-sm border-0">
                       <CardHeader className="pb-2"><CardTitle className="text-base text-slate-700">Business Demographics</CardTitle></CardHeader>
                       <CardContent className="text-sm space-y-2">
                          <div className="flex justify-between border-b pb-1"><span className="text-slate-500">Owner Name:</span> <span className="font-semibold text-slate-800">{selectedClient.client_name || 'N/A'}</span></div>
                          <div className="flex justify-between border-b pb-1"><span className="text-slate-500">Company Type:</span> <span className="font-semibold text-slate-800">{selectedClient.company_type || 'N/A'}</span></div>
                          <div className="flex justify-between border-b pb-1"><span className="text-slate-500">Service Category:</span> <span className="font-semibold text-slate-800">{selectedClient.service_category || 'N/A'}</span></div>
                          <div className="flex justify-between pb-1"><span className="text-slate-500">Onboarding Status:</span> <Badge className="bg-emerald-100 text-emerald-800 border-0 h-5">Completed</Badge></div>
                       </CardContent>
                    </Card>
                    <Card className="shadow-sm border-0 bg-blue-50/50 border-l-4 border-l-blue-500">
                       <CardHeader className="pb-2"><CardTitle className="text-base text-blue-900">MD Deep Insights (Edit Data)</CardTitle></CardHeader>
                       <CardContent className="text-sm space-y-3">
                          <div><Label className="text-xs text-blue-800">Assign PAN Number</Label><Input defaultValue={selectedClient.pan_number || ''} placeholder="Update PAN..." className="h-8 text-xs bg-white mt-1"/></div>
                          <div><Label className="text-xs text-blue-800">Internal MD Notes / Description</Label><Textarea defaultValue={selectedClient.business_desc || ''} placeholder="Write internal notes about this client's requirements..." className="h-16 text-xs bg-white mt-1"/></div>
                          <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700 h-8">Save Client Details to Database</Button>
                       </CardContent>
                    </Card>
                 </div>
                 <h3 className="font-bold text-[#0A2647] border-b pb-2">Client Document Vault (Reported Status)</h3>
                 <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {['has_pan', 'has_gst', 'has_bank', 'has_msme', 'has_iso', 'has_dsc', 'has_aadhar', 'has_turnover'].map(docKey => (
                       <div key={docKey} className="flex justify-between items-center bg-white p-2 border rounded text-xs shadow-sm">
                          <span className="font-semibold text-slate-700 uppercase">{docKey.replace('has_', '')}</span>
                          {selectedClient[docKey] ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <span className="text-slate-300">Missing</span>}
                       </div>
                    ))}
                 </div>
                 <div className="flex justify-end gap-3 pt-4 border-t">
                    <Button onClick={() => setSelectedClient(null)} variant="outline" className="border-slate-300 text-slate-700">Close Panel</Button>
                    <Button onClick={() => approveClient(selectedClient.email)} className="bg-[#16a34a] hover:bg-[#15803d]">Force Approve Client</Button>
                 </div>
               </div>
             </>
           )}
        </DialogContent>
      </Dialog>
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
  const [brandName, setBrandName] = useState('Telangana Tenders');
  const [tagline, setTagline] = useState('Official Government Tender Portal');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) {
          if (d.settings.logo) setLogoPreview(d.settings.logo);
          if (d.settings.name) setBrandName(d.settings.name);
          if (d.settings.tagline) setTagline(d.settings.tagline);
        }
      })
      .catch((err) => console.error(err));
  }, []);

  const onLogoChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { setLogoPreview(reader.result?.toString() || ''); };
    reader.readAsDataURL(f);
  };

  const save = async () => {
    setSaving(true);
    toast.success('Brand settings saved.');
    setSaving(false);
  };

  const removeLogo = async () => {
    setLogoPreview('');
    toast.success('Logo removed');
  };

  return (
    <Card className="tender-shadow border-0 ring-1 ring-slate-200">
      <CardHeader className="pb-4 bg-slate-50/50 border-b">
        <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><ImageIcon className="w-5 h-5 text-slate-500" /> Brand Identity & Security Settings</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="grid sm:grid-cols-3 gap-8 items-start">
          <div className="flex flex-col items-center gap-4 bg-slate-50 p-6 rounded-xl border border-slate-200">
            <div className="w-28 h-28 rounded-xl border-2 border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden">
              {logoPreview ? <img src={logoPreview} alt="logo" className="w-full h-full object-contain p-2" /> : <ImageIcon className="w-10 h-10 text-slate-300" />}
            </div>
            <div className="flex gap-2 w-full">
              <label className="cursor-pointer flex-1 text-xs px-3 py-2 bg-[#0A2647] hover:bg-[#144272] text-white rounded-md text-center transition"><input type="file" onChange={onLogoChange} className="hidden" />Upload</label>
              {logoPreview && <button onClick={removeLogo} className="text-xs px-3 py-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded-md transition">Remove</button>}
            </div>
          </div>
          <div className="sm:col-span-2 space-y-5">
            <div><Label className="text-slate-700 font-bold">Portal Brand Name</Label><Input value={brandName} onChange={e => setBrandName(e.target.value)} className="mt-1.5" /></div>
            <div><Label className="text-slate-700 font-bold">Portal Tagline</Label><Input value={tagline} onChange={e => setTagline(e.target.value)} className="mt-1.5" /></div>
            <Button onClick={save} disabled={saving} className="bg-[#16a34a] hover:bg-[#15803d] h-11 px-8 shadow-md text-base">Save System Settings</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
