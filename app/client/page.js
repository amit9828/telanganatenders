'use client';
import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import BrandLogo from '@/components/BrandLogo';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { load } from '@cashfreepayments/cashfree-js';
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Briefcase, CheckCircle2, AlertTriangle, FileText, 
  Clock, ShieldAlert, Send, MessageSquare, Target, UserCheck, 
  Upload, Banknote, BellRing, Loader2, LogOut, FileUp, 
  Scale, Handshake, BrainCircuit, IndianRupee, Search, Download, Activity
} from 'lucide-react';

export default function ClientDashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);

  // File Upload State for Corporate Vault
  const [uploadedFiles, setUploadedFiles] = useState({});
  const [ticketForm, setTicketForm] = useState({ subject: '', message: '' });

  useEffect(() => {
    setIsMounted(true);
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_email') : 'client@enterprise.com';
    setEmail(e);
    fetchClientData(e);
  }, []);

  const fetchClientData = async (userEmail) => {
    try {
      // In real scenario, fetch from /api/me
      // Using dummy ultra-pro data for UI demonstration based on new architecture
      setUserData({
        is_approved: true,
        profile: { company_name: 'RR Constructions Enterprise', client_name: 'Rahul Reddy', service_category: 'Civil & IT Solutions' },
        action_alerts: [
          { message: "Update CA Turnover Certificate for 2025-26", type: "document" }
        ],
        pending_payments: [
          { reason: "GeM Vendor Assessment Fee", amount: 11200 }
        ],
        emd_ledger: { total_paid: 250000, refunded: 50000 },
        ai_recommendations: [
          { id: 'GEM/2026/112', title: 'Construction of Substation', dept: 'TSSPDCL', value: '4.5 Cr', win_prob: '88%' }
        ]
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (docName, e) => {
    const file = e.target.files[0];
    if(file) {
      setUploadedFiles(prev => ({ ...prev, [docName]: 'Pending Verification' }));
      toast.success(`${docName} uploaded securely to Vault! Awaiting Officer verification.`);
    }
  };

  const handleTicket = (e) => {
    e.preventDefault();
    toast.success('Legal/SLA Ticket Raised. Our experts will connect within 24 Hrs.');
    setTicketForm({ subject: '', message: '' });
  };

  const payCustomFee = async (feeAmount, reason) => {
    toast.info(`Initiating payment of ₹${feeAmount} for ${reason} via Cashfree...`);
    // Cashfree logic goes here
  };

  if (!isMounted) return null;

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/></div>;

  const alerts = userData?.action_alerts || [];
  const pendingPayments = userData?.pending_payments || [];

  return (
    <div className="min-h-screen bg-slate-50">
      
      {/* 1. THE EXECUTIVE HEADER */}
      <header className="bg-white border-b sticky top-0 z-30 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <BrandLogo subtitle="Enterprise Portal" />
          
          <div className="flex items-center gap-3">
             <span className="text-sm font-semibold text-slate-600 hidden md:inline">{email}</span>
             
             {/* NOTIFICATIONS DROPDOWN */}
             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="outline" size="sm" className="relative text-slate-700">
                     <BellRing className="w-4 h-4 sm:mr-2"/> 
                     <span className="hidden sm:inline">Alerts</span>
                     {(alerts.length > 0 || pendingPayments.length > 0) && (
                        <Badge className="absolute -top-2 -right-2 bg-red-500 h-5 px-1.5 text-[10px]">
                           {alerts.length + pendingPayments.length}
                        </Badge>
                     )}
                   </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                   <DropdownMenuLabel>MD / Officer Requests</DropdownMenuLabel>
                   <DropdownMenuSeparator />
                   {alerts.map((a, i) => (
                      <DropdownMenuItem key={`alert-${i}`} className="text-xs text-red-600 font-medium whitespace-normal cursor-pointer">
                         ⚠️ {a.message}
                      </DropdownMenuItem>
                   ))}
                   {pendingPayments.map((p, i) => (
                      <DropdownMenuItem key={`pay-${i}`} className="text-xs text-amber-600 font-medium whitespace-normal cursor-pointer">
                         💰 Fee Due: {p.reason} (₹{p.amount})
                      </DropdownMenuItem>
                   ))}
                </DropdownMenuContent>
             </DropdownMenu>

             <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: '/' })} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                <LogOut className="w-4 h-4 sm:mr-2"/> <span className="hidden sm:inline">Sign Out</span>
             </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        
        {/* PROFILE & GeM HEALTH WIDGET */}
        <div className="bg-[#0A2647] rounded-xl p-6 text-white flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 shadow-lg relative overflow-hidden">
          <div className="absolute -right-10 -top-10 opacity-10 pointer-events-none"><Briefcase className="w-64 h-64" /></div>
          <div className="relative z-10">
            <div className="flex gap-2 mb-2">
               <Badge className="bg-[#16a34a] border-0">Verified GeM Vendor</Badge>
               <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/50"><Activity className="w-3 h-3 mr-1"/> GeM Account Health: Excellent</Badge>
            </div>
            <h2 className="text-2xl md:text-3xl font-black">{userData.profile?.company_name}</h2>
            <p className="text-emerald-300 text-sm mt-1 flex items-center gap-2">
              <UserCheck className="w-4 h-4" /> {userData.profile?.client_name} • DSC Class 3: Active
            </p>
          </div>
          <div className="relative z-10 flex gap-4 w-full lg:w-auto">
            <div className="bg-white/10 p-4 rounded-lg text-center flex-1 border border-white/10">
              <p className="text-slate-300 text-[10px] uppercase tracking-wider mb-1 font-semibold">Win Ratio</p>
              <p className="text-2xl font-black">75%</p>
            </div>
            <div className="bg-white/10 p-4 rounded-lg text-center flex-1 border border-white/10">
              <p className="text-slate-300 text-[10px] uppercase tracking-wider mb-1 font-semibold">Active Bids</p>
              <p className="text-2xl font-black text-[#16a34a]">3</p>
            </div>
          </div>
        </div>

        {/* 2. MODULE 1: CORPORATE VAULT & COMPLIANCE */}
        <Card className="tender-shadow border-t-4 border-t-[#16a34a]">
          <CardHeader className="bg-slate-50 border-b pb-4">
            <CardTitle className="text-[#0A2647] flex items-center gap-2"><Briefcase className="w-5 h-5 text-[#16a34a]"/> Corporate Vault & Compliance</CardTitle>
            <CardDescription>Upload files securely. Officers will verify and approve them for bidding.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {['GST_Certificate', 'MSME_Udyam', 'CA_Turnover', 'Bank_Mandate'].map((doc) => (
                  <div key={doc} className="bg-white p-3 border rounded-md shadow-sm hover:border-[#16a34a] transition">
                     <div className="flex justify-between items-center mb-2">
                       <Label className="font-bold text-slate-700 text-xs">{doc.replace('_', ' ')}</Label>
                       {uploadedFiles[doc] ? (
                         <Badge className="bg-amber-100 text-amber-800 text-[9px] border-0 px-1 py-0">{uploadedFiles[doc]}</Badge>
                       ) : (
                         <Badge variant="outline" className="text-[9px] px-1 py-0 border-red-200 text-red-500">Missing</Badge>
                       )}
                     </div>
                     <div className="flex items-center gap-2">
                        <FileUp className="w-4 h-4 text-slate-400 shrink-0" />
                        <Input type="file" accept=".pdf, image/*" onChange={(e) => handleFileUpload(doc, e)} className="text-xs h-8 cursor-pointer file:text-xs file:bg-slate-100 file:border-0 file:rounded file:px-2"/>
                     </div>
                  </div>
                ))}
             </div>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-3 gap-6">
          
          {/* MAIN COLUMN */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* 3. MODULE 2: AI TENDER MATCH & JV HUB */}
            <Card className="tender-shadow border-t-4 border-t-purple-500">
              <CardHeader className="border-b pb-4 bg-purple-50/50">
                <CardTitle className="text-[#0A2647] flex items-center gap-2"><BrainCircuit className="w-5 h-5 text-purple-600"/> AI Tender Match & JV Hub</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                   {userData?.ai_recommendations.map(tender => (
                     <div key={tender.id} className="p-5 hover:bg-slate-50 transition flex flex-col md:flex-row justify-between gap-4">
                        <div>
                          <Badge className="bg-purple-100 text-purple-800 border-0 mb-2">AI Win Probability: {tender.win_prob}</Badge>
                          <h4 className="font-bold text-[#0A2647]">{tender.title}</h4>
                          <p className="text-xs text-muted-foreground mt-1">{tender.dept} • Est. Value: {tender.value}</p>
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                          <Button size="sm" className="bg-[#0A2647] hover:bg-[#144272] w-full"><FileText className="w-4 h-4 mr-2"/> Apply Now</Button>
                          <Button size="sm" variant="outline" className="border-purple-200 text-purple-700 hover:bg-purple-50 w-full"><Handshake className="w-4 h-4 mr-2"/> Find JV Partner</Button>
                        </div>
                     </div>
                   ))}
                </div>
              </CardContent>
            </Card>

            {/* NEW: TENDER WORKSPACE (Undertakings & Actions) */}
            <Card className="tender-shadow">
              <CardHeader className="border-b pb-4 bg-slate-50">
                <CardTitle className="text-[#0A2647] flex items-center gap-2"><Target className="w-5 h-5 text-blue-600"/> Active Bids Workspace</CardTitle>
              </CardHeader>
              <CardContent className="p-5">
                 <div className="flex justify-between items-start mb-3">
                   <div>
                     <Badge variant="outline" className="text-[10px] mb-1">GEM/2026/B/9988</Badge>
                     <p className="font-bold text-[#0A2647]">IT Equipment Supply - Collectorate</p>
                   </div>
                   <Badge className="bg-blue-100 text-blue-800 border-0">Awaiting Your Action</Badge>
                 </div>
                 <div className="bg-white border rounded-lg p-4 grid md:grid-cols-2 gap-4">
                    <div className="border-r md:pr-4">
                       <p className="text-xs font-bold text-slate-500 uppercase mb-2">Officer Required Docs</p>
                       <ul className="space-y-2 text-sm text-slate-700">
                         <li className="flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500"/> OEM Authorization (Pending)</li>
                       </ul>
                    </div>
                    <div>
                       <p className="text-xs font-bold text-slate-500 uppercase mb-2">Undertaking Actions</p>
                       <div className="space-y-2">
                         <Button variant="outline" size="sm" className="w-full justify-start"><Download className="w-4 h-4 mr-2"/> Download Draft</Button>
                         <Button size="sm" className="w-full justify-start bg-[#16a34a] hover:bg-[#15803d]"><Upload className="w-4 h-4 mr-2"/> Upload Signed Copy</Button>
                       </div>
                    </div>
                 </div>
              </CardContent>
            </Card>
          </div>

          {/* SIDE COLUMN */}
          <div className="space-y-6">
            
            {/* 4. MODULE 3: FINANCIAL POWERHOUSE */}
            <Card className="tender-shadow border-t-4 border-t-amber-500">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2"><Banknote className="w-5 h-5 text-amber-600"/> Financial Powerhouse</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                   <div className="bg-amber-50 border border-amber-100 p-3 rounded-lg flex justify-between items-center">
                      <span className="text-sm font-semibold text-amber-900">Total EMD Paid</span>
                      <span className="text-lg font-black text-amber-700">₹{userData?.emd_ledger.total_paid.toLocaleString()}</span>
                   </div>
                   <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-lg flex justify-between items-center">
                      <span className="text-sm font-semibold text-emerald-900">EMD Refunded</span>
                      <span className="text-lg font-black text-emerald-700">₹{userData?.emd_ledger.refunded.toLocaleString()}</span>
                   </div>
                   
                   {/* MD Recommendation: Working Capital & Loans */}
                   <div className="border-t pt-4 mt-2 space-y-2">
                     <p className="text-xs font-semibold text-slate-500">Working Capital & Funding</p>
                     <Button className="w-full bg-[#0A2647] hover:bg-[#144272] h-9 text-xs"><IndianRupee className="w-3 h-3 mr-2"/> Apply for EMD Loan</Button>
                     <Button variant="outline" className="w-full border-emerald-200 text-emerald-700 hover:bg-emerald-50 h-9 text-xs"><Banknote className="w-3 h-3 mr-2"/> GeM Sahay (Bill Discounting)</Button>
                   </div>
                </div>
              </CardContent>
            </Card>

            {/* 5. MODULE 4: LEGAL DEFENSE & SLA SUPPORT */}
            <Card className="tender-shadow border-t-4 border-t-slate-800">
              <CardHeader className="pb-4 bg-slate-50 border-b">
                <CardTitle className="text-lg flex items-center gap-2"><Scale className="w-5 h-5 text-slate-700"/> Legal Defense & Support</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="mb-4">
                   <Button variant="outline" className="w-full border-red-200 text-red-700 hover:bg-red-50 text-xs"><ShieldAlert className="w-4 h-4 mr-2"/> Generate GeM SCN Reply Draft</Button>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                  <div className="flex-1 h-px bg-slate-200" /> or raise 24/7 SLA ticket <div className="flex-1 h-px bg-slate-200" />
                </div>
                <form onSubmit={handleTicket} className="space-y-3">
                  <Input placeholder="Subject (e.g., DSC Issue)" value={ticketForm.subject} onChange={e=>setTicketForm({...ticketForm, subject: e.target.value})} required className="text-sm bg-white" />
                  <textarea className="w-full border rounded-md p-2 text-sm h-20 focus:ring-1 focus:ring-[#0A2647] outline-none bg-white" placeholder="Describe your requirement..." value={ticketForm.message} onChange={e=>setTicketForm({...ticketForm, message: e.target.value})} required></textarea>
                  <Button type="submit" className="w-full bg-[#16a34a] hover:bg-[#15803d]"><Send className="w-4 h-4 mr-2"/> Submit Support Ticket</Button>
                </form>
              </CardContent>
            </Card>

          </div>
        </div>
      </main>
    </div>
  );
}
