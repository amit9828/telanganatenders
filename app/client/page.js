'use client';
import { useEffect, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { load } from '@cashfreepayments/cashfree-js';
import { toast } from 'sonner';
import {
  ArrowLeft, Briefcase, CheckCircle2, AlertTriangle, FileText, 
  Clock, ShieldAlert, Sparkles, Send, MessageSquare, Target, UserCheck, 
  Upload, Download, Banknote, IndianRupee, BellRing, Loader2, CheckCircle, ShieldCheck
} from 'lucide-react';

export default function ClientDashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);

  // Onboarding Form State
  const [form, setForm] = useState({
    client_name: '', company_name: '', phone: '', address: '', category: 'Civil & Construction'
  });
  const [docs, setDocs] = useState({
    pan: false, bank: false, gst: false, msme: false, iso: false, ca_turnover: false, dsc_class3: false, fssai: false
  });
  const [submitting, setSubmitting] = useState(false);
  const [ticketForm, setTicketForm] = useState({ subject: '', message: '' });

  useEffect(() => {
    setIsMounted(true);
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_email'] : '';
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

  const submitOnboarding = async (e) => {
    e.preventDefault();
    if(!form.client_name || !form.company_name || !form.phone) return toast.error('Please fill required fields');
    setSubmitting(true);
    
    try {
      const payload = {
        email,
        profile_type: 'client',
        client_name: form.client_name,
        company_name: form.company_name,
        phone: form.phone,
        address: form.address,
        service_category: form.category,
        documents: docs,
        status: 'pending'
      };

      const r = await fetch('/api/users/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if(r.ok) {
        toast.success('Registration Completed! Sent to MD for Approval.');
        fetchClientData(email);
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

  // --- DYNAMIC CUSTOM PAYMENT HANDLER (Cashfree integration for missing document fees) ---
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
  // STATE 1: ONBOARDING FORM
  // ==========================================
  if (!userData?.onboarding_complete || !userData?.profile?.company_name) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 py-8">
        <Card className="max-w-3xl mx-auto tender-shadow-lg border-t-4 border-t-[#16a34a]">
          <CardHeader className="text-center bg-white border-b pb-6">
            <Briefcase className="w-12 h-12 mx-auto text-[#16a34a] mb-2" />
            <CardTitle className="text-2xl text-[#0A2647]">Client & Contractor Registration</CardTitle>
            <CardDescription>Setup your enterprise profile to unlock GeM consultancy & tender bidding services.</CardDescription>
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
                <Label className="text-[#0A2647] font-bold text-base mb-3 block">Document Availability Checklist</Label>
                <p className="text-xs text-slate-500 mb-4">Tick the documents you currently hold.</p>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Object.keys(docs).map((docKey) => (
                    <label key={docKey} className={`flex items-center gap-2 text-sm p-3 border rounded-md cursor-pointer transition ${docs[docKey] ? 'bg-emerald-50 border-[#16a34a]' : 'bg-white hover:border-[#16a34a]/50'}`}>
                      <input 
                        type="checkbox" 
                        className="accent-[#16a34a] w-4 h-4" 
                        checked={docs[docKey]} 
                        onChange={(e) => setDocs({...docs, [docKey]: e.target.checked})} 
                      /> 
                      <span className="capitalize font-medium text-slate-700">
                        {docKey.replace('_', ' ').toUpperCase()}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <Button type="submit" disabled={submitting} className="w-full bg-[#0A2647] hover:bg-[#144272] h-12 text-base shadow-md">
                {submitting ? 'Submitting to MD...' : 'Complete Registration'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ==========================================
  // STATE 2: PENDING APPROVAL
  // ==========================================
  if (userData?.onboarding_complete && !userData?.is_approved) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 text-center">
         <UserCheck className="w-20 h-20 text-amber-500 mb-4 animate-pulse" />
         <h1 className="text-3xl font-bold text-[#0A2647] mb-2">Registration Completed!</h1>
         <p className="text-slate-600 max-w-md mx-auto mb-6">Your profile is currently under review by our Managing Director. Your dedicated Client Dashboard will be unlocked once approved.</p>
         <Button onClick={() => window.location.reload()} variant="outline" className="border-[#0A2647] text-[#0A2647] bg-white">Check Approval Status</Button>
      </div>
    );
  }

  // ==========================================
  // STATE 3: ULTRA PRO CLIENT DASHBOARD
  // ==========================================
  
  const dummyAlerts = userData?.action_alerts?.length > 0 ? userData.action_alerts : [
    { id: 1, employee: "Admin", message: "We need the updated CA Turnover Certificate for GEM/2026/B/45879. Please upload it ASAP.", type: "urgent" }
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-30 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <BrandLogo subtitle="Enterprise Workspace" />
          <div className="flex gap-3">
             <Button variant="outline" size="sm" className="hidden md:flex"><BellRing className="w-4 h-4 mr-2"/> Notifications <Badge className="ml-2 bg-red-500 h-4 px-1 text-[10px]">1</Badge></Button>
             <a href="/"><Button variant="outline" size="sm"><ArrowLeft className="w-4 h-4 mr-2"/> Exit Portal</Button></a>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        
        {/* --- DYNAMIC PENDING PAYMENT REQUESTS FROM MD/EMPLOYEE --- */}
        {userData?.pending_payments?.filter(p => p.status === 'UNPAID').map((payReq, idx) => (
          <div key={idx} className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
             <div className="flex items-start gap-3">
                <Banknote className="w-6 h-6 text-amber-700 mt-1 shrink-0" />
                <div>
                   <h3 className="font-bold text-amber-900">Custom Document Fee Requested</h3>
                   <p className="text-sm text-amber-800 mt-0.5">{payReq.reason} — <strong className="text-amber-950">₹{payReq.amount}</strong></p>
                </div>
             </div>
             <Button onClick={() => payCustomFee(payReq.amount, payReq.reason)} disabled={buying} size="sm" className="bg-[#16a34a] hover:bg-[#15803d] shrink-0">
               {buying ? 'Processing...' : `Pay ₹${payReq.amount} Now`}
             </Button>
          </div>
        ))}

        {/* SMART ACTION CENTER (Employee Alerts) */}
        {dummyAlerts.map(alert => (
          <div key={alert.id} className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
             <div className="flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-red-600 mt-1 shrink-0" />
                <div>
                   <h3 className="font-bold text-red-900 flex items-center gap-2">ACTION REQUIRED <Badge variant="outline" className="bg-white text-red-700 border-red-200">Raised by {alert.employee}</Badge></h3>
                   <p className="text-sm text-red-800 mt-1">{alert.message}</p>
                </div>
             </div>
             <Button size="sm" className="bg-red-600 hover:bg-red-700 shrink-0 shadow-sm w-full md:w-auto"><Upload className="w-4 h-4 mr-2"/> Upload Now</Button>
          </div>
        ))}

        {/* HEADER WIDGET */}
        <div className="bg-[#0A2647] rounded-xl p-6 text-white flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 shadow-lg relative overflow-hidden">
          <div className="absolute -right-10 -top-10 opacity-10 pointer-events-none"><Briefcase className="w-64 h-64" /></div>
          <div className="relative z-10">
            <Badge className="bg-[#16a34a] hover:bg-[#15803d] mb-2 border-0">Verified Enterprise</Badge>
            <h2 className="text-2xl md:text-3xl font-black">{userData.profile?.company_name || 'Your Company'}</h2>
            <p className="text-emerald-300 text-sm mt-1 flex items-center gap-2">
              <UserCheck className="w-4 h-4" /> {userData.profile?.client_name} • {userData.profile?.service_category}
            </p>
          </div>
          <div className="relative z-10 flex gap-4 w-full lg:w-auto">
            <div className="bg-white/10 p-4 rounded-lg text-center flex-1 lg:min-w-[140px] border border-white/10">
              <p className="text-slate-300 text-[10px] uppercase tracking-wider mb-1 font-semibold">Bids Submitted</p>
              <p className="text-2xl font-black">4</p>
            </div>
            <div className="bg-white/10 p-4 rounded-lg text-center flex-1 lg:min-w-[140px] border border-white/10">
              <p className="text-slate-300 text-[10px] uppercase tracking-wider mb-1 font-semibold">Contracts Won</p>
              <p className="text-2xl font-black text-[#16a34a]">1</p>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          
          {/* MAIN COLUMN */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* TENDER WORKSPACE (Documents & Undertakings) */}
            <Card className="tender-shadow border-t-4 border-t-[#16a34a]">
              <CardHeader className="border-b pb-4 bg-slate-50/50">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg"><Target className="w-5 h-5 text-[#16a34a]"/> Tender Workspace & Actions</CardTitle>
                <CardDescription>Upload tender-specific documents and signed undertakings requested by our officers.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  <div className="p-5 hover:bg-slate-50 transition">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3">
                        <div>
                          <Badge variant="outline" className="text-[10px] mb-1">GEM/2026/B/45879</Badge>
                          <p className="font-bold text-[#0A2647]">Supply of Medical Equipment to Gandhi Hospital</p>
                        </div>
                        <Badge className="shrink-0 bg-blue-100 text-blue-800 hover:bg-blue-200 border-0">Technical Evaluation</Badge>
                      </div>
                      
                      <div className="bg-white border rounded-lg p-4 grid md:grid-cols-2 gap-4">
                        <div className="border-r md:pr-4">
                           <p className="text-xs font-bold text-slate-500 uppercase mb-2">Officer Required Docs</p>
                           <ul className="space-y-2 text-sm text-slate-700">
                             <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500"/> OEM Authorization</li>
                             <li className="flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500"/> CA Turnover (Pending)</li>
                           </ul>
                        </div>
                        <div>
                           <p className="text-xs font-bold text-slate-500 uppercase mb-2">Undertaking Actions</p>
                           <div className="space-y-2">
                             <Button variant="outline" size="sm" className="w-full justify-start border-slate-300 text-[#0A2647]"><Download className="w-4 h-4 mr-2"/> Download Draft Format</Button>
                             <Button size="sm" className="w-full justify-start bg-[#16a34a] hover:bg-[#15803d]"><Upload className="w-4 h-4 mr-2"/> Upload Signed Copy</Button>
                           </div>
                        </div>
                      </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* LIVE L1 ANALYTICS */}
            <Card className="tender-shadow">
              <CardHeader className="bg-slate-50/50 border-b pb-4">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg"><Sparkles className="w-5 h-5 text-purple-500"/> Market Intelligence & L1 Analytics</CardTitle>
                <CardDescription>Check winning prices of past tenders to quote better next time.</CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                 <div className="border rounded-md bg-white shadow-sm overflow-hidden">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs text-slate-500 bg-slate-100 border-b">
                        <tr>
                          <th className="px-3 py-2">Tender / Dept</th>
                          <th className="px-3 py-2 text-right">L1 Price (Winning)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b">
                           <td className="px-3 py-3">Computers Procurement<br/><span className="text-[10px] text-muted-foreground">TS IT Dept</span></td>
                           <td className="px-3 py-3 text-right font-bold text-red-600">₹14,50,000 <br/><span className="text-[10px] font-normal text-slate-500">You lost by ₹50k</span></td>
                        </tr>
                        <tr>
                           <td className="px-3 py-3">CCTV Installation<br/><span className="text-[10px] text-muted-foreground">Police Dept</span></td>
                           <td className="px-3 py-3 text-right font-bold text-emerald-600">₹8,90,000 <br/><span className="text-[10px] font-normal text-slate-500">You Won!</span></td>
                        </tr>
                      </tbody>
                    </table>
                 </div>
              </CardContent>
            </Card>

          </div>

          {/* SIDE COLUMN */}
          <div className="space-y-6">
            
            {/* EMD & FINANCIAL LEDGER */}
            <Card className="tender-shadow border-t-4 border-t-amber-500">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2"><Banknote className="w-5 h-5 text-amber-600"/> EMD & Financial Ledger</CardTitle>
                <CardDescription className="text-xs">Track your Earnest Money Deposits and Consultancy Fees.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                   <div className="bg-amber-50 border border-amber-100 p-3 rounded-lg flex justify-between items-center">
                      <span className="text-sm font-semibold text-amber-900">Total Pending EMD</span>
                      <span className="text-lg font-black text-amber-700">₹1,50,000</span>
                   </div>
                   <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-lg flex justify-between items-center">
                      <span className="text-sm font-semibold text-emerald-900">EMD Refunded</span>
                      <span className="text-lg font-black text-emerald-700">₹45,000</span>
                   </div>
                </div>
              </CardContent>
            </Card>

            {/* SLA Tech Support */}
            <Card className="tender-shadow">
              <CardHeader className="pb-4 bg-slate-50 border-b">
                <CardTitle className="text-lg flex items-center gap-2"><MessageSquare className="w-5 h-5 text-[#0A2647]"/> 24/7 SLA Support Desk</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={handleTicket} className="space-y-3">
                  <Input 
                    placeholder="Subject (e.g., DSC Issue)" 
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
                    <Send className="w-4 h-4 mr-2"/> Submit Ticket
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
