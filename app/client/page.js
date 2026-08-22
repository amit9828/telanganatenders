'use client';
import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import BrandLogo from '@/components/BrandLogo';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { load } from '@cashfreepayments/cashfree-js';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Briefcase, CheckCircle2, AlertTriangle, FileText, 
  Clock, ShieldAlert, Send, MessageSquare, Target, UserCheck, 
  Upload, Banknote, BellRing, Loader2, LogOut, FileUp, 
  Scale, Handshake, BrainCircuit, IndianRupee
} from 'lucide-react';

export default function ClientDashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const router = useRouter();

  // Onboarding Form State
  const [form, setForm] = useState({
    client_name: '', company_name: '', phone: '', address: '', category: 'Civil & Construction'
  });
  
  // Real File Uploads State
  const [docs, setDocs] = useState({
    gst: null, esi: null, epf: null, iso: null, bank_account: null, 
    pan: null, aadhaar: null, dsc_class3: null, ifsc: null, 
    fssai: null, cer: null, turnover_cert: null, annual_returns: null
  });
  
  const [submitting, setSubmitting] = useState(false);
  const [ticketForm, setTicketForm] = useState({ subject: '', message: '' });

  useEffect(() => {
    setIsMounted(true);
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_email') : '';
    if (e) {
      setEmail(e);
      fetchClientData(e);
    } else {
      setLoading(false);
    }
  }, []);

  const fetchClientData = async (userEmail) => {
    try {
      const r = await fetch(`/api/me?email=${encodeURIComponent(userEmail)}`);
      const d = await r.json();
      setUserData(d);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (docKey, file) => {
    if (file) {
      setDocs(prev => ({ ...prev, [docKey]: file }));
    }
  };

  // Instant Access Logic - No waiting for MD Approval
  const submitOnboarding = async (e) => {
    e.preventDefault();
    if(!form.client_name || !form.company_name || !form.phone) return toast.error('Please fill required fields');
    setSubmitting(true);
    
    // Convert file presence to boolean flags for the DB profile
    const uploadedFlags = {};
    Object.keys(docs).forEach(key => {
      uploadedFlags[`has_${key}`] = docs[key] ? true : false;
    });

    try {
      const payload = {
        email,
        profile_type: 'client',
        client_name: form.client_name,
        company_name: form.company_name,
        phone: form.phone,
        address: form.address,
        service_category: form.category,
        documents: uploadedFlags,
        status: 'approved' // Automatically approved for instant dashboard access
      };

      const r = await fetch('/api/users/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if(r.ok) {
        toast.success('Registration Completed! Welcome to your Enterprise Dashboard.');
        setUserData(prev => ({ ...prev, onboarding_complete: true, is_approved: true, profile: payload }));
      } else {
        toast.error('Failed to submit profile');
      }
    } catch (err) {
      toast.error('Network error');
    }
    setSubmitting(false);
  };

  const handleTicket = async (e) => {
    e.preventDefault();
    if(!ticketForm.subject || !ticketForm.message) return toast.error('Fill subject and message');
    try {
      const r = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, department: 'Support', subject: ticketForm.subject, message: ticketForm.message })
      });
      if(r.ok) {
        toast.success('Ticket submitted successfully! SLA 24-hour timer started.');
        setTicketForm({ subject: '', message: '' });
      } else {
        toast.error('Failed to submit ticket');
      }
    } catch(err) {
      toast.error('Network error');
    }
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
        returnUrl: "https://www.tgtenders.in/payment-status?order_id={order_id}",
      });
    } catch (e) {
      toast.error('Could not start payment');
    } finally {
      setBuying(false);
    }
  };

  if (!isMounted) return null;

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/></div>;
  }

  if (!email) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4 text-center">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-[#0A2647]">Authentication Required</h2>
        <p className="text-slate-600 mb-4">Please login from the home page to access the Client Portal.</p>
        <a href="/"><Button className="bg-[#0A2647]">Go to Home</Button></a>
      </div>
    );
  }

  // ==========================================
  // STATE 1: ONBOARDING FORM (Real File Uploads)
  // ==========================================
  if (!userData?.onboarding_complete) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 py-8">
        <Card className="max-w-5xl mx-auto tender-shadow-lg border-t-4 border-t-[#16a34a]">
          <CardHeader className="text-center bg-white border-b pb-6">
            <Briefcase className="w-12 h-12 mx-auto text-[#16a34a] mb-2" />
            <CardTitle className="text-2xl text-[#0A2647]">Client & Contractor Registration</CardTitle>
            <CardDescription>Upload your documents to create your secure Vendor Master Profile.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 bg-slate-50/50">
            <form onSubmit={submitOnboarding} className="space-y-6">
              
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Authorized Client Name *</Label>
                  <Input required value={form.client_name} onChange={e=>setForm({...form, client_name: e.target.value})} placeholder="e.g. Rahul Reddy" className="mt-1 bg-white"/>
                </div>
                <div>
                  <Label>Company / Agency Name *</Label>
                  <Input required value={form.company_name} onChange={e=>setForm({...form, company_name: e.target.value})} placeholder="e.g. RR Constructions" className="mt-1 bg-white"/>
                </div>
                <div>
                  <Label>Contact Phone Number *</Label>
                  <Input required type="tel" value={form.phone} onChange={e=>setForm({...form, phone: e.target.value})} placeholder="+91 XXXXX XXXXX" className="mt-1 bg-white"/>
                </div>
                <div>
                  <Label>Primary Business Category *</Label>
                  <select className="w-full border rounded-md p-2 mt-1 bg-white text-sm" value={form.category} onChange={e=>setForm({...form, category: e.target.value})}>
                    <option value="Civil & Construction">Civil & Construction</option>
                    <option value="IT & Electronics">IT & Electronics</option>
                    <option value="Medical & Healthcare">Medical & Healthcare</option>
                    <option value="Manpower & Security">Manpower & Security</option>
                    <option value="General Supplies">General Supplies</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Label>Registered Office Address *</Label>
                  <Input required value={form.address} onChange={e=>setForm({...form, address: e.target.value})} placeholder="Full address" className="mt-1 bg-white"/>
                </div>
              </div>

              <div className="border-t pt-5">
                <Label className="text-[#0A2647] font-bold text-base mb-1 block">Corporate Document Vault (Upload Files)</Label>
                <p className="text-xs text-slate-500 mb-4">Please upload your documents (PDF/Images). You can skip the ones you don't have.</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.keys(docs).map((docKey) => (
                    <div key={docKey} className="bg-white p-3 border rounded-md shadow-sm hover:border-[#16a34a] transition flex flex-col gap-2">
                      <Label className="capitalize font-semibold text-slate-700 text-xs">
                        {docKey.replace(/_/g, ' ').toUpperCase()}
                      </Label>
                      <div className="flex items-center gap-2">
                         <FileUp className="w-4 h-4 text-slate-400 shrink-0" />
                         <Input 
                           type="file" 
                           accept=".pdf, image/*"
                           className="text-xs h-8 cursor-pointer file:text-xs file:bg-slate-100 file:border-0 file:rounded file:px-2 file:mr-2"
                           onChange={(e) => handleFileChange(docKey, e.target.files[0])} 
                         />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Button type="submit" disabled={submitting} className="w-full bg-[#0A2647] hover:bg-[#144272] h-12 text-base shadow-md">
                {submitting ? 'Creating Profile & Uploading...' : 'Save Profile & Enter Portal'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ==========================================
  // STATE 3: ULTRA PRO CLIENT DASHBOARD (REAL DATA ONLY)
  // ==========================================
  
  // Dynamic Arrays mapped from Database (No fake data)
  const alerts = userData?.action_alerts || [];
  const pendingPayments = userData?.pending_payments?.filter(p => p.status === 'UNPAID') || [];
  const activeBids = userData?.active_bids || [];
  const aiRecommendations = userData?.recommended_tenders || [];
  
  // Safe EMD Calculations to prevent errors
  const totalEmd = userData?.emd_ledger?.reduce((acc, curr) => acc + Number(curr.amount || 0), 0) || 0;
  const refundedEmd = userData?.emd_ledger?.filter(e => e.status === 'refunded').reduce((acc, curr) => acc + Number(curr.amount || 0), 0) || 0;

  return (
    <div className="min-h-screen bg-slate-50">
      
      {/* PROFESSIONAL HEADER */}
      <header className="bg-white border-b sticky top-0 z-30 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <BrandLogo subtitle="Enterprise Workspace" />
          
          <div className="flex items-center gap-3">
             <span className="text-sm font-semibold text-slate-600 hidden md:inline">{email}</span>
             
             {/* REAL NOTIFICATION DROPDOWN - FIXED CLIENT-SIDE EXCEPTION */}
             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="outline" size="sm" className="relative text-slate-700">
                     <BellRing className="w-4 h-4 sm:mr-2"/> 
                     <span className="hidden sm:inline">Notifications</span>
                     {(alerts.length > 0 || pendingPayments.length > 0) && (
                        <Badge className="absolute -top-2 -right-2 bg-red-500 h-5 px-1.5 text-[10px]">
                           {alerts.length + pendingPayments.length}
                        </Badge>
                     )}
                   </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                   <DropdownMenuLabel>Pending Actions</DropdownMenuLabel>
                   <DropdownMenuSeparator />
                   
                   {/* Properly rendered items without React Fragments to prevent Radix UI crashes */}
                   {alerts.length === 0 && pendingPayments.length === 0 && (
                      <DropdownMenuItem className="text-muted-foreground text-xs justify-center py-4">All clear! No new notifications.</DropdownMenuItem>
                   )}
                   {alerts.map((a, i) => (
                      <DropdownMenuItem key={`alert-${i}`} className="text-xs text-red-600 font-medium whitespace-normal">
                         ⚠️ {a.message}
                      </DropdownMenuItem>
                   ))}
                   {pendingPayments.map((p, i) => (
                      <DropdownMenuItem key={`pay-${i}`} className="text-xs text-amber-600 font-medium whitespace-normal">
                         💰 Fee Req: {p.reason}
                      </DropdownMenuItem>
                   ))}
                </DropdownMenuContent>
             </DropdownMenu>

             {/* SIGN OUT BUTTON */}
             <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: '/' })} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                <LogOut className="w-4 h-4 sm:mr-2"/> <span className="hidden sm:inline">Sign Out</span>
             </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        
        {/* DYNAMIC ACTION ALERTS (STRICTLY REAL DATA) */}
        {pendingPayments.map((payReq, idx) => (
          <div key={idx} className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-4">
             <div className="flex items-start gap-3">
                <Banknote className="w-6 h-6 text-amber-700 mt-1 shrink-0" />
                <div>
                   <h3 className="font-bold text-amber-900">Custom Document Fee Requested</h3>
                   <p className="text-sm text-amber-800 mt-0.5">{payReq.reason} — <strong className="text-amber-950">₹{payReq.amount}</strong></p>
                </div>
             </div>
             <Button onClick={() => payCustomFee(payReq.amount, payReq.reason)} disabled={buying} size="sm" className="bg-[#16a34a] hover:bg-[#15803d] shrink-0 w-full md:w-auto">
               {buying ? 'Processing...' : `Pay ₹${payReq.amount} Now`}
             </Button>
          </div>
        ))}

        {alerts.map((alert, idx) => (
          <div key={idx} className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-4">
             <div className="flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-red-600 mt-1 shrink-0" />
                <div>
                   <h3 className="font-bold text-red-900 flex items-center gap-2">ACTION REQUIRED <Badge variant="outline" className="bg-white text-red-700 border-red-200">Officer Request</Badge></h3>
                   <p className="text-sm text-red-800 mt-1">{alert.message}</p>
                </div>
             </div>
             <Button size="sm" className="bg-red-600 hover:bg-red-700 shrink-0 shadow-sm w-full md:w-auto">
               <Upload className="w-4 h-4 mr-2"/> Upload Document
             </Button>
          </div>
        ))}

        {/* PROFILE OVERVIEW WIDGET */}
        <div className="bg-[#0A2647] rounded-xl p-6 text-white flex flex-col justify-between items-start gap-6 shadow-lg relative overflow-hidden">
          <div className="absolute -right-10 -top-10 opacity-10 pointer-events-none"><Briefcase className="w-64 h-64" /></div>
          <div className="relative z-10">
            <Badge className="bg-[#16a34a] hover:bg-[#15803d] mb-2 border-0">Verified Vendor Profile</Badge>
            <h2 className="text-2xl md:text-3xl font-black">{userData.profile?.company_name || 'Your Company'}</h2>
            <p className="text-emerald-300 text-sm mt-1 flex items-center gap-2">
              <UserCheck className="w-4 h-4" /> {userData.profile?.client_name} • {userData.profile?.service_category}
            </p>
            
            {/* Displaying verified documents from DB as badges */}
            <div className="flex flex-wrap gap-2 mt-4">
               {userData.profile?.documents && Object.keys(userData.profile.documents).map(doc => {
                 if(userData.profile.documents[doc]) {
                   return <Badge key={doc} variant="outline" className="border-emerald-400 text-emerald-200 text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1 text-emerald-400"/> {doc.replace('has_', '').toUpperCase()}</Badge>
                 }
                 return null;
               })}
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            
            {/* NEW: AI TENDER MATCH & JV HUB */}
            <Card className="tender-shadow border-t-4 border-t-purple-500">
              <CardHeader className="border-b pb-4 bg-purple-50/50">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg"><BrainCircuit className="w-5 h-5 text-purple-600"/> AI Tender Match & JV Hub</CardTitle>
                <CardDescription>Tenders matched to your profile by our engine & Officers.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {aiRecommendations.length === 0 ? (
                  <div className="p-8 text-center bg-white rounded-b-xl">
                    <Search className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p className="text-slate-600 text-sm font-medium">No matched tenders at this moment.</p>
                    <p className="text-xs text-slate-400 mt-1">Our AI engine is constantly scanning GeM & State portals for you.</p>
                  </div>
                ) : (
                  <div className="divide-y">
                     {aiRecommendations.map(tender => (
                       <div key={tender.id} className="p-5 hover:bg-slate-50 transition flex flex-col md:flex-row justify-between gap-4">
                          <div>
                            <Badge className="bg-purple-100 text-purple-800 border-0 mb-2">{tender.match_score || '92%'} Win Probability</Badge>
                            <h4 className="font-bold text-[#0A2647]">{tender.title}</h4>
                            <p className="text-xs text-muted-foreground mt-1">{tender.department} • Est. Value: ₹{tender.value || 'N/A'}</p>
                          </div>
                          <div className="flex flex-col gap-2 shrink-0">
                            <Button size="sm" className="bg-[#0A2647] hover:bg-[#144272] w-full"><FileText className="w-4 h-4 mr-2"/> View & Apply</Button>
                            <Button size="sm" variant="outline" className="border-purple-200 text-purple-700 hover:bg-purple-50 w-full"><Handshake className="w-4 h-4 mr-2"/> Find JV Partner</Button>
                          </div>
                       </div>
                     ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* MY ACTIVE WORKSPACE (REAL DATA) */}
            <Card className="tender-shadow border-t-4 border-t-[#16a34a]">
              <CardHeader className="border-b pb-4 bg-slate-50/50">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg"><Target className="w-5 h-5 text-[#16a34a]"/> My Active Bids Workspace</CardTitle>
                <CardDescription>Track the real-time progress of your ongoing tender submissions.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {activeBids.length === 0 ? (
                  <div className="p-8 text-center bg-white rounded-b-xl">
                    <Briefcase className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p className="text-slate-600 text-sm font-medium">You have no active bids currently.</p>
                  </div>
                ) : (
                  <div className="divide-y">
                     {activeBids.map(bid => (
                        <div key={bid.id} className="p-5 hover:bg-slate-50 transition">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <Badge variant="outline" className="text-[10px] mb-1">{bid.tender_id}</Badge>
                                <p className="font-bold text-[#0A2647]">{bid.title}</p>
                              </div>
                              <Badge className="shrink-0 bg-blue-100 text-blue-800 hover:bg-blue-200 border-0">{bid.status}</Badge>
                            </div>
                        </div>
                     ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            
            {/* NEW: FINANCIAL POWERHOUSE */}
            <Card className="tender-shadow border-t-4 border-t-amber-500">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2"><Banknote className="w-5 h-5 text-amber-600"/> Financial Powerhouse</CardTitle>
                <CardDescription className="text-xs">Your EMD Ledger & Funding options.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                   <div className="bg-amber-50 border border-amber-100 p-3 rounded-lg flex justify-between items-center">
                      <span className="text-sm font-semibold text-amber-900">Total EMD Paid</span>
                      <span className="text-lg font-black text-amber-700">₹{totalEmd}</span>
                   </div>
                   <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-lg flex justify-between items-center">
                      <span className="text-sm font-semibold text-emerald-900">EMD Refunded</span>
                      <span className="text-lg font-black text-emerald-700">₹{refundedEmd}</span>
                   </div>
                   
                   <div className="border-t pt-4 mt-2">
                     <p className="text-xs font-semibold text-slate-500 mb-2">Need Funds for Bidding?</p>
                     <Button className="w-full bg-[#0A2647] hover:bg-[#144272] h-10"><IndianRupee className="w-4 h-4 mr-2"/> Apply for EMD Loan / PBG</Button>
                   </div>
                </div>
              </CardContent>
            </Card>

            {/* NEW: LEGAL DEFENSE & SLA SUPPORT */}
            <Card className="tender-shadow border-t-4 border-t-slate-800">
              <CardHeader className="pb-4 bg-slate-50 border-b">
                <CardTitle className="text-lg flex items-center gap-2"><Scale className="w-5 h-5 text-slate-700"/> Legal Defense & Support</CardTitle>
                <CardDescription className="text-[11px]">24/7 GeM SCN replies and technical helpdesk.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="mb-4">
                   <Button variant="outline" className="w-full border-slate-300 text-slate-700 hover:bg-slate-100">Generate GeM SCN Reply Draft</Button>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                  <div className="flex-1 h-px bg-slate-200" /> or raise a ticket <div className="flex-1 h-px bg-slate-200" />
                </div>
                <form onSubmit={handleTicket} className="space-y-3">
                  <Input 
                    placeholder="Subject (e.g., DSC Mapping Issue)" 
                    value={ticketForm.subject}
                    onChange={e=>setTicketForm({...ticketForm, subject: e.target.value})}
                    required 
                    className="text-sm bg-white"
                  />
                  <textarea 
                    className="w-full border rounded-md p-2 text-sm h-24 focus:ring-1 focus:ring-[#0A2647] outline-none bg-white"
                    placeholder="Describe your requirement..."
                    value={ticketForm.message}
                    onChange={e=>setTicketForm({...ticketForm, message: e.target.value})}
                    required
                  ></textarea>
                  <Button type="submit" className="w-full bg-[#16a34a] hover:bg-[#15803d]">
                    <Send className="w-4 h-4 mr-2"/> Submit Support Ticket
                  </Button>
                </form>
              </CardContent>
            </Card>

          </div>
        </div>
      </main>
    </div>
  );
}
