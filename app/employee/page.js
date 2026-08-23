'use client';
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import BrandLogo from '@/components/BrandLogo';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from 'sonner';
import {
  ArrowLeft, Users, FileText, PlusCircle, BellRing, 
  MessageSquare, Send, CheckCircle2, ShieldCheck, 
  Briefcase, Kanban, Building2, LayoutDashboard, AlertCircle, Contact, MonitorPlay
} from 'lucide-react';

export default function EmployeeDashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [empData, setEmpData] = useState({ name: 'Employee', id: 'EMP-001', role: 'Operations Officer' });
  const [loading, setLoading] = useState(true);

  // --- PERMANENT BACKEND STATES ---
  const [mdTasks, setMdTasks] = useState([]);
  const [bids, setBids] = useState([]);
  const [officers, setOfficers] = useState([]);

  // Forms
  const [tenderForm, setTenderForm] = useState({
    title: '', department: '', last_date: '', district: 'Hyderabad', category: 'Product', supply_details: ''
  });
  const [publishing, setPublishing] = useState(false);
  const [alertForm, setAlertForm] = useState({ client_id: '', message: '' });
  
  // Govt Officer Form State
  const [officerForm, setOfficerForm] = useState({ name: '', department: '', phone: '', designation: '', notes: '' });
  const [savingOfficer, setSavingOfficer] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_emp_email') : 'employee@tgtenders.in';
    const finalEmail = e || 'employee@tgtenders.in';
    setEmail(finalEmail);
    
    // 🚀 INITIAL DB FETCH ON LOAD
    fetchLiveOperationsData(finalEmail);

    // 🚀 AUTO-LOG ATTENDANCE ON LOAD
    fetch('/api/employee/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: finalEmail, action: 'LOGIN', details: 'Employee started session on portal.' })
    }).catch(err => console.log('Attendance log failed', err));
    
  }, []);

  const fetchLiveOperationsData = async (userEmail) => {
    try {
      const [tasksRes, bidsRes, officersRes] = await Promise.all([
        fetch('/api/dispatches'), 
        fetch('/api/bids'),       
        fetch('/api/gov-officers') // Fetch Govt Officers
      ]);

      if (tasksRes.ok) {
        const tData = await tasksRes.json();
        const employeeTasks = (tData.dispatches || []).filter(d => d.target_type === 'employee_task');
        setMdTasks(employeeTasks);
      }
      if (bidsRes.ok) {
        const bData = await bidsRes.json();
        setBids(bData.bids || []);
      }
      if (officersRes.ok) {
        const oData = await officersRes.json();
        setOfficers(oData.officers || []);
      }
    } catch (err) {
      console.error("Failed to fetch live operations data", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePublishTender = async (e) => {
    e.preventDefault();
    if(!tenderForm.title || !tenderForm.department || !tenderForm.last_date) return toast.error('Please fill all required fields');
    setPublishing(true);
    try {
      const r = await fetch('/api/tenders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tenderForm)
      });
      if(r.ok) {
        toast.success('Tender published manually and synced with portal calendar!');
        setTenderForm({ title: '', department: '', last_date: '', district: 'Hyderabad', category: 'Product', supply_details: '' });
        // Log Activity
        logActivity('PUBLISHED_TENDER', `Published tender: ${tenderForm.title}`);
      } else {
        toast.error('Failed to publish tender');
      }
    } catch (err) {
      toast.error('Network error');
    }
    setPublishing(false);
  };

  const sendActionAlert = async (e) => {
    e.preventDefault();
    if(!alertForm.client_id || !alertForm.message) return toast.error('Fill all fields');
    try {
      const res = await fetch('/api/dispatches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: 'client_alert', target_id: alertForm.client_id, subject: 'ACTION REQUIRED: Operations Update', message: alertForm.message })
      });
      if (res.ok) {
        toast.success(`CRITICAL ALERT pushed to Client Dashboard (${alertForm.client_id})!`);
        logActivity('SENT_ALERT', `Alert to ${alertForm.client_id}`);
        setAlertForm({ client_id: '', message: '' });
      }
    } catch (err) {
      toast.error('Network Error while pushing alert.');
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
        toast.success('Task marked completed. MD Dashboard Updated.');
        logActivity('COMPLETED_TASK', `Task ${taskId} marked as done`);
      } else {
        fetchLiveOperationsData(email);
      }
    } catch (err) {
      toast.error('Network Error while updating task.');
    }
  };

  // 🚀 NEW: Save Govt Officer Function
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
        setOfficerForm({ name: '', department: '', phone: '', designation: '', notes: '' });
        fetchLiveOperationsData(email); // Refresh list
      }
    } catch (err) {
      toast.error('Failed to save officer data');
    }
    setSavingOfficer(false);
  };

  // Helper function to log activity
  const logActivity = (action, details) => {
    fetch('/api/employee/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action, details })
    }).catch(err => console.log('Activity log failed', err));
  };

  const escalateToMD = () => {
    toast.info('Item escalated to Managing Director successfully.');
    logActivity('ESCALATED_TICKET', 'Escalated a ticket to MD');
  };
  const [impersonateEmail, setImpersonateEmail] = useState('');

  const handleImpersonate = async (targetEmail) => {
    if (!targetEmail) return toast.error('Enter a valid client email');
    toast.loading(`Connecting to ${targetEmail}'s portal...`);
    await signIn('impersonate', {
      email: targetEmail,
      adminToken: 'admin_success',
      callbackUrl: '/account' // Redirects straight to their account
    });
  };
  if (!isMounted) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ENTERPRISE HEADER */}
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

      <main className="container mx-auto px-4 py-6">
        
        {/* MD PRIORITY TASKS WIDGET */}
        <div className="mb-6 bg-white border border-blue-200 rounded-xl p-4 shadow-sm relative overflow-hidden">
           <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
           <h3 className="font-bold text-[#0A2647] flex items-center gap-2 mb-3"><LayoutDashboard className="w-4 h-4 text-blue-500"/> Tasks Assigned by MD / Admin</h3>
           <div className="grid md:grid-cols-2 gap-4">
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
          {/* UPDATED: Added Officers Tab */}
          <TabsList className="grid w-full lg:w-[1000px] grid-cols-5 bg-slate-200 h-auto p-1 mb-6 rounded-lg overflow-x-auto">
            <TabsTrigger value="kanban" className="py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <Kanban className="w-4 h-4 mr-2 hidden sm:block"/> Bids
            </TabsTrigger>
            <TabsTrigger value="officers" className="py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <Contact className="w-4 h-4 mr-2 hidden sm:block"/> Govt Officers
            </TabsTrigger>
            <TabsTrigger value="clients" className="py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <AlertCircle className="w-4 h-4 mr-2 hidden sm:block"/> Alerts
            </TabsTrigger>
            <TabsTrigger value="publisher" className="py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <PlusCircle className="w-4 h-4 mr-2 hidden sm:block"/> Data
            </TabsTrigger>
            <TabsTrigger value="sla" className="py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <MessageSquare className="w-4 h-4 mr-2 hidden sm:block"/> Helpdesk
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: KANBAN BID WORKFLOW (Existing) */}
          <TabsContent value="kanban" className="space-y-6">
            <Card className="shadow-sm border-0 ring-1 ring-slate-200">
              <CardHeader className="bg-slate-50/50 pb-4 border-b">
                <CardTitle className="text-[#0A2647] flex items-center gap-2"><Kanban className="w-5 h-5 text-blue-600"/> Active Bids Workflow Tracker</CardTitle>
                <CardDescription>Manually update the progress of ongoing client bids. This syncs directly to the client's dashboard.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                {bids.length === 0 ? (
                  <p className="text-center text-sm text-slate-500 py-10">No active bids in the database.</p>
                ) : (
                  <div className="grid md:grid-cols-2 gap-4">
                    {bids.map(b => (
                      <div key={b._id || b.id} className="border rounded-xl p-4 bg-white shadow-sm flex flex-col justify-between gap-3 hover:shadow-md transition">
                        <div>
                          <div className="flex justify-between items-start mb-2">
                            <Badge className="bg-slate-100 text-slate-600 font-mono text-[10px]">{b.bid_no || b.id}</Badge>
                            <Badge className="bg-blue-100 text-blue-800 border-0">{b.status}</Badge>
                          </div>
                          <h4 className="font-bold text-[#0A2647] mt-1">{b.title || b.description}</h4>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1 font-semibold">
                            <Building2 className="w-3 h-3 text-emerald-600"/> Client: {b.client_email || b.client}
                          </p>
                        </div>
                        
                        <div className="border-t pt-3 flex items-center justify-between gap-2">
                          <span className="text-xs text-slate-500 font-semibold">Update Status:</span>
                          <select 
                            className="border rounded px-2 py-1.5 text-xs bg-slate-50 font-bold text-[#0A2647] outline-none focus:ring-2 focus:ring-blue-500"
                            value={b.status}
                            onChange={(e) => updateBidStatus(b._id || b.id, e.target.value)}
                          >
                            <option value="Doc Preparation">Doc Preparation</option>
                            <option value="Awaiting Docs">Ask Client for Docs</option>
                            <option value="Submitted">Mark Submitted</option>
                            <option value="Evaluating">Evaluating</option>
                            <option value="Won">Declare Won</option>
                            <option value="Lost">Declare Lost</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 🚀 NEW TAB 2: GOVT OFFICERS DIRECTORY */}
          <TabsContent value="officers" className="space-y-6">
            <div className="grid md:grid-cols-3 gap-6">
              {/* Form Section */}
              <Card className="shadow-sm border-t-4 border-t-purple-600 md:col-span-1 h-fit">
                <CardHeader className="bg-purple-50/50 pb-4 border-b">
                  <CardTitle className="text-purple-900 flex items-center gap-2"><PlusCircle className="w-5 h-5 text-purple-600"/> Add Govt Officer</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <form onSubmit={handleSaveOfficer} className="space-y-4">
                    <div>
                      <Label className="text-slate-600">Officer Name *</Label>
                      <Input required value={officerForm.name} onChange={e=>setOfficerForm({...officerForm, name: e.target.value})} className="mt-1 bg-white"/>
                    </div>
                    <div>
                      <Label className="text-slate-600">Department *</Label>
                      <Input required placeholder="e.g. R&B" value={officerForm.department} onChange={e=>setOfficerForm({...officerForm, department: e.target.value})} className="mt-1 bg-white"/>
                    </div>
                    <div>
                      <Label className="text-slate-600">Designation</Label>
                      <Input placeholder="e.g. Executive Engineer" value={officerForm.designation} onChange={e=>setOfficerForm({...officerForm, designation: e.target.value})} className="mt-1 bg-white"/>
                    </div>
                    <div>
                      <Label className="text-slate-600">Phone Number *</Label>
                      <Input required type="tel" value={officerForm.phone} onChange={e=>setOfficerForm({...officerForm, phone: e.target.value})} className="mt-1 bg-white"/>
                    </div>
                    <div>
                      <Label className="text-slate-600">Follow-up Notes</Label>
                      <textarea className="w-full border rounded-md p-2 mt-1 h-20 text-sm bg-white outline-none focus:ring-2 focus:ring-purple-500" value={officerForm.notes} onChange={e=>setOfficerForm({...officerForm, notes: e.target.value})}></textarea>
                    </div>
                    <Button type="submit" disabled={savingOfficer} className="w-full bg-purple-600 hover:bg-purple-700 h-11">
                      {savingOfficer ? 'Saving...' : 'Save to Directory'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Directory List Section */}
              <Card className="shadow-sm md:col-span-2">
                <CardHeader className="bg-slate-50 border-b pb-4">
                  <CardTitle className="text-[#0A2647] flex items-center gap-2"><Contact className="w-5 h-5 text-purple-600"/> Central Officers Directory</CardTitle>
                  <CardDescription>Database of government contacts for quick follow-ups.</CardDescription>
                </CardHeader>
                <CardContent className="pt-4 p-0">
                  {officers.length === 0 ? (
                    <p className="text-center text-sm text-slate-500 py-10">No officers added yet.</p>
                  ) : (
                    <div className="divide-y">
                      {officers.map(officer => (
                        <div key={officer._id || Math.random()} className="p-4 hover:bg-slate-50 transition flex flex-col sm:flex-row justify-between gap-4">
                          <div>
                            <h4 className="font-bold text-[#0A2647] text-base">{officer.name}</h4>
                            <p className="text-sm font-semibold text-purple-700">{officer.designation} - {officer.department}</p>
                            {officer.notes && <p className="text-xs text-slate-600 mt-2 bg-slate-100 p-2 rounded italic">"{officer.notes}"</p>}
                          </div>
                          <div className="shrink-0 flex sm:flex-col gap-2 items-end">
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-sm py-1">📞 {officer.phone}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB 3: CLIENT ACTION ALERTS */}
          <TabsContent value="clients" className="space-y-6">
            <Card className="shadow-sm max-w-2xl mx-auto border-t-4 border-t-red-500">
              <CardHeader className="bg-red-50/50 pb-4 border-b">
                <CardTitle className="text-red-900 flex items-center gap-2"><BellRing className="w-5 h-5 text-red-600"/> Push Action Request to Client</CardTitle>
                <CardDescription>Bypass email. Send a direct red-alert to the client's portal screen for immediate action.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={sendActionAlert} className="space-y-4">
                  <div>
                    <Label className="text-slate-600">Client ID / Email</Label>
                    <Input required placeholder="client@example.com" value={alertForm.client_id} onChange={e=>setAlertForm({...alertForm, client_id: e.target.value})} className="mt-1 font-mono bg-white"/>
                  </div>
                  <div>
                    <Label className="text-slate-600">Requirement / Message</Label>
                    <textarea required className="w-full border rounded-md p-2 mt-1 h-24 text-sm bg-white focus:ring-2 focus:ring-red-500 outline-none" placeholder="e.g., Please upload your updated GST certificate for the ongoing bid..." value={alertForm.message} onChange={e=>setAlertForm({...alertForm, message: e.target.value})}></textarea>
                  </div>
                  <Button type="submit" className="w-full bg-red-600 hover:bg-red-700 h-11">
                    <Send className="w-4 h-4 mr-2"/> Push Alert to Client Dashboard
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* 👇👇👇 STEP 3: PASTE IMPERSONATION CARD HERE 👇👇👇 */}
            <Card className="shadow-sm max-w-2xl mx-auto border-t-4 border-t-blue-500 mt-6">
              <CardHeader className="bg-blue-50/50 pb-4 border-b">
                <CardTitle className="text-blue-900 flex items-center gap-2"><MonitorPlay className="w-5 h-5 text-blue-600"/> Client Troubleshooting</CardTitle>
                <CardDescription>Login as a client directly to resolve issues without their password.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-4">
                  <div>
                    <Label className="text-slate-600">Client Email to Access</Label>
                    <Input placeholder="client@example.com" value={impersonateEmail} onChange={e=>setImpersonateEmail(e.target.value)} className="mt-1 font-mono bg-white"/>
                  </div>
                  <Button onClick={() => handleImpersonate(impersonateEmail)} className="w-full bg-[#0A2647] hover:bg-[#144272] h-11">
                    <MonitorPlay className="w-4 h-4 mr-2"/> Login to Client Dashboard
                  </Button>
                </div>
              </CardContent>
            </Card>
            {/* 👆👆👆 END OF STEP 3 👆👆👆 */}

          </TabsContent>
          {/* TAB 4: FULL MANUAL TENDER PUBLISHER */}
          <TabsContent value="publisher" className="space-y-6">
            <Card className="border-t-4 border-t-[#16a34a] shadow-sm max-w-3xl mx-auto">
              <CardHeader className="bg-slate-50/50 pb-4">
                <CardTitle className="text-[#0A2647] flex items-center gap-2"><FileText className="w-5 h-5 text-[#16a34a]"/> Publish Scraped Tender Data</CardTitle>
                <CardDescription>Manually enter tender data collected from GeM or state procurement portals.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={handlePublishTender} className="space-y-4">
                  <div>
                    <Label>Tender Title / Work Description *</Label>
                    <Input required value={tenderForm.title} onChange={e=>setTenderForm({...tenderForm, title: e.target.value})} placeholder="e.g. Supply of IT Equipment..." className="mt-1 bg-white"/>
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label>Department Name *</Label>
                      <Input required value={tenderForm.department} onChange={e=>setTenderForm({...tenderForm, department: e.target.value})} placeholder="e.g. R&B Department" className="mt-1 bg-white"/>
                    </div>
                    <div>
                      <Label>Last Date (Submission Deadline) *</Label>
                      <Input required type="date" value={tenderForm.last_date} onChange={e=>setTenderForm({...tenderForm, last_date: e.target.value})} className="mt-1 bg-white"/>
                    </div>
                    <div>
                      <Label>District *</Label>
                      <Input required value={tenderForm.district} onChange={e=>setTenderForm({...tenderForm, district: e.target.value})} className="mt-1 bg-white"/>
                    </div>
                    <div>
                      <Label>Category *</Label>
                      <select className="w-full border rounded-md p-2 mt-1 bg-white text-sm" value={tenderForm.category} onChange={e=>setTenderForm({...tenderForm, category: e.target.value})}>
                        <option value="Product">Product</option>
                        <option value="Service">Service</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <Label>Supply / Technical Details</Label>
                    <textarea className="w-full border rounded-md p-2 mt-1 h-24 text-sm bg-white" placeholder="Enter specifications..." value={tenderForm.supply_details} onChange={e=>setTenderForm({...tenderForm, supply_details: e.target.value})}></textarea>
                  </div>
                  <Button type="submit" disabled={publishing} className="w-full bg-[#16a34a] hover:bg-[#15803d] h-11">
                    {publishing ? 'Publishing...' : 'Publish Tender to Live Portal'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 5: FULL SLA HELPDESK */}
          <TabsContent value="sla" className="space-y-6">
            <Card className="shadow-sm max-w-3xl mx-auto">
              <CardHeader className="bg-slate-50/50 pb-4 border-b">
                <CardTitle className="text-[#0A2647] flex items-center gap-2"><MessageSquare className="w-5 h-5 text-amber-500"/> Client Helpdesk & SLA Tracker</CardTitle>
                <CardDescription>Resolve queries within 24 hours or escalate to MD.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                 <div className="border border-amber-200 bg-white rounded-lg p-4 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                    <div className="flex justify-between items-start mb-2">
                       <div>
                         <Badge variant="outline" className="mb-1 bg-slate-100">Operations</Badge>
                         <h4 className="font-bold text-[#0A2647]">DSC Mapping Assistance</h4>
                         <p className="text-xs text-muted-foreground">client@example.com • 4 hours ago</p>
                       </div>
                       <Badge className="bg-amber-100 text-amber-800 border-0">20 hrs remaining</Badge>
                    </div>
                    <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded mb-3">"Need help linking my Class 3 DSC token to the GeM vendor profile."</p>
                    
                    <div className="flex flex-col sm:flex-row gap-2">
                       <Input placeholder="Type resolution note..." className="text-sm flex-1 bg-white focus-visible:ring-amber-500" />
                       <Button onClick={() => toast.success('Reply sent & ticket resolved.')} className="bg-[#16a34a] hover:bg-[#15803d] shrink-0">Resolve</Button>
                       
                       {/* 🚀 NEW: Quick Login & Fix Button */}
                       <Button onClick={() => handleImpersonate('client@example.com')} variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50 shrink-0"><MonitorPlay className="w-4 h-4 mr-1"/> Login & Fix</Button>
                       
                       <Button onClick={escalateToMD} variant="outline" className="border-red-300 text-red-600 hover:bg-red-50 shrink-0"><ShieldCheck className="w-4 h-4 mr-1"/> Escalate to MD</Button>
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
