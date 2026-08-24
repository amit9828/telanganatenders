'use client';
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import BrandLogo from '@/components/BrandLogo';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea'; 
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  ArrowLeft, Users, FileText, PlusCircle, BellRing, 
  MessageSquare, Send, CheckCircle2, ShieldCheck, 
  Briefcase, Kanban, Building2, LayoutDashboard, AlertCircle, Contact, MonitorPlay,
  Database, Lock, Globe, MapPin, Target, UploadCloud, Clock, LogIn, XCircle, Lightbulb, Search, Trophy, Trash2, Star
} from 'lucide-react';

const DISTRICTS = [
  'Hyderabad', 'Adilabad', 'Nizamabad', 'Karimnagar', 'Medak', 'Ranga Reddy',
  'Mahabubnagar', 'Nalgonda', 'Warangal', 'Khammam', 'Sangareddy',
  'Medchal-Malkajgiri', 'Siddipet', 'Vikarabad',
  'Visakhapatnam', 'Vijayawada (NTR)', 'Guntur', 'Tirupati', 'Nellore',
  'Kurnool', 'Anantapur', 'Kadapa (YSR)', 'Kakinada', 'Eluru',
  'Srikakulam', 'Vizianagaram', 'Prakasam'
];

const BORDER_COLORS = [
  'border-blue-500', 'border-purple-500', 'border-emerald-500', 
  'border-orange-500', 'border-indigo-500', 'border-rose-500'
];

