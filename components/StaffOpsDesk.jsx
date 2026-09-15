'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import DashboardNav from '@/components/DashboardNav';
import GeminiWorkspace from '@/components/GeminiWorkspace';
import LiveScrapedTendersPanel from '@/components/LiveScrapedTendersPanel';
import AiMatchmakerPanel from '@/components/AiMatchmakerPanel';
import GemCoPilot from '@/components/GemCoPilot';
import CopilotTrainDropzone from '@/components/CopilotTrainDropzone';
import LiveTendersPaged from '@/components/workflow/LiveTendersPaged';
import SuggestSowModal from '@/components/workflow/SuggestSowModal';
import InternalTrackingBoard from '@/components/workflow/InternalTrackingBoard';
import SubmittedTrackingBoard from '@/components/workflow/SubmittedTrackingBoard';
import CompactTenderCard from '@/components/workflow/CompactTenderCard';
import StaffChat from '@/components/StaffChat';
import OpsAlerts from '@/components/OpsAlerts';
import TeamDirectoryPanel, { openStaffDesk } from '@/components/TeamDirectoryPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { workflowFetch } from '@/components/workflow/api';
import { TS_AP_DISTRICTS } from '@/lib/regions';
import {
  Briefcase, FileText, Users, Bot, Activity, Target, BellRing, MessageSquare, PlusCircle, ClipboardList, UserCog, ArrowLeft, Loader2
} from 'lucide-react';

