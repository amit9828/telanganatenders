'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import DashboardNav from '@/components/DashboardNav';
import LiveScrapedTendersPanel from '@/components/LiveScrapedTendersPanel';
import AiMatchmakerPanel from '@/components/AiMatchmakerPanel';
import L1BenchmarkDropzone from '@/components/L1BenchmarkDropzone';
import MatchedOpportunitiesPanel from '@/components/MatchedOpportunitiesPanel';
import GemCoPilot from '@/components/GemCoPilot';
import LiveTendersPaged from '@/components/workflow/LiveTendersPaged';
import InternalTrackingBoard from '@/components/workflow/InternalTrackingBoard';
import SubmittedTrackingBoard from '@/components/workflow/SubmittedTrackingBoard';
import PublishTenderForm from '@/components/workflow/PublishTenderForm';
import CompactTenderCard from '@/components/workflow/CompactTenderCard';
import SuggestionBar from '@/components/workflow/SuggestionBar';
import SuggestClientControls from '@/components/workflow/SuggestClientControls';
import StaffChat from '@/components/StaffChat';
import OpsAlerts from '@/components/OpsAlerts';
import TeamDirectoryPanel, { openStaffDesk } from '@/components/TeamDirectoryPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { workflowFetch, openWorkflowFile } from '@/components/workflow/api';
import { TS_AP_DISTRICTS } from '@/lib/regions';
import {
  Briefcase, FileText, Users, Bot, Activity, Target, BellRing, MessageSquare, PlusCircle, ClipboardList, UserCog, ArrowLeft, Loader2, Contact, Search, MapPin, Database, LogIn, CheckCircle2
} from 'lucide-react';

