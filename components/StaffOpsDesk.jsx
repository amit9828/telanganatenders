'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import DashboardNav from '@/components/DashboardNav';
import PricingMasterPanel from '@/components/PricingMasterPanel';
import MasterTenderDesk from '@/components/MasterTenderDesk';
import AiMatchmakerPanel from '@/components/AiMatchmakerPanel';
import L1BenchmarkDropzone from '@/components/L1BenchmarkDropzone';
import MatchedOpportunitiesPanel from '@/components/MatchedOpportunitiesPanel';
import GemCoPilot from '@/components/GemCoPilot';
import LiveTendersPaged from '@/components/workflow/LiveTendersPaged';
import SuggestClientControls from '@/components/workflow/SuggestClientControls';
import InternalTrackingBoard from '@/components/workflow/InternalTrackingBoard';
import SubmittedTrackingBoard from '@/components/workflow/SubmittedTrackingBoard';
import WinningBidsBoard from '@/components/workflow/WinningBidsBoard';
import { mergeTrackingEvent, useWorkflowStream } from '@/components/workflow/useWorkflowStream';
import PublishTenderForm from '@/components/workflow/PublishTenderForm';
import CreatePublishTaskForm from '@/components/workflow/CreatePublishTaskForm';
import CompactTenderCard from '@/components/workflow/CompactTenderCard';
import SuggestionBar from '@/components/workflow/SuggestionBar';
import ArchiveBoard from '@/components/workflow/ArchiveBoard';
import StaffChat from '@/components/StaffChat';
import OpsAlerts from '@/components/OpsAlerts';
import TeamDirectoryPanel, { openStaffDesk } from '@/components/TeamDirectoryPanel';
import ClientBidSupportPanel from '@/components/ClientBidSupportPanel';
import OperationsStoragePanel from '@/components/OperationsStoragePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { workflowFetch, fetchWorkflowQueue, openWorkflowFile, staffHeaders } from '@/components/workflow/api';
import { workflowDocActions } from '@/components/workflow/jobDocActions';
import { consumeStaffBypass, openClientBypass } from '@/lib/tab-handoff';
import { useServerDeskRole } from '@/components/DeskAuth';
import { useStaffPresence } from '@/components/reports/useStaffPresence';
import { BrandMark } from '@/components/BrandLogo';
import { TS_AP_DISTRICTS } from '@/lib/regions';
import { DESIGNATIONS, resolveStaffDesignation } from '@/lib/designations';
import {
  applyJobToBoard,
  belongsOnInternal,
  belongsOnLiveQueue,
  belongsOnSubmitted,
  belongsOnWinning,
  dropJob,
  setListIfChanged,
  upsertJob,
} from '@/lib/job-board-state';
import {
  Briefcase, FileText, Users, Bot, Activity, Target, BellRing, MessageSquare, PlusCircle, ClipboardList, UserCog, ArrowLeft, Loader2, Contact, Search, MapPin, Database, LogIn, CheckCircle2, Archive, UploadCloud, Pencil, Trash2, IndianRupee
} from 'lucide-react';