export default function StaffOpsDesk({ desk }) {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState(desk === 'tl' ? 'tasks' : 'live');
  const [jobs, setJobs] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [clients, setClients] = useState([]);
  const [team, setTeam] = useState([]);
  const [suggestJob, setSuggestJob] = useState(null);
  const [memberId, setMemberId] = useState('');
  const [taskTitle, setTaskTitle] = useState('Check Drive / Publish tender');
  const [tenderForm, setTenderForm] = useState({ bid_no: '', title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: '' });
  const [pdfBase64, setPdfBase64] = useState('');
  const [pdfName, setPdfName] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [pendingJobId, setPendingJobId] = useState('');

  const selfId = session?.user?.emp_id || session?.user?.email;
  const isGm = desk === 'gm';
  const isTl = desk === 'tl';

  const load = async () => {
    try {
      const [q, t, c, e] = await Promise.all([
        workflowFetch('/api/workflow/queue'),
        fetch('/api/tenders').then((r) => r.json()),
        fetch('/api/users/approved').then((r) => r.json()),
        workflowFetch('/api/employees'),
      ]);
      setJobs(q.jobs || []);
      setTenders(t.tenders || []);
      setClients(c.users || []);
      setTeam(e.team || []);
    } catch (err) {
      toast.error(err.message);
    }
  };

  useEffect(() => {
    if (status === 'authenticated' || status === 'unauthenticated') load();
  }, [status]);

  const liveJobs = jobs.filter((j) => j.status === 'LIVE' || j.status === 'AWAITING_CLIENT');
  const internal = jobs.filter((j) => ['MD_CHECKLIST', 'TL_ASSIGN', 'MAKER_PREP', 'TL_QC', 'GM_QC', 'MD_SUBMIT', 'AWAITING_RECEIPT'].includes(j.status));
  const submitted = jobs.filter((j) => j.status === 'SUBMITTED' || j.status === 'WON');
  const awaitingPublish = jobs.filter((j) => j.status === 'AWAITING_PUBLISH');
  const tls = team.filter((t) => t.designation === 'DOC_TEAM_TL');
  const members = team.filter((t) => t.designation === 'DOC_TEAM_MEMBER');

  const groups = isGm
    ? [
        { id: 'work', label: 'Work', items: [
          { value: 'live', label: 'Live Tenders', icon: FileText, color: 'navy' },
          { value: 'internal', label: 'Internal Board', icon: ClipboardList, color: 'blue' },
          { value: 'submitted', label: 'Submitted', icon: FileText, color: 'emerald' },
        ] },
        { id: 'ai', label: 'AI', items: [
          { value: 'matchmaker', label: 'AI Matchmaker', icon: Target, color: 'indigo' },
          { value: 'scraped', label: 'Live Scraped', icon: Activity, color: 'teal' },
          { value: 'copilot', label: 'Co-Pilot', icon: Bot, color: 'violet' },
        ] },
        { id: 'team', label: 'Team', items: [
          { value: 'team', label: 'Team Directory', icon: UserCog, color: 'blue' },
          { value: 'alerts', label: 'Alerts', icon: BellRing, color: 'navy' },
          { value: 'chat', label: 'Chat', icon: MessageSquare, color: 'navy' },
        ] },
      ]
    : [
        { id: 'work', label: 'Work', items: [
          { value: 'tasks', label: 'Create Task', icon: PlusCircle, color: 'navy' },
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

  const createTask = async (e) => {
    e.preventDefault();
    try {
      await workflowFetch('/api/workflow/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_emp_id: memberId, title: taskTitle }),
      });
      toast.success('Task assigned. Member will see a Publish card.');
      setMemberId('');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const publish = async (e) => {
    e.preventDefault();
    setPublishing(true);
    try {
      const res = await fetch('/api/tenders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...tenderForm, ...(pdfBase64 ? { pdf_base64: pdfBase64 } : {}), pdf_filename: pdfName || 'tender.pdf' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Publish failed');
      const tenderId = data.id || data.tender?._id || data.tender_id;
      const jobId = pendingJobId || awaitingPublish[0]?._id;
      if (tenderId && jobId) {
        await workflowFetch(`/api/workflow/jobs/${jobId}/publish-attach`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tender_id: tenderId, bid_no: tenderForm.bid_no }),
        });
      }
      toast.success('Published and attached to the job.');
      setTenderForm({ bid_no: '', title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: '' });
      setPdfBase64('');
      setPdfName('');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPublishing(false);
    }
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
                  <LiveTendersPaged
                    tenders={tenders}
                    onViewPdf={(id) => window.open(`/api/tenders/${id}/pdf?role=employee`, '_blank')}
                    renderActions={(t) => {
                      const job = liveJobs.find((j) => String(j.tender_id) === String(t._id) || j.bid_no === t.bid_no);
                      if (!job) return null;
                      return (
                        <Button size="sm" className="h-7 text-[10px] bg-emerald-600 hover:bg-emerald-700" onClick={() => setSuggestJob(job)}>
                          Suggest + SOW
                        </Button>
                      );
                    }}
                  />
                  {liveJobs.filter((j) => !tenders.some((t) => String(t._id) === String(j.tender_id))).length > 0 && (
                    <div className="grid sm:grid-cols-2 gap-3 mt-4">
                      {liveJobs.map((j) => (
                        <CompactTenderCard
                          key={j._id}
                          job={{ ...j, display_status: j.status === 'AWAITING_CLIENT' ? 'Pending Approval' : 'LIVE' }}
                          actions={[{ label: 'Suggest + SOW', onClick: () => setSuggestJob(j) }]}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>
              )}
              {isTl && (
                <TabsContent value="tasks">
                  <Card>
                    <CardHeader><CardTitle>Create task</CardTitle></CardHeader>
                    <CardContent>
                      <form onSubmit={createTask} className="space-y-3 max-w-lg">
                        <div>
                          <Label>Team member</Label>
                          <Select value={memberId} onValueChange={setMemberId}>
                            <SelectTrigger className="mt-1"><SelectValue placeholder="Select maker" /></SelectTrigger>
                            <SelectContent>
                              {members.map((m) => <SelectItem key={m.emp_id} value={m.emp_id}>{m.name} ({m.emp_id})</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Notes</Label>
                          <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className="mt-1" />
                        </div>
                        <Button type="submit">Assign work</Button>
                      </form>
                      <div className="grid sm:grid-cols-2 gap-3 mt-6">
                        {awaitingPublish.map((j) => (
                          <CompactTenderCard key={j._id} job={{ ...j, display_status: 'Awaiting publish' }} />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              )}
              {isTl && (
                <TabsContent value="publisher">
                  <Card className="max-w-xl">
                    <CardHeader><CardTitle>Publish tender</CardTitle></CardHeader>
                    <CardContent>
                      <form onSubmit={publish} className="space-y-3">
                        {awaitingPublish.length > 0 && (
                          <div>
                            <Label>Attach to task</Label>
                            <Select value={pendingJobId} onValueChange={setPendingJobId}>
                              <SelectTrigger className="mt-1"><SelectValue placeholder="Select assigned job" /></SelectTrigger>
                              <SelectContent>
                                {awaitingPublish.map((j) => <SelectItem key={j._id} value={j._id}>{j.assigned_emp_name} — {j.title}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {['bid_no', 'title', 'department', 'last_date'].map((k) => (
                          <div key={k}>
                            <Label className="capitalize">{k.replace('_', ' ')}</Label>
                            <Input required type={k === 'last_date' ? 'date' : 'text'} value={tenderForm[k]} onChange={(e) => setTenderForm({ ...tenderForm, [k]: e.target.value })} className="mt-1" />
                          </div>
                        ))}
                        <div>
                          <Label>District</Label>
                          <Select value={tenderForm.district} onValueChange={(v) => setTenderForm({ ...tenderForm, district: v })}>
                            <SelectTrigger className="mt-1"><SelectValue placeholder="District" /></SelectTrigger>
                            <SelectContent>{TS_AP_DISTRICTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <input type="file" accept="application/pdf" onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setPdfName(f.name);
                          const r = new FileReader();
                          r.onload = () => setPdfBase64(String(r.result).split(',')[1] || '');
                          r.readAsDataURL(f);
                        }} />
                        <Button type="submit" disabled={publishing}>{publishing ? 'Publishing…' : 'Publish'}</Button>
                      </form>
                    </CardContent>
                  </Card>
                </TabsContent>
              )}
              <TabsContent value="internal">
                <InternalTrackingBoard desk={desk} jobs={internal} tls={tls} members={members} onRefresh={load} />
              </TabsContent>
              <TabsContent value="submitted">
                <SubmittedTrackingBoard jobs={submitted} canEdit={isGm || isTl} onRefresh={load} />
              </TabsContent>
              <TabsContent value="matchmaker"><AiMatchmakerPanel /></TabsContent>
              <TabsContent value="scraped"><LiveScrapedTendersPanel /></TabsContent>
              <TabsContent value="copilot">
                {isGm && <div className="mb-4"><CopilotTrainDropzone /></div>}
                <GemCoPilot />
                {isGm && <div className="mt-6"><GeminiWorkspace /></div>}
              </TabsContent>
              <TabsContent value="team">
                <TeamDirectoryPanel actorDesk={desk} team={team} onRefresh={load} impersonate={openStaffDesk} />
              </TabsContent>
              <TabsContent value="alerts"><OpsAlerts /></TabsContent>
              <TabsContent value="chat"><StaffChat selfId={selfId} roster={team} /></TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
      <SuggestSowModal open={!!suggestJob} onOpenChange={() => setSuggestJob(null)} job={suggestJob} clients={clients} onDone={load} />
    </div>
  );
}
