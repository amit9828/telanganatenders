'use client';
import { useEffect, useState } from 'react';
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
  Briefcase, Kanban, Building2, LayoutDashboard, AlertCircle
} from 'lucide-react';

export default function EmployeeDashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [empData, setEmpData] = useState({ name: 'Employee', id: 'EMP-001', role: 'Operations Officer' });
  const [loading, setLoading] = useState(true);

  // MD Assigned Tasks (Coming from Admin Dashboard)
  const [mdTasks, setMdTasks] = useState([
    { id: 'TSK-101', subject: 'Verify Balaji Ent GST', status: 'Pending', priority: 'High' },
    { id: 'TSK-102', subject: 'Call RR Constructions for DSC', status: 'Completed', priority: 'Medium' }
  ]);

  // Manual Tender Entry Form
  const [tenderForm, setTenderForm] = useState({
    title: '', department: '', last_date: '', district: 'Hyderabad', category: 'Product', supply_details: ''
  });
  const [publishing, setPublishing] = useState(false);

  // Client Action Alert Form
  const [alertForm, setAlertForm] = useState({ client_id: '', message: '' });

  // Kanban Mock Bids State (Manual Status Tracking)
  const [bids, setBids] = useState([
    { id: 'BID-001', title: 'Medical Equipment Supply', client: 'CLI-1042 (RR Const)', status: 'Awaiting Docs', portal: 'GeM' },
    { id: 'BID-002', title: 'Road Construction Works', client: 'CLI-2099 (Balaji Ent)', status: 'Submitted', portal: 'State R&B' },
  ]);

  useEffect(() => {
    setIsMounted(true);
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_emp_email') : 'employee@tgtenders.in';
    setEmail(e || 'employee@tgtenders.in');
    setLoading(false);
  }, []);

  const handlePublishTender = async (e) => {
    e.preventDefault();
    if(!tenderForm.title || !tenderForm.department || !tenderForm.last_date) {
      return toast.error('Please fill all required fields');
    }
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
      } else {
        toast.error('Failed to publish tender');
      }
    } catch (err) {
      toast.error('Network error');
    }
    setPublishing(false);
  };

  const sendActionAlert = (e) => {
    e.preventDefault();
    if(!alertForm.client_id || !alertForm.message) return toast.error('Fill all fields');
    toast.success(`CRITICAL ALERT pushed to Client Dashboard (${alertForm.client_id})!`);
    setAlertForm({ client_id: '', message: '' });
  };

  const updateBidStatus = (id, newStatus) => {
    setBids(bids.map(b => b.id === id ? { ...b, status: newStatus } : b));
    toast.success(`Bid ${id} updated to "${newStatus}". Client Notified.`);
  };

  const markTaskDone = (taskId) => {
    setMdTasks(mdTasks.map(t => t.id === taskId ? { ...t, status: 'Completed' } : t));
    toast.success('Task marked completed. MD Dashboard Updated.');
  };

  const escalateToMD = () => {
    toast.info('Item escalated to Managing Director successfully.');
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
             <Badge className="bg-[#16a34a] border-0 hidden sm:inline-flex">Free PDF Access Enabled</Badge>
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
              {mdTasks.map(task => (
                 <div key={task.id} className="flex justify-between items-center bg-slate-50 border p-3 rounded-lg">
                    <div>
                       <Badge variant="outline" className={`mb-1 ${task.priority === 'High' ? 'text-red-600 border-red-200 bg-red-50' : 'text-amber-600 border-amber-200 bg-amber-50'}`}>{task.priority} Priority</Badge>
                       <p className="font-semibold text-sm text-slate-800">{task.subject}</p>
                    </div>
                    {task.status === 'Pending' ? (
                       <Button size="sm" onClick={() => markTaskDone(task.id)} className="bg-blue-600 hover:bg-blue-700 h-8 text-xs">Mark Done</Button>
                    ) : (
                       <Badge className="bg-emerald-100 text-emerald-800 border-0"><CheckCircle2 className="w-3 h-3 mr-1"/> Done</Badge>
                    )}
                 </div>
              ))}
           </div>
        </div>

        <Tabs defaultValue="kanban" className="w-full">
          <TabsList className="grid w-full lg:w-[900px] grid-cols-4 bg-slate-200 h-auto p-1 mb-6 rounded-lg">
            <TabsTrigger value="kanban" className="py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <Kanban className="w-4 h-4 mr-2 hidden sm:block"/> Bid Workflow
            </TabsTrigger>
            <TabsTrigger value="clients" className="py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <AlertCircle className="w-4 h-4 mr-2 hidden sm:block"/> Client Alerts
            </TabsTrigger>
            <TabsTrigger value="publisher" className="py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <PlusCircle className="w-4 h-4 mr-2 hidden sm:block"/> Manual Data
            </TabsTrigger>
            <TabsTrigger value="sla" className="py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <MessageSquare className="w-4 h-4 mr-2 hidden sm:block"/> Helpdesk
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: KANBAN BID WORKFLOW */}
          <TabsContent value="kanban" className="space-y-6">
            <Card className="shadow-sm border-0 ring-1 ring-slate-200">
              <CardHeader className="bg-slate-50/50 pb-4 border-b">
                <CardTitle className="text-[#0A2647] flex items-center gap-2"><Kanban className="w-5 h-5 text-blue-600"/> Active Bids Workflow Tracker</CardTitle>
                <CardDescription>Manually update the progress of ongoing client bids.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid md:grid-cols-2 gap-4">
                  {bids.map(b => (
                    <div key={b.id} className="border rounded-xl p-4 bg-white shadow-sm flex flex-col justify-between gap-3 hover:shadow-md transition">
                      <div>
                        <div className="flex justify-between items-start mb-2">
                          <Badge className="bg-slate-100 text-slate-600 font-mono text-[10px]">{b.id}</Badge>
                          <Badge className="bg-blue-100 text-blue-800 border-0">{b.status}</Badge>
                        </div>
                        <h4 className="font-bold text-[#0A2647] mt-1">{b.title}</h4>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1 font-semibold">
                          <Building2 className="w-3 h-3 text-emerald-600"/> Client: {b.client}
                        </p>
                      </div>
                      
                      <div className="border-t pt-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500 font-semibold">Update Status:</span>
                        <select 
                          className="border rounded px-2 py-1.5 text-xs bg-slate-50 font-bold text-[#0A2647] outline-none focus:ring-2 focus:ring-blue-500"
                          value={b.status}
                          onChange={(e) => updateBidStatus(b.id, e.target.value)}
                        >
                          <option value="Document Preparation">Doc Preparation</option>
                          <option value="Awaiting Docs">Ask Client for Docs</option>
                          <option value="Submitted">Mark Submitted</option>
                          <option value="Won">Declare Won</option>
                          <option value="Lost">Declare Lost</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 2: CLIENT ACTION ALERTS */}
          <TabsContent value="clients" className="space-y-6">
            <Card className="shadow-sm max-w-2xl mx-auto border-t-4 border-t-red-500">
              <CardHeader className="bg-red-50/50 pb-4 border-b">
                <CardTitle className="text-red-900 flex items-center gap-2"><BellRing className="w-5 h-5 text-red-600"/> Push Action Request to Client</CardTitle>
                <CardDescription>Bypass email. Send a direct red-alert to the client's portal screen for immediate action.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={sendActionAlert} className="space-y-4">
                  <div>
                    <Label className="text-slate-600">Client ID / Email (e.g. CLI-1042)</Label>
                    <Input required placeholder="CLI-XXXX or client@example.com" value={alertForm.client_id} onChange={e=>setAlertForm({...alertForm, client_id: e.target.value})} className="mt-1 font-mono"/>
                  </div>
                  <div>
                    <Label className="text-slate-600">Requirement / Message</Label>
                    <textarea required className="w-full border rounded-md p-2 mt-1 h-24 text-sm" placeholder="e.g., Please upload your updated GST certificate for the ongoing bid..." value={alertForm.message} onChange={e=>setAlertForm({...alertForm, message: e.target.value})}></textarea>
                  </div>
                  <Button type="submit" className="w-full bg-red-600 hover:bg-red-700 h-11">
                    <Send className="w-4 h-4 mr-2"/> Push Alert to Client Dashboard
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: FULL MANUAL TENDER PUBLISHER (Restored fully) */}
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

          {/* TAB 4: FULL SLA HELPDESK (Restored fully) */}
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
                       <Input placeholder="Type resolution note..." className="text-sm flex-1 bg-white" />
                       <Button onClick={() => toast.success('Reply sent & ticket resolved.')} className="bg-[#16a34a] hover:bg-[#15803d] shrink-0">Resolve</Button>
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
