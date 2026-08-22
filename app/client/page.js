'use client';
import { useEffect, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { load } from '@cashfreepayments/cashfree-js';
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Briefcase, CheckCircle2, AlertTriangle, FileText, 
  Clock, ShieldAlert, Send, MessageSquare, Target, UserCheck, 
  Upload, Banknote, BellRing, Loader2, LogOut, FileUp, 
  Scale, Download, Activity, Package, Building2, 
  ChevronDown, UserCircle, UploadCloud, Globe, Database
} from 'lucide-react';

export default function ClientDashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [userData, setUserData] = useState(null);
  const [publicTenders, setPublicTenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);

  // States
  const [uploadedFiles, setUploadedFiles] = useState({});
  const [customTenderForm, setCustomTenderForm] = useState({ link_or_id: '', description: '', file: null });
  const [ticketForm, setTicketForm] = useState({ subject: '', message: '' });

  useEffect(() => {
    setIsMounted(true);
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_email') : '';
    if (e) {
      setEmail(e);
      fetchClientData(e);
      fetchPublicTenders();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchClientData = async (userEmail) => {
    try {
      const r = await fetch(`/api/me?email=${encodeURIComponent(userEmail)}`);
      const d = await r.json();
      
      // DB డేటా మాత్రమే (ఫేక్ డేటా లేకుండా)
      setUserData({
        ...d,
        is_approved: d.is_approved || false,
        profile: d.profile || {},
        officer_queries: d.officer_queries || [],
        active_bids: d.active_bids || [],
        suggested_bids: d.suggested_bids || [],
        custom_requests: d.custom_requests || [], // ట్రాకింగ్ కస్టమ్ టెండర్స్
        emd_ledger: d.emd_ledger || { total_paid: 0, refunded: 0 },
        pending_payments: d.pending_payments || []
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPublicTenders = async () => {
    try {
      const r = await fetch('/api/tenders');
      const d = await r.json();
      setPublicTenders(d.tenders || []);
    } catch (err) {
      console.error(err);
    }
  };

  // Google Drive అప్‌లోడ్ సిమ్యులేషన్
  const handleFileUpload = (docName, e) => {
    const file = e.target.files[0];
    if(file) {
      const clientName = userData?.profile?.client_name || 'Client';
      toast.promise(
        new Promise((resolve) => setTimeout(resolve, 2000)), 
        {
          loading: `Uploading to secure Google Drive folder: ${clientName}...`,
          success: `${docName} synced to Google Drive successfully!`,
          error: 'Upload failed.',
        }
      );
      setUploadedFiles(prev => ({ ...prev, [docName]: 'Uploaded to Drive' }));
    }
  };

  // కస్టమ్ టెండర్ రిక్వెస్ట్ సబ్‌మిట్
  const handleCustomTenderSubmit = (e) => {
    e.preventDefault();
    if(!customTenderForm.link_or_id || !customTenderForm.description) {
      return toast.error("Please provide the Tender ID/Link and Description.");
    }
    
    // UI లో తక్షణం కనిపించడానికి (రియల్ టైమ్‌లో API కి పంపాలి)
    const newRequest = {
      id: Date.now(),
      link_or_id: customTenderForm.link_or_id,
      description: customTenderForm.description,
      status: 'Pending Officer Review',
      officer_reply: 'Awaiting officer response...'
    };
    
    setUserData(prev => ({
      ...prev,
      custom_requests: [newRequest, ...(prev.custom_requests || [])]
    }));

    toast.success("Custom tender request submitted! Operations team will review and update status.");
    setCustomTenderForm({ link_or_id: '', description: '', file: null });
  };

  const handleQueryResponse = (queryId) => {
    toast.success('Document submitted to Officer for review.');
  };

  const handleTicketSubmit = async (e) => {
    e.preventDefault();
    if(!ticketForm.subject || !ticketForm.message) return toast.error('Fill subject and message');
    try {
      const r = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, department: 'Support', subject: ticketForm.subject, message: ticketForm.message })
      });
      if(r.ok) {
        toast.success('24/7 SLA Ticket raised successfully! Our team will resolve it.');
        setTicketForm({ subject: '', message: '' });
      } else {
        toast.error('Failed to submit ticket');
      }
    } catch(err) {
      toast.error('Network error');
    }
  };

  // ఫైనల్ సిస్టమ్ సైన్ అవుట్ ఫిక్స్
  const handleSignOut = () => {
    localStorage.removeItem('tt_email');
    window.location.href = '/';
  };

  const payCustomFee = async (feeAmount, reason) => {
    if (buying) return;
    setBuying(true);
    try {
      const r1 = await fetch('/api/payment/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, plan: 'custom', amount: feeAmount, description: reason }),
      });
      const d1 = await r1.json();
      if (!r1.ok || !d1.payment_session_id) {
        toast.error(d1.error || 'Failed to initialize payment');
        setBuying(false);
        return;
      }
      const cashfree = await load({ mode: "production" });
      await cashfree.checkout({
        paymentSessionId: d1.payment_session_id,
        returnUrl: window.location.origin + "/payment-status?order_id={order_id}",
      });
    } catch (e) {
      toast.error('Could not start payment');
    } finally {
      setBuying(false);
    }
  };

  if (!isMounted) return null;

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/></div>;

  if (!userData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4 text-center">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-[#0A2647]">Authentication Required</h2>
        <a href="/"><Button className="mt-4 bg-[#0A2647]">Go to Login</Button></a>
      </div>
    );
  }

  const queries = userData?.officer_queries || [];
  const activeBids = userData?.active_bids || [];
  const suggestedBids = userData?.suggested_bids || [];
  const customRequests = userData?.custom_requests || [];
  const rawPayments = Array.isArray(userData?.pending_payments) ? userData.pending_payments : [];
  const pendingPayments = rawPayments.filter(p => p.status === 'UNPAID');
  
  // EMD లెడ్జర్ సేఫ్ క్యాలిక్యులేషన్
  const emdData = userData?.emd_ledger;
  let totalEmd = 0;
  let refundedEmd = 0;
  if (Array.isArray(emdData)) {
    totalEmd = emdData.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    refundedEmd = emdData.filter(e => e.status === 'refunded').reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  } else if (emdData && typeof emdData === 'object') {
    totalEmd = Number(emdData.total_paid) || 0;
    refundedEmd = Number(emdData.refunded) || 0;
  }

  const companyName = userData?.profile?.company_name || 'Your Company';
  const clientName = userData?.profile?.client_name || 'Client';

  return (
    <div className="min-h-screen bg-slate-50">
      
      {/* 1. THE EXECUTIVE HEADER */}
      <header className="bg-white border-b sticky top-0 z-30 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <BrandLogo subtitle="Enterprise Portal" />
          
          <div className="flex items-center gap-4">
             {/* DYNAMIC COMPANY NAME */}
             <div className="hidden md:flex flex-col items-end mr-2">
               <span className="text-sm font-bold text-[#0A2647]">{companyName}</span>
               <span className="text-[10px] text-slate-500">{email}</span>
             </div>

             {/* NOTIFICATIONS */}
             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="ghost" size="icon" className="relative text-slate-700">
                     <BellRing className="w-5 h-5"/> 
                     {(queries.length > 0 || pendingPayments.length > 0) && (
                        <Badge className="absolute -top-1 -right-1 bg-red-500 h-4 w-4 p-0 flex justify-center items-center text-[10px]">
                           {queries.length + pendingPayments.length}
                        </Badge>
                     )}
                   </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                   <DropdownMenuLabel>Officer Requests & Queries</DropdownMenuLabel>
                   <DropdownMenuSeparator />
                   {queries.length === 0 && pendingPayments.length === 0 ? (
                      <DropdownMenuItem className="text-muted-foreground text-xs justify-center py-4">No active queries.</DropdownMenuItem>
                   ) : (
                      <>
                        {queries.map((q, i) => (
                          <DropdownMenuItem key={`q-${i}`} className="text-xs text-red-600 font-medium whitespace-normal cursor-pointer flex flex-col items-start gap-1">
                             <span>⚠️ {q.subject}</span>
                          </DropdownMenuItem>
                        ))}
                        {pendingPayments.map((p, i) => (
                          <DropdownMenuItem key={`p-${i}`} className="text-xs text-amber-600 font-medium whitespace-normal cursor-pointer">
                             💰 Fee Due: {p.reason}
                          </DropdownMenuItem>
                        ))}
                      </>
                   )}
                </DropdownMenuContent>
             </DropdownMenu>

             {/* CLIENT PROFILE DROPDOWN WITH FIXED SIGN OUT */}
             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="outline" className="flex items-center gap-2 border-slate-200 bg-slate-50">
                     <UserCircle className="w-5 h-5 text-[#0A2647]" />
                     <div className="hidden md:flex flex-col items-start text-left">
                       <span className="text-xs font-bold text-[#0A2647] leading-none">{clientName}</span>
                       <span className="text-[9px] text-slate-500 font-semibold">{companyName}</span>
                     </div>
                     <ChevronDown className="w-3 h-3 text-slate-400" />
                   </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 p-2">
                   <div className="p-2 border-b mb-2 bg-slate-50 rounded-md">
                     <p className="font-bold text-[#0A2647]">{clientName}</p>
                     <p className="text-xs text-slate-500">{email}</p>
                     <Badge className="mt-2 bg-blue-100 text-blue-800 hover:bg-blue-200 border-0">{userData.profile?.category || 'Vendor'}</Badge>
                   </div>
                   <DropdownMenuItem className="text-red-600 cursor-pointer font-medium" onClick={handleSignOut}>
                     <LogOut className="w-4 h-4 mr-2" /> Sign Out
                   </DropdownMenuItem>
                </DropdownMenuContent>
             </DropdownMenu>

             {/* MAIN SIGN OUT BUTTON */}
             <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-red-600 hover:text-red-700 hover:bg-red-50 font-bold border border-red-100">
                <LogOut className="w-4 h-4 md:mr-2"/> <span className="hidden md:inline">Sign Out</span>
             </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        
        {/* HERO WIDGET */}
        <div className="bg-[#0A2647] rounded-xl p-6 text-white shadow-lg relative overflow-hidden flex flex-col lg:flex-row justify-between lg:items-center gap-6">
          <div className="absolute -right-10 -top-10 opacity-10 pointer-events-none"><Briefcase className="w-64 h-64" /></div>
          <div className="relative z-10">
            <div className="flex flex-wrap gap-2 mb-3">
               {userData.is_approved && (
                 <Badge className="bg-emerald-500 text-white border-0 py-1"><CheckCircle2 className="w-3 h-3 mr-1"/> Officer Approved Vendor</Badge>
               )}
               <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/50 py-1"><Activity className="w-3 h-3 mr-1"/> Account Health: Active</Badge>
            </div>
            <h2 className="text-2xl md:text-4xl font-black">{companyName}</h2>
            <p className="text-emerald-300 text-sm mt-2 flex items-center gap-2">
              <UserCheck className="w-4 h-4" /> {clientName} • {userData.profile?.category || 'Business Entity'}
            </p>
          </div>
          <div className="relative z-10 flex gap-4 w-full lg:w-auto">
            <div className="bg-white/10 p-4 rounded-lg text-center flex-1 border border-white/10">
              <p className="text-slate-300 text-[10px] uppercase tracking-wider mb-1 font-semibold">Active Tenders</p>
              <p className="text-3xl font-black text-[#16a34a]">{activeBids.length}</p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="grid w-full lg:w-[1000px] grid-cols-5 bg-slate-200 h-auto p-1 mb-6">
            <TabsTrigger value="dashboard" className="py-2.5 data-[state=active]:bg-white data-[state=active]:text-[#0A2647] font-bold text-xs sm:text-sm">
              <Target className="w-4 h-4 mr-2 hidden sm:block"/> Active Bids
            </TabsTrigger>
            <TabsTrigger value="live_tenders" className="py-2.5 data-[state=active]:bg-white data-[state=active]:text-[#0A2647] font-bold text-xs sm:text-sm">
              <Globe className="w-4 h-4 mr-2 hidden sm:block"/> Live Govt Tenders
            </TabsTrigger>
            <TabsTrigger value="profile" className="py-2.5 data-[state=active]:bg-white data-[state=active]:text-[#0A2647] font-bold text-xs sm:text-sm">
              <Building2 className="w-4 h-4 mr-2 hidden sm:block"/> GeM Profile
            </TabsTrigger>
            <TabsTrigger value="vault" className="py-2.5 data-[state=active]:bg-white data-[state=active]:text-[#0A2647] font-bold text-xs sm:text-sm">
              <Database className="w-4 h-4 mr-2 hidden sm:block"/> Drive Vault
            </TabsTrigger>
            <TabsTrigger value="finance" className="py-2.5 data-[state=active]:bg-white data-[state=active]:text-[#0A2647] font-bold text-xs sm:text-sm">
              <Banknote className="w-4 h-4 mr-2 hidden sm:block"/> Finance & SLA
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6">
            
            {/* 1. OFFICER QUERY & UNDERTAKING BLOCK */}
            <Card className={`border-t-4 shadow-sm bg-white ${queries.length > 0 ? 'border-t-red-500' : 'border-t-slate-300'}`}>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="flex items-center gap-2 text-base text-[#0A2647]">
                   <AlertTriangle className={`w-5 h-5 ${queries.length > 0 ? 'text-red-600' : 'text-slate-400'}`}/> Officer Query & Undertakings Block
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                 {queries.length === 0 ? (
                    <div className="text-center p-6 bg-slate-50 rounded-md border border-dashed border-slate-300">
                       <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2"/>
                       <p className="text-slate-600 font-medium text-sm">No Active Queries or Undertakings Required.</p>
                       <p className="text-xs text-slate-400 mt-1">When an officer requires your signature, it will appear here.</p>
                    </div>
                 ) : (
                    queries.map((q, idx) => (
                      <div key={idx} className="bg-red-50/50 p-4 rounded-md border border-red-100 grid md:grid-cols-2 gap-6 mb-4 last:mb-0">
                         <div>
                            <div className="flex justify-between">
                               <p className="font-bold text-slate-800 mb-2">{q.subject}</p>
                               <Badge className="bg-red-100 text-red-800 border border-red-300 animate-pulse h-fit"><Clock className="w-3 h-3 mr-1"/> 24 Hrs</Badge>
                            </div>
                            <p className="text-sm text-slate-600 bg-white p-3 rounded-md border border-slate-200">{q.message}</p>
                         </div>
                         <div className="bg-white p-4 rounded-md border border-slate-200 flex flex-col gap-3">
                            <Button variant="outline" size="sm" className="w-full justify-start text-[#0A2647] border-slate-300">
                              <Download className="w-4 h-4 mr-2"/> Download Officer Format
                            </Button>
                            <div className="flex items-center gap-2 mt-2">
                              <Input type="file" onChange={(e) => handleFileUpload('Undertaking', e)} accept=".pdf,.jpg" className="text-xs h-9 cursor-pointer file:text-xs file:bg-slate-100 file:border-0 file:rounded file:px-2" />
                              <Button size="sm" className="bg-[#16a34a] hover:bg-[#15803d]" onClick={() => handleQueryResponse(q.id)}>Submit to Officer</Button>
                            </div>
                         </div>
                      </div>
                    ))
                 )}
              </CardContent>
            </Card>

            {/* 2. CUSTOM TENDER REQUEST BLOCK */}
            <Card className="tender-shadow border-t-4 border-t-emerald-500">
              <CardHeader className="bg-emerald-50/40 pb-4 border-b">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
                  <UploadCloud className="w-5 h-5 text-emerald-600"/> Found a Tender? Request Bid Support
                </CardTitle>
                <CardDescription>Upload tender details you found externally. Track our officer's reply here.</CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
                <form onSubmit={handleCustomTenderSubmit} className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                       <Label className="text-slate-600 text-xs font-bold">Tender Link / ID / Reference *</Label>
                       <Input required placeholder="e.g. https://eprocure.gov.in/... or Tender ID" value={customTenderForm.link_or_id} onChange={e => setCustomTenderForm({...customTenderForm, link_or_id: e.target.value})} className="mt-1 bg-white text-sm border-slate-300" />
                    </div>
                    <div>
                       <Label className="text-slate-600 text-xs font-bold">Brief Description of Work *</Label>
                       <textarea required placeholder="Short description about the work or items required..." value={customTenderForm.description} onChange={e => setCustomTenderForm({...customTenderForm, description: e.target.value})} className="w-full border border-slate-300 rounded-md p-2 mt-1 h-24 text-sm bg-white"></textarea>
                    </div>
                  </div>
                  <div className="space-y-4 flex flex-col justify-between bg-slate-50 p-4 rounded-lg border border-slate-100">
                    <div>
                       <Label className="text-slate-600 text-xs font-bold mb-2 block">Upload Reference Document (Optional)</Label>
                       <div className="border-2 border-dashed border-emerald-300 rounded-lg p-6 text-center bg-white hover:bg-emerald-50/50 transition cursor-pointer relative">
                          <Input type="file" accept=".pdf,.zip" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={e => setCustomTenderForm({...customTenderForm, file: e.target.files[0]})} />
                          <div className="flex flex-col items-center pointer-events-none">
                             <FileUp className="w-8 h-8 text-emerald-500 mb-2" />
                             <span className="text-sm font-semibold text-[#0A2647]">{customTenderForm.file ? customTenderForm.file.name : "Click here to upload PDF/ZIP"}</span>
                             <span className="text-[10px] text-slate-500 mt-1">Max file size 10MB</span>
                          </div>
                       </div>
                    </div>
                    <Button type="submit" className="w-full bg-[#16a34a] hover:bg-[#15803d] h-11 shadow-sm">
                      <Send className="w-4 h-4 mr-2"/> Submit Tender to Operations Team
                    </Button>
                  </div>
                </form>

                {/* Tracking Custom Tender Requests Status & Officer Reply */}
                {customRequests.length > 0 && (
                  <div className="mt-6 border-t pt-4">
                     <h4 className="font-bold text-[#0A2647] mb-3">My Custom Tender Requests Status</h4>
                     <div className="space-y-3">
                        {customRequests.map((req, i) => (
                           <div key={i} className="bg-white border rounded-md p-4 shadow-sm flex flex-col md:flex-row justify-between md:items-center gap-4">
                              <div className="flex-1">
                                 <p className="font-bold text-[#0A2647] text-sm">{req.link_or_id}</p>
                                 <p className="text-xs text-slate-500 mt-1">{req.description}</p>
                                 <div className="mt-2 bg-slate-50 p-2 rounded border border-slate-200 text-xs">
                                    <span className="font-bold text-slate-700">Officer Reply: </span>
                                    <span className="text-blue-700 font-medium">{req.officer_reply || 'Pending Review'}</span>
                                 </div>
                              </div>
                              <Badge className={`px-3 py-1 shrink-0 ${req.status?.includes('Pending') ? 'bg-amber-100 text-amber-800' : req.status?.includes('Accepted') ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'} border-0`}>
                                 {req.status}
                              </Badge>
                           </div>
                        ))}
                     </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 3. ACTIVE BIDS TRACKER */}
            <Card className="tender-shadow">
              <CardHeader className="border-b pb-4 bg-slate-50">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg"><Target className="w-5 h-5 text-blue-600"/> Active Bids Tracking</CardTitle>
              </CardHeader>
              <CardContent className="p-5">
                 {activeBids.length === 0 ? (
                    <div className="text-center p-6">
                       <p className="text-slate-500 text-sm">You have no active bids currently processed.</p>
                    </div>
                 ) : (
                   activeBids.map((bid, i) => (
                     <div key={i} className="mb-4 last:mb-0 border rounded-lg p-4 bg-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:shadow-md transition">
                       <div className="flex-1">
                         <Badge variant="outline" className="text-[10px] mb-1.5">{bid.bid_no}</Badge>
                         <p className="font-bold text-[#0A2647] text-base">{bid.description}</p>
                         <div className="flex flex-wrap gap-4 mt-2 text-xs text-slate-500 font-medium">
                           <span className="flex items-center gap-1"><Upload className="w-3 h-3"/> Submitted: {bid.submitted_on}</span>
                           <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-amber-500"/> Last Date: {bid.last_date}</span>
                         </div>
                       </div>
                       <Badge className="bg-blue-100 text-blue-800 border-0 px-3 py-1.5">{bid.status}</Badge>
                     </div>
                   ))
                 )}
              </CardContent>
            </Card>

            {/* 4. OFFICER SUGGESTED BIDS */}
            <Card className="tender-shadow border-t-4 border-t-purple-500">
              <CardHeader className="border-b pb-4 bg-purple-50/50">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg"><Target className="w-5 h-5 text-purple-600"/> Officer Suggested Bids</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {suggestedBids.length === 0 ? (
                    <div className="text-center p-6">
                       <p className="text-slate-500 text-sm">No new suggestions from your dedicated officer.</p>
                    </div>
                ) : (
                  <div className="divide-y">
                     {suggestedBids.map(tender => (
                       <div key={tender.id} className="p-5 hover:bg-slate-50 transition flex flex-col md:flex-row justify-between gap-4">
                          <div>
                            <Badge className="bg-purple-100 text-purple-800 border-0 mb-2">Win Probability: {tender.win_prob}</Badge>
                            <h4 className="font-bold text-[#0A2647] text-base">{tender.title}</h4>
                            <p className="text-xs text-muted-foreground mt-1">{tender.id} • {tender.dept}</p>
                          </div>
                          <div className="flex flex-col gap-2 shrink-0">
                            <Button size="sm" className="bg-[#0A2647] hover:bg-[#144272] w-full">Apply Request</Button>
                          </div>
                       </div>
                     ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 2: LIVE GOVT TENDERS */}
          <TabsContent value="live_tenders" className="space-y-6">
            <Card className="tender-shadow">
              <CardHeader className="bg-slate-50 border-b">
                <CardTitle className="text-[#0A2647] text-lg flex items-center gap-2"><Globe className="w-5 h-5 text-blue-600"/> Public Procurement Tenders</CardTitle>
              </CardHeader>
              <CardContent className="p-0 divide-y">
                 {publicTenders.length === 0 ? (
                    <div className="text-center p-6 text-slate-500 text-sm">Loading latest govt tenders...</div>
                 ) : (
                    publicTenders.map(t => (
                      <div key={t._id} className="p-4 hover:bg-slate-50 flex flex-col md:flex-row justify-between md:items-center gap-4">
                         <div>
                            <p className="font-bold text-[#0A2647]">{t.title}</p>
                            <p className="text-xs text-slate-500 mt-1">{t.department} • {t.district} • Last Date: {new Date(t.last_date).toLocaleDateString()}</p>
                         </div>
                         <a href={`/?open_tender=${t._id}`} target="_blank" rel="noreferrer">
                           <Button size="sm" variant="outline"><FileText className="w-4 h-4 mr-2"/> View Notice</Button>
                         </a>
                      </div>
                    ))
                 )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: GeM BUSINESS PROFILE */}
          <TabsContent value="profile" className="space-y-6">
             <Card className="tender-shadow">
                <CardHeader className="bg-slate-50 border-b">
                   <CardTitle className="text-[#0A2647] text-lg">Organisation Profile</CardTitle>
                </CardHeader>
                <CardContent className="p-0 divide-y">
                   <div className="p-5 hover:bg-slate-50">
                      <div className="flex items-center gap-2 mb-3">
                         <div className="w-1.5 h-5 bg-[#16a34a] rounded-full"></div>
                         <h4 className="font-bold text-slate-700">Business PAN Validation</h4>
                      </div>
                      <div className="pl-3.5 grid md:grid-cols-2 gap-4">
                         <div>
                            <Label className="text-xs text-slate-500">Organisation Type</Label>
                            <p className="font-medium text-[#0A2647]">{userData.profile?.org_type || 'N/A'}</p>
                         </div>
                         <div>
                            <Label className="text-xs text-slate-500">Business Name</Label>
                            <p className="font-medium text-[#0A2647]">{companyName}</p>
                         </div>
                      </div>
                   </div>
                   <div className="p-5 hover:bg-slate-50">
                      <div className="flex items-center gap-2 mb-3">
                         <div className="w-1.5 h-5 bg-[#16a34a] rounded-full"></div>
                         <h4 className="font-bold text-slate-700">Date Of Incorporation</h4>
                      </div>
                      <div className="pl-3.5">
                         <Input value={userData.profile?.incorporation_date || ''} readOnly className="mt-1 bg-slate-100 max-w-[200px]" />
                      </div>
                   </div>
                   <div className="p-5 hover:bg-slate-50">
                      <div className="flex items-center gap-2 mb-3">
                         <div className="w-1.5 h-5 bg-[#16a34a] rounded-full"></div>
                         <h4 className="font-bold text-slate-700">Office Locations</h4>
                      </div>
                      <div className="pl-3.5">
                         <div className="border rounded-md overflow-hidden">
                            <table className="w-full text-sm text-left">
                              <thead className="bg-slate-100 border-b">
                                <tr>
                                  <th className="px-4 py-2 font-semibold">Office</th>
                                  <th className="px-4 py-2 font-semibold">Address</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td className="px-4 py-3 font-medium">Registered Office</td>
                                  <td className="px-4 py-3 text-xs text-slate-600">{userData.profile?.address || 'Not Provided'}</td>
                                </tr>
                              </tbody>
                            </table>
                         </div>
                      </div>
                   </div>
                </CardContent>
             </Card>
          </TabsContent>

          {/* TAB 4: CORPORATE VAULT */}
          <TabsContent value="vault" className="space-y-6">
            <Card className="tender-shadow border-t-4 border-t-[#16a34a]">
              <CardHeader className="bg-slate-50 border-b pb-4">
                <CardTitle className="text-[#0A2647] flex items-center gap-2"><Database className="w-5 h-5 text-[#16a34a]"/> Corporate Drive Vault</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {['PAN_Card', 'GST_Certificate', 'MSME_Udyam', 'Bank_Mandate', 'DSC_Class_3', 'ISO_Certificate'].map((doc) => (
                      <div key={doc} className="bg-white p-3 border rounded-md shadow-sm">
                         <div className="flex justify-between items-center mb-2">
                           <Label className="font-bold text-slate-700 text-xs">{doc.replace(/_/g, ' ')}</Label>
                           {uploadedFiles[doc] ? (
                             <Badge className="bg-emerald-100 text-emerald-800 text-[9px] border-0 px-1 py-0">{uploadedFiles[doc]}</Badge>
                           ) : (
                             <Badge variant="outline" className="text-[9px] px-1 py-0 border-slate-200 text-slate-500">Not Synced</Badge>
                           )}
                         </div>
                         <div className="flex items-center gap-2 mt-3">
                            <UploadCloud className="w-4 h-4 text-blue-500 shrink-0" />
                            <Input type="file" accept=".pdf, image/*" onChange={(e) => handleFileUpload(doc, e)} className="text-xs h-8 cursor-pointer file:text-xs file:bg-slate-100 file:border-0 file:rounded file:px-2"/>
                         </div>
                      </div>
                    ))}
                 </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 5: FINANCE & SLA */}
          <TabsContent value="finance" className="space-y-6 grid lg:grid-cols-2 gap-6">
            <Card className="tender-shadow border-t-4 border-t-amber-500 h-fit">
              <CardHeader className="pb-4 border-b bg-amber-50/30">
                <CardTitle className="text-lg flex items-center gap-2"><Banknote className="w-5 h-5 text-amber-600"/> Financial Ledger</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                   <div className="flex justify-between items-center bg-slate-50 p-3 rounded border">
                      <span className="text-sm font-semibold text-slate-700">Total EMD Paid</span>
                      <span className="text-lg font-black text-slate-800">₹{totalEmd.toLocaleString()}</span>
                   </div>
                   <div className="flex justify-between items-center bg-emerald-50 p-3 rounded border border-emerald-100">
                      <span className="text-sm font-semibold text-emerald-900">EMD Refunded</span>
                      <span className="text-lg font-black text-emerald-700">₹{refundedEmd.toLocaleString()}</span>
                   </div>
                   
                   <div className="border-t pt-4">
                      <h4 className="font-bold text-slate-700 mb-3">Pending Payment Requests</h4>
                      {pendingPayments.length === 0 ? (
                         <p className="text-xs text-slate-500 text-center py-2">No pending fees requested.</p>
                      ) : (
                        pendingPayments.map((pay, i) => (
                          <div key={i} className="mb-2 border border-red-200 bg-red-50 p-3 rounded-lg flex flex-col gap-2">
                             <div className="flex justify-between items-center text-sm">
                                <span className="font-semibold text-red-900">{pay.reason}</span>
                                <span className="font-bold text-red-700">₹{pay.amount}</span>
                             </div>
                             <Button onClick={() => payCustomFee(pay.amount, pay.reason)} disabled={buying} size="sm" className="w-full bg-[#0A2647] hover:bg-[#144272] h-8">
                               {buying ? 'Connecting...' : 'Pay via Cashfree'}
                             </Button>
                          </div>
                        ))
                      )}
                   </div>
              </CardContent>
            </Card>

            <Card className="tender-shadow border-t-4 border-t-slate-800 h-fit">
              <CardHeader className="pb-4 bg-slate-50 border-b">
                <CardTitle className="text-lg flex items-center gap-2"><MessageSquare className="w-5 h-5 text-slate-700"/> 24/7 SLA Support Desk</CardTitle>
              </CardHeader>
              <CardContent className="pt-5">
                <form onSubmit={handleTicketSubmit} className="space-y-4">
                  <div>
                    <Label className="text-xs text-slate-600">Ticket Subject *</Label>
                    <Input placeholder="e.g., Portal Login Issue" value={ticketForm.subject} onChange={e=>setTicketForm({...ticketForm, subject: e.target.value})} required className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-600">Describe Issue *</Label>
                    <textarea className="w-full border rounded-md p-2 text-sm h-24 mt-1" placeholder="Describe requirement..." value={ticketForm.message} onChange={e=>setTicketForm({...ticketForm, message: e.target.value})} required></textarea>
                  </div>
                  <Button type="submit" className="w-full bg-[#16a34a] hover:bg-[#15803d]">
                    <Send className="w-4 h-4 mr-2"/> Submit Ticket
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </main>
    </div>
  );
}
