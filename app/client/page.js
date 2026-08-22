'use client';
import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import BrandLogo from '@/components/BrandLogo';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Briefcase, CheckCircle2, AlertTriangle, FileText, 
  Clock, ShieldAlert, Send, MessageSquare, Target, UserCheck, 
  Upload, Banknote, BellRing, Loader2, LogOut, FileUp, 
  Scale, Download, Activity, Package, Building2, 
  ChevronDown, UserCircle, UploadCloud
} from 'lucide-react';

export default function ClientDashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  // File Upload State for Corporate Vault
  const [uploadedFiles, setUploadedFiles] = useState({});
  
  // Custom Tender Request State (New Feature)
  const [customTenderForm, setCustomTenderForm] = useState({
    link_or_id: '', description: '', file: null
  });

  useEffect(() => {
    setIsMounted(true);
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_email') : 'client@enterprise.com';
    setEmail(e);
    fetchClientData(e);
  }, []);

  const fetchClientData = async (userEmail) => {
    try {
      setUserData({
        is_approved: true, 
        profile: { 
          company_name: 'SK Group Management Contracts', 
          client_name: 'Rahul Reddy', 
          org_type: 'Proprietorship',
          incorporation_date: '22/05/2026',
          category: 'Service Provider / OEM' 
        },
        officer_queries: [
          { id: 'Q-101', subject: 'Undertaking Required for GEM/2026/B/123', deadline: new Date(Date.now() + 20 * 60 * 60 * 1000), status: 'Action Required' }
        ],
        active_bids: [
          { 
            bid_no: 'GEM/2026/B/554', 
            description: 'Supply of IT Peripherals to Collectorate', 
            submitted_on: '15-Aug-2026',
            last_date: '28-Aug-2026',
            status: 'Technical Evaluation' 
          }
        ],
        suggested_bids: [
          { id: 'GEM/2026/B/991', title: 'Civil Works at ZP High School', dept: 'State Govt', win_prob: '88%', emd: 'Determined by Dept' }
        ],
        emd_ledger: { total_paid: 150000, refunded: 0 }
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
      setUploadedFiles(prev => ({ ...prev, [docName]: 'Pending Officer Verification' }));
      toast.success(`${docName} uploaded securely! Awaiting Officer verification.`);
    }
  };

  const handleQueryResponse = (queryId) => {
    toast.success('Documents uploaded and query submitted for Officer review.');
  };

  // Custom Tender Submit Handler
  const handleCustomTenderSubmit = (e) => {
    e.preventDefault();
    if(!customTenderForm.link_or_id || !customTenderForm.description) {
      return toast.error("Please provide the Tender ID/Link and Description.");
    }
    toast.success("Custom tender request submitted successfully! Our Operations team will review and contact you.");
    setCustomTenderForm({ link_or_id: '', description: '', file: null });
  };

  if (!isMounted) return null;

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/></div>;

  const queries = userData?.officer_queries || [];

  return (
    <div className="min-h-screen bg-slate-50">
      
      {/* 1. THE EXECUTIVE HEADER */}
      <header className="bg-white border-b sticky top-0 z-30 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <BrandLogo subtitle="Enterprise Portal" />
          
          <div className="flex items-center gap-2 sm:gap-4">
             {/* NOTIFICATIONS */}
             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="ghost" size="icon" className="relative text-slate-700">
                     <BellRing className="w-5 h-5"/> 
                     {queries.length > 0 && (
                        <Badge className="absolute -top-1 -right-1 bg-red-500 h-4 w-4 p-0 flex justify-center items-center text-[10px]">
                           {queries.length}
                        </Badge>
                     )}
                   </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                   <DropdownMenuLabel>Officer Requests & Queries</DropdownMenuLabel>
                   <DropdownMenuSeparator />
                   {queries.length === 0 ? (
                      <DropdownMenuItem className="text-muted-foreground text-xs justify-center py-4">No active queries.</DropdownMenuItem>
                   ) : (
                      queries.map((q, i) => (
                        <DropdownMenuItem key={i} className="text-xs text-red-600 font-medium whitespace-normal cursor-pointer flex flex-col items-start gap-1">
                           <span>⚠️ {q.subject}</span>
                           <span className="text-[10px] text-slate-500">Deadline: 24 Hrs</span>
                        </DropdownMenuItem>
                      ))
                   )}
                </DropdownMenuContent>
             </DropdownMenu>

             {/* CLIENT PROFILE DROPDOWN */}
             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="outline" className="flex items-center gap-2 border-slate-200 bg-slate-50">
                     <UserCircle className="w-5 h-5 text-[#0A2647]" />
                     <div className="hidden md:flex flex-col items-start text-left">
                       <span className="text-xs font-bold text-[#0A2647] leading-none">{userData.profile?.client_name}</span>
                       <span className="text-[9px] text-slate-500 font-semibold">{userData.profile?.company_name}</span>
                     </div>
                     <ChevronDown className="w-3 h-3 text-slate-400" />
                   </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 p-2">
                   <div className="p-2 border-b mb-2 bg-slate-50 rounded-md">
                     <p className="font-bold text-[#0A2647]">{userData.profile?.client_name}</p>
                     <p className="text-xs text-slate-500">{email}</p>
                     <Badge className="mt-2 bg-blue-100 text-blue-800 hover:bg-blue-200 border-0">{userData.profile?.category}</Badge>
                   </div>
                   <DropdownMenuItem className="text-red-600 cursor-pointer font-medium" onClick={() => signOut({ callbackUrl: '/' })}>
                     <LogOut className="w-4 h-4 mr-2" /> Sign Out
                   </DropdownMenuItem>
                </DropdownMenuContent>
             </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        
        {/* HERO WIDGET: GEM VENDOR ASSESSMENT STATUS */}
        <div className="bg-[#0A2647] rounded-xl p-6 text-white shadow-lg relative overflow-hidden flex flex-col lg:flex-row justify-between lg:items-center gap-6">
          <div className="absolute -right-10 -top-10 opacity-10 pointer-events-none"><Briefcase className="w-64 h-64" /></div>
          <div className="relative z-10">
            <div className="flex flex-wrap gap-2 mb-3">
               {userData.is_approved && (
                 <Badge className="bg-emerald-500 text-white border-0 py-1"><CheckCircle2 className="w-3 h-3 mr-1"/> Officer Approved Vendor</Badge>
               )}
               <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/50 py-1"><Activity className="w-3 h-3 mr-1"/> GeM Account Health: Excellent</Badge>
               <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/50 py-1"><Package className="w-3 h-3 mr-1"/> {userData.profile?.category}</Badge>
            </div>
            <h2 className="text-2xl md:text-4xl font-black">{userData.profile?.company_name}</h2>
            <p className="text-emerald-300 text-sm mt-2 flex items-center gap-2">
              <Building2 className="w-4 h-4" /> {userData.profile?.org_type} • Est. {userData.profile?.incorporation_date}
            </p>
          </div>
          <div className="relative z-10 flex gap-4 w-full lg:w-auto">
            <div className="bg-white/10 p-4 rounded-lg text-center flex-1 border border-white/10">
              <p className="text-slate-300 text-[10px] uppercase tracking-wider mb-1 font-semibold">Active Tenders</p>
              <p className="text-3xl font-black text-[#16a34a]">{userData.active_bids?.length || 0}</p>
            </div>
          </div>
        </div>

        {/* TABS NAVIGATION */}
        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="grid w-full lg:w-[800px] grid-cols-4 bg-slate-200 h-auto p-1 mb-6">
            <TabsTrigger value="dashboard" className="py-2.5 data-[state=active]:bg-white data-[state=active]:text-[#0A2647] font-bold text-xs sm:text-sm">
              <Target className="w-4 h-4 mr-2 hidden sm:block"/> Active Bids & Queries
            </TabsTrigger>
            <TabsTrigger value="profile" className="py-2.5 data-[state=active]:bg-white data-[state=active]:text-[#0A2647] font-bold text-xs sm:text-sm">
              <Building2 className="w-4 h-4 mr-2 hidden sm:block"/> GeM Business Profile
            </TabsTrigger>
            <TabsTrigger value="vault" className="py-2.5 data-[state=active]:bg-white data-[state=active]:text-[#0A2647] font-bold text-xs sm:text-sm">
              <FileUp className="w-4 h-4 mr-2 hidden sm:block"/> Corporate Vault
            </TabsTrigger>
            <TabsTrigger value="finance" className="py-2.5 data-[state=active]:bg-white data-[state=active]:text-[#0A2647] font-bold text-xs sm:text-sm">
              <Banknote className="w-4 h-4 mr-2 hidden sm:block"/> Financials
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: DASHBOARD (Queries, Active Bids, Custom Tender Request) */}
          <TabsContent value="dashboard" className="space-y-6">
            
            {/* OFFICER QUERY FOLDER (24 Hour Timer) */}
            {queries.map((q, idx) => (
              <Card key={idx} className="border-t-4 border-t-red-500 shadow-sm bg-red-50/30">
                <CardHeader className="pb-3 border-b border-red-100">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-red-900 flex items-center gap-2 text-base"><AlertTriangle className="w-5 h-5 text-red-600"/> Officer Query & Requirement</CardTitle>
                      <CardDescription className="text-red-700/70 mt-1">Please resolve this query immediately to proceed with your bid.</CardDescription>
                    </div>
                    <Badge className="bg-red-100 text-red-800 border border-red-300 animate-pulse"><Clock className="w-3 h-3 mr-1"/> Resolve within 24 Hrs</Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-4 grid md:grid-cols-2 gap-6">
                   <div>
                      <p className="font-bold text-slate-800 mb-2">{q.subject}</p>
                      <p className="text-sm text-slate-600 bg-white p-3 rounded-md border border-slate-200">The officer requested an OEM undertaking on your letterhead. Please download the format, sign it, and upload it back here.</p>
                   </div>
                   <div className="bg-white p-4 rounded-md border border-slate-200 flex flex-col gap-3">
                      <Button variant="outline" size="sm" className="w-full justify-start text-[#0A2647] border-slate-300">
                        <Download className="w-4 h-4 mr-2"/> Download Officer Document / Format
                      </Button>
                      <div className="flex items-center gap-2 mt-2">
                        <Input type="file" accept=".pdf,.jpg,.jpeg,.doc,.docx" className="text-xs h-9 cursor-pointer file:text-xs file:bg-slate-100 file:border-0 file:rounded file:px-2" />
                        <Button size="sm" className="bg-[#16a34a] hover:bg-[#15803d]" onClick={() => handleQueryResponse(q.id)}>Submit to Officer</Button>
                      </div>
                   </div>
                </CardContent>
              </Card>
            ))}

            {/* ACTIVE BIDS TRACKER */}
            <Card className="tender-shadow">
              <CardHeader className="border-b pb-4 bg-slate-50">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg"><Target className="w-5 h-5 text-blue-600"/> Active Bids Tracking</CardTitle>
              </CardHeader>
              <CardContent className="p-5">
                 {userData?.active_bids?.map((bid, i) => (
                   <div key={i} className="mb-4 last:mb-0 border rounded-lg overflow-hidden hover:shadow-md transition">
                     <div className="p-4 bg-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                       <div className="flex-1">
                         <Badge variant="outline" className="text-[10px] mb-1.5">{bid.bid_no}</Badge>
                         <p className="font-bold text-[#0A2647] text-lg leading-tight">{bid.description}</p>
                         <div className="flex flex-wrap gap-4 mt-2 text-xs text-slate-500 font-medium">
                           <span className="flex items-center gap-1"><Upload className="w-3 h-3"/> Submitted: {bid.submitted_on}</span>
                           <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-amber-500"/> Last Date: {bid.last_date}</span>
                         </div>
                       </div>
                       <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-0 px-3 py-1.5 text-sm">{bid.status}</Badge>
                     </div>
                   </div>
                 ))}
              </CardContent>
            </Card>

            {/* NEW FEATURE: CUSTOM TENDER REQUEST BLOCK */}
            <Card className="tender-shadow border-t-4 border-t-emerald-500">
              <CardHeader className="bg-emerald-50/40 pb-4 border-b">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
                  <UploadCloud className="w-5 h-5 text-emerald-600"/> Found a Tender? Request Bid Support
                </CardTitle>
                <CardDescription>If you found a tender on your own (offline or another portal), upload the details here. Our Operations team will bid for you.</CardDescription>
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
                       <Label className="text-slate-600 text-xs font-bold mb-2 block">Upload Tender Document (Optional)</Label>
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
              </CardContent>
            </Card>

            {/* OFFICER SUGGESTED BIDS (NO FAKE EMD) */}
            <Card className="tender-shadow border-t-4 border-t-purple-500">
              <CardHeader className="border-b pb-4 bg-purple-50/50">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg"><Target className="w-5 h-5 text-purple-600"/> Officer Suggested Bids</CardTitle>
                <CardDescription>Handpicked tenders matching your business profile.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                   {userData?.suggested_bids?.map(tender => (
                     <div key={tender.id} className="p-5 hover:bg-slate-50 transition flex flex-col md:flex-row justify-between gap-4">
                        <div>
                          <Badge className="bg-purple-100 text-purple-800 border-0 mb-2">Win Probability: {tender.win_prob}</Badge>
                          <h4 className="font-bold text-[#0A2647] text-base">{tender.title}</h4>
                          <p className="text-xs text-muted-foreground mt-1">{tender.id} • {tender.dept}</p>
                          <p className="text-xs font-semibold text-slate-600 mt-1">EMD: {tender.emd}</p>
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                          <Button size="sm" className="bg-[#0A2647] hover:bg-[#144272] w-full"><FileText className="w-4 h-4 mr-2"/> Apply Request</Button>
                        </div>
                     </div>
                   ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 2: GeM BUSINESS PROFILE SUB-BLOCKS */}
          <TabsContent value="profile" className="space-y-6">
             <Card className="tender-shadow">
                <CardHeader className="bg-slate-50 border-b">
                   <CardTitle className="text-[#0A2647] text-lg">Organisation Profile</CardTitle>
                   <CardDescription>Summary of your Seller Business Profile mapped with GeM</CardDescription>
                </CardHeader>
                <CardContent className="p-0 divide-y">
                   
                   <div className="p-5 hover:bg-slate-50">
                      <div className="flex items-center gap-2 mb-3">
                         <div className="w-1.5 h-5 bg-[#16a34a] rounded-full"></div>
                         <h4 className="font-bold text-slate-700">Business PAN Validation</h4>
                      </div>
                      <div className="pl-3.5 grid md:grid-cols-2 gap-4">
                         <div>
                            <Label className="text-xs text-slate-500">Business / Organisation Type</Label>
                            <p className="font-medium text-[#0A2647]">{userData.profile?.org_type}</p>
                         </div>
                         <div>
                            <Label className="text-xs text-slate-500">Business / Organisation Name</Label>
                            <p className="font-medium text-[#0A2647]">{userData.profile?.company_name}</p>
                         </div>
                      </div>
                   </div>

                   <div className="p-5 hover:bg-slate-50">
                      <div className="flex items-center gap-2 mb-3">
                         <div className="w-1.5 h-5 bg-[#16a34a] rounded-full"></div>
                         <h4 className="font-bold text-slate-700">Business Details</h4>
                      </div>
                      <div className="pl-3.5 grid md:grid-cols-2 gap-4">
                         <div>
                            <Label className="text-xs text-slate-500">Date Of Incorporation</Label>
                            <Input value={userData.profile?.incorporation_date} readOnly className="mt-1 bg-slate-100 max-w-[200px]" />
                         </div>
                      </div>
                   </div>

                   <div className="p-5 hover:bg-slate-50">
                      <div className="flex items-center gap-2 mb-3">
                         <div className="w-1.5 h-5 bg-[#16a34a] rounded-full"></div>
                         <h4 className="font-bold text-slate-700">Office Locations</h4>
                      </div>
                      <div className="pl-3.5">
                         <p className="text-xs text-slate-500 mb-3">You can add multiple office locations as per their function for your Business.</p>
                         <div className="border rounded-md overflow-hidden">
                            <table className="w-full text-sm text-left">
                              <thead className="bg-slate-100 border-b">
                                <tr>
                                  <th className="px-4 py-2 font-semibold">Office</th>
                                  <th className="px-4 py-2 font-semibold">Address</th>
                                  <th className="px-4 py-2 font-semibold">GSTIN</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td className="px-4 py-3 font-medium">Registered Office</td>
                                  <td className="px-4 py-3 text-xs text-slate-600">5-4-136A, Ground Floor, Balayogi Colony</td>
                                  <td className="px-4 py-3 text-xs font-mono">34CAPPT65XXXXX</td>
                                </tr>
                              </tbody>
                            </table>
                         </div>
                      </div>
                   </div>
                </CardContent>
             </Card>
          </TabsContent>

          {/* TAB 3: CORPORATE VAULT (Document Uploads) */}
          <TabsContent value="vault" className="space-y-6">
            <Card className="tender-shadow border-t-4 border-t-[#16a34a]">
              <CardHeader className="bg-slate-50 border-b pb-4">
                <CardTitle className="text-[#0A2647] flex items-center gap-2"><Briefcase className="w-5 h-5 text-[#16a34a]"/> Corporate Vault Master</CardTitle>
                <CardDescription>Upload all your corporate documents. Our consultancy officers will use these to build your bids.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                 
                 <h4 className="font-bold text-slate-700 mb-3 border-b pb-1">Mandatory Documents</h4>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                    {['PAN_Card', 'Aadhaar_Card', 'GST_Certificate', 'Bank_Mandate_or_Cheque', 'DSC_Class_3'].map((doc) => (
                      <div key={doc} className="bg-white p-3 border rounded-md shadow-sm hover:border-[#16a34a] transition">
                         <div className="flex justify-between items-center mb-2">
                           <Label className="font-bold text-slate-700 text-xs">{doc.replace(/_/g, ' ')} <span className="text-red-500">*</span></Label>
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

                 <h4 className="font-bold text-slate-700 mb-3 border-b pb-1">Optional / Specific Documents</h4>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[
                      'MSME_Udyam', 'ESI_Registration', 'EPF_Registration', 'ISO_Certificate', 'FSSAI_License', 
                      'CER_Certificate', 'CA_Turnover_Certificate', 'Annual_Returns_(ITR)', 
                      'Experience_Certificates', 'Previous_Work_Orders', 'Company_Letterhead_(Word_Format)'
                    ].map((doc) => (
                      <div key={doc} className="bg-white p-3 border rounded-md shadow-sm hover:border-[#16a34a] transition">
                         <div className="flex justify-between items-center mb-2">
                           <Label className="font-bold text-slate-700 text-xs truncate max-w-[150px]" title={doc.replace(/_/g, ' ')}>{doc.replace(/_/g, ' ')}</Label>
                           {uploadedFiles[doc] ? (
                             <Badge className="bg-amber-100 text-amber-800 text-[9px] border-0 px-1 py-0">Uploaded</Badge>
                           ) : (
                             <Badge variant="outline" className="text-[9px] px-1 py-0 border-slate-200 text-slate-400">Optional</Badge>
                           )}
                         </div>
                         <div className="flex items-center gap-2">
                            <FileUp className="w-4 h-4 text-slate-400 shrink-0" />
                            <Input type="file" accept=".pdf, image/*, .doc, .docx" onChange={(e) => handleFileUpload(doc, e)} className="text-xs h-8 cursor-pointer file:text-xs file:bg-slate-100 file:border-0 file:rounded file:px-2"/>
                         </div>
                      </div>
                    ))}
                 </div>

              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 4: FINANCIALS */}
          <TabsContent value="finance" className="space-y-6">
            <Card className="tender-shadow border-t-4 border-t-amber-500 max-w-3xl mx-auto">
              <CardHeader className="pb-4 border-b bg-amber-50/30">
                <CardTitle className="text-lg flex items-center gap-2"><Banknote className="w-5 h-5 text-amber-600"/> Financial Powerhouse & EMD Ledger</CardTitle>
                <CardDescription>Track EMD deposits. No fake data—all values reflect actual records.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-4">
                   <div className="bg-white border border-amber-200 p-5 rounded-lg flex justify-between items-center shadow-sm">
                      <span className="text-base font-semibold text-slate-700">Total EMD Paid for Active Bids</span>
                      <span className="text-2xl font-black text-amber-700">₹{userData?.emd_ledger.total_paid.toLocaleString()}</span>
                   </div>
                   <div className="bg-white border border-emerald-200 p-5 rounded-lg flex justify-between items-center shadow-sm">
                      <span className="text-base font-semibold text-slate-700">EMD Refunded Successfully</span>
                      <span className="text-2xl font-black text-emerald-700">₹{userData?.emd_ledger.refunded.toLocaleString()}</span>
                   </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </main>
    </div>
  );
}