export default function StaffOpsDesk({ desk }) {
  const deskRole = useServerDeskRole();
  const onDesk = deskRole === desk;
  const { data: session } = useSession();
  const [localEmpEmail, setLocalEmpEmail] = useState('');
  const [activeTab, setActiveTab] = useState(desk === 'tl' ? 'publisher' : 'live');
  const [jobs, setJobs] = useState([]);
  const [internalJobs, setInternalJobs] = useState([]);
  const [submittedJobs, setSubmittedJobs] = useState([]);
  const [winningJobs, setWinningJobs] = useState([]);
  const [archivedJobs, setArchivedJobs] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [clients, setClients] = useState([]);
  const [team, setTeam] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [officerSearch, setOfficerSearch] = useState('');
  const [savingOfficer, setSavingOfficer] = useState(false);
  const [officerForm, setOfficerForm] = useState({
    name: '', department: '', designation: '', phone: '', state: '', district: '', address: '', pincode: '', notes: '',
  });
  const [editTender, setEditTender] = useState(null);

  const sessionMatchesDesk = (() => {
    const user = session?.user;
    if (!user || user.role === 'MD') return false;
    const d = resolveStaffDesignation(user);
    if (desk === 'gm') return d === DESIGNATIONS.GM;
    if (desk === 'tl') return d === DESIGNATIONS.DOC_TEAM_TL;
    return d === DESIGNATIONS.DOC_TEAM_MEMBER;
  })();
  const staffEmail = localEmpEmail || (sessionMatchesDesk ? session?.user?.email : '');
  const selfFromTeam = team.find((t) => String(t.email || '').toLowerCase() === String(staffEmail || '').toLowerCase())
    || (localEmpEmail ? team.find((t) => String(t.emp_id || '') === String(localEmpEmail)) : null);
  const jwtEmpId = sessionMatchesDesk && session?.user?.emp_id ? session.user.emp_id : '';
  const selfId = selfFromTeam?.emp_id || jwtEmpId || '';
  const isGm = desk === 'gm';
  const isTl = desk === 'tl';
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  useStaffPresence(activeTab, { enabled: Boolean(staffEmail) });
  const teamRef = useRef(team);
  teamRef.current = team;

  const patchJob = useCallback((job) => {
    if (!job) return;
    setJobs((prev) => applyJobToBoard(prev, job, belongsOnLiveQueue));
    setInternalJobs((prev) => applyJobToBoard(prev, job, belongsOnInternal));
    setSubmittedJobs((prev) => applyJobToBoard(prev, job, belongsOnSubmitted));
    setWinningJobs((prev) => applyJobToBoard(prev, job, belongsOnWinning));
  }, []);

  const removeJob = useCallback((id) => {
    setJobs((prev) => dropJob(prev, id));
    setInternalJobs((prev) => dropJob(prev, id));
    setSubmittedJobs((prev) => dropJob(prev, id));
    setWinningJobs((prev) => dropJob(prev, id));
    setArchivedJobs((prev) => dropJob(prev, id));
  }, []);

  const archiveJob = useCallback((job) => {
    if (!job) return;
    removeJob(job._id);
    setArchivedJobs((prev) => upsertJob(prev, { ...job, archive_reason: job.archive_reason || 'Lost' }));
  }, [removeJob]);

  const load = useCallback(async (tab = activeTabRef.current) => {
    const want = new Set();
    if (tab === 'live' || tab === 'publisher' || tab === 'bid-support') {
      want.add('tenders');
      want.add('clients');
    }
    if (tab === 'publisher') want.add('awaiting');
    if (tab === 'suggestion-bar') {
      want.add('parked');
      want.add('suggestions');
      want.add('clients');
    }
    if (tab === 'internal') want.add('internal');
    if (tab === 'submitted') {
      want.add('submitted');
      want.add('winning');
    }
    if (tab === 'archive') want.add('archive');
    if (tab === 'officers') want.add('officers');
    if (tab === 'clients') want.add('clients');
    if (tab === 'team' || tab === 'chat' || !teamRef.current.length) want.add('team');
    if (want.size === 0 && !teamRef.current.length) want.add('team');

    try {
      const tasks = {};
      if (want.has('tenders')) {
        tasks.tenders = fetch('/api/tenders', { credentials: 'include', headers: staffHeaders() }).then((r) => r.json());
      }
      if (want.has('clients')) {
        tasks.clients = fetch('/api/users/approved?directory=1', { credentials: 'include', headers: staffHeaders() }).then((r) => r.json());
      }
      if (want.has('team')) tasks.team = workflowFetch('/api/employees');
      if (want.has('internal')) tasks.internal = fetchWorkflowQueue('internal');
      if (want.has('submitted')) tasks.submitted = fetchWorkflowQueue('submitted');
      if (want.has('winning')) tasks.winning = fetchWorkflowQueue('winning');
      if (want.has('parked')) tasks.parked = fetchWorkflowQueue('parked');
      if (want.has('suggestions')) tasks.suggestions = fetchWorkflowQueue('suggestions');
      if (want.has('awaiting')) tasks.awaiting = fetchWorkflowQueue('awaiting_publish');
      if (want.has('officers')) {
        tasks.officers = fetch('/api/gov-officers', { credentials: 'include', headers: staffHeaders() }).then((r) => r.json()).catch(() => ({ officers: [] }));
      }
      if (want.has('archive')) {
        tasks.archive = workflowFetch('/api/workflow/archive').catch(() => ({ jobs: [] }));
      }
      const entries = Object.entries(tasks);
      const results = await Promise.all(entries.map(([, p]) => p));
      const got = Object.fromEntries(entries.map(([k], i) => [k, results[i]]));
      if (got.tenders) setListIfChanged(setTenders, got.tenders.tenders || []);
      if (got.clients) setListIfChanged(setClients, got.clients.users || []);
      if (got.team) setListIfChanged(setTeam, got.team.team || []);
      if (got.internal) setListIfChanged(setInternalJobs, got.internal.jobs || []);
      if (got.submitted) setListIfChanged(setSubmittedJobs, got.submitted.jobs || []);
      if (got.winning) setListIfChanged(setWinningJobs, (got.winning.jobs || []).filter(belongsOnWinning));
      if (got.officers) setListIfChanged(setOfficers, got.officers.officers || []);
      if (got.archive) setListIfChanged(setArchivedJobs, got.archive.jobs || []);
      if (got.parked || got.suggestions || got.awaiting) {
        setJobs((prev) => {
          let next = prev;
          if (got.parked || got.suggestions) {
            next = [
              ...(got.parked?.jobs || []),
              ...(got.suggestions?.jobs || []),
              ...prev.filter((j) => j.status === 'AWAITING_PUBLISH'),
            ];
          }
          if (got.awaiting) {
            next = [
              ...next.filter((j) => j.status !== 'AWAITING_PUBLISH'),
              ...(got.awaiting.jobs || []),
            ];
          }
          return next;
        });
      }
    } catch (err) {
      toast.error(err.message);
    }
  }, []);

  useEffect(() => {
    if (!onDesk || typeof window === 'undefined') return;
    setLocalEmpEmail(consumeStaffBypass());
  }, [onDesk]);

  useEffect(() => {
    if (!onDesk) return undefined;
    load(activeTab);
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') load(activeTabRef.current);
    }, 60000);
    return () => clearInterval(interval);
  }, [activeTab, load, onDesk]);

  const parkedJobs = jobs.filter((j) => j.status === 'LIVE' && j.parked_client_email);
  const pendingClientJobs = jobs.filter((j) => j.status === 'AWAITING_CLIENT');
  const internal = internalJobs;
  const submitted = submittedJobs;
  const awaitingPublish = jobs.filter((j) => j.status === 'AWAITING_PUBLISH');
  const tls = team.filter((t) => resolveStaffDesignation(t) === DESIGNATIONS.DOC_TEAM_TL);
  const members = team.filter((t) => resolveStaffDesignation(t) === DESIGNATIONS.DOC_TEAM_MEMBER);
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
          { value: 'bid-support', label: 'Bid Support', icon: UploadCloud, color: 'blue' },
          { value: 'archive', label: 'Archive', icon: Archive, color: 'slate' },
        ] },
        { id: 'ai', label: 'AI', items: [
          { value: 'matchmaker', label: 'AI Matchmaker / Live Hunting', icon: Target, color: 'indigo' },
          { value: 'master-tenders', label: 'Master Tenders', icon: FileText, color: 'teal' },
          { value: 'copilot', label: 'Co-Pilot', icon: Bot, color: 'violet' },
        ] },
        { id: 'clients-officers', label: 'Clients', items: [
          { value: 'clients', label: 'Clients DB', icon: Briefcase, color: 'navy' },
          { value: 'officers', label: 'Officers', icon: Contact, color: 'purple' },
        ] },
        { id: 'team', label: 'Team', items: [
          { value: 'team', label: 'Team Directory', icon: UserCog, color: 'blue' },
          { value: 'pricing', label: 'Pricing', icon: IndianRupee, color: 'emerald' },
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
          { value: 'clients', label: 'Clients DB', icon: Briefcase, color: 'navy' },
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
      load('officers');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingOfficer(false);
    }
  };

  const handleEditTender = (t) => {
    setEditTender(t);
    setActiveTab('publisher');
    toast.info('Edit mode active. Update details and click save.');
  };

  const handleDeleteTender = async (id) => {
    if (!confirm('Are you sure you want to permanently delete this tender from the Live Portal?')) return;
    try {
      const res = await fetch(`/api/tenders/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: staffHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete tender.');
      toast.success('Tender deleted successfully.');
      if (String(editTender?._id || editTender?.id || '') === String(id)) setEditTender(null);
      setTenders((prev) => prev.filter((row) => String(row._id || row.id) !== String(id)));
    } catch (err) {
      toast.error(err.message || 'Network error');
    }
  };

  const impersonateClient = (targetEmail) => {
    openClientBypass(targetEmail);
  };

  const boardJobsRef = useRef({ jobs: [], internal: [], submitted: [], winning: [] });
  boardJobsRef.current = {
    jobs,
    internal: internalJobs,
    submitted: submittedJobs,
    winning: winningJobs,
  };
  useWorkflowStream((event) => {
    if (!event?.jobId) return;
    if (event.archived) {
      removeJob(event.jobId);
      return;
    }
    const pools = boardJobsRef.current;
    const found = [...pools.submitted, ...pools.winning, ...pools.internal, ...pools.jobs]
      .find((job) => String(job._id) === String(event.jobId));
    if (!found) {
      if (activeTabRef.current === 'submitted') load('submitted');
      return;
    }
    patchJob(mergeTrackingEvent(found, event));
  }, { audience: 'staff', enabled: onDesk });

  if (!onDesk) {
    if (typeof window !== 'undefined') window.location.replace('/');
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="navy-gradient text-white sticky top-0 z-30 shadow-lg">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="font-bold text-lg">{isGm ? 'GM Desk' : 'Doc Team TL Desk'}</h1>
              <p className="text-[10px] text-emerald-300 font-mono">{selfId} · {staffEmail || '—'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <BrandMark size="md" />
            <a href="/"><Button variant="outline" size="sm" className="border-white/20 text-slate-200"><ArrowLeft className="w-4 h-4 mr-1" /> Exit</Button></a>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <DashboardNav groups={groups} activeTab={activeTab} onChange={setActiveTab} title={isGm ? 'GM' : 'TL'} />
          <div className="flex-1 min-w-0">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              {isGm && (
                <TabsContent value="pricing">
                  <PricingMasterPanel canEdit={false} />
                </TabsContent>
              )}
              {isGm && (
                <TabsContent value="live">
                  <LiveTendersPaged
                    tenders={tenders}
                    pdfEmail={staffEmail}
                    pdfRole="employee"
                    renderActions={(t) => (
                      <SuggestClientControls
                        tender={t}
                        clients={clients}
                        onDone={patchJob}
                        compact
                        variant="suggest"
                      />
                    )}
                  />
                </TabsContent>
              )}
              {isGm && (
                <TabsContent value="suggestion-bar">
                  <SuggestionBar jobs={parkedJobs} pdfEmail={staffEmail} onPatchJob={patchJob} />
                  {pendingClientJobs.length > 0 && (
                    <div className="mt-6">
                      <h3 className="text-sm font-black text-[#0A2647] uppercase tracking-wide mb-3">Pending client approval</h3>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {pendingClientJobs.map((j) => (
                          <CompactTenderCard
                            key={j._id}
                            job={{ ...j, display_status: 'Pending Approval' }}
                            showClientName
                            actions={workflowDocActions(j, (job, slot) => openWorkflowFile(job._id, slot).catch((err) => toast.error(err.message || 'Could not open file')))}
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
                    <div className="lg:col-span-2 space-y-4">
                      <CreatePublishTaskForm
                        actorDesk="tl"
                        actorEmpId={selfId}
                        members={members}
                        onCreated={patchJob}
                      />
                      <PublishTenderForm
                        awaitingJobs={awaitingPublish}
                        editTender={editTender}
                        onCancelEdit={() => setEditTender(null)}
                        onPublished={(published) => {
                          setEditTender(null);
                          if (published?.job) patchJob(published.job);
                          const tender = published?.tender || (published?.id ? { ...published, _id: published.id } : null);
                          if (tender?._id || tender?.id) {
                            setTenders((prev) => upsertJob(prev, tender));
                          }
                        }}
                      />
                    </div>
                    <div className="lg:col-span-3">
                      <LiveTendersPaged
                        tenders={tenders}
                        pdfEmail={staffEmail}
                        pdfRole="employee"
                        renderActions={(t) => (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-500 hover:text-blue-700 hover:bg-blue-50" onClick={() => handleEditTender(t)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => handleDeleteTender(t._id || t.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      />
                    </div>
                  </div>
                  <OperationsStoragePanel clients={clients} uploadedBy={staffEmail || selfId} />
                </TabsContent>
              )}
              <TabsContent value="internal">
                <InternalTrackingBoard
                  desk={desk}
                  jobs={internal}
                  tls={tls}
                  members={members}
                  team={team}
                  onPatchJob={patchJob}
                  onRemoveJob={removeJob}
                  actorEmpId={selfId}
                />
              </TabsContent>
              <TabsContent value="submitted" className="space-y-6">
                <SubmittedTrackingBoard
                  jobs={submitted}
                  onPatchJob={patchJob}
                  onRemoveJob={removeJob}
                  onArchiveJob={archiveJob}
                  actorEmpId=""
                />
                <WinningBidsBoard jobs={winningJobs} showClientName />
              </TabsContent>
              {isGm && (
                <TabsContent value="bid-support">
                  <ClientBidSupportPanel tenders={tenders} pdfEmail={staffEmail} onSuggested={patchJob} />
                </TabsContent>
              )}
              {isGm && (
                <TabsContent value="archive">
                  <ArchiveBoard jobs={archivedJobs} onRemoveJob={removeJob} />
                </TabsContent>
              )}
              {isGm && (
                <TabsContent value="matchmaker">
                  <AiMatchmakerPanel />
                  <div className="mt-6"><L1BenchmarkDropzone /></div>
                  <div className="mt-6"><MatchedOpportunitiesPanel /></div>
                </TabsContent>
              )}
              {isGm && (
                <TabsContent value="master-tenders"><MasterTenderDesk /></TabsContent>
              )}
              <TabsContent value="copilot">
                <GemCoPilot embedded />
              </TabsContent>
              {(isGm || isTl) && (
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
                <TeamDirectoryPanel actorDesk={desk} team={team} onRefresh={() => load('team')} impersonate={openStaffDesk} actorEmpId={selfId} />
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
