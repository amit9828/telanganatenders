'use client';
import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import BrandLogo from '@/components/BrandLogo';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Briefcase, CheckCircle2, AlertTriangle, FileText, Clock, ShieldAlert, Send, 
  MessageSquare, Target, UserCheck, Upload, Banknote, BellRing, Loader2, LogOut, 
  FileUp, Download, Activity, Building2, ChevronDown, UserCircle, UploadCloud, 
  Globe, Database, PhoneCall, Plus, Trash2, Trophy, Eye, ShieldCheck
} from 'lucide-react';

export default function ClientDashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);

  // --- Core State ---
  const [userData, setUserData] = useState(null);
  const [clientId, setClientId] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [publicTenders, setPublicTenders] = useState([]);
  const [buying, setBuying] = useState(false);

  // --- Forms State ---
  const [uploadedFiles, setUploadedFiles] = useState({});
  const [customTenderForm, setCustomTenderForm] = useState({ link_or_id: '', description: '', file: null });
  const [ticketForm, setTicketForm] = useState({ subject: '', message: '' });

  // --- Dynamic Business Profile State (Empty Default) ---
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    clientName: '', orgType: 'Private Limited', companyName: '',
    phone: '', email: '', gstin: '', incorpDate: '',
    udyam: '', address: '', services: [''], description: ''
  });

  // --- Real-time Stats, Vault & Wins State (Empty Default) ---
  const [vaultDocs, setVaultDocs] = useState([]);
  const [clientStats, setClientStats] = useState({ recommended: 0, participated: 0, ongoing: 0, won: 0, lost: 0, revenue: 0 });
  const [wonBids, setWonBids] = useState([]);

  useEffect(() => {
    setIsMounted(true);
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_email') || 'client@apex.com' : 'client@apex.com';
    setEmail(e);
    setClientId(`CLI-${e.substring(0, 4).toUpperCase()}${Math.floor(100 + Math.random() * 900)}`);
    fetchPublicTenders();
    fetchClientData(e); // 🚀 Permanent Database Fetch
  }, []);

  // ============================================================================
  // 🚀 PERMANENT BACKEND LOGIC: Fetch User Data from DB
  // ============================================================================
  const fetchClientData = async (userEmail) => {
    try {
      const r = await fetch(`/api/me?email=${encodeURIComponent(userEmail)}`);
      if(r.ok) {
        const d = await r.json();
        setUserData(d);

        // 1. LIVE TRACKING: Map real stats, won bids, and vault docs from your DB
        if(d.stats) setClientStats(d.stats);
        if(d.won_bids) setWonBids(d.won_bids);
        if(d.vault_docs) setVaultDocs(d.vault_docs);

        // Pre-fill editable profile from Database
        if(d.profile) {
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
            services: d.profile.service_category ? d.profile.service_category.split(',') : prev.services,
            description: d.profile.description || prev.description
          }));
        }
      }
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
    } catch (err) { console.error(err); }
  };

  // For Demo Purposes: Function to bypass lock screen
  const bypassLockScreen = () => setUserData(prev => ({ ...prev, is_approved: true }));

  // --- Dynamic Profile Functions ---
  const addServiceRow = () => setProfileForm(prev => ({...prev, services: [...prev.services, '']}));
  const updateService = (index, value) => {
    const newServices = [...profileForm.services];
    newServices[index] = value;
    setProfileForm(prev => ({...prev, services: newServices}));
  };
  const removeService = (index) => {
    const newServices = profileForm.services.filter((_, i) => i !== index);
    setProfileForm(prev => ({...prev, services: newServices}));
  };
  
  // ============================================================================
  // 🚀 PERMANENT BACKEND LOGIC: Save Profile to DB
  // ============================================================================
  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      const r = await fetch('/api/users/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          client_name: profileForm.clientName,
          company_name: profileForm.companyName,
          company_type: profileForm.orgType,
          phone: profileForm.phone,
          address: profileForm.address,
          description: profileForm.description,
          service_category: profileForm.services.join(',')
        })
      });
      if(r.ok) {
        setIsEditingProfile(false);
        toast.success("Business Profile Updated Successfully! Synced with MD Database.");
        fetchClientData(email); // Refresh Data
      }
    } catch(err) {
      toast.error("Network Error.");
    }
  };

  // ============================================================================
  // 🚀 REAL GOOGLE DRIVE UPLOAD LOGIC
  // ============================================================================
  const handleFileUpload = async (docId, e) => {
    const file = e?.target?.files?.[0];
    if(file) {
      toast.info(`Uploading ${file.name} to Secure Google Drive...`);
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('docId', docId);
      formData.append('email', email);
      formData.append('clientName', profileForm.clientName); 

      try {
        const res = await fetch('/api/vault/upload', {
          method: 'POST',
          body: formData
        });
        
        if(res.ok) {
          toast.success(`Document uploaded successfully! Pending Officer Approval.`);
          fetchClientData(email); // Refreshes UI with real DB dates and statuses
        } else {
          toast.error('Upload failed. Please try again.');
        }
      } catch (err) {
        toast.error('Network Error during upload.');
      }
    }
  };

  // ============================================================================
  // 🚀 PERMANENT BACKEND LOGIC: Send Custom Bid Request to Database
  // ============================================================================
  const handleCustomTenderSubmit = async (e) => { 
    e.preventDefault(); 
    if(!customTenderForm.link_or_id || !customTenderForm.description) {
      return toast.error("Please fill all details");
    }

    try {
      const res = await fetch('/api/client-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_email: email,
          client_id: clientId,
          link_or_id: customTenderForm.link_or_id,
          description: customTenderForm.description
        })
      });

      if(res.ok) {
        toast.success("Custom tender request submitted successfully to Operations Team!"); 
        setCustomTenderForm({ link_or_id: '', description: '', file: null }); 
        fetchClientData(email); // Refresh Data
      } else {
        toast.error("Failed to submit request.");
      }
    } catch(err) {
      toast.error("Network Error.");
    }
  };
  
  // ============================================================================
  // 🚀 PERMANENT BACKEND LOGIC: Create SLA Ticket in Database
  // ============================================================================
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
        toast.success('24/7 SLA Ticket raised successfully!'); 
        setTicketForm({ subject: '', message: '' }); 
        fetchClientData(email); // Refresh Data
      }
    } catch(err) {
      toast.error("Network Error.");
    }
  };

  const handleQueryResponse = (id) => { toast.success('Response submitted to Officer.'); };
  
  const handleSignOut = async () => {
    if (typeof window !== 'undefined') localStorage.clear();
    await signOut({ redirect: false });
    window.location.href = '/';
  };

  if (!isMounted || loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-10 h-10 animate-spin text-[#0A2647]"/></div>;

  // ============================================================================
  // 🔒 MNC SECURITY GATE: HOLDING SCREEN FOR MD APPROVAL
  // ============================================================================
  if (userData && !userData.is_approved) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A2647] p-4 bg-[url('/grid-pattern.svg')]">
        <Card className="max-w-lg w-full shadow-2xl border-t-8 border-t-amber-500 bg-white">
           <CardHeader className="text-center pb-2 border-b">
             <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4 ring-4 ring-amber-50">
                <ShieldAlert className="w-8 h-8 text-amber-600" />
             </div>
             <CardTitle className="text-2xl font-black text-[#0A2647]">Account Under Verification</CardTitle>
             <CardDescription className="text-sm mt-2">Welcome to TenderNexus Enterprise Portal.</CardDescription>
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
                <Button onClick={bypassLockScreen} size="sm" variant="outline" className="border-slate-300 text-xs text-slate-400 hover:text-slate-600">Bypass (Dev Demo)</Button>
             </div>
           </CardContent>
        </Card>
      </div>
    );
  }

  // ============================================================================
  // 🟢 APPROVED CLIENT DASHBOARD
  // ============================================================================
  const queries = userData?.officer_queries || [];
  const activeBids = userData?.active_bids || [];
  const customRequests = userData?.custom_requests || [];
  const criticalAlerts = userData?.action_alerts || [];
  const pendingPayments = userData?.pending_payments || [];
  
  const emdData = userData?.emd_ledger;
  const totalEmd = emdData?.total_paid || 0;
  const refundedEmd = emdData?.refunded || 0;

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="bg-white border-b sticky top-0 z-40 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <BrandLogo subtitle="Enterprise Portal" />
          <div className="flex items-center gap-4">
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
                     <Badge className="mt-2 bg-blue-100 text-blue-800 border-0">{userData.profile?.category || 'Vendor'}</Badge>
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
        
        {/* --- MD CRITICAL ALERTS BANNER --- */}
        {criticalAlerts.length > 0 && (
          <div className="bg-red-600 text-white rounded-xl p-4 shadow-lg flex items-start gap-4 animate-in fade-in slide-in-from-top-4">
             <AlertTriangle className="w-8 h-8 shrink-0 text-red-200" />
             <div className="flex-1">
                <h3 className="font-black text-lg uppercase tracking-wide">Action Required from MD / Admin</h3>
                <div className="mt-2 space-y-2">
                   {criticalAlerts.map((alert, idx) => (
                     <div key={idx} className="bg-red-700/50 p-3 rounded-lg border border-red-500/50 flex justify-between items-center">
                        <p className="font-medium text-sm">{alert.subject}: {alert.message}</p>
                        <Button size="sm" onClick={() => fetchClientData(email)} className="h-7 text-xs bg-white text-red-700 hover:bg-red-50">Dismiss</Button>
                     </div>
                   ))}
                </div>
             </div>
          </div>
        )}

        {/* --- TOP FUNNEL METRICS (Clickable Links to Tabs) --- */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
           <Card onClick={() => setActiveTab('live_tenders')} className="border-0 shadow-sm ring-1 ring-slate-200 bg-white cursor-pointer hover:ring-blue-400 hover:shadow-md transition">
              <CardContent className="p-4 flex flex-col items-center text-center">
                 <Target className="w-5 h-5 text-blue-500 mb-2"/>
                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Recommended</p>
                 <p className="text-2xl font-black text-[#0A2647]">{clientStats.recommended}</p>
              </CardContent>
           </Card>
           <Card onClick={() => setActiveTab('dashboard')} className="border-0 shadow-sm ring-1 ring-slate-200 bg-white cursor-pointer hover:ring-blue-400 hover:shadow-md transition">
              <CardContent className="p-4 flex flex-col items-center text-center">
                 <FileText className="w-5 h-5 text-slate-500 mb-2"/>
                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Participated</p>
                 <p className="text-2xl font-black text-[#0A2647]">{clientStats.participated}</p>
              </CardContent>
           </Card>
           <Card onClick={() => setActiveTab('dashboard')} className="border-0 shadow-sm ring-1 ring-blue-500/50 bg-blue-50/50 cursor-pointer hover:ring-blue-600 hover:shadow-md transition">
              <CardContent className="p-4 flex flex-col items-center text-center">
                 <Activity className="w-5 h-5 text-blue-600 mb-2"/>
                 <p className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">Ongoing Bids</p>
                 <p className="text-2xl font-black text-blue-700">{activeBids.length || clientStats.ongoing}</p>
              </CardContent>
           </Card>
           <Card onClick={() => setActiveTab('wins')} className="border-0 shadow-sm ring-1 ring-emerald-500/50 bg-emerald-50/80 cursor-pointer hover:ring-emerald-600 hover:shadow-md transition">
              <CardContent className="p-4 flex flex-col items-center text-center">
                 <Trophy className="w-5 h-5 text-emerald-600 mb-2"/>
                 <p className="text-[10px] font-bold text-emerald-900 uppercase tracking-wider">Tenders Won</p>
                 <p className="text-2xl font-black text-emerald-700">{clientStats.won}</p>
              </CardContent>
           </Card>
           <Card onClick={() => setActiveTab('finance')} className="border-0 shadow-sm ring-1 ring-emerald-500 bg-emerald-600 text-white col-span-2 lg:col-span-1 cursor-pointer hover:ring-emerald-400 hover:shadow-md transition">
              <CardContent className="p-4 flex flex-col items-center text-center">
                 <Banknote className="w-5 h-5 text-emerald-200 mb-2"/>
                 <p className="text-[10px] font-bold text-emerald-100 uppercase tracking-wider">Project Revenue</p>
                 <p className="text-xl sm:text-2xl font-black">₹{clientStats.revenue.toLocaleString()}</p>
              </CardContent>
           </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mt-6">
          <TabsList className="flex flex-wrap w-full bg-white shadow-sm border border-slate-200 h-auto p-1.5 rounded-lg mb-6">
            <TabsTrigger value="dashboard" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <Activity className="w-4 h-4 mr-2 hidden sm:block"/> Active Dashboard
            </TabsTrigger>
            <TabsTrigger value="live_tenders" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <Globe className="w-4 h-4 mr-2 hidden sm:block"/> Live Tenders
            </TabsTrigger>
            <TabsTrigger value="profile" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <Building2 className="w-4 h-4 mr-2 hidden sm:block"/> Client Profile
            </TabsTrigger>
            <TabsTrigger value="vault" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <Database className="w-4 h-4 mr-2 hidden sm:block"/> Corp Vault
            </TabsTrigger>
            <TabsTrigger value="wins" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white font-semibold rounded-md">
              <Trophy className="w-4 h-4 mr-2 hidden sm:block"/> Winning Bids
            </TabsTrigger>
            <TabsTrigger value="finance" className="flex-1 min-w-[120px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-semibold rounded-md">
              <Banknote className="w-4 h-4 mr-2 hidden sm:block"/> Finance/SLA
            </TabsTrigger>
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
                            {isEditingProfile ? <Input value={profileForm.gstin} onChange={e=>setProfileForm({...profileForm, gstin: e.target.value})} className="mt-1 uppercase font-mono"/> : <p className="font-semibold text-[#0A2647] font-mono bg-slate-50 p-2.5 rounded border mt-1">{profileForm.gstin}</p>}
                         </div>
                         <div>
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Date of Incorporation</Label>
                            {isEditingProfile ? <Input type="date" value={profileForm.incorpDate} onChange={e=>setProfileForm({...profileForm, incorpDate: e.target.value})} className="mt-1"/> : <p className="font-semibold text-[#0A2647] bg-slate-50 p-2.5 rounded border mt-1">{profileForm.incorpDate}</p>}
                         </div>
                         <div className="md:col-span-2">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Udyam Registration Number</Label>
                            {isEditingProfile ? <Input value={profileForm.udyam} onChange={e=>setProfileForm({...profileForm, udyam: e.target.value})} className="mt-1 uppercase font-mono"/> : <p className="font-semibold text-[#0A2647] font-mono bg-slate-50 p-2.5 rounded border mt-1">{profileForm.udyam}</p>}
                         </div>
                      </div>

                      {/* Dynamic Services Array */}
                      <div className="border-t border-slate-100 pt-5">
                         <div className="flex justify-between items-center mb-4">
                            <Label className="text-xs font-bold text-[#0A2647] uppercase tracking-wider">Primary Services / Products Offered</Label>
                            {isEditingProfile && <Button type="button" size="sm" onClick={addServiceRow} variant="outline" className="h-8 text-xs border-blue-300 text-blue-700 hover:bg-blue-50 font-semibold"><Plus className="w-3 h-3 mr-1"/> Add Row</Button>}
                         </div>
                         <div className="space-y-3">
                            {profileForm.services.map((service, index) => (
                               <div key={index} className="flex gap-3">
                                  <div className="bg-slate-100 border text-slate-500 flex items-center justify-center w-10 rounded-md text-xs font-bold">{index + 1}</div>
                                  {isEditingProfile ? (
                                     <>
                                        <Input value={service} onChange={(e) => updateService(index, e.target.value)} placeholder={`Service or Product ${index + 1}`} className="flex-1 h-10"/>
                                        {profileForm.services.length > 1 && (
                                           <Button type="button" variant="ghost" size="icon" onClick={() => removeService(index)} className="text-red-400 hover:text-red-600 hover:bg-red-50 h-10 w-10"><Trash2 className="w-4 h-4"/></Button>
                                        )}
                                     </>
                                  ) : <p className="flex-1 font-semibold text-[#0A2647] bg-slate-50 p-2.5 rounded border">{service || 'Not specified'}</p>}
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
                            <Button type="button" variant="outline" onClick={() => setIsEditingProfile(false)} className="h-11">Cancel</Button>
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
                <CardTitle className="text-[#0A2647] flex items-center gap-2"><Database className="w-5 h-5 text-[#16a34a]"/> Corporate Document Vault</CardTitle>
                <CardDescription>Upload your KYC and business documents. Approved documents are directly synced to your secure Google Drive folder.</CardDescription>
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
                            {/* Rejection Message Display */}
                            {doc.status === 'rejected' && doc.reject_reason && (
                               <p className="text-xs text-red-700 font-semibold mb-3">Reason: {doc.reject_reason}</p>
                            )}
                            <label className="cursor-pointer flex items-center justify-center w-full bg-[#0A2647] hover:bg-[#144272] text-white p-2.5 rounded-lg transition text-xs font-semibold shadow-sm">
                              <UploadCloud className="w-4 h-4 mr-2" /> Upload PDF
                              <input type="file" className="hidden" accept=".pdf, image/*" onChange={(e) => handleFileUpload(doc.id, e)} />
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
                              <Badge className="bg-emerald-500 text-white border-0 text-[10px] uppercase font-bold tracking-wider"><CheckCircle2 className="w-3 h-3 mr-1"/> MD Approved</Badge>
                            </div>
                            <div className="bg-white p-2.5 border border-emerald-100 rounded-lg flex flex-col gap-2 shadow-inner">
                               <div className="flex justify-between items-center">
                                  <span className="text-xs font-mono text-slate-500 truncate max-w-[120px]" title={doc.file_name}>{doc.file_name || doc.file}</span>
                                  {/* Real Live Date */}
                                  <span className="text-[9px] text-slate-400 font-semibold">{doc.upload_date}</span>
                               </div>
                               <div className="flex items-center gap-2 mt-1">
                                  {/* View & Download Links to Google Drive */}
                                  {doc.view_url && (
                                    <a href={doc.view_url} target="_blank" rel="noreferrer" className="flex-1">
                                      <Button size="sm" variant="ghost" className="w-full h-7 text-[10px] px-2 font-bold bg-slate-100 hover:bg-slate-200 text-[#0A2647]"><Eye className="w-3 h-3 mr-1"/> View</Button>
                                    </a>
                                  )}
                                  {doc.download_url && (
                                    <a href={doc.download_url} target="_blank" rel="noreferrer" className="flex-1">
                                      <Button size="sm" variant="outline" className="w-full h-7 text-[10px] border-emerald-200 text-emerald-700 hover:bg-emerald-50 px-2 font-bold"><Download className="w-3 h-3 mr-1"/> Download</Button>
                                    </a>
                                  )}
                               </div>
                            </div>
                         </div>
                       ))}
                    </div>
                 </div>

              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================================== */}
          {/* TAB 3: WINNING BIDS LEDGER (Read-Only) */}
          {/* ============================================================================== */}
          <TabsContent value="wins" className="space-y-6">
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
                                      <Badge className="bg-slate-100 text-slate-600 font-mono text-[10px] border border-slate-200">{bid.id}</Badge>
                                      <Badge className="bg-emerald-100 text-emerald-800 border-0 uppercase tracking-widest text-[9px] font-bold"><CheckCircle2 className="w-3 h-3 mr-1"/> Contract Awarded</Badge>
                                   </div>
                                   <h4 className="font-black text-[#0A2647] text-lg mb-1 leading-tight">{bid.desc}</h4>
                                   <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Date of Award: {bid.date}</p>
                                </div>
                                <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 min-w-[220px] shrink-0 text-center md:text-right">
                                   <p className="text-[10px] text-emerald-800 font-bold uppercase mb-1 tracking-wider">Contract Value</p>
                                   <p className="text-2xl font-black text-emerald-700">{bid.value}</p>
                                   <div className="border-t border-emerald-200 mt-2 pt-2">
                                      <p className="text-[10px] text-emerald-800 font-bold uppercase">Valid Until: <span className="text-emerald-900">{bid.validity}</span></p>
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
          {/* TAB 4: ACTIVE DASHBOARD (Officer Queries, Visual Stepper, Custom Request) */}
          {/* ============================================================================== */}
          <TabsContent value="dashboard" className="space-y-6">
            
            {/* Visual Stepper Logic UI */}
            <Card className="tender-shadow">
              <CardHeader className="border-b pb-4 bg-slate-50">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg"><Activity className="w-5 h-5 text-blue-600"/> Tenders Tracking</CardTitle>
              </CardHeader>
              <CardContent className="p-5">
                 {activeBids.length === 0 ? (
                    <div className="text-center py-6 text-slate-400">
                      <p className="text-sm font-semibold">No active bids in progress.</p>
                    </div>
                 ) : (
                    activeBids.map((bid, i) => (
                       <div key={i} className="mb-4 border border-slate-200 rounded-xl p-5 bg-white shadow-sm flex flex-col gap-6">
                          <div>
                            <Badge variant="outline" className="text-[10px] mb-2 font-mono bg-slate-50">{bid.bid_no}</Badge>
                            <p className="font-bold text-[#0A2647] text-base leading-tight">{bid.description}</p>
                          </div>
                          <div className="relative mt-2 px-2 sm:px-6">
                             <div className="absolute top-3 left-8 right-8 h-1.5 bg-slate-100 rounded-full z-0"></div>
                             <div className="absolute top-3 left-8 w-[50%] h-1.5 bg-blue-500 rounded-full z-0"></div>
                             <div className="relative z-10 flex justify-between">
                                <div className="flex flex-col items-center gap-2">
                                   <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center shadow ring-4 ring-white"><CheckCircle2 className="w-4 h-4"/></div>
                                   <span className="text-[10px] font-bold text-slate-600 uppercase">Doc Prep</span>
                                </div>
                                <div className="flex flex-col items-center gap-2">
                                   <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center shadow ring-4 ring-white"><CheckCircle2 className="w-4 h-4"/></div>
                                   <span className="text-[10px] font-bold text-slate-600 uppercase">Submitted</span>
                                </div>
                                <div className="flex flex-col items-center gap-2">
                                   <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center shadow ring-4 ring-white animate-pulse"><Clock className="w-4 h-4"/></div>
                                   <span className="text-[10px] font-bold text-amber-700 uppercase">Evaluating</span>
                                </div>
                                <div className="flex flex-col items-center gap-2">
                                   <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-300 flex items-center justify-center shadow ring-4 ring-white"><Trophy className="w-4 h-4"/></div>
                                   <span className="text-[10px] font-bold text-slate-400 uppercase">Result</span>
                                </div>
                             </div>
                          </div>
                       </div>
                    ))
                 )}
              </CardContent>
            </Card>

            {/* Officer Queries Block */}
            {queries.length > 0 && (
              <Card className={`border-t-4 shadow-sm bg-white border-t-red-500`}>
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="flex items-center gap-2 text-base text-[#0A2647]">
                     <AlertTriangle className={`w-5 h-5 text-red-600`}/> Officer Query & Undertakings Block
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                   {queries.map((q, idx) => (
                      <div key={idx} className="bg-red-50/50 p-4 rounded-md border border-red-100 grid md:grid-cols-2 gap-6 mb-4">
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
                              <Button size="sm" className="bg-[#16a34a] hover:bg-[#15803d]" onClick={() => handleQueryResponse(q.id)}>Submit</Button>
                            </div>
                         </div>
                      </div>
                   ))}
                </CardContent>
              </Card>
            )}

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
                             <span className="text-[10px] text-slate-500 mt-1">Max file size 10MB</span>
                          </div>
                       </div>
                    </div>
                    <Button type="submit" className="w-full bg-[#0A2647] hover:bg-[#144272] h-11 shadow-sm text-white">
                      <Send className="w-4 h-4 mr-2"/> Submit Tender to Operations Team
                    </Button>
                  </div>
                </form>

                {/* Show Permanent Saved Custom Requests */}
                {customRequests.length > 0 && (
                  <div className="mt-6 border-t pt-6 space-y-4">
                     <h4 className="font-bold text-[#0A2647]">My Submitted Requests ({customRequests.length})</h4>
                     {customRequests.map(req => (
                        <div key={req._id} className="p-4 border border-slate-200 rounded-xl bg-white shadow-sm flex flex-col md:flex-row justify-between md:items-center gap-4">
                           <div className="flex-1">
                              <div className="flex justify-between items-start">
                                 <h4 className="font-bold text-[#0A2647] text-sm break-all mb-1">{req.link_or_id}</h4>
                                 <Badge className={req.status === 'Pending Officer Review' ? 'bg-amber-100 text-amber-800 border-0' : 'bg-emerald-100 text-emerald-800 border-0'}>{req.status}</Badge>
                              </div>
                              <p className="text-xs text-slate-500 mt-1">"{req.description}"</p>
                              {req.reply && (
                                 <div className="mt-2 text-xs text-emerald-700 font-bold bg-emerald-50 p-2 rounded border border-emerald-100">
                                    Officer Reply: {req.reply}
                                 </div>
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
              <CardHeader className="bg-slate-50 border-b">
                <CardTitle className="text-[#0A2647] text-lg flex items-center gap-2"><Globe className="w-5 h-5 text-blue-600"/> Public Procurement Tenders</CardTitle>
              </CardHeader>
              <CardContent className="p-0 divide-y">
                 {publicTenders.map(t => (
                   <div key={t._id} className="p-4 hover:bg-slate-50 flex flex-col md:flex-row justify-between md:items-center gap-4">
                      <div>
                         <p className="font-bold text-[#0A2647]">{t.title}</p>
                         <p className="text-xs text-slate-500 mt-1">{t.department} • {t.district} • Last Date: {new Date(t.last_date).toLocaleDateString()}</p>
                      </div>
                      <a href={`/?open_tender=${t._id}`} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline"><FileText className="w-4 h-4 mr-2"/> View Notice</Button>
                      </a>
                   </div>
                 ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================================== */}
          {/* TAB 6: FINANCE & SLA */}
          {/* ============================================================================== */}
          <TabsContent value="finance" className="space-y-6 grid lg:grid-cols-2 gap-6">
            <Card className="tender-shadow border-t-4 border-t-amber-500 h-fit">
              <CardHeader className="pb-4 border-b bg-amber-50/30">
                <CardTitle className="text-lg flex items-center gap-2"><Banknote className="w-5 h-5 text-amber-600"/> Financial Ledger</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                   <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border">
                      <span className="text-sm font-semibold text-slate-700">Total EMD Paid</span>
                      <span className="text-lg font-black text-slate-800">₹{totalEmd.toLocaleString()}</span>
                   </div>
                   <div className="border-t pt-4">
                      <h4 className="font-bold text-slate-700 mb-3">Pending Payment Requests</h4>
                      {!pendingPayments || pendingPayments.length === 0 ? (
                         <p className="text-xs text-slate-500 text-center py-2">No pending fees requested.</p>
                      ) : (
                        pendingPayments.map((pay, i) => (
                          <div key={i} className="mb-2 border border-red-200 bg-red-50 p-3 rounded-lg flex flex-col gap-2">
                             <div className="flex justify-between items-center text-sm">
                                <span className="font-semibold text-red-900">{pay.reason}</span>
                                <span className="font-bold text-red-700">₹{pay.amount}</span>
                             </div>
                             <Button onClick={() => toast.info('Connecting to Cashfree...')} disabled={buying} size="sm" className="w-full bg-[#0A2647] hover:bg-[#144272] h-9">
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
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </main>
    </div>
  );
}
