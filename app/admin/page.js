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
  ShieldCheck,
  LogOut,
  Upload,
  FileText,
  Users,
  IndianRupee,
  Trash2,
  Plus,
  Image as ImageIcon,
  Lock,
  MessageSquare, 
  Send,         
  TrendingDown, 
  Clock,
  UserCheck,
  CheckCircle2,
  Loader2,
  Eye,
  UserPlus,
  Briefcase,
  ClipboardList,
  Key,
  Mail
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

  const [tenders, setTenders] = useState([]);
  const [stats, setStats] = useState({ tenders: 0, users: 0, payments: 0, revenue: 0 });

  const [tickets, setTickets] = useState([]);
  const [ticketReply, setTicketReply] = useState({}); 
  const [l1Data, setL1Data] = useState({}); 

  const [pendingUsers, setPendingUsers] = useState([]);
  const [paymentRequest, setPaymentRequest] = useState({});

  // MD Direct Access State
  const [selectedClient, setSelectedClient] = useState(null);

  // Officer Login Creation State
  const [officerForm, setOfficerForm] = useState({ name: '', email: '', password: '', role: 'officer' });
  const [officers, setOfficers] = useState([
    { id: 1, name: 'Suresh Officer', email: 'suresh@tgtenders.in', role: 'officer', status: 'Active' },
    { id: 2, name: 'Ramesh Employee', email: 'ramesh@tgtenders.in', role: 'employee', status: 'Active' },
  ]);

  // Operations & Dispatch State
  const [taskForm, setTaskForm] = useState({ target_type: 'client_alert', email: '', subject: '', message: '' });
  const [dispatches, setDispatches] = useState([]);

  const [form, setForm] = useState({
    title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: '',
  });
  const [pdfBase64, setPdfBase64] = useState('');
  const [pdfName, setPdfName] = useState('');

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('tt_admin') : '';
    if (t) {
       setToken(t);
    }
    setAuthChecking(false);
  }, []);

  useEffect(() => {
    if (token) {
      refresh();
    }
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
    if (file.type !== 'application/pdf') {
      toast.error('Please upload a PDF file');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error('PDF file is too large! Please upload under 4MB.');
      return;
    }
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
      toast.error('Fill all required fields');
      return;
    }
    setLoading(true);
    try {
      const r = await fetch('/api/tenders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...form,
          pdf_base64: pdfBase64,
          pdf_filename: pdfName || 'tender.pdf',
        }),
      });
      
      const d = await r.json().catch(() => ({}));
      
      if (!r.ok) {
        toast.error(d.error || `Server Error (${r.status}) - Try smaller PDF`);
        return;
      }
      
      toast.success(
        `Tender published! ${d.notified || ''} user(s) notified by email.`
      );
      setForm({
        title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: '',
      });
      setPdfBase64('');
      setPdfName('');
      refresh();
    } catch (err) {
      toast.error('Network Error: File might be too large for server limit.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this tender?')) return;
    await fetch(`/api/tenders/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    toast.success('Deleted');
    refresh();
  };

  const submitTicketReply = async (ticket_id) => {
    const replyText = ticketReply[ticket_id];
    if(!replyText) return toast.error('Please write a reply first.');
    
    try {
      const r = await fetch('/api/tickets/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ticket_id, reply: replyText, admin_email: 'Admin' })
      });
      if(r.ok) {
        toast.success('Reply Sent & Ticket Resolved!');
        setTicketReply(prev => ({...prev, [ticket_id]: ''}));
        refresh();
      } else {
        toast.error('Failed to send reply');
      }
    } catch(e) { toast.error('Error resolving ticket'); }
  };

  const submitL1Price = async (tender_id) => {
    const data = l1Data[tender_id];
    if (!data?.price) return toast.error('Please enter the L1 Price');
    
    try {
      const r = await fetch(`/api/tenders/${tender_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
      if(r.ok) { 
        toast.success('Client Approved & Portal Unlocked!'); 
        refresh(); 
      }
    } catch(e) { toast.error('Error approving client'); }
  };

  const sendPaymentRequest = async (email) => {
    const reqData = paymentRequest[email];
    if(!reqData?.amount || !reqData?.reason) return toast.error('Enter Amount and Reason for the document.');
    try {
      const r = await fetch('/api/users/request-payment', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email, amount: reqData.amount, reason: reqData.reason })
      });
      if(r.ok) { 
        toast.success(`Payment request sent to ${email} for ₹${reqData.amount}`);
        setPaymentRequest(prev => ({...prev, [email]: {amount:'', reason:''}}));
      }
    } catch(e) { toast.error('Error sending request'); }
  };

  // MD Functions for Officers & Operations
  const handleCreateOfficer = (e) => {
    e.preventDefault();
    if(!officerForm.name || !officerForm.email || !officerForm.password) return toast.error("Fill all fields");
    
    setOfficers(prev => [...prev, { id: Date.now(), name: officerForm.name, email: officerForm.email, role: officerForm.role, status: 'Active' }]);
    toast.success(`${officerForm.role.toUpperCase()} Login Credentials Created & Sent!`);
    setOfficerForm({ name: '', email: '', password: '', role: 'officer' });
  };

  const handleDispatchTask = (e) => {
    e.preventDefault();
    if(!taskForm.email || !taskForm.subject || !taskForm.message) return toast.error("Fill all details to dispatch");
    
    const newTask = {
      id: Date.now(),
      target_type: taskForm.target_type,
      email: taskForm.email,
      subject: taskForm.subject,
      message: taskForm.message,
      status: 'Sent - Awaiting Response',
      date: new Date().toLocaleString()
    };

    setDispatches(prev => [newTask, ...prev]);
    toast.success(taskForm.target_type === 'client_alert' ? 'Requirement Alert Pushed to Client Dashboard!' : 'Work Order Assigned to Employee!');
    setTaskForm({ target_type: 'client_alert', email: '', subject: '', message: '' });
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/>
      </div>
    );
  }

  if (!token) {
    if (typeof window !== 'undefined') {
       window.location.replace('/');
    }
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-40">
        <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <BrandLogo subtitle="MD Command Center" />
          <div className="flex items-center gap-1.5">
            <a href="/">
              <Button variant="outline" size="sm" className="text-xs sm:text-sm border-[#0A2647] text-[#0A2647]">
                View Site
              </Button>
            </a>
            <Button variant="ghost" size="sm" onClick={logout} className="text-xs sm:text-sm text-red-600 hover:text-red-700 hover:bg-red-50">
              <LogOut className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          <StatCard
            icon={<FileText className="w-4 h-4" />}
            label="Tenders"
            value={stats.tenders || 0}
          />
          <StatCard
            icon={<Users className="w-4 h-4" />}
            label="Registered Users"
            value={stats.users || 0}
          />
          <StatCard
            icon={<IndianRupee className="w-4 h-4" />}
            label="Payments"
            value={stats.payments || 0}
          />
          <StatCard
            icon={<IndianRupee className="w-4 h-4" />}
            label="Revenue"
            value={`₹${stats.revenue || 0}`}
            accent
          />
        </div>

        {/* --- TABS SYSTEM --- */}
        <Tabs defaultValue="approvals" className="w-full">
          <TabsList className="flex flex-wrap w-full bg-slate-200 h-auto p-1 rounded-md mb-2">
            <TabsTrigger value="approvals" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white">
              <UserCheck className="w-4 h-4 mr-2 hidden sm:block"/> Approvals
            </TabsTrigger>
            <TabsTrigger value="tenders" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white">
              <FileText className="w-4 h-4 mr-2 hidden sm:block"/> Tenders & L1
            </TabsTrigger>
            <TabsTrigger value="tickets" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white">
              <MessageSquare className="w-4 h-4 mr-2 hidden sm:block"/> SLA Tickets
            </TabsTrigger>
            <TabsTrigger value="operations" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-purple-700 data-[state=active]:text-white">
              <ClipboardList className="w-4 h-4 mr-2 hidden sm:block"/> Operations
            </TabsTrigger>
            <TabsTrigger value="team" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-blue-700 data-[state=active]:text-white">
              <UserPlus className="w-4 h-4 mr-2 hidden sm:block"/> Team Access
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white">
              <ShieldCheck className="w-4 h-4 mr-2 hidden sm:block"/> Brand Setup
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: APPROVALS & PAYMENTS (CLIENT DEEP DETAILS) */}
          <TabsContent value="approvals" className="mt-4">
            <Card className="tender-shadow border-[#16a34a]/30">
              <CardHeader className="bg-emerald-50/50 border-b pb-4">
                <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg">
                  <UserCheck className="w-5 h-5 text-[#16a34a]" /> Pending Client Approvals & Management
                </CardTitle>
                <CardDescription>Review new client details. Click "View & Manage Client" for direct access to their profile and documents.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 max-h-[600px] overflow-y-auto">
                {pendingUsers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle2 className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p>All clear! No pending approvals right now.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {pendingUsers.map(user => (
                      <div key={user._id} className="border rounded-lg p-4 bg-white shadow-sm flex flex-col xl:flex-row gap-4 justify-between items-start">
                        <div className="flex-1 w-full">
                          <div className="flex justify-between items-start">
                             <div>
                               <h4 className="font-bold text-[#0A2647] text-lg">{user.company_name || 'Unnamed Company'}</h4>
                               <div className="flex gap-2 text-xs text-slate-500 mb-2">
                                 <span><Mail className="w-3 h-3 inline mr-1"/>{user.email}</span> • <span>{user.company_type || 'Proprietor'}</span>
                               </div>
                             </div>
                             <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">New Registration</Badge>
                          </div>
                          
                          {/* DEEP DETAILS GRID AS REQUESTED BY MD */}
                          <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-slate-700 bg-slate-50 p-3 rounded border border-slate-100">
                             <div><span className="font-semibold text-slate-800">PAN Number:</span> {user.pan_number || 'Pending Upload'}</div>
                             <div><span className="font-semibold text-slate-800">Experience:</span> {user.experience_years ? `${user.experience_years} Years` : 'Not Specified'}</div>
                             <div className="col-span-2"><span className="font-semibold text-slate-800">Target Tenders / Service:</span> {user.tender_interest || user.service_category || 'All Categories'}</div>
                             <div className="col-span-2"><span className="font-semibold text-slate-800">Business Description:</span> {user.business_desc || 'No detailed business description provided by the client yet.'}</div>
                          </div>
                          
                          <div className="flex flex-wrap gap-2 mt-3">
                            <Badge variant={user.has_gst ? "default" : "destructive"} className={user.has_gst ? "bg-emerald-100 text-emerald-800" : ""}>GST: {user.has_gst ? 'Yes' : 'No'}</Badge>
                            <Badge variant={user.has_msme ? "default" : "destructive"} className={user.has_msme ? "bg-emerald-100 text-emerald-800" : ""}>MSME: {user.has_msme ? 'Yes' : 'No'}</Badge>
                            <Badge variant={user.has_iso ? "default" : "destructive"} className={user.has_iso ? "bg-emerald-100 text-emerald-800" : ""}>ISO: {user.has_iso ? 'Yes' : 'No'}</Badge>
                          </div>
                        </div>

                        <div className="w-full xl:w-[320px] shrink-0 bg-slate-50 p-3 rounded border flex flex-col gap-2">
                          {/* DIRECT ACCESS BUTTON FOR MD */}
                          <Button onClick={() => setSelectedClient(user)} variant="outline" className="w-full text-blue-700 border-blue-300 hover:bg-blue-50">
                            <Eye className="w-4 h-4 mr-2" /> View & Manage Client Profile
                          </Button>
                          
                          <div className="flex-1 border-t border-slate-200 my-1"></div>

                          <Button onClick={() => approveClient(user.email)} className="bg-[#16a34a] hover:bg-[#15803d] w-full">
                            <CheckCircle2 className="w-4 h-4 mr-2" /> Approve & Unlock Portal
                          </Button>
                          <div className="text-[10px] font-bold text-center text-slate-400 my-1">- OR REQUEST DOC FEE -</div>
                          <div className="flex gap-2">
                             <Input 
                               placeholder="Reason (e.g. MSME)" className="h-8 text-xs bg-white"
                               value={paymentRequest[user.email]?.reason || ''}
                               onChange={e => setPaymentRequest(prev => ({...prev, [user.email]: {...prev[user.email], reason: e.target.value}}))}
                             />
                             <Input 
                               placeholder="₹ Amount" type="number" className="h-8 text-xs bg-white w-20 shrink-0"
                               value={paymentRequest[user.email]?.amount || ''}
                               onChange={e => setPaymentRequest(prev => ({...prev, [user.email]: {...prev[user.email], amount: e.target.value}}))}
                             />
                          </div>
                          <Button onClick={() => sendPaymentRequest(user.email)} variant="outline" size="sm" className="border-amber-500 text-amber-700 hover:bg-amber-50 h-8">
                            Send Payment Link
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 2: TENDERS & L1 */}
          <TabsContent value="tenders" className="mt-4">
            <div className="grid lg:grid-cols-5 gap-4 sm:gap-6">
              {/* Publish form */}
              <Card className="lg:col-span-2 tender-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[#0A2647]">
                    <Plus className="w-4 h-4" /> Publish New Tender
                  </CardTitle>
                  <CardDescription>
                    Uploaded PDF is unlocked only for paid users — each PDF is auto-watermarked with the buyer's email. All registered users will receive an email alert on publish.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={publish} className="space-y-3">
                    <div>
                      <Label>Document Title (Work) *</Label>
                      <Input
                        value={form.title}
                        onChange={(e) =>
                          setForm({ ...form, title: e.target.value })
                        }
                        placeholder="Construction of new road from..."
                        required
                      />
                    </div>
                    <div>
                      <Label>Department Name *</Label>
                      <Input
                        value={form.department}
                        onChange={(e) =>
                          setForm({ ...form, department: e.target.value })
                        }
                        placeholder="Roads & Buildings Dept"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Last Date *</Label>
                        <Input
                          type="date"
                          value={form.last_date}
                          onChange={(e) =>
                            setForm({ ...form, last_date: e.target.value })
                          }
                          required
                        />
                      </div>
                      <div>
                        <Label>Category (Product/Service) *</Label>
                        <Select
                          value={form.category}
                          onValueChange={(v) =>
                            setForm({ ...form, category: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select Type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Product">Product</SelectItem>
                            <SelectItem value="Service">Service</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>District (TS & AP) *</Label>
                      <Select
                        value={form.district}
                        onValueChange={(v) =>
                          setForm({ ...form, district: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select District" />
                        </SelectTrigger>
                        <SelectContent>
                          {DISTRICTS.map((d) => (
                            <SelectItem key={d} value={d}>
                              {d}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Supply / Tender Details</Label>
                      <Textarea
                        rows={3}
                        value={form.supply_details}
                        onChange={(e) =>
                          setForm({ ...form, supply_details: e.target.value })
                        }
                        placeholder="Brief description of supply items, scope, EMD, etc."
                      />
                    </div>
                    <div>
                      <Label>PDF Document (Keep under 4 MB)</Label>
                      <div className="border-2 border-dashed rounded-md p-4 text-center bg-slate-50">
                        <input
                          type="file"
                          accept="application/pdf"
                          onChange={onPdfChange}
                          className="hidden"
                          id="pdf-input"
                        />
                        <label
                          htmlFor="pdf-input"
                          className="cursor-pointer flex flex-col items-center"
                        >
                          <Upload className="w-6 h-6 text-[#16a34a] mb-1" />
                          <span className="text-sm font-medium text-[#0A2647]">
                            {pdfName || 'Click to upload PDF'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Stored securely. Locked behind paywall.
                          </span>
                        </label>
                      </div>
                    </div>
                    <Button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-[#16a34a] hover:bg-[#15803d]"
                    >
                      {loading ? 'Publishing...' : 'Publish Tender & Notify Users'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Tender list */}
              <Card className="lg:col-span-3 tender-shadow">
                <CardHeader>
                  <CardTitle className="text-[#0A2647]">
                    Published Tenders ({tenders.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 max-h-[70vh] overflow-y-auto">
                  {tenders.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No tenders yet. Publish your first one!
                    </p>
                  )}
                  {tenders.map((t) => (
                    <div
                      key={t._id || t.id}
                      className="border rounded-md p-3 flex flex-col gap-3 hover:bg-slate-50 transition"
                    >
                      {/* Top Row: Details */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className="bg-[#0A2647]">
                              {t.district}
                            </Badge>
                            {t.category && (
                              <Badge variant="outline" className="text-xs">
                                {t.category}
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              Last:{' '}
                              {new Date(t.last_date).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="font-semibold text-[#0A2647] truncate">
                            {t.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t.department}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(t._id || t.id)}
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </div>
                      
                      {/* --- L1 PRICE MARKET INTELLIGENCE INPUT --- */}
                      <div className="bg-emerald-50/50 p-2 rounded-md border flex flex-col sm:flex-row gap-2 items-center w-full">
                         <div className="flex items-center gap-1 w-full sm:w-auto text-emerald-700 text-xs font-semibold whitespace-nowrap px-1">
                           <TrendingDown className="w-4 h-4" /> Market Intel:
                         </div>
                         <Input 
                            placeholder="L1 Price (₹)" type="number" 
                            className="h-8 text-xs bg-white w-full sm:w-32"
                            value={l1Data[t._id || t.id]?.price || t.l1_price || ''}
                            onChange={e => setL1Data(prev => ({...prev, [t._id || t.id]: {...prev[t._id || t.id], price: e.target.value}}))}
                         />
                         <Input 
                            placeholder="Winner Name (Optional)" 
                            className="h-8 text-xs bg-white w-full sm:flex-1"
                            value={l1Data[t._id || t.id]?.winner || t.l1_winner || ''}
                            onChange={e => setL1Data(prev => ({...prev, [t._id || t.id]: {...prev[t._id || t.id], winner: e.target.value}}))}
                         />
                         <Button size="sm" className="h-8 text-xs w-full sm:w-auto bg-[#0A2647] hover:bg-[#144272]" onClick={() => submitL1Price(t._id || t.id)}>
                            Save L1
                         </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB 3: TICKETS */}
          <TabsContent value="tickets" className="mt-4">
            <Card className="tender-shadow border-amber-200">
              <CardHeader className="bg-amber-50 border-b pb-4">
                <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg">
                  <MessageSquare className="w-5 h-5 text-amber-600" /> Client Tickets (24-Hour SLA Monitor)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 max-h-[500px] overflow-y-auto">
                {tickets.length === 0 ? (
                   <p className="text-sm text-muted-foreground text-center py-4">No active support tickets from clients.</p> 
                ) : (
                   <div className="grid md:grid-cols-2 gap-4">
                      {tickets.map(ticket => (
                         <div key={ticket._id} className="border rounded-md p-4 bg-white shadow-sm relative">
                            <div className="flex justify-between items-start mb-2">
                               <div>
                                 <Badge variant="outline" className="mb-1">{ticket.department}</Badge>
                                 <h4 className="font-bold text-[#0A2647] text-sm">{ticket.subject}</h4>
                                 <p className="text-xs text-muted-foreground">{ticket.client_email}</p>
                               </div>
                               <Badge className={ticket.status === 'RESOLVED' ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}>
                                 {ticket.status === 'OPEN' ? 'ACTION REQUIRED' : 'RESOLVED'}
                               </Badge>
                            </div>
                            <p className="text-sm text-slate-700 bg-slate-50 p-2 rounded border mb-3">"{ticket.message}"</p>
                            
                            {ticket.status === 'OPEN' ? (
                               <div className="flex gap-2">
                                 <Textarea 
                                    placeholder="Type your reply to the client..." 
                                    className="text-sm min-h-[40px] bg-slate-50"
                                    value={ticketReply[ticket._id] || ''}
                                    onChange={(e) => setTicketReply(prev => ({...prev, [ticket._id]: e.target.value}))}
                                 />
                                 <Button onClick={() => submitTicketReply(ticket._id)} className="bg-emerald-600 hover:bg-emerald-700 h-auto">
                                    <Send className="w-4 h-4" />
                                 </Button>
                               </div>
                            ) : (
                               <div className="bg-emerald-50 text-emerald-800 p-2 rounded text-xs border border-emerald-200">
                                  <span className="font-semibold">Resolved Reply:</span> {ticket.reply}
                               </div>
                            )}
                         </div>
                      ))}
                   </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 4: OPERATIONS & DISPATCH (MD Control for Alerts & Tasks) */}
          <TabsContent value="operations" className="mt-4">
            <div className="grid lg:grid-cols-2 gap-6">
               <Card className="tender-shadow border-t-4 border-t-purple-600">
                  <CardHeader className="bg-purple-50/50 border-b pb-4">
                     <CardTitle className="flex items-center gap-2 text-purple-900 text-lg">
                       <Send className="w-5 h-5 text-purple-600" /> Dispatch Alerts & Task Orders
                     </CardTitle>
                     <CardDescription>Raise requirements directly to clients or assign work orders to employees.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4">
                     <form onSubmit={handleDispatchTask} className="space-y-4">
                        <div className="flex gap-4 mb-2">
                           <label className="flex items-center gap-2 cursor-pointer bg-slate-50 p-2 border rounded-md w-full">
                              <input type="radio" name="target" value="client_alert" checked={taskForm.target_type === 'client_alert'} onChange={e => setTaskForm({...taskForm, target_type: e.target.value})} className="accent-purple-600" />
                              <span className="text-sm font-bold text-slate-700">Alert to Client</span>
                           </label>
                           <label className="flex items-center gap-2 cursor-pointer bg-slate-50 p-2 border rounded-md w-full">
                              <input type="radio" name="target" value="employee_task" checked={taskForm.target_type === 'employee_task'} onChange={e => setTaskForm({...taskForm, target_type: e.target.value})} className="accent-purple-600" />
                              <span className="text-sm font-bold text-slate-700">Task to Employee</span>
                           </label>
                        </div>
                        <div>
                           <Label>Target Email ID *</Label>
                           <Input type="email" placeholder="email@example.com" value={taskForm.email} onChange={e => setTaskForm({...taskForm, email: e.target.value})} required className="mt-1" />
                        </div>
                        <div>
                           <Label>Subject / Title *</Label>
                           <Input placeholder="e.g. Upload GST Certificate" value={taskForm.subject} onChange={e => setTaskForm({...taskForm, subject: e.target.value})} required className="mt-1" />
                        </div>
                        <div>
                           <Label>Detailed Requirement / Instructions *</Label>
                           <Textarea rows={3} placeholder="Describe exactly what needs to be done..." value={taskForm.message} onChange={e => setTaskForm({...taskForm, message: e.target.value})} required className="mt-1" />
                        </div>
                        <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700">
                           <ClipboardList className="w-4 h-4 mr-2" /> Dispatch Now
                        </Button>
                     </form>
                  </CardContent>
               </Card>

               {/* Track Operations */}
               <Card className="tender-shadow">
                  <CardHeader className="bg-slate-50 border-b pb-4">
                     <CardTitle className="text-[#0A2647] text-lg">Sent Dispatches & Status</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 max-h-[450px] overflow-y-auto">
                     {dispatches.length === 0 ? (
                        <p className="text-sm text-center text-slate-400 py-10">No alerts or tasks dispatched yet.</p>
                     ) : (
                        <div className="space-y-3">
                           {dispatches.map(d => (
                              <div key={d.id} className="p-3 border rounded-md bg-white shadow-sm flex flex-col gap-1.5">
                                 <div className="flex justify-between items-start">
                                    <Badge variant="outline" className={d.target_type === 'client_alert' ? "bg-orange-50 text-orange-700 border-orange-200" : "bg-blue-50 text-blue-700 border-blue-200"}>
                                       {d.target_type === 'client_alert' ? 'CLIENT ALERT' : 'EMPLOYEE TASK'}
                                    </Badge>
                                    <span className="text-[10px] text-slate-400">{d.date}</span>
                                 </div>
                                 <h4 className="font-bold text-sm text-[#0A2647]">{d.subject}</h4>
                                 <p className="text-xs text-slate-500">To: {d.email}</p>
                                 <p className="text-xs bg-slate-50 p-2 rounded mt-1 border border-slate-100">"{d.message}"</p>
                                 <div className="mt-1 flex justify-end">
                                    <Badge className="bg-slate-200 text-slate-600 border-0">{d.status}</Badge>
                                 </div>
                              </div>
                           ))}
                        </div>
                     )}
                  </CardContent>
               </Card>
            </div>
          </TabsContent>

          {/* TAB 5: TEAM ACCESS & OFFICER LOGINS */}
          <TabsContent value="team" className="mt-4">
            <div className="grid lg:grid-cols-2 gap-6">
               <Card className="tender-shadow border-t-4 border-t-blue-600">
                  <CardHeader className="bg-blue-50/50 border-b pb-4">
                     <CardTitle className="flex items-center gap-2 text-blue-900 text-lg">
                       <UserPlus className="w-5 h-5 text-blue-600" /> Create Officer / Employee Access
                     </CardTitle>
                     <CardDescription>Generate dedicated login credentials for your internal team.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4">
                     <form onSubmit={handleCreateOfficer} className="space-y-4">
                        <div>
                           <Label>Full Name *</Label>
                           <Input placeholder="e.g. Ramesh Kumar" value={officerForm.name} onChange={e => setOfficerForm({...officerForm, name: e.target.value})} required className="mt-1" />
                        </div>
                        <div>
                           <Label>Official Email ID *</Label>
                           <Input type="email" placeholder="officer@tgtenders.in" value={officerForm.email} onChange={e => setOfficerForm({...officerForm, email: e.target.value})} required className="mt-1" />
                        </div>
                        <div>
                           <Label>Assign Password *</Label>
                           <Input type="password" placeholder="Create a secure password" value={officerForm.password} onChange={e => setOfficerForm({...officerForm, password: e.target.value})} required className="mt-1" />
                        </div>
                        <div>
                           <Label>Role *</Label>
                           <Select value={officerForm.role} onValueChange={v => setOfficerForm({...officerForm, role: v})}>
                              <SelectTrigger className="mt-1"><SelectValue placeholder="Select Role" /></SelectTrigger>
                              <SelectContent>
                                 <SelectItem value="officer">Tender Officer (SLA & Docs)</SelectItem>
                                 <SelectItem value="employee">Data Entry Employee</SelectItem>
                                 <SelectItem value="admin">Sub-Admin (Manager)</SelectItem>
                              </SelectContent>
                           </Select>
                        </div>
                        <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700">
                           <Key className="w-4 h-4 mr-2" /> Generate Access ID
                        </Button>
                     </form>
                  </CardContent>
               </Card>

               <Card className="tender-shadow">
                  <CardHeader className="bg-slate-50 border-b pb-4">
                     <CardTitle className="text-[#0A2647] text-lg">Active Team Members</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                     <div className="space-y-3">
                        {officers.map(off => (
                           <div key={off.id} className="p-3 border rounded-md bg-white shadow-sm flex items-center justify-between">
                              <div>
                                 <h4 className="font-bold text-[#0A2647] text-sm">{off.name}</h4>
                                 <p className="text-xs text-slate-500">{off.email}</p>
                                 <Badge variant="outline" className="mt-1 text-[10px] uppercase tracking-wider bg-slate-100">{off.role}</Badge>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                 <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Active</Badge>
                                 <Button variant="ghost" size="sm" className="h-6 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2">Revoke</Button>
                              </div>
                           </div>
                        ))}
                     </div>
                  </CardContent>
               </Card>
            </div>
          </TabsContent>

          {/* TAB 6: BRAND SETTINGS */}
          <TabsContent value="settings" className="mt-4">
            <BrandSettings token={token} />
          </TabsContent>
        </Tabs>

      </main>

      {/* MD DIRECT ACCESS DIALOG (VIEW & MANAGE CLIENT) */}
      <Dialog open={!!selectedClient} onOpenChange={(open) => !open && setSelectedClient(null)}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto bg-slate-50 p-0 border-0">
           {selectedClient && (
             <>
               <div className="bg-[#0A2647] p-6 text-white sticky top-0 z-10 flex justify-between items-start shadow-md">
                 <div>
                    <h2 className="text-2xl font-bold">{selectedClient.company_name}</h2>
                    <p className="text-emerald-400 text-sm mt-1">{selectedClient.email} • {selectedClient.phone || 'Phone N/A'}</p>
                 </div>
                 <Badge className="bg-emerald-500 text-white border-0">Profile Access Mode</Badge>
               </div>
               
               <div className="p-6 space-y-6">
                 {/* Internal Notes / Quick Edit Section */}
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
                          <div>
                             <Label className="text-xs text-blue-800">Assign PAN Number</Label>
                             <Input defaultValue={selectedClient.pan_number || ''} placeholder="Update PAN..." className="h-8 text-xs bg-white mt-1"/>
                          </div>
                          <div>
                             <Label className="text-xs text-blue-800">Internal MD Notes / Description</Label>
                             <Textarea defaultValue={selectedClient.business_desc || ''} placeholder="Write internal notes about this client's requirements..." className="h-16 text-xs bg-white mt-1"/>
                          </div>
                          <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700 h-8">Save Client Details to Database</Button>
                       </CardContent>
                    </Card>
                 </div>

                 {/* Available Documents Checklist */}
                 <h3 className="font-bold text-[#0A2647] border-b pb-2">Client Document Vault (Reported Status)</h3>
                 <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {['has_pan', 'has_gst', 'has_bank', 'has_msme', 'has_iso', 'has_dsc', 'has_aadhar', 'has_turnover'].map(docKey => (
                       <div key={docKey} className="flex justify-between items-center bg-white p-2 border rounded text-xs shadow-sm">
                          <span className="font-semibold text-slate-700 uppercase">{docKey.replace('has_', '')}</span>
                          {selectedClient[docKey] ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <span className="text-slate-300">Missing</span>}
                       </div>
                    ))}
                 </div>

                 {/* Action Panel */}
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
    <Card className={accent ? 'border-[#16a34a] bg-emerald-50' : ''}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-[10px] sm:text-xs mb-1">
          {icon} {label}
        </div>
        <div className="text-xl sm:text-2xl font-bold text-[#0A2647]">{value}</div>
      </CardContent>
    </Card>
  );
}

function BrandSettings({ token }) {
  const [logoPreview, setLogoPreview] = useState('');
  const [brandName, setBrandName] = useState('Telangana & AP Tenders');
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
    if (!f.type.startsWith('image/')) {
      toast.error('Please upload an image file (PNG/JPG/WebP/SVG)');
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      toast.error('Logo too large. Keep under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result?.toString() || '';
      setLogoPreview(result); 
    };
    reader.readAsDataURL(f);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { 
        name: brandName, 
        tagline: tagline,
        logo: logoPreview 
      };
      
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      
      if (!r.ok) {
        toast.error('Failed to save');
        return;
      }
      toast.success('Brand settings saved. Refresh the home page to see the new logo.');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('An error occurred while saving.');
    } finally {
      setSaving(false);
    }
  };

  const removeLogo = async () => {
    if (!confirm('Remove uploaded logo?')) return;
    await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: brandName, tagline: tagline, logo: null }),
    });
    setLogoPreview('');
    toast.success('Logo removed');
  };

  return (
    <Card className="tender-shadow">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-[#0A2647] text-base">
          <ImageIcon className="w-4 h-4" /> Brand Identity & Security
        </CardTitle>
        <CardDescription className="text-xs">
          Upload your logo (shown across the site) and set the brand name.
          Every paid PDF is automatically watermarked with the buyer's email.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-3 gap-4 items-start">
          <div className="flex flex-col items-center gap-3">
            <div className="w-24 h-24 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden flex items-center justify-center">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="logo" className="w-full h-full object-contain" />
              ) : (
                <ImageIcon className="w-8 h-8 text-slate-300" />
              )}
            </div>
            <div className="flex gap-2">
              <label className="cursor-pointer">
                <input type="file" accept="image/*" onChange={onLogoChange} className="hidden" />
                <span className="inline-flex items-center text-xs px-3 py-1.5 bg-[#0A2647] text-white rounded-md">
                  <Upload className="w-3 h-3 mr-1" /> Upload
                </span>
              </label>
              {logoPreview && (
                <button
                  onClick={removeLogo}
                  className="inline-flex items-center text-xs px-3 py-1.5 bg-white border rounded-md text-red-500"
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Remove
                </button>
              )}
            </div>
          </div>
          <div className="sm:col-span-2 space-y-3">
            <div>
              <Label>Brand Name</Label>
              <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} />
            </div>
            <div>
              <Label>Tagline</Label>
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={save}
                disabled={saving}
                className="bg-[#16a34a] hover:bg-[#15803d]"
              >
                {saving ? 'Saving...' : 'Save Brand Settings'}
              </Button>
              <span className="text-xs text-emerald-700 inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> PDF watermarking is ON for all paid downloads
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