export default function EmployeeDashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [empData, setEmpData] = useState({ name: 'Employee', id: 'EMP-001', role: 'Operations Officer' });
  const [loading, setLoading] = useState(true);

  const [mdTasks, setMdTasks] = useState([]);
  const [bids, setBids] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [approvedClients, setApprovedClients] = useState([]);
  const [publicTenders, setPublicTenders] = useState([]); 
  const [suggestions, setSuggestions] = useState([]); 
  const [tickets, setTickets] = useState([]); 

  const [tenderForm, setTenderForm] = useState({
    bid_no: '', title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: ''
  });
  const [publishing, setPublishing] = useState(false);
  const [pdfName, setPdfName] = useState('');
  const [pdfBase64, setPdfBase64] = useState('');
  
  const [alertForm, setAlertForm] = useState({ client_id: '', message: '' });
  const [queryForm, setQueryForm] = useState({ client_email: '', subject: '', message: '' });
  
  const [officerForm, setOfficerForm] = useState({ 
    name: '', department: '', designation: '', phone: '', 
    state: '', district: '', address: '', pincode: '', notes: '' 
  });
  const [savingOfficer, setSavingOfficer] = useState(false);
  const [officerSearch, setOfficerSearch] = useState('');

  const [showAddBid, setShowAddBid] = useState(false);
  const [newBidForm, setNewBidForm] = useState({ 
    bid_no: '', description: '', submitted_date: '', status: 'Bid Allocated', client_email: '' 
  });

  const [suggestForm, setSuggestForm] = useState({}); 

  useEffect(() => {
    setIsMounted(true);
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_emp_email') : 'employee@tgtenders.in';
    const finalEmail = e || 'employee@tgtenders.in';
    setEmail(finalEmail);
    fetchLiveOperationsData(finalEmail);
    fetch('/api/employee/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: finalEmail, action: 'LOGIN', details: 'Employee started session on portal.' })
    }).catch(err => console.log('Attendance log failed', err));
  }, []);

  const fetchLiveOperationsData = async (userEmail) => {
    try {
      const [tasksRes, bidsRes, officersRes, clientsRes, tendersRes, ticketsRes] = await Promise.all([
        fetch('/api/dispatches'), fetch('/api/bids'), fetch('/api/gov-officers'),
        fetch('/api/users/approved'), fetch('/api/tenders'), fetch('/api/tickets')
      ]);

      if (tasksRes.ok) {
        const tData = await tasksRes.json();
        const allDispatches = tData.dispatches || [];
        setMdTasks(allDispatches.filter(d => d.target_type === 'employee_task'));
        setSuggestions(allDispatches.filter(d => d.subject === 'New Tender Suggestion from Officer' && d.status !== 'Completed'));
      }
      if (bidsRes.ok) {
        const bData = await bidsRes.json();
        setBids(bData.bids || []);
      }
      if (officersRes.ok) {
        const oData = await officersRes.json();
        setOfficers(oData.officers || []);
      }
      if (clientsRes.ok) {
        const cData = await clientsRes.json();
        setApprovedClients(cData.users || []);
      }
      if (tendersRes.ok) {
        const pData = await tendersRes.json();
        setPublicTenders(pData.tenders || []);
      }
      if (ticketsRes.ok) {
        const tkData = await ticketsRes.json();
        setTickets(tkData.tickets || []);
      }
    } catch (err) {
      console.error("Failed to fetch live operations data", err);
    } finally {
      setLoading(false);
    }
  };

  const onPdfChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') return toast.error('Please upload a PDF file');
    if (file.size > 4 * 1024 * 1024) return toast.error('PDF file is too large! Please upload under 4MB.');
    
    const reader = new FileReader();
    reader.onload = () => {
      setPdfBase64(reader.result?.toString().split(',')[1] || '');
      setPdfName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const handlePublishTender = async (e) => {
    e.preventDefault();
    if(!tenderForm.title || !tenderForm.department || !tenderForm.last_date || !tenderForm.bid_no) return toast.error('Please fill all required fields');
    setPublishing(true);
    try {
      const r = await fetch('/api/tenders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...tenderForm, pdf_base64: pdfBase64, pdf_filename: pdfName || 'tender.pdf' })
      });
      if(r.ok) {
        toast.success('Tender published manually and synced with portal!');
        setTenderForm({ bid_no: '', title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: '' });
        setPdfBase64(''); setPdfName('');
        logActivity('PUBLISHED_TENDER', `Published tender: ${tenderForm.title}`);
        fetchLiveOperationsData(email); 
      } else {
        toast.error('Failed to publish tender');
      }
    } catch (err) {
      toast.error('Network error');
    }
    setPublishing(false);
  };

  const handleSuggestTender = async (tenderId, tenderTitle) => {
    const selectedClientEmail = suggestForm[tenderId];
    if(!selectedClientEmail) return toast.error("Please select a client to suggest this tender.");
    
    const isDuplicate = suggestions.some(s => s.target_id === selectedClientEmail && s.message === tenderTitle);
    if(isDuplicate) {
      return toast.error("Action Denied: You have already suggested this tender to the selected client.");
    }
    
    try {
      const res = await fetch('/api/dispatches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          target_type: 'client_alert', 
          target_id: selectedClientEmail, 
          subject: 'New Tender Suggestion from Officer', 
          message: `${tenderTitle}` 
        })
      });
      if (res.ok) {
        toast.success(`Tender suggestion sent successfully to client!`);
        logActivity('SUGGESTED_TENDER', `Suggested tender to ${selectedClientEmail}`);
        setSuggestForm({...suggestForm, [tenderId]: ''});
        fetchLiveOperationsData(email);
      }
    } catch (err) {
      toast.error('Network Error while sending suggestion.');
    }
  };

  const handleSuggestionResponse = async (suggestion, action) => {
    try {
      if (action === 'Accepted') {
         const isDuplicate = bids.some(b => b.client_email === suggestion.target_id && b.description === suggestion.message);
         if(isDuplicate) {
            return toast.error("Action Denied: This tender is already actively tracked for this client.");
         }

         const res = await fetch('/api/bids', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
               bid_no: 'WAITING FOR BID NO', 
               description: suggestion.message, 
               status: 'Bid Allocated',
               client_email: suggestion.target_id,
               submitted_date: ''
            })
         });
         if (res.ok) toast.success("Suggestion Accepted! Moved to Active Bids Tracker.");
      } else {
         toast.info("Suggestion Rejected and removed from list.");
      }

      await fetch('/api/dispatches/complete', {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ task_id: suggestion._id })
      });
      fetchLiveOperationsData(email);
    } catch (err) {
      toast.error("Error processing suggestion.");
    }
  };

  const handleAddBidRow = async (e) => {
    e.preventDefault();
    if(!newBidForm.client_email || !newBidForm.bid_no) return toast.error("Client Email and Bid Number are required");
    
    const isDuplicate = bids.some(b => b.bid_no === newBidForm.bid_no && b.client_email === newBidForm.client_email);
    if(isDuplicate) return toast.error("Action Denied: This Bid Number is already active for this client!");

    try {
      const res = await fetch('/api/bids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBidForm)
      });
      if(res.ok) {
        toast.success("New Bid Event Row Added Successfully!");
        setNewBidForm({ bid_no: '', description: '', submitted_date: '', status: 'Bid Allocated', client_email: '' });
        setShowAddBid(false);
        fetchLiveOperationsData(email);
      } else {
        toast.error("Failed to add bid row.");
      }
    } catch (err) {
      toast.error("Network Error.");
    }
  };

  const handleDeleteBid = async (bidId) => {
     if(!confirm("Are you sure you want to delete this bid access from the tracker?")) return;
     try {
       const res = await fetch(`/api/bids?id=${bidId}`, { method: 'DELETE' });
       if (res.ok) { 
          toast.success("Bid tracking removed."); 
          fetchLiveOperationsData(email); 
       } else {
          toast.error("Failed to remove. Backend route might need update.");
       }
     } catch(e) { toast.error("Network error"); }
  }

  const handleCreateDriveFolder = async (clientEmail, companyName) => {
      toast.info("Generating secure Google Drive Workspace...");
      try {
          const res = await fetch('/api/drive/create-folder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: clientEmail, folderName: `Client - ${companyName}` })
          });
          const data = await res.json();
          if(res.ok && data.folderLink) {
              toast.success("Drive Workspace Synced!");
              fetchLiveOperationsData(email);
              window.open(data.folderLink, '_blank');
          } else {
              toast.error(data.error || "Failed to create drive.");
          }
      } catch(e) {
          toast.error("Network Error.");
      }
  }

  const sendActionAlert = async (e) => {
    e.preventDefault();
    if(!alertForm.client_id || !alertForm.message) return toast.error('Please select client and fill message');
    try {
      const res = await fetch('/api/dispatches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: 'client_alert', target_id: alertForm.client_id, subject: 'ACTION REQUIRED: Operations Update', message: alertForm.message })
      });
      if (res.ok) {
        toast.success(`CRITICAL ALERT pushed to Client Dashboard!`);
        logActivity('SENT_ALERT', `Alert to ${alertForm.client_id}`);
        setAlertForm({ client_id: '', message: '' });
      }
    } catch (err) {
      toast.error('Network Error while pushing alert.');
    }
  };

  const handleRaiseQuery = async (e) => {
    e.preventDefault();
    if(!queryForm.client_email || !queryForm.subject || !queryForm.message) return toast.error('Please select client and fill query');
    try {
      const res = await fetch('/api/queries/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queryForm)
      });
      if (res.ok) {
        toast.success(`Query Raised! Client's dashboard is now locked until they reply.`);
        logActivity('RAISED_QUERY', `Locked client ${queryForm.client_email} for document request.`);
        setQueryForm({ client_email: '', subject: '', message: '' });
      } else {
        toast.error('Failed to raise query.');
      }
    } catch (err) {
      toast.error('Network Error while raising query.');
    }
  };

  const updateBidStatus = async (id, newStatus) => {
    setBids(bids.map(b => (b._id === id || b.id === id) ? { ...b, status: newStatus } : b));
    try {
      const res = await fetch('/api/bids/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bid_id: id, status: newStatus })
      });
      if (res.ok) {
        toast.success(`Bid updated to "${newStatus}". Client Notified.`);
        logActivity('UPDATED_BID', `Changed bid ${id} status to ${newStatus}`);
      } else {
        fetchLiveOperationsData(email); 
      }
    } catch (err) {
      toast.error('Network Error during status update.');
    }
  };

  const markTaskDone = async (taskId) => {
    setMdTasks(mdTasks.map(t => (t._id === taskId || t.id === taskId) ? { ...t, status: 'Completed' } : t));
    try {
      const res = await fetch('/api/dispatches/complete', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId })
      });
      if (res.ok) {
        toast.success('Task marked completed.');
        logActivity('COMPLETED_TASK', `Task ${taskId} marked as done`);
      } else {
        fetchLiveOperationsData(email);
      }
    } catch (err) {
      toast.error('Network Error while updating task.');
    }
  };

  const handleSaveOfficer = async (e) => {
    e.preventDefault();
    if(!officerForm.name || !officerForm.department || !officerForm.phone) return toast.error('Name, Dept and Phone are required');
    setSavingOfficer(true);
    try {
      const res = await fetch('/api/gov-officers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(officerForm)
      });
      if (res.ok) {
        toast.success('Govt Officer added to Central Directory!');
        logActivity('ADDED_OFFICER', `Added officer: ${officerForm.name}`);
        setOfficerForm({ name: '', department: '', designation: '', phone: '', state: '', district: '', address: '', pincode: '', notes: '' });
        fetchLiveOperationsData(email); 
      }
    } catch (err) {
      toast.error('Failed to save officer data');
    }
    setSavingOfficer(false);
  };

  const escalateToMD = async (ticket) => {
    try {
      const res = await fetch('/api/dispatches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
           target_type: 'employee_task', 
           target_id: 'MD', 
           subject: `ESCALATION: ${ticket.subject}`, 
           message: `Client ${ticket.client_email} is facing an issue that needs MD attention.\n\nIssue: ${ticket.message}` 
        })
      });
      if (res.ok) {
         toast.success('Ticket escalated to Managing Director successfully.');
         logActivity('ESCALATED_TICKET', `Escalated ticket ${ticket._id} to MD`);
      }
    } catch (e) {
      toast.error("Failed to escalate.");
    }
  };

  // 🚀 FIX: redirecting to /client directly
  const handleImpersonate = async (targetEmail) => {
    if (!targetEmail) return toast.error('Enter a valid client email');
    toast.loading(`Connecting to ${targetEmail}'s portal...`);
    await signIn('impersonate', {
      email: targetEmail,
      adminToken: 'admin_success',
      callbackUrl: '/client' 
    });
  };

  const logActivity = (action, details) => {
    fetch('/api/employee/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action, details })
    }).catch(err => console.log('Activity log failed', err));
  };

  if (!isMounted) return null;

  const groupedBids = bids.reduce((acc, bid) => {
      const key = bid.client_email || 'Unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(bid);
      return acc;
  }, {});

  const groupedSuggestions = suggestions.reduce((acc, sug) => {
      const key = sug.target_id || 'Unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(sug);
      return acc;
  }, {});

  const filteredOfficers = officers.filter(o => 
     o.name?.toLowerCase().includes(officerSearch.toLowerCase()) || 
     o.department?.toLowerCase().includes(officerSearch.toLowerCase()) ||
     o.district?.toLowerCase().includes(officerSearch.toLowerCase())
  );

  const activeTickets = tickets.filter(t => t.status === 'OPEN');
  const resolvedTickets = tickets.filter(t => t.status === 'RESOLVED');

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-[#0A2647] border-b sticky top-0 z-30 shadow-md text-white">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <div className="bg-white/10 p-2 rounded-lg"><Briefcase className="w-6 h-6 text-[#16a34a]" /></div>
             <div>
               <h1 className="font-bold text-lg leading-tight">Operations Desk</h1>
               <p className="text-[10px] text-emerald-300 font-mono tracking-widest">{empData.id} • {email}</p>
             </div>
          </div>
          <div className="flex gap-3 items-center">
             <Badge className="bg-[#16a34a] border-0 hidden sm:inline-flex">Session Active</Badge>
             <a href="/"><Button variant="outline" size="sm" className="border-slate-600 text-slate-300 hover:text-white hover:bg-slate-800"><ArrowLeft className="w-4 h-4 mr-2"/> Exit System</Button></a>
          </div>
        </div>
      </header>

      <main className="w-full px-4 sm:px-8 py-6">
        
        <div className="mb-6 bg-white border border-blue-200 rounded-xl p-4 shadow-sm relative overflow-hidden w-full">
           <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
           <h3 className="font-bold text-[#0A2647] flex items-center gap-2 mb-3"><LayoutDashboard className="w-4 h-4 text-blue-500"/> Tasks Assigned by MD / Admin</h3>
           <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mdTasks.length === 0 ? (
                 <p className="text-sm text-slate-500 py-2">No pending tasks from MD.</p>
              ) : (
                 mdTasks.map(task => (
                    <div key={task._id || task.id} className="flex justify-between items-center bg-slate-50 border p-3 rounded-lg">
                       <div>
                          <Badge variant="outline" className={`mb-1 ${task.priority === 'High' ? 'text-red-600 border-red-200 bg-red-50' : 'text-amber-600 border-amber-200 bg-amber-50'}`}>Priority Task</Badge>
                          <p className="font-semibold text-sm text-slate-800">{task.subject}</p>
                          <p className="text-xs text-slate-500 mt-1">{task.message}</p>
                       </div>
                       {task.status !== 'Completed' ? (
                          <Button size="sm" onClick={() => markTaskDone(task._id || task.id)} className="bg-blue-600 hover:bg-blue-700 h-8 text-xs shrink-0">Mark Done</Button>
                       ) : (
                          <Badge className="bg-emerald-100 text-emerald-800 border-0 shrink-0"><CheckCircle2 className="w-3 h-3 mr-1"/> Done</Badge>
                       )}
                    </div>
                 ))
              )}
           </div>
        </div>

        <Tabs defaultValue="kanban" className="w-full">
          <TabsList className="flex flex-wrap w-full bg-slate-200 h-auto p-1 mb-6 rounded-lg gap-1">
            <TabsTrigger value="kanban" className="flex-1 min-w-[150px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <Kanban className="w-4 h-4 mr-2 hidden sm:block"/> Active Bids
            </TabsTrigger>
            <TabsTrigger value="suggestions" className="flex-1 min-w-[150px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <Lightbulb className="w-4 h-4 mr-2 hidden sm:block"/> Suggestions
            </TabsTrigger>
            <TabsTrigger value="officers" className="flex-1 min-w-[150px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <Contact className="w-4 h-4 mr-2 hidden sm:block"/> Govt Officers
            </TabsTrigger>
            <TabsTrigger value="clients" className="flex-1 min-w-[150px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <AlertCircle className="w-4 h-4 mr-2 hidden sm:block"/> Alerts & Clients
            </TabsTrigger>
            <TabsTrigger value="publisher" className="flex-1 min-w-[150px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <PlusCircle className="w-4 h-4 mr-2 hidden sm:block"/> Tenders DB
            </TabsTrigger>
            <TabsTrigger value="sla" className="flex-1 min-w-[150px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <MessageSquare className="w-4 h-4 mr-2 hidden sm:block"/> Helpdesk
            </TabsTrigger>
          </TabsList>

          <TabsContent value="kanban" className="w-full space-y-6">
            <Card className="shadow-sm border-0 ring-1 ring-slate-200 w-full">
              <CardHeader className="bg-slate-50/50 pb-4 border-b flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                   <CardTitle className="text-[#0A2647] flex items-center gap-2"><Kanban className="w-5 h-5 text-blue-600"/> Active Bid Events Tracker</CardTitle>
                   <CardDescription>Manually add or update the progress of ongoing client bids.</CardDescription>
                </div>
                <Button onClick={() => setShowAddBid(!showAddBid)} className="bg-blue-600 hover:bg-blue-700 shrink-0">
                   <PlusCircle className="w-4 h-4 mr-2"/> Add New Bid Row
                </Button>
              </CardHeader>
              <CardContent className="pt-4">
                
                {showAddBid && (
                   <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-5 mb-6 shadow-inner animate-in fade-in slide-in-from-top-4">
                      <h4 className="font-bold text-blue-900 mb-4 flex items-center"><Target className="w-4 h-4 mr-2"/> Create New Bid Tracking Row</h4>
                      <form onSubmit={handleAddBidRow} className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
                         <div>
                            <Label className="text-xs font-bold text-slate-600">Select Client *</Label>
                            <Select required value={newBidForm.client_email} onValueChange={v => setNewBidForm({...newBidForm, client_email: v})}>
                               <SelectTrigger className="mt-1 bg-white h-9"><SelectValue placeholder="Choose Client" /></SelectTrigger>
                               <SelectContent>
                                  {approvedClients.map(c => <SelectItem key={c.email} value={c.email}>{c.client_id} ({c.company_name || c.name})</SelectItem>)}
                               </SelectContent>
                            </Select>
                         </div>
                         <div>
                            <Label className="text-xs font-bold text-slate-600">Bid Number / ID *</Label>
                            <Input required placeholder="e.g. GEM/2026/B/..." value={newBidForm.bid_no} onChange={e=>setNewBidForm({...newBidForm, bid_no: e.target.value})} className="mt-1 bg-white h-9" />
                         </div>
                         <div>
                            <Label className="text-xs font-bold text-slate-600">Initial Status *</Label>
                            <Select required value={newBidForm.status} onValueChange={v => setNewBidForm({...newBidForm, status: v})}>
                               <SelectTrigger className="mt-1 bg-white h-9"><SelectValue placeholder="Select Status" /></SelectTrigger>
                               <SelectContent>
                                  <SelectItem value="Bid Allocated">Bid Allocated</SelectItem>
                                  <SelectItem value="Client Approved">Client Approved</SelectItem>
                                  <SelectItem value="Client Cancelled">Client Cancelled</SelectItem>
                                  <SelectItem value="ADC Check">ADC Check</SelectItem>
                                  <SelectItem value="Documents Asking">Documents Asking</SelectItem>
                                  <SelectItem value="Documents Preparing">Documents Preparing</SelectItem>
                                  <SelectItem value="Bid Participated">Bid Participated</SelectItem>
                                  <SelectItem value="Technical Evaluation">Technical Evaluation</SelectItem>
                                  <SelectItem value="Technical Qualification">Technical Qualification</SelectItem>
                                  <SelectItem value="Financial Evaluation">Financial Evaluation</SelectItem>
                                  <SelectItem value="Won">Won</SelectItem>
                                  <SelectItem value="Lost">Lost</SelectItem>
                               </SelectContent>
                            </Select>
                         </div>
                         <div>
                            <Label className="text-xs font-bold text-slate-600">Submitted Date (Optional)</Label>
                            <Input type="date" value={newBidForm.submitted_date} onChange={e=>setNewBidForm({...newBidForm, submitted_date: e.target.value})} className="mt-1 bg-white h-9" />
                         </div>
                         <div className="sm:col-span-3">
                            <Label className="text-xs font-bold text-slate-600">Description of Work *</Label>
                            <Input required placeholder="Short title of the tender work..." value={newBidForm.description} onChange={e=>setNewBidForm({...newBidForm, description: e.target.value})} className="mt-1 bg-white h-9" />
                         </div>
                         <div className="sm:col-span-1 flex items-end">
                            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 h-9 shadow-md"><CheckCircle2 className="w-4 h-4 mr-2"/> Save Record</Button>
                         </div>
                      </form>
                   </div>
                )}

                {bids.length === 0 ? (
                  <p className="text-center text-sm text-slate-500 py-10">No active bids in the database.</p>
                ) : (
                  <div className="space-y-6">
                    {Object.entries(groupedBids).map(([clientEmail, clientBids], index) => {
                        const clientInfo = approvedClients.find(c => c.email === clientEmail);
                        const cName = clientInfo ? clientInfo.company_name || clientInfo.name : clientEmail;
                        const colorClass = BORDER_COLORS[index % BORDER_COLORS.length]; 
                        
                        return (
                        <Card key={clientEmail} className={`border-t-4 ${colorClass} shadow-sm overflow-hidden`}>
                           <CardHeader className="bg-slate-50 border-b py-3 px-4">
                              <div className="flex justify-between items-center">
                                 <div>
                                    <CardTitle className="text-xl uppercase font-black text-[#0A2647]">{cName}</CardTitle>
                                    <CardDescription className="text-xs font-mono mt-0.5">{clientEmail}</CardDescription>
                                 </div>
                                 <Badge className="bg-blue-100 text-blue-800 border-0 shadow-sm">{clientBids.length} Active Bids</Badge>
                              </div>
                           </CardHeader>
                           <CardContent className="p-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                              {clientBids.map(b => (
                                <div key={b._id || b.id} className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm flex flex-col justify-between gap-3 hover:border-blue-300 transition">
                                  <div>
                                    <div className="flex justify-between items-start mb-2">
                                      {/* 🚀 FIX: High visibility for BID NUMBER */}
                                      <div className="bg-blue-50 border border-blue-200 text-blue-900 px-2 py-1 rounded shadow-sm flex items-center">
                                         <span className="text-[10px] uppercase font-bold text-blue-500 mr-2">BID NO:</span>
                                         <span className="text-xs font-black font-mono">{b.bid_no || b.id || 'N/A'}</span>
                                      </div>
                                      <div className="flex gap-2 items-center">
                                         <Badge className="bg-blue-100 text-blue-800 border-0 shadow-sm">{b.status}</Badge>
                                         <Button variant="ghost" size="icon" onClick={() => handleDeleteBid(b._id || b.id)} className="h-5 w-5 p-0 text-red-400 hover:text-red-600"><Trash2 className="w-3 h-3"/></Button>
                                      </div>
                                    </div>
                                    <h4 className="font-bold text-[#0A2647] mt-2 text-sm leading-tight">{b.description || b.title}</h4>
                                  </div>
                                  
                                  <div className="border-t border-slate-100 pt-3 mt-1 flex flex-col sm:flex-row items-center justify-between gap-2">
                                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Update Status</span>
                                    <select 
                                      className="border border-blue-300 rounded-md px-2 py-1.5 text-xs bg-blue-50 font-bold text-blue-900 outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-auto shadow-sm cursor-pointer"
                                      value={b.status}
                                      onChange={(e) => updateBidStatus(b._id || b.id, e.target.value)}
                                    >
                                      <option value="Bid Allocated">Bid Allocated</option>
                                      <option value="Client Approved">Client Approved</option>
                                      <option value="Client Cancelled">Client Cancelled</option>
                                      <option value="ADC Check">ADC Check</option>
                                      <option value="Documents Asking">Documents Asking</option>
                                      <option value="Documents Preparing">Documents Preparing</option>
                                      <option value="Bid Participated">Bid Participated</option>
                                      <option value="Technical Evaluation">Technical Evaluation</option>
                                      <option value="Technical Qualification">Technical Qualification</option>
                                      <option value="Financial Evaluation">Financial Evaluation</option>
                                      <option value="Won">Won</option>
                                      <option value="Lost">Lost</option>
                                    </select>
                                  </div>

                                  {b.status === 'Won' && (
                                     <Button size="sm" onClick={() => toast.success("Winning Bid Published to Client Ledger!")} className="w-full bg-emerald-600 hover:bg-emerald-700 mt-2 h-8 text-xs font-bold animate-in fade-in shadow-md">
                                        <Trophy className="w-4 h-4 mr-2" /> Publish Win to Client
                                     </Button>
                                  )}
                                </div>
                              ))}
                           </CardContent>
                        </Card>
                    )})}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="suggestions" className="w-full space-y-6">
            <Card className="shadow-sm border-0 ring-1 ring-slate-200">
               <CardHeader className="bg-slate-50/50 border-b pb-4">
                  <CardTitle className="text-[#0A2647] flex items-center gap-2"><Lightbulb className="w-5 h-5 text-amber-500"/> Suggested Tenders Tracker</CardTitle>
                  <CardDescription>Track all tenders you have suggested. If a client accepts, convert it to an Active Bid.</CardDescription>
               </CardHeader>
               <CardContent className="pt-4 max-h-[700px] overflow-y-auto">
                  {suggestions.length === 0 ? (
                     <div className="text-center py-10 text-slate-400">
                        <Lightbulb className="w-12 h-12 mx-auto mb-3 opacity-20"/>
                        <p className="text-sm font-semibold">No pending suggestions.</p>
                     </div>
                  ) : (
                     <div className="space-y-6">
                        {Object.entries(groupedSuggestions).map(([clientEmail, clientSuggestions], index) => {
                           const clientInfo = approvedClients.find(c => c.email === clientEmail);
                           const cName = clientInfo ? clientInfo.company_name || clientInfo.name : clientEmail;
                           const colorClass = BORDER_COLORS[(index + 1) % BORDER_COLORS.length]; 
                           
                           return (
                           <Card key={clientEmail} className={`border-t-4 ${colorClass} shadow-sm overflow-hidden`}>
                              <CardHeader className="bg-amber-50/30 border-b py-3 px-4">
                                 <div className="flex justify-between items-center">
                                    <div>
                                       <CardTitle className="text-lg uppercase font-black text-[#0A2647]">{cName}</CardTitle>
                                       <CardDescription className="text-xs font-mono mt-0.5">{clientEmail}</CardDescription>
                                    </div>
                                    <Badge className="bg-amber-100 text-amber-800 border-0 shadow-sm">{clientSuggestions.length} Suggestions</Badge>
                                 </div>
                              </CardHeader>
                              <CardContent className="p-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                                 {clientSuggestions.map(sug => (
                                    <div key={sug._id} className="border border-amber-200 rounded-xl p-4 bg-white shadow-sm flex flex-col justify-between hover:shadow-md transition relative">
                                       <div>
                                          <div className="flex justify-between items-start mb-2">
                                             <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[9px] font-mono">Suggested On: {new Date(sug.created_at).toLocaleDateString()}</Badge>
                                          </div>
                                          <h4 className="font-bold text-[#0A2647] mt-1 mb-4 text-sm leading-relaxed border border-slate-100 bg-slate-50 p-3 rounded-md">
                                             {sug.message}
                                          </h4>
                                       </div>
                                       <div className="flex gap-2 border-t border-slate-100 pt-3">
                                          <Button size="sm" onClick={() => handleSuggestionResponse(sug, 'Accepted')} className="flex-1 bg-[#16a34a] hover:bg-[#15803d] h-9 text-xs shadow-sm">
                                             <CheckCircle2 className="w-3.5 h-3.5 mr-1.5"/> Accepted
                                          </Button>
                                          <Button size="sm" onClick={() => handleSuggestionResponse(sug, 'Rejected')} variant="outline" className="flex-1 border-red-200 text-red-600 hover:bg-red-50 h-9 text-xs">
                                             <XCircle className="w-3.5 h-3.5 mr-1.5"/> Rejected
                                          </Button>
                                       </div>
                                    </div>
                                 ))}
                              </CardContent>
                           </Card>
                        )})}
                     </div>
                  )}
               </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="officers" className="w-full space-y-6">
            <div className="grid lg:grid-cols-3 gap-6">
              <Card className="shadow-sm border-t-4 border-t-purple-600 lg:col-span-1 h-fit">
                <CardHeader className="bg-purple-50/50 pb-4 border-b">
                  <CardTitle className="text-purple-900 flex items-center gap-2"><PlusCircle className="w-5 h-5 text-purple-600"/> Add Govt Officer</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <form onSubmit={handleSaveOfficer} className="space-y-4">
                    <div>
                      <Label className="text-xs font-bold text-slate-600">Officer Name *</Label>
                      <Input required value={officerForm.name} onChange={e=>setOfficerForm({...officerForm, name: e.target.value})} className="mt-1 bg-white h-9 text-sm"/>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                       <div>
                         <Label className="text-xs font-bold text-slate-600">Department *</Label>
                         <Input required placeholder="e.g. R&B" value={officerForm.department} onChange={e=>setOfficerForm({...officerForm, department: e.target.value})} className="mt-1 bg-white h-9 text-sm"/>
                       </div>
                       <div>
                         <Label className="text-xs font-bold text-slate-600">Designation</Label>
                         <Input placeholder="e.g. EE" value={officerForm.designation} onChange={e=>setOfficerForm({...officerForm, designation: e.target.value})} className="mt-1 bg-white h-9 text-sm"/>
                       </div>
                    </div>
                    <div>
                      <Label className="text-xs font-bold text-slate-600">Phone Number *</Label>
                      <Input required type="tel" value={officerForm.phone} onChange={e=>setOfficerForm({...officerForm, phone: e.target.value})} className="mt-1 bg-white h-9 text-sm"/>
                    </div>
                    <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                       <div>
                          <Label className="text-xs font-bold text-slate-600">State</Label>
                          <Select value={officerForm.state} onValueChange={v=>setOfficerForm({...officerForm, state: v})}>
                             <SelectTrigger className="mt-1 bg-white h-9"><SelectValue placeholder="Select" /></SelectTrigger>
                             <SelectContent>
                                <SelectItem value="Telangana">Telangana</SelectItem>
                                <SelectItem value="Andhra Pradesh">Andhra Pradesh</SelectItem>
                             </SelectContent>
                          </Select>
                       </div>
                       <div>
                          <Label className="text-xs font-bold text-slate-600">District</Label>
                          <Select value={officerForm.district} onValueChange={v=>setOfficerForm({...officerForm, district: v})}>
                             <SelectTrigger className="mt-1 bg-white h-9"><SelectValue placeholder="Select" /></SelectTrigger>
                             <SelectContent>
                                {DISTRICTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                             </SelectContent>
                          </Select>
                       </div>
                    </div>
                    <div>
                      <Label className="text-xs font-bold text-slate-600">Full Address</Label>
                      <Textarea rows={2} placeholder="Office address..." value={officerForm.address} onChange={e=>setOfficerForm({...officerForm, address: e.target.value})} className="mt-1 bg-white text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs font-bold text-slate-600">Pincode</Label>
                      <Input type="text" placeholder="e.g. 500001" value={officerForm.pincode} onChange={e=>setOfficerForm({...officerForm, pincode: e.target.value})} className="mt-1 bg-white h-9 text-sm"/>
                    </div>
                    <div>
                      <Label className="text-xs font-bold text-slate-600">Follow-up Notes</Label>
                      <textarea className="w-full border rounded-md p-2 mt-1 h-16 text-sm bg-white outline-none focus:ring-2 focus:ring-purple-500" value={officerForm.notes} onChange={e=>setOfficerForm({...officerForm, notes: e.target.value})}></textarea>
                    </div>
                    <Button type="submit" disabled={savingOfficer} className="w-full bg-purple-600 hover:bg-purple-700 h-10 shadow-md">
                      {savingOfficer ? 'Saving...' : 'Save to Directory'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="shadow-sm lg:col-span-2 w-full">
                <CardHeader className="bg-slate-50 border-b pb-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                  <div>
                     <CardTitle className="text-[#0A2647] flex items-center gap-2"><Contact className="w-5 h-5 text-purple-600"/> Central Officers Directory</CardTitle>
                     <CardDescription>Database of government contacts for quick follow-ups.</CardDescription>
                  </div>
                  <div className="relative shrink-0">
                     <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                     <Input placeholder="Search officers..." value={officerSearch} onChange={e=>setOfficerSearch(e.target.value)} className="pl-9 h-9 w-full sm:w-[250px] bg-white shadow-sm" />
                  </div>
                </CardHeader>
                <CardContent className="pt-4 p-0">
                  {filteredOfficers.length === 0 ? (
                    <p className="text-center text-sm text-slate-500 py-10">No officers found.</p>
                  ) : (
                    <div className="divide-y max-h-[650px] overflow-y-auto">
                      {filteredOfficers.map(officer => (
                        <div key={officer._id || Math.random()} className="p-4 hover:bg-slate-50 transition flex flex-col sm:flex-row justify-between gap-4">
                          <div>
                            <h4 className="font-bold text-[#0A2647] text-base">{officer.name}</h4>
                            <p className="text-sm font-semibold text-purple-700">{officer.designation} - {officer.department}</p>
                            
                            {(officer.state || officer.district) && (
                               <p className="text-[10px] text-slate-500 font-bold mt-1 flex items-center gap-1">
                                  <MapPin className="w-3 h-3"/> {officer.district}{officer.district && officer.state ? ', ' : ''}{officer.state} {officer.pincode ? `- ${officer.pincode}` : ''}
                               </p>
                            )}
                            
                            {officer.notes && <p className="text-xs text-slate-600 mt-2 bg-slate-100 p-2 rounded italic">"{officer.notes}"</p>}
                          </div>
                          <div className="shrink-0 flex sm:flex-col gap-2 items-end">
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-sm py-1 shadow-sm">📞 {officer.phone}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="clients" className="w-full space-y-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <Card className="shadow-sm border-t-4 border-t-red-500">
                <CardHeader className="bg-red-50/50 pb-4 border-b">
                  <CardTitle className="text-red-900 flex items-center gap-2"><BellRing className="w-5 h-5 text-red-600"/> Push Action Request</CardTitle>
                  <CardDescription>Send a direct red-alert banner to the client's portal screen.</CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  <form onSubmit={sendActionAlert} className="space-y-4">
                    <div>
                      <Label className="text-slate-600 text-xs font-bold">Select Client ID *</Label>
                      <Select required value={alertForm.client_id} onValueChange={v => setAlertForm({...alertForm, client_id: v})}>
                         <SelectTrigger className="mt-1 bg-white h-9"><SelectValue placeholder="Choose Client" /></SelectTrigger>
                         <SelectContent>
                            {approvedClients.map(c => <SelectItem key={c.email} value={c.email}>{c.client_id} ({c.company_name || c.name})</SelectItem>)}
                         </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-slate-600 text-xs font-bold">Requirement / Message *</Label>
                      <textarea required className="w-full border rounded-md p-2 mt-1 h-24 text-sm bg-white focus:ring-2 focus:ring-red-500 outline-none" placeholder="e.g., Please check email..." value={alertForm.message} onChange={e=>setAlertForm({...alertForm, message: e.target.value})}></textarea>
                    </div>
                    <Button type="submit" className="w-full bg-red-600 hover:bg-red-700 h-10 shadow-md">
                      <Send className="w-4 h-4 mr-2"/> Push Alert
                    </Button>
                  </form>
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
                      <Select required value={queryForm.client_email} onValueChange={v => setQueryForm({...queryForm, client_email: v})}>
                         <SelectTrigger className="mt-1 bg-white h-9"><SelectValue placeholder="Choose Client" /></SelectTrigger>
                         <SelectContent>
                            {approvedClients.map(c => <SelectItem key={c.email} value={c.email}>{c.client_id} ({c.company_name || c.name})</SelectItem>)}
                         </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-slate-600 text-xs font-bold">Query Subject *</Label>
                      <Input required placeholder="e.g., PAN Card Missing" value={queryForm.subject} onChange={e=>setQueryForm({...queryForm, subject: e.target.value})} className="mt-1 bg-white h-9 text-sm"/>
                    </div>
                    <div>
                      <Label className="text-slate-600 text-xs font-bold">Detailed Description *</Label>
                      <textarea required className="w-full border rounded-md p-2 mt-1 h-[68px] text-sm bg-white focus:ring-2 focus:ring-orange-500 outline-none" placeholder="Explain what document is needed..." value={queryForm.message} onChange={e=>setQueryForm({...queryForm, message: e.target.value})}></textarea>
                    </div>
                    <Button type="submit" className="w-full bg-orange-600 hover:bg-orange-700 h-10 shadow-md">
                      <Lock className="w-4 h-4 mr-2"/> Lock Client & Send Query
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            <Card className="tender-shadow border-t-4 border-t-blue-600 mt-6 w-full">
              <CardHeader className="bg-blue-50/50 border-b pb-4">
                 <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg">
                    <Briefcase className="w-5 h-5 text-blue-600" /> Active Clients Directory
                 </CardTitle>
                 <CardDescription>View client details, access their Google Drive vault, or login to troubleshoot.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 max-h-[600px] overflow-y-auto">
                 {approvedClients.length === 0 ? (
                    <div className="text-center py-8 text-slate-400">
                       <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                       <p className="text-sm font-semibold">No active verified clients found.</p>
                    </div>
                 ) : (
                    <div className="grid xl:grid-cols-2 gap-4">
                       {approvedClients.map(client => {
                          const safeId = client?.email ? `CLI-${client.email.substring(0,4).toUpperCase()}X` : 'CLI-XXXX';
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
                             </div>
                             
                             <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-4 border-t border-slate-100">
                                {client.drive_folder_link || client.drive_link ? (
                                   <Button size="sm" onClick={() => window.open(client.drive_folder_link || client.drive_link, '_blank')} variant="outline" className="flex-1 text-blue-600 border-blue-200 hover:bg-blue-50 h-9">
                                      <Database className="w-4 h-4 mr-2" /> Open Drive
                                   </Button>
                                ) : (
                                   <Button size="sm" onClick={() => handleCreateDriveFolder(client.email, client.company_name || client.name)} variant="outline" className="flex-1 text-amber-600 border-amber-200 hover:bg-amber-50 h-9">
                                      <Database className="w-4 h-4 mr-2" /> Sync Drive Space
                                   </Button>
                                )}
                                <Button size="sm" onClick={() => handleImpersonate(client.email)} className="flex-1 bg-[#0A2647] hover:bg-[#144272] h-9 shadow-sm">
                                   <LogIn className="w-4 h-4 mr-2" /> Login as Client
                                </Button>
                             </div>
                          </div>
                       )})}
                    </div>
                 )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="publisher" className="w-full space-y-6">
            <div className="grid lg:grid-cols-5 gap-6">
               
               <Card className="border-0 shadow-md lg:col-span-2 h-fit">
                 <CardHeader className="pb-4 border-b border-slate-100">
                   <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg"><PlusCircle className="w-5 h-5"/> Publish New Tender</CardTitle>
                 </CardHeader>
                 <CardContent className="pt-5">
                   <form onSubmit={handlePublishTender} className="space-y-4">
                     <div>
                       <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Document Title (Work) *</Label>
                       <Input required value={tenderForm.title} onChange={e=>setTenderForm({...tenderForm, title: e.target.value})} className="bg-white h-10"/>
                     </div>
                     <div>
                       <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Bid Number (Internal Use) *</Label>
                       <Input required value={tenderForm.bid_no} onChange={e=>setTenderForm({...tenderForm, bid_no: e.target.value})} placeholder="e.g. GEM/2026/B/..." className="bg-white h-10"/>
                     </div>
                     <div>
                       <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Department Name *</Label>
                       <Input required value={tenderForm.department} onChange={e=>setTenderForm({...tenderForm, department: e.target.value})} className="bg-white h-10"/>
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                       <div>
                         <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Last Date *</Label>
                         <Input required type="date" value={tenderForm.last_date} onChange={e=>setTenderForm({...tenderForm, last_date: e.target.value})} className="bg-white h-10 text-sm"/>
                       </div>
                       <div>
                         <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Category *</Label>
                         <Select value={tenderForm.category} onValueChange={v=>setTenderForm({...tenderForm, category: v})}>
                            <SelectTrigger className="bg-white h-10"><SelectValue placeholder="Product" /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="Product">Product</SelectItem>
                               <SelectItem value="Service">Service</SelectItem>
                            </SelectContent>
                         </Select>
                       </div>
                     </div>
                     <div>
                       <Label className="text-sm font-bold text-[#0A2647] mb-1 block">District (TS & AP) *</Label>
                       <Select value={tenderForm.district} onValueChange={v=>setTenderForm({...tenderForm, district: v})}>
                          <SelectTrigger className="bg-white h-10"><SelectValue placeholder="Select District" /></SelectTrigger>
                          <SelectContent>
                             {DISTRICTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                          </SelectContent>
                       </Select>
                     </div>
                     <div>
                       <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Supply / Tender Details</Label>
                       <textarea className="w-full border rounded-md p-3 h-24 text-sm bg-white outline-none focus:ring-1 focus:ring-slate-300" value={tenderForm.supply_details} onChange={e=>setTenderForm({...tenderForm, supply_details: e.target.value})}></textarea>
                     </div>
                     <div>
                       <Label className="text-sm font-bold text-[#0A2647] mb-1 block">PDF Document (Keep under 4 MB)</Label>
                       <div className="border-2 border-dashed border-slate-200 rounded-md p-6 text-center bg-slate-50 hover:bg-slate-100 cursor-pointer transition relative group">
                          <input type="file" accept="application/pdf" onChange={onPdfChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                          <UploadCloud className="w-6 h-6 text-[#16a34a] mx-auto mb-2 group-hover:scale-110 transition-transform" />
                          <span className="text-sm font-bold text-[#0A2647]">{pdfName || 'Click to upload PDF'}</span>
                       </div>
                     </div>
                     <Button type="submit" disabled={publishing} className="w-full bg-[#16a34a] hover:bg-[#15803d] h-11 text-base font-bold shadow-md">
                       {publishing ? 'Publishing...' : 'Publish Tender'}
                     </Button>
                   </form>
                 </CardContent>
               </Card>

               <Card className="shadow-sm border-0 ring-1 ring-slate-200 lg:col-span-3 h-fit">
                  <CardHeader className="bg-slate-50/50 pb-4 border-b">
                     <CardTitle className="text-[#0A2647] flex items-center justify-between text-lg">
                        <span className="flex items-center gap-2"><Globe className="w-5 h-5 text-blue-600"/> Live Portal Tenders</span>
                        <Badge variant="outline" className="bg-white">{publicTenders.length}</Badge>
                     </CardTitle>
                     <CardDescription>View all tenders uploaded by you or MD. Select a tender to suggest it directly to a client.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4 max-h-[700px] overflow-y-auto space-y-4 pr-2">
                     {publicTenders.length === 0 ? (
                        <p className="text-center text-sm text-slate-500 py-10">No public tenders live on site right now.</p>
                     ) : (
                        publicTenders.map(t => (
                           <div key={t._id} className="border border-slate-200 rounded-xl p-4 bg-white hover:border-blue-300 transition shadow-sm">
                              <div className="flex items-start justify-between gap-3 mb-3">
                                 <div>
                                    <div className="flex items-center gap-2 mb-1.5">
                                       <Badge className="bg-[#0A2647] text-[9px] px-1.5">{t.district}</Badge>
                                       {t.category && <Badge variant="outline" className="text-[9px] px-1.5">{t.category}</Badge>}
                                       <span className="text-[10px] text-red-600 font-bold flex items-center bg-red-50 px-1.5 py-0.5 rounded"><Clock className="w-3 h-3 mr-1"/> Ends: {new Date(t.last_date).toLocaleDateString()}</span>
                                    </div>
                                    <h4 className="font-bold text-[#0A2647] text-base leading-tight">{t.title}</h4>
                                    <p className="text-xs text-slate-500 mt-1">{t.department} {t.bid_no && <span className="ml-2 font-mono bg-slate-100 px-1 rounded">Bid No: {t.bid_no}</span>}</p>
                                 </div>
                              </div>
                              
                              <div className="border-t border-slate-100 pt-3 mt-2 flex flex-col sm:flex-row items-center gap-2">
                                 {/* 🚀 NEW: VIEW PDF BUTTON FOR EMPLOYEES TO PREVIEW DOCUMENTS WITHOUT PAYWALL */}
                                 <Button size="sm" onClick={() => window.open(`/api/tenders/${t._id}/pdf?email=${email}&role=employee`, '_blank')} variant="outline" className="h-8 text-xs text-blue-600 border-blue-200 shadow-sm shrink-0">
                                    <FileText className="w-3 h-3 mr-1.5"/> View PDF
                                 </Button>
                                 <Select value={suggestForm[t._id] || ''} onValueChange={v => setSuggestForm({...suggestForm, [t._id]: v})}>
                                    <SelectTrigger className="h-8 bg-slate-50 border-blue-200 text-xs font-semibold focus:ring-blue-500 w-full">
                                       <SelectValue placeholder="Select Client ID to Suggest" />
                                    </SelectTrigger>
                                    <SelectContent>
                                       {approvedClients.map(c => {
                                          const safeId = c.client_id || (c.email ? `CLI-${c.email.substring(0,4).toUpperCase()}X` : 'CLI-XXXX');
                                          return <SelectItem key={c.email} value={c.email}>{safeId} ({c.company_name || c.name})</SelectItem>
                                       })}
                                    </SelectContent>
                                 </Select>
                                 <Button size="sm" onClick={() => handleSuggestTender(t._id, t.title)} className="bg-blue-600 hover:bg-blue-700 h-8 text-xs w-full sm:w-auto shadow-sm shrink-0">
                                    <Send className="w-3 h-3 mr-1.5"/> Suggest
                                 </Button>
                              </div>
                           </div>
                        ))
                     )}
                  </CardContent>
               </Card>
            </div>
          </TabsContent>

          <TabsContent value="sla" className="w-full space-y-6">
            <Card className="shadow-sm w-full">
              <CardHeader className="bg-slate-50/50 pb-4 border-b">
                <CardTitle className="text-[#0A2647] flex items-center gap-2"><MessageSquare className="w-5 h-5 text-amber-500"/> Client Helpdesk & SLA Tracker</CardTitle>
                <CardDescription>Resolve queries within 24 hours or escalate to MD.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 max-h-[800px] overflow-y-auto">
                 
                 {activeTickets.length > 0 && (
                    <div className="mb-8 space-y-4">
                       <h3 className="font-bold text-slate-700 mb-2 border-b pb-2">Active Action Required</h3>
                       <div className="grid md:grid-cols-2 gap-4">
                       {activeTickets.map(ticket => (
                          <div key={ticket._id} className="border border-amber-200 bg-white rounded-lg p-4 relative overflow-hidden shadow-sm hover:shadow-md transition">
                             <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                             <div className="flex justify-between items-start mb-2">
                                <div>
                                  <Badge variant="outline" className="mb-1 bg-slate-100">{ticket.department}</Badge>
                                  <h4 className="font-bold text-[#0A2647]">{ticket.subject}</h4>
                                  <p className="text-xs text-muted-foreground">{ticket.client_email} • {new Date(ticket.created_at).toLocaleDateString()}</p>
                                </div>
                                <Badge className="bg-amber-100 text-amber-800 border-0 animate-pulse shrink-0">Action Required</Badge>
                             </div>
                             <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded mb-3 border border-slate-100 shadow-inner">"{ticket.message}"</p>
                             
                             <div className="flex flex-col gap-2 mt-4 pt-3 border-t">
                                <div className="flex gap-2">
                                   <Input placeholder="Type resolution note..." className="text-sm flex-1 bg-white focus-visible:ring-amber-500 h-9" />
                                   <Button onClick={() => toast.success('Reply sent & ticket resolved.')} className="bg-[#16a34a] hover:bg-[#15803d] shrink-0 h-9"><CheckCircle2 className="w-4 h-4 mr-1"/>Resolve</Button>
                                </div>
                                <div className="flex gap-2">
                                   <Button onClick={() => handleImpersonate(ticket.client_email)} variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50 flex-1 h-9"><MonitorPlay className="w-4 h-4 mr-1"/> Login & Fix</Button>
                                   <Button onClick={() => escalateToMD(ticket)} variant="outline" className="border-red-300 text-red-600 hover:bg-red-50 flex-1 h-9"><ShieldCheck className="w-4 h-4 mr-1"/> Escalate to MD</Button>
                                </div>
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
                                   <span className="text-[10px] bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-400 font-semibold flex items-center"><Star className="w-3 h-3 mr-1 text-slate-300"/> No Rating</span>
                                </div>
                             </div>
                          ))}
                       </div>
                    )}
                 </div>

              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </main>
    </div>
  );
}