export default function StaffOpsDesk({ desk }) {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState(desk === 'tl' ? 'publisher' : 'live');
  const [jobs, setJobs] = useState([]);
  const [internalJobs, setInternalJobs] = useState([]);
  const [submittedJobs, setSubmittedJobs] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [clients, setClients] = useState([]);
  const [team, setTeam] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [officerSearch, setOfficerSearch] = useState('');
  const [savingOfficer, setSavingOfficer] = useState(false);
  const [officerForm, setOfficerForm] = useState({
    name: '', department: '', designation: '', phone: '', state: '', district: '', address: '', pincode: '', notes: '',
  });

  const selfId = session?.user?.emp_id || '';
  const staffEmail = session?.user?.email;
  const isGm = desk === 'gm';
  const isTl = desk === 'tl';

  const load = async () => {
    try {
      const [q, internalQ, submittedQ, t, c, e, o] = await Promise.all([
        workflowFetch('/api/workflow/queue'),
        workflowFetch('/api/workflow/queue?board=internal'),
        workflowFetch('/api/workflow/queue?board=submitted'),
        fetch('/api/tenders', { credentials: 'include' }).then((r) => r.json()),
        fetch('/api/users/approved', { credentials: 'include' }).then((r) => r.json()),
        workflowFetch('/api/employees'),
        isGm
          ? fetch('/api/gov-officers', { credentials: 'include' }).then((r) => r.json()).catch(() => ({ officers: [] }))
          : Promise.resolve({ officers: [] }),
      ]);
      setJobs(q.jobs || []);
      setInternalJobs(internalQ.jobs || []);
      setSubmittedJobs(submittedQ.jobs || []);
      setTenders(t.tenders || []);
      setClients(c.users || []);
      setTeam(e.team || []);
      setOfficers(o.officers || []);
    } catch (err) {
      toast.error(err.message);
    }
  };

  useEffect(() => {
    if (status !== 'authenticated' && status !== 'unauthenticated') return undefined;
    load();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') load();
    }, 60000);
    return () => clearInterval(interval);
  }, [status]);

  const liveJobs = jobs.filter((j) => j.status === 'LIVE' && !j.parked_client_email);
  const parkedJobs = jobs.filter((j) => j.status === 'LIVE' && j.parked_client_email);
  const pendingClientJobs = jobs.filter((j) => j.status === 'AWAITING_CLIENT');
  const internal = internalJobs;
  const submitted = submittedJobs;
  const awaitingPublish = jobs.filter((j) => j.status === 'AWAITING_PUBLISH');
  const tls = team.filter((t) => t.designation === 'DOC_TEAM_TL');
  const members = team.filter((t) => t.designation === 'DOC_TEAM_MEMBER');
  const filteredOfficers = officers.filter((o) => {
    const needle = officerSearch.trim().toLowerCase();
    if (!needle) return true;
    return [o.name, o.department, o.designation, o.district, o.phone].some((v) => String(v || '').toLowerCase().includes(needle));
  });

  const groups = isGm
    ? [
        { id: 'work', label: 'Work', items: [
          { value: 'live', label: 'Live Tenders', icon: FileText, color: 'navy' },
          { value: 'suggestion-bar', label: 'Suggestion Bar', icon: FileText, color: 'amber' },
          { value: 'internal', label: 'Internal Board', icon: ClipboardList, color: 'blue' },
          { value: 'submitted', label: 'Submitted', icon: FileText, color: 'emerald' },
        ] },
        { id: 'ai', label: 'AI', items: [
          { value: 'matchmaker', label: 'AI Matchmaker / Live Hunting', icon: Target, color: 'indigo' },
          { value: 'scraped', label: 'Live Scraped', icon: Activity, color: 'teal' },
          { value: 'copilot', label: 'Co-Pilot', icon: Bot, color: 'violet' },
        ] },
        { id: 'clients-officers', label: 'Clients', items: [
          { value: 'clients', label: 'Clients DB', icon: Briefcase, color: 'navy' },
          { value: 'officers', label: 'Officers', icon: Contact, color: 'purple' },
        ] },
        { id: 'team', label: 'Team', items: [
          { value: 'team', label: 'Team Directory', icon: UserCog, color: 'blue' },
          { value: 'alerts', label: 'Alerts', icon: BellRing, color: 'navy' },
          { value: 'chat', label: 'Chat', icon: MessageSquare, color: 'navy' },
        ] },
      ]
    : [
        { id: 'work', label: 'Work', items: [
          { value: 'publisher', label: 'Publish', icon: FileText, color: 'navy' },
          { value: 'internal', label: 'Team Board', icon: ClipboardList, color: 'blue' },
          { value: 'submitted', label: 'Submitted', icon: FileText, color: 'emerald' },
        ] },
        { id: 'ai', label: 'AI', items: [
          { value: 'copilot', label: 'Co-Pilot', icon: Bot, color: 'violet' },
        ] },
        { id: 'team', label: 'Team', items: [
          { value: 'team', label: 'Team', icon: Users, color: 'blue' },
          { value: 'alerts', label: 'Alerts', icon: BellRing, color: 'navy' },
          { value: 'chat', label: 'Chat', icon: MessageSquare, color: 'navy' },
        ] },
      ];

  const handleSaveOfficer = async (e) => {
    e.preventDefault();
    if (!officerForm.name || !officerForm.department) return toast.error('Name and Dept are required');
    setSavingOfficer(true);
    try {
      const res = await fetch('/api/gov-officers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(officerForm),
      });
      if (!res.ok) throw new Error('Failed to save officer');
      toast.success('Govt Officer added to Central Directory!');
      setOfficerForm({ name: '', department: '', designation: '', phone: '', state: '', district: '', address: '', pincode: '', notes: '' });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingOfficer(false);
    }
  };

  const impersonateClient = (targetEmail) => {
    localStorage.setItem('tt_email', targetEmail);
    window.open('/client', '_blank');
  };

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="navy-gradient text-white sticky top-0 z-30 shadow-lg">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 p-2 rounded-xl"><Briefcase className="w-5 h-5 text-emerald-400" /></div>
            <div>
              <h1 className="font-bold text-lg">{isGm ? 'GM Desk' : 'Doc Team TL Desk'}</h1>
              <p className="text-[10px] text-emerald-300 font-mono">{session?.user?.emp_id} · {session?.user?.email}</p>
            </div>
          </div>
          <a href="/"><Button variant="outline" size="sm" className="border-white/20 text-slate-200"><ArrowLeft className="w-4 h-4 mr-1" /> Exit</Button></a>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <DashboardNav groups={groups} activeTab={activeTab} onChange={setActiveTab} title={isGm ? 'GM' : 'TL'} />
          <div className="flex-1 min-w-0">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              {isGm && (
                <TabsContent value="live">
                  <div className="grid sm:grid-cols-2 gap-3 mb-4">
                    {liveJobs.map((j) => (
                      <CompactTenderCard
                        key={j._id}
                        job={{ ...j, display_status: 'LIVE' }}
                        actions={j.sow ? [{ label: 'View SOW', icon: 'eye', onClick: () => openWorkflowFile(j._id, 'sow') }] : []}
                      />
                    ))}
                  </div>
                  <LiveTendersPaged
                    tenders={tenders}
                    pdfEmail={staffEmail}
                    pdfRole="employee"
                    renderActions={(t) => (
                      <SuggestClientControls tender={t} clients={clients} onDone={load} compact />
                    )}
                  />
                </TabsContent>
              )}
              {isGm && (
                <TabsContent value="suggestion-bar">
                  <SuggestionBar jobs={parkedJobs} pdfEmail={staffEmail} onRefresh={load} />
                  {pendingClientJobs.length > 0 && (
                    <div className="mt-6">
                      <h3 className="text-sm font-black text-[#0A2647] uppercase tracking-wide mb-3">Pending client approval</h3>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {pendingClientJobs.map((j) => (
                          <CompactTenderCard
                            key={j._id}
                            job={{ ...j, display_status: 'Pending Approval' }}
                            actions={j.sow ? [{ label: 'View SOW', icon: 'eye', onClick: () => openWorkflowFile(j._id, 'sow') }] : []}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>
              )}
              {isTl && (
                <TabsContent value="publisher" className="space-y-6">
                  <div className="grid lg:grid-cols-5 gap-6">
                    <div className="lg:col-span-2">
                      <PublishTenderForm awaitingJobs={awaitingPublish} onPublished={load} />
                    </div>
                    <div className="lg:col-span-3">
                      <LiveTendersPaged tenders={tenders} pdfEmail={staffEmail} pdfRole="employee" />
                    </div>
                  </div>
                </TabsContent>
              )}
              <TabsContent value="internal">
                <InternalTrackingBoard
                  desk={desk}
                  jobs={internal}
                  tls={tls}
                  members={members}
                  team={team}
                  onRefresh={load}
                  chatSelfId={selfId}
                  chatRoster={team}
                />
              </TabsContent>
              <TabsContent value="submitted">
                <SubmittedTrackingBoard jobs={submitted} canEdit={isGm || isTl} onRefresh={load} chatSelfId={selfId} chatRoster={team} />
              </TabsContent>
              {isGm && (
                <TabsContent value="matchmaker">
                  <AiMatchmakerPanel />
                  <div className="mt-6"><L1BenchmarkDropzone /></div>
                  <div className="mt-6"><MatchedOpportunitiesPanel /></div>
                </TabsContent>
              )}
              {isGm && (
                <TabsContent value="scraped"><LiveScrapedTendersPanel /></TabsContent>
              )}
              <TabsContent value="copilot">
                <GemCoPilot embedded />
              </TabsContent>
              {isGm && (
                <TabsContent value="clients">
                  <Card className="tender-shadow border-t-4 border-t-blue-600">
                    <CardHeader className="bg-blue-50/50 border-b pb-4">
                      <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg">
                        <Briefcase className="w-5 h-5 text-blue-600" /> Active Clients Directory
                      </CardTitle>
                      <CardDescription>View client details or login to troubleshoot.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-4 max-h-[700px] overflow-y-auto">
                      {clients.length === 0 ? (
                        <p className="text-sm text-slate-400 text-center py-8">No active verified clients found.</p>
                      ) : (
                        <div className="grid xl:grid-cols-2 gap-4">
                          {clients.map((client) => (
                            <div key={client._id || client.email} className="border border-slate-200 rounded-xl p-5 bg-white shadow-sm">
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <h4 className="font-black text-[#0A2647] text-lg">{client.company_name || client.name || 'Unnamed Client'}</h4>
                                  <p className="text-[10px] text-slate-500 font-mono">{client.client_id} • {client.email}</p>
                                </div>
                                <Badge className="bg-emerald-100 text-emerald-800 border-0"><CheckCircle2 className="w-3 h-3 mr-1" /> Active</Badge>
                              </div>
                              <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-4 border-t border-slate-100">
                                {(client.drive_folder_link || client.drive_link) && (
                                  <Button size="sm" onClick={() => window.open(client.drive_folder_link || client.drive_link, '_blank')} variant="outline" className="flex-1 h-9">
                                    <Database className="w-4 h-4 mr-2" /> Open Drive
                                  </Button>
                                )}
                                <Button size="sm" onClick={() => impersonateClient(client.email)} className="flex-1 bg-[#0A2647] hover:bg-[#144272] h-9">
                                  <LogIn className="w-4 h-4 mr-2" /> Login as Client
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}
              {isGm && (
                <TabsContent value="officers">
                  <div className="grid lg:grid-cols-3 gap-6">
                    <Card className="shadow-sm border-t-4 border-t-purple-600 lg:col-span-1 h-fit">
                      <CardHeader className="bg-purple-50/50 pb-4 border-b">
                        <CardTitle className="text-purple-900 flex items-center gap-2"><PlusCircle className="w-5 h-5 text-purple-600" /> Add Govt Officer</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-4">
                        <form onSubmit={handleSaveOfficer} className="space-y-4">
                          <div>
                            <Label className="text-xs font-bold text-slate-600">Officer Name *</Label>
                            <Input required value={officerForm.name} onChange={(e) => setOfficerForm({ ...officerForm, name: e.target.value })} className="mt-1 bg-white h-9 text-sm" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs font-bold text-slate-600">Department *</Label>
                              <Input required value={officerForm.department} onChange={(e) => setOfficerForm({ ...officerForm, department: e.target.value })} className="mt-1 bg-white h-9 text-sm" />
                            </div>
                            <div>
                              <Label className="text-xs font-bold text-slate-600">Designation</Label>
                              <Input value={officerForm.designation} onChange={(e) => setOfficerForm({ ...officerForm, designation: e.target.value })} className="mt-1 bg-white h-9 text-sm" />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs font-bold text-slate-600">Phone Number</Label>
                            <Input type="tel" value={officerForm.phone} onChange={(e) => setOfficerForm({ ...officerForm, phone: e.target.value })} className="mt-1 bg-white h-9 text-sm" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs font-bold text-slate-600">State</Label>
                              <Select value={officerForm.state} onValueChange={(v) => setOfficerForm({ ...officerForm, state: v })}>
                                <SelectTrigger className="mt-1 bg-white h-9"><SelectValue placeholder="Select" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Telangana">Telangana</SelectItem>
                                  <SelectItem value="Andhra Pradesh">Andhra Pradesh</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs font-bold text-slate-600">District</Label>
                              <Select value={officerForm.district} onValueChange={(v) => setOfficerForm({ ...officerForm, district: v })}>
                                <SelectTrigger className="mt-1 bg-white h-9"><SelectValue placeholder="Select" /></SelectTrigger>
                                <SelectContent>
                                  {TS_AP_DISTRICTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs font-bold text-slate-600">Full Address</Label>
                            <Textarea rows={2} value={officerForm.address} onChange={(e) => setOfficerForm({ ...officerForm, address: e.target.value })} className="mt-1 bg-white text-sm" />
                          </div>
                          <div>
                            <Label className="text-xs font-bold text-slate-600">Pincode</Label>
                            <Input value={officerForm.pincode} onChange={(e) => setOfficerForm({ ...officerForm, pincode: e.target.value })} className="mt-1 bg-white h-9 text-sm" />
                          </div>
                          <div>
                            <Label className="text-xs font-bold text-slate-600">Follow-up Notes</Label>
                            <textarea className="w-full border rounded-md p-2 mt-1 h-16 text-sm bg-white" value={officerForm.notes} onChange={(e) => setOfficerForm({ ...officerForm, notes: e.target.value })} />
                          </div>
                          <Button type="submit" disabled={savingOfficer} className="w-full bg-purple-600 hover:bg-purple-700 h-10">
                            {savingOfficer ? 'Saving...' : 'Save to Directory'}
                          </Button>
                        </form>
                      </CardContent>
                    </Card>
                    <Card className="shadow-sm lg:col-span-2 w-full">
                      <CardHeader className="bg-slate-50 border-b pb-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                        <div>
                          <CardTitle className="text-[#0A2647] flex items-center gap-2"><Contact className="w-5 h-5 text-purple-600" /> Central Officers Directory</CardTitle>
                          <CardDescription>Database of government contacts for quick follow-ups.</CardDescription>
                        </div>
                        <div className="relative shrink-0">
                          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <Input placeholder="Search officers..." value={officerSearch} onChange={(e) => setOfficerSearch(e.target.value)} className="pl-9 h-9 w-full sm:w-[250px] bg-white" />
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 p-0">
                        {filteredOfficers.length === 0 ? (
                          <p className="text-center text-sm text-slate-500 py-10">No officers found.</p>
                        ) : (
                          <div className="divide-y max-h-[650px] overflow-y-auto">
                            {filteredOfficers.map((officer) => (
                              <div key={officer._id} className="p-4 flex flex-col sm:flex-row justify-between gap-4">
                                <div>
                                  <h4 className="font-bold text-[#0A2647]">{officer.name}</h4>
                                  <p className="text-sm font-semibold text-purple-700">{officer.designation} - {officer.department}</p>
                                  {(officer.state || officer.district) && (
                                    <p className="text-[10px] text-slate-500 font-bold mt-1 flex items-center gap-1">
                                      <MapPin className="w-3 h-3" /> {officer.district}{officer.district && officer.state ? ', ' : ''}{officer.state}
                                    </p>
                                  )}
                                </div>
                                {officer.phone && <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 h-fit">📞 {officer.phone}</Badge>}
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
              )}
              <TabsContent value="team">
                <TeamDirectoryPanel actorDesk={desk} team={team} onRefresh={load} impersonate={openStaffDesk} />
              </TabsContent>
              <TabsContent value="alerts"><OpsAlerts roster={team} /></TabsContent>
              <TabsContent value="chat" className="w-full overflow-hidden"><StaffChat selfId={selfId} roster={team} /></TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
    </div>
  );
}
