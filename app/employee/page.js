'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useServerDeskRole } from '@/components/DeskAuth';
import { BrandMark } from '@/components/BrandLogo';
import GeminiWorkspace from '@/components/GeminiWorkspace';
import StationeryUploader from '@/components/StationeryUploader';
import WhatsAppVerifiedBadge from '@/components/WhatsAppVerifiedBadge';
import DashboardNav from '@/components/DashboardNav';
import InternalTrackingBoard from '@/components/workflow/InternalTrackingBoard';
import DocTeamWorkspace from '@/components/doc-team/DocTeamWorkspace';
import SubmittedTrackingBoard from '@/components/workflow/SubmittedTrackingBoard';
import WinningBidsBoard from '@/components/workflow/WinningBidsBoard';
import PublishTenderForm from '@/components/workflow/PublishTenderForm';
import OperationsStoragePanel from '@/components/OperationsStoragePanel';
import StaffChat from '@/components/StaffChat';
import OpsAlerts from '@/components/OpsAlerts';
import { TS_AP_DISTRICTS } from '@/lib/regions';
import { liveTendersOnly } from '@/lib/tender-sort';
import {
  applyJobToBoard,
  belongsOnInternal,
  belongsOnSubmitted,
  belongsOnWinning,
  dropJob,
  INTERNAL_BOARD_STATUSES,
  sameStamps,
  setListIfChanged,
  SUBMITTED_BOARD_STATUSES,
} from '@/lib/job-board-state';
import { staffHeaders, fetchWorkflowQueue } from '@/components/workflow/api';
import { consumeStaffBypass, openClientBypass, rememberRealStaffIdent } from '@/lib/tab-handoff';
import { useStaffPresence } from '@/components/reports/useStaffPresence';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea'; 
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'; 
import {
  ArrowLeft, Users, FileText, PlusCircle, BellRing, 
  MessageSquare, Send, CheckCircle2, ShieldCheck, 
  Briefcase, Kanban, Building2, ClipboardList, AlertCircle, Contact, Loader2,
  Database, Lock, Globe, MapPin, Target, Clock, XCircle, Lightbulb, Search, Trash2, Star, Pencil, Eye, X, FolderPlus, TrendingDown, RefreshCw, AlertTriangle, PenTool, Bot, LogIn
} from 'lucide-react';

// 🚀 Single source of truth (lib/regions.js) — was hand-duplicated here and had
// drifted from the AP district list used elsewhere.
const DISTRICTS = TS_AP_DISTRICTS;

const BORDER_COLORS = [
  'border-blue-500', 'border-purple-500', 'border-emerald-500', 
  'border-orange-500', 'border-indigo-500', 'border-rose-500'
];

export default function EmployeeDashboard() {
  const deskRole = useServerDeskRole();
  const onEmployeeDesk = deskRole === 'employee';
  const { data: session, status } = useSession();
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState('internal');
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
  const [guestQueries, setGuestQueries] = useState([]); // 🚀 RESTORED STATE

  const [isEditingTender, setIsEditingTender] = useState(null);
  const [tenderSearch, setTenderSearch] = useState(''); 
  const [tenderPage, setTenderPage] = useState(1); 
  
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
  const [editingBid, setEditingBid] = useState(null); 
  const [suggestForm, setSuggestForm] = useState({});

  const [mdTaskReply, setMdTaskReply] = useState({});
  const [viewClientDocs, setViewClientDocs] = useState(null);
  const [stationeryClient, setStationeryClient] = useState(null);

  const [ticketReply, setTicketReply] = useState({});
  const [taskForm, setTaskForm] = useState({ target_type: 'client_alert', target_id: '', subject: '', message: '' });
  const [dispatches, setDispatches] = useState([]);
  const [rejectReason, setRejectReason] = useState({});
  const [teamMembers, setTeamMembers] = useState([]);
  const [l1Data, setL1Data] = useState({});
  const [pendingUsers, setPendingUsers] = useState([]);
  const [mdTaskFile, setMdTaskFile] = useState({});
  const [uploadingTask, setUploadingTask] = useState(false);
  const [wfJobs, setWfJobs] = useState([]);
  const [wfWinning, setWfWinning] = useState([]);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  useStaffPresence(activeTab, { enabled: Boolean(email) });

  const patchJob = useCallback((job) => {
    if (!job) return;
    setWfJobs((prev) => applyJobToBoard(prev, job, (row) => belongsOnInternal(row) || belongsOnSubmitted(row)));
    setWfWinning((prev) => applyJobToBoard(prev, job, belongsOnWinning));
  }, []);
  const removeJob = useCallback((id) => {
    setWfJobs((prev) => dropJob(prev, id));
    setWfWinning((prev) => dropJob(prev, id));
  }, []);
  const archiveJob = useCallback((job) => {
    if (job?._id) removeJob(job._id);
  }, [removeJob]);

// 🚀 FIX: Employee Live Tracking (Auto-Refresh without Cache)
  const sessionUserEmail = session?.user?.email;
  const sessionUserEmpId = session?.user?.emp_id;
  const sessionUserName = session?.user?.name;
  useEffect(() => {
    setIsMounted(true);
    if (!onEmployeeDesk) {
      setLoading(false);
      return undefined;
    }
    const bypass = typeof window !== 'undefined' ? consumeStaffBypass() : '';
    const sessionEmpId = status === 'authenticated' ? String(sessionUserEmpId || '').trim() : '';
    const fromSession = status === 'authenticated'
      ? String(sessionUserEmail || sessionUserEmpId || '')
      : '';
    const finalEmail = bypass || fromSession;
    setEmail(finalEmail);
    if (bypass) {
      rememberRealStaffIdent(bypass);
    } else if (sessionEmpId) {
      setEmpData((prev) => ({ ...prev, id: sessionEmpId, name: sessionUserName || prev.name }));
      rememberRealStaffIdent(sessionEmpId);
    } else if (status === 'authenticated' && sessionUserEmail) {
      rememberRealStaffIdent(String(sessionUserEmail).trim());
    }
    if (!finalEmail) {
      setLoading(false);
      return undefined;
    }
    
    // అటెండెన్స్ లాగ్
    fetch('/api/employee/activity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: finalEmail, action: 'LOGIN', details: 'Employee started session on portal.' })
    }).catch(err => console.log('Attendance log failed', err));

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchLiveOperationsData(finalEmail, activeTabRef.current);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [onEmployeeDesk, status, sessionUserEmail, sessionUserEmpId]);

  useEffect(() => {
    if (!email) return undefined;
    fetchLiveOperationsData(email, activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, activeTab]);

  const fetchLiveOperationsData = async (userEmail, tab = activeTabRef.current) => {
    try {
      const want = new Set(['employees']);
      if (tab === 'internal') { want.add('workflow'); want.add('dispatches'); }
      else if (tab === 'submitted') { want.add('workflow'); want.add('winning'); want.add('bids'); }
      else if (tab === 'clients') { want.add('clients'); want.add('officers'); }
      else if (tab === 'publisher') want.add('tenders');
      else if (tab === 'alerts') want.add('dispatches');
      else if (tab === 'sla') { want.add('tickets'); want.add('guests'); }
      else if (tab === 'chat') want.add('employees');

      const stamp = Date.now();
      const headers = staffHeaders();
      const tasks = {};
      if (want.has('dispatches')) tasks.dispatches = fetch(`/api/dispatches?t=${stamp}`, { credentials: 'include', headers });
      if (want.has('bids')) tasks.bids = fetch(`/api/bids?t=${stamp}`, { credentials: 'include', headers });
      if (want.has('officers')) tasks.officers = fetch(`/api/gov-officers?t=${stamp}`, { credentials: 'include', headers });
      if (want.has('clients')) tasks.clients = fetch(`/api/users/approved?t=${stamp}`, { credentials: 'include', headers });
      if (want.has('tenders')) tasks.tenders = fetch(`/api/tenders?t=${stamp}`, { credentials: 'include', headers });
      if (want.has('tickets')) tasks.tickets = fetch(`/api/tickets?t=${stamp}`, { credentials: 'include', headers });
      if (want.has('guests')) tasks.guests = fetch(`/api/guest-queries?t=${stamp}`, { credentials: 'include', headers });
      if (want.has('employees')) tasks.employees = fetch(`/api/employees?t=${stamp}`, { credentials: 'include', headers });
      if (want.has('workflow')) {
        const board = tab === 'submitted' ? 'submitted' : 'internal';
        tasks.workflow = fetchWorkflowQueue(board);
      }
      if (want.has('winning')) tasks.winning = fetchWorkflowQueue('winning');

      const keys = Object.keys(tasks);
      const responses = await Promise.all(keys.map((k) => tasks[k]));
      const got = {};
      await Promise.all(keys.map(async (k, i) => {
        const res = responses[i];
        if (k === 'workflow' || k === 'winning') {
          got[k] = res;
          return;
        }
        if (res?.ok) got[k] = await res.json();
      }));

      if (got.dispatches) {
        const allDispatches = got.dispatches.dispatches || [];
        setListIfChanged(setDispatches, allDispatches);
        setMdTasks(allDispatches.filter((d) => d.target_type === 'employee_task'));
        setSuggestions(allDispatches.filter((d) => d.subject === 'New Tender Suggestion from Officer' && d.status !== 'Completed' && d.client_reply !== 'Client Accepted the Tender'));
      }
      if (got.bids) setListIfChanged(setBids, got.bids.bids || []);
      if (got.officers) setListIfChanged(setOfficers, got.officers.officers || []);
      if (got.clients) setListIfChanged(setApprovedClients, got.clients.users || []);
      if (got.tenders) setListIfChanged(setPublicTenders, got.tenders.tenders || []);
      if (got.tickets) setListIfChanged(setTickets, got.tickets.tickets || []);
      if (got.guests) setListIfChanged(setGuestQueries, got.guests.queries || got.guests['guest-queries'] || []);
      if (got.employees) {
        const team = got.employees.team || [];
        setListIfChanged(setTeamMembers, team);
        const needle = String(userEmail || '').trim().toLowerCase();
        const mine = team.find((t) => {
          const rowEmail = String(t.email || '').trim().toLowerCase();
          const rowId = String(t.emp_id || '').trim().toLowerCase();
          return needle && (rowEmail === needle || rowId === needle);
        });
        if (mine?.emp_id) {
          const canonical = String(mine.email || '').trim();
          setEmpData({ name: mine.name || 'Employee', id: mine.emp_id, role: mine.designation || mine.role || 'Operations Officer' });
          if (canonical) {
            rememberRealStaffIdent(canonical);
            if (canonical.toLowerCase() !== needle) setEmail(canonical);
          }
        }
      }
      if (got.workflow) {
        setWfJobs((prev) => {
          const incoming = got.workflow.jobs || [];
          const keep = prev.filter((j) => (tab === 'submitted' ? belongsOnInternal(j) : belongsOnSubmitted(j)));
          const incomingIds = new Set(incoming.map((x) => String(x._id)));
          const merged = [...incoming, ...keep.filter((j) => !incomingIds.has(String(j._id)))];
          return sameStamps(prev, merged) ? prev : merged;
        });
      }
      if (got.winning) setListIfChanged(setWfWinning, (got.winning.jobs || []).filter(belongsOnWinning));
    } catch (err) { console.error("Employee Sync Error", err); } finally { setLoading(false); }
  };

  const handleViewPDF = async (tenderId) => {
    window.open(`/api/tenders/${tenderId}/pdf?email=${email}&role=employee`, '_blank');
    toast.success('Opening PDF Document...');
  };

  const handleEditTender = (t) => {
    setIsEditingTender(t);
    setActiveTab('publisher');
    toast.info('Edit mode active. Update details and click save.');
  };

  const handleDeleteTenderDB = async (id) => {
    if(!confirm("Are you sure you want to permanently delete this tender from the Live Portal?")) return;
    try {
      const res = await fetch(`/api/tenders/${id}`, { method: 'DELETE', credentials: 'include', headers: staffHeaders() });
      if(res.ok) {
        toast.success("Tender deleted successfully.");
        setPublicTenders((prev) => prev.filter((row) => String(row._id || row.id) !== String(id)));
      }
      else { toast.error("Failed to delete tender."); }
    } catch(e) { toast.error("Network error"); }
  };

  const handleSuggestTender = async (tenderId, tenderTitle, tenderBidNo) => {
    const selectedClientEmail = suggestForm[tenderId];
    if(!selectedClientEmail) return toast.error("Please select a client to suggest this tender.");
    const formattedMessage = `[BID: ${tenderBidNo || 'N/A'}] ${tenderTitle}`;
    const isDuplicate = suggestions.some(s => s.target_id === selectedClientEmail && s.message === formattedMessage);
    if(isDuplicate) return toast.error("Action Denied: You have already suggested this tender to the selected client.");
    
    try {
      const res = await fetch('/api/dispatches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: 'client_alert', target_id: selectedClientEmail, subject: 'New Tender Suggestion from Officer', message: formattedMessage })
      });
      if (res.ok) {
        toast.success(`Tender suggestion sent successfully to client!`);
        logActivity('SUGGESTED_TENDER', `Suggested tender to ${selectedClientEmail}`);
        setSuggestForm({...suggestForm, [tenderId]: ''});
        fetchLiveOperationsData(email);
      }
    } catch (err) { toast.error('Network Error while sending suggestion.'); }
  };

  const handleConvertSuggestionToBid = async (sug) => {
      if (sug.client_reply !== 'Client Accepted the Tender') {
         return toast.error("Cannot move to tracker until the client actively accepts the suggestion.");
      }
      let extractedBidNo = 'PENDING';
      let extractedDesc = sug.message;
      const match = sug.message.match(/\[BID: (.*?)\] (.*)/);
      if (match) { extractedBidNo = match[1]; extractedDesc = match[2]; }

      const isDuplicate = bids.some(b => b.client_email === sug.target_id && b.bid_no === extractedBidNo);
      if(isDuplicate) return toast.error("Action Denied: This tender is already actively tracked for this client.");

      try {
          const res = await fetch('/api/bids', {
             method: 'POST', headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ bid_no: extractedBidNo, description: extractedDesc, status: 'Bid Allocated', client_email: sug.target_id, submitted_date: '' })
          });
          if (res.ok) {
             await fetch('/api/dispatches/complete', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_id: sug._id })
             });
             toast.success("Both parties agreed! Tender successfully moved to Kanban Tracker.");
             fetchLiveOperationsData(email);
          }
      } catch (e) { toast.error("Error confirming the bid."); }
  };

  const handleSuggestionResponse = async (suggestion, action) => {
    try {
      if (action === 'Rejected') {
         await fetch('/api/dispatches/complete', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: suggestion._id })
         });
         toast.info("Suggestion Rejected and removed from list.");
      }
      fetchLiveOperationsData(email);
    } catch (err) { toast.error("Error processing suggestion."); }
  };

  const handleAddBidRow = async (e) => {
    e.preventDefault();
    if(!newBidForm.client_email || !newBidForm.bid_no) return toast.error("Client Email and Bid Number are required");
    const isDuplicate = bids.some(b => b.bid_no === newBidForm.bid_no && b.client_email === newBidForm.client_email);
    if(isDuplicate) return toast.error("Action Denied: This Bid Number is already active for this client!");

    try {
      const res = await fetch('/api/bids', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBidForm)
      });
      if(res.ok) {
        toast.success("New Bid Event Row Added Successfully!");
        setNewBidForm({ bid_no: '', description: '', submitted_date: '', status: 'Bid Allocated', client_email: '' });
        setShowAddBid(false); fetchLiveOperationsData(email);
      } else toast.error("Failed to add bid row.");
    } catch (err) { toast.error("Network Error."); }
  };
  
  const handleSaveEditBid = async (e) => {
     e.preventDefault();
     if(!editingBid) return;
     try {
        const res = await fetch('/api/bids/update', {
           method: 'PUT', headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ bid_id: editingBid._id || editingBid.id, status: editingBid.status, bid_no: editingBid.bid_no, description: editingBid.description })
        });
        if(res.ok) {
           toast.success("Bid details updated successfully!");
           setEditingBid(null); fetchLiveOperationsData(email);
        } else toast.error("Failed to update bid details.");
     } catch(err) { toast.error("Network Error."); }
  };

  const handleDeleteBid = async (bidId) => {
     if(!confirm("Are you sure you want to delete this bid access from the tracker?")) return;
     try {
       const res = await fetch(`/api/bids?id=${bidId}`, { method: 'DELETE' });
       if (res.ok) { toast.success("Bid tracking removed."); fetchLiveOperationsData(email); } 
       else toast.error("Failed to remove. Backend route might need update.");
     } catch(e) { toast.error("Network error"); }
  }

  const [approvalModal, setApprovalModal] = useState({ open: false, email: '', docId: '', docName: '', clientName: '' });
  const [customFileName, setCustomFileName] = useState('');
  const [overwriteDoc, setOverwriteDoc] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState('');

  const openApprovalModal = (client, doc) => {
      const cleanClientName = (client.company_name || client.client_name || 'Client').replace(/\s+/g, '_');
      const cleanDocName = doc.name.replace(/\s+/g, '_');
      setCustomFileName(`${cleanClientName}_${cleanDocName}`);
      setDuplicateWarning('');
      setOverwriteDoc(false);
      setApprovalModal({ open: true, email: client.email, docId: doc.id, docName: doc.name, clientName: client.company_name || client.client_name });
  };

  const handleVerifyVaultDoc = async (clientEmail, docId, status, customName = null, overwrite = false) => {
      let reason = '';
      if (status === 'rejected') {
          reason = rejectReason[`${clientEmail}_${docId}`];
          if (!reason) return toast.error("Please provide a rejection reason.");
      }
      try {
          const res = await fetch('/api/vault/verify', {
             method: 'PUT', headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ email: clientEmail, docId: docId, status: status, reject_reason: reason, custom_file_name: customName, overwrite: overwrite })
          });
          const data = await res.json();
          if (res.ok) {
              toast.success(`Document marked as ${status.toUpperCase()}!`);
              if (status === 'rejected') setRejectReason(prev => ({...prev, [`${clientEmail}_${docId}`]: ''}));
              if (status === 'verified') { setApprovalModal({ open: false, email: '', docId: '', docName: '', clientName: '' }); setViewClientDocs(null); }
              fetchLiveOperationsData(email);
          } else if (res.status === 409) {
              setDuplicateWarning(data.message || 'Duplicate found. Replace it?');
          } else { toast.error("Failed to update status."); }
      } catch (err) { toast.error("Network error."); }
  };
  
  const approveClient = async (clientEmail) => {
      try {
          await fetch('/api/users/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: clientEmail }) });
          toast.success('✅ Client Verified & Portal Unlocked!'); fetchLiveOperationsData(email);
      } catch(e) { toast.error('Network Error while approving.'); }
  };

  const deleteClientPermanently = async (clientEmail) => {
      if (!confirm("🚨 WARNING: Are you sure you want to PERMANENTLY delete this client?")) return;
      try {
          const res = await fetch(`/api/users?email=${encodeURIComponent(clientEmail)}`, { method: 'DELETE' });
          if (res.ok) { toast.success("Client and all data permanently wiped out!"); fetchLiveOperationsData(email); } 
          else toast.error("Failed to delete client.");
      } catch(e) { toast.error('Network Error while deleting.'); }
  };

  const handleSyncDrive = async (clientEmail, companyName) => {
      toast.loading("Creating Google Drive Workspace...");
      try {
          const res = await fetch('/api/drive/create-folder', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: clientEmail, folderName: `Client - ${companyName}` })
          });
          const data = await res.json();
          if(res.ok) { toast.success("Drive Synced & Created Successfully!"); fetchLiveOperationsData(email); } 
          else toast.error(data.error || "Drive Sync Failed.");
      } catch(e) { toast.error("Network Error."); }
  };

  // 🚀 RESTORED: GUEST QUERY RESOLVE FUNCTION
  const resolveGuestQuery = async (id) => {
      try {
          await fetch(`/api/guest-queries?id=${id}`, { method: 'DELETE' });
          toast.success("Guest query marked as resolved and removed!");
          fetchLiveOperationsData(email);
      } catch (e) { toast.error("Error updating query."); }
  };

  const submitTicketReply = async (ticket_id) => {
      const replyText = ticketReply[ticket_id];
      if(!replyText) return toast.error('Please write a reply first.');
      try {
          const r = await fetch('/api/tickets/reply', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ticket_id, reply: replyText, admin_email: empData.name || 'Operations Officer' })
          });
          if(r.ok) { 
              toast.success('Reply Sent & Ticket Resolved!'); 
              setTicketReply(prev => ({...prev, [ticket_id]: ''})); 
              fetchLiveOperationsData(email); 
          } else toast.error('Failed to send reply');
      } catch(e) { toast.error('Error resolving ticket'); }
  };

  const deleteTicket = async (ticket_id) => {
      if(!confirm("Permanently delete this helpdesk conversation?")) return;
      try {
          const res = await fetch(`/api/tickets?id=${ticket_id}`, { method: 'DELETE' });
          if(res.ok) { toast.success("Ticket deleted"); fetchLiveOperationsData(email); } 
          else toast.error("Failed to delete");
      } catch(e) { toast.error("Network error"); }
  };

  const handleDispatchTask = async (e) => {
      e.preventDefault();
      if(!taskForm.target_id || !taskForm.subject || !taskForm.message) return toast.error("Fill all details to dispatch");
      try {
          const res = await fetch('/api/dispatches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(taskForm) });
          if(res.ok) { 
              toast.success('Dispatch Sent!'); 
              setTaskForm({ target_type: 'client_alert', target_id: '', subject: '', message: '' }); 
              fetchLiveOperationsData(email); 
          } else toast.error('Failed to dispatch');
      } catch (err) { toast.error('Network Error.'); }
  };

  const deleteDispatch = async (id) => {
      if(!confirm("Permanently delete this task?")) return;
      setDispatches(prev => prev.filter(d => d._id !== id));
      await fetch(`/api/dispatches?id=${id}`, { method: 'DELETE' });
      toast.success("Deleted permanently.");
  };

  const handleGiveWarning = async (id) => {
      try {
          await fetch('/api/dispatches/update', {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ task_id: id, status: 'Warning Issued' })
          });
          toast.success("Warning issued successfully!"); fetchLiveOperationsData(email);
      } catch(e) { toast.error("Network error"); }
  };

  const handleForceClose = async (id) => {
      if(!confirm("Are you sure you want to force close this task?")) return;
      try {
          await fetch('/api/dispatches/update', {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ task_id: id, status: 'Force Closed (SLA Breach)' })
          });
          toast.success("Task force closed."); fetchLiveOperationsData(email);
      } catch(e) { toast.error("Network error"); }
  };

  const submitL1Price = async (tender_id) => {
      const data = l1Data[tender_id];
      if (!data?.price) return toast.error('Please enter the L1 Price');
      try {
          await fetch(`/api/tenders/${tender_id}`, {
              method: 'PUT', headers: staffHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ l1_price: data.price, l1_winner: data.winner })
          });
          toast.success('L1 Intel saved successfully!'); fetchLiveOperationsData(email);
      } catch(e) { toast.error('Error saving L1 Price'); }
  };

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
        fetchLiveOperationsData(email);
      }
    } catch (err) { toast.error('Network Error while pushing alert.'); }
  };

  const handleRaiseQuery = async (e) => {
    e.preventDefault();
    if(!queryForm.client_email || !queryForm.subject || !queryForm.message) return toast.error('Please select client and fill query');
    try {
      const res = await fetch('/api/queries/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queryForm)
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.success(`Query Raised! Client's dashboard is now locked until they reply.`);
        logActivity('RAISED_QUERY', `Locked client ${queryForm.client_email} for document request.`);
        if (data?.id) {
          const raised = { id: data.id, subject: queryForm.subject, message: queryForm.message, created_at: new Date().toISOString() };
          setApprovedClients(prev => prev.map(c =>
            c.email === queryForm.client_email
              ? { ...c, officer_queries: [...(c.officer_queries || []), raised] }
              : c
          ));
        }
        setQueryForm({ client_email: '', subject: '', message: '' });
        fetchLiveOperationsData(email);
      } else { toast.error('Failed to raise query.'); }
    } catch (err) { toast.error('Network Error while raising query.'); }
  };

  const handleCloseQuery = async (queryId, clientEmail) => {
    if(!confirm("Are you sure you want to close this query?")) return;
    try {
      const res = await fetch('/api/queries/close', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryId, email: clientEmail })
      });
      if (res.ok) {
        toast.success(`Query Closed successfully.`);
        setApprovedClients(prev => prev.map(c =>
          c.email === clientEmail
            ? { ...c, officer_queries: (c.officer_queries || []).map(q => q.id === queryId ? { ...q, is_closed: true } : q) }
            : c
        ));
        fetchLiveOperationsData(email);
      }
    } catch (err) { toast.error('Network Error.'); }
  };

  const updateBidStatus = async (id, newStatus) => {
    if (newStatus === 'Won' || newStatus === 'Lost') {
      return toast.error('Won and Lost are set on the Submitted board, not this tracker.');
    }

    setBids(bids.map(b => (b._id === id || b.id === id) ? { ...b, status: newStatus } : b));
    try {
      const res = await fetch('/api/bids/update', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bid_id: id, status: newStatus })
      });
      if (res.ok) {
        toast.success(`Bid updated to "${newStatus}". Client Notified.`);
        logActivity('UPDATED_BID', `Changed bid ${id} status to ${newStatus}`);
      } else { fetchLiveOperationsData(email); }
    } catch (err) { toast.error('Network Error during status update.'); }
  };

  const onTaskFileChange = (taskId, e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { 
          setMdTaskFile(prev => ({...prev, [taskId]: { name: file.name, data: reader.result.toString().split(',')[1] }})); 
      };
      reader.readAsDataURL(file);
  };

  const markTaskDone = async (taskId) => {
    const replyText = mdTaskReply[taskId] || 'Completed by Employee';
    const fileObj = mdTaskFile[taskId];
    setUploadingTask(true);
    try {
      const res = await fetch('/api/dispatches/update', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            task_id: taskId, 
            status: 'Completed', 
            reply: replyText,
            file_name: fileObj?.name || null,
            file_base64: fileObj?.data || null
        })
      });
      if (res.ok) {
        toast.success('Task marked completed & replied to MD.');
        setMdTaskReply(prev => ({...prev, [taskId]: ''}));
        setMdTaskFile(prev => ({...prev, [taskId]: null}));
        fetchLiveOperationsData(email); 
      }
    } catch (err) { toast.error('Network Error while updating task.'); }
    setUploadingTask(false);
  };

  const handleSaveOfficer = async (e) => {
    e.preventDefault();
    if(!officerForm.name || !officerForm.department) return toast.error('Name and Dept are required');
    setSavingOfficer(true);
    try {
      const res = await fetch('/api/gov-officers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(officerForm)
      });
      if (res.ok) {
        toast.success('Govt Officer added to Central Directory!');
        logActivity('ADDED_OFFICER', `Added officer: ${officerForm.name}`);
        setOfficerForm({ name: '', department: '', designation: '', phone: '', state: '', district: '', address: '', pincode: '', notes: '' });
        fetchLiveOperationsData(email); 
      }
    } catch (err) { toast.error('Failed to save officer data'); }
    setSavingOfficer(false);
  };

  const escalateToMD = async (ticket) => {
    try {
      const res = await fetch('/api/dispatches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    } catch (e) { toast.error("Failed to escalate."); }
  };

  const logActivity = (action, details) => {
    fetch('/api/employee/activity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action, details })
    }).catch(err => console.log('Activity log failed', err));
  };

  if (!isMounted) return null;
  if (!onEmployeeDesk) {
    if (typeof window !== 'undefined') window.location.replace('/');
    return null;
  }

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

  const livePublished = liveTendersOnly(publicTenders);
  const tenderNeedle = (tenderSearch || '').trim().toLowerCase();
  const filteredTenders = !tenderNeedle
    ? livePublished
    : livePublished.filter((t) =>
        [t.bid_no, t.title].some((v) => String(v || '').toLowerCase().includes(tenderNeedle))
      );
  const empTenderPages = Math.max(1, Math.ceil(filteredTenders.length / 10));
  const safeTenderPage = Math.min(tenderPage, empTenderPages);
  const pagedTenders = filteredTenders.slice((safeTenderPage - 1) * 10, safeTenderPage * 10);

  const activeTickets = tickets.filter(t => t.status === 'OPEN');
  const resolvedTickets = tickets.filter(t => t.status === 'RESOLVED');
  const pendingClientAlerts = mdTasks.filter(t => t.target_type === 'client_alert' && t.status !== 'Completed').length;
  const activeMdPriorityTasks = mdTasks.filter((t) => t.status !== 'Completed');

  // Grouped nav (Enterprise UI/UX Blueprint, section A) — replaces the old single-row
  // flat TabsList (11 tabs) with a left rail on desktop and a Sheet drawer on
  // tablet/mobile. Same tab values as before, so every <TabsContent value="..."> below
  // is untouched.
  const EMPLOYEE_NAV_GROUPS = [
    { id: 'my-work', label: 'My Work', items: [
      { value: 'doc-team', label: 'Doc Team', icon: ClipboardList, color: 'navy' },
      { value: 'internal', label: 'Internal Tracking', icon: ClipboardList, color: 'navy' },
      { value: 'submitted', label: 'Submitted Tracking', icon: FileText, color: 'navy' },
    ] },
    { id: 'clients-officers', label: 'Clients', items: [
      { value: 'clients', label: 'Clients DB', icon: Users, color: 'navy' },
    ] },
    { id: 'ai-tools', label: 'AI Tools', items: [
      { value: 'copilot-desk', label: 'Co-Pilot Chat Desk', icon: Bot, color: 'violet' },
    ] },
    { id: 'publishing', label: 'Publishing', items: [
      { value: 'publisher', label: 'Published Tenders', icon: PlusCircle, color: 'navy' },
    ] },
    { id: 'alerts-support', label: 'Alerts & Support', items: [
      { value: 'ops-alerts', label: 'Work Alerts', icon: BellRing, color: 'navy' },
      { value: 'chat', label: 'Staff Chat', icon: MessageSquare, color: 'navy' },
      { value: 'alerts', label: 'Client Queries', icon: BellRing, color: 'navy', badge: pendingClientAlerts },
      { value: 'sla', label: 'Helpdesk', icon: MessageSquare, color: 'navy', badge: activeTickets.length + guestQueries.length },
    ] },
  ];

return (
    <div className="min-h-screen bg-slate-50">
      <header className="navy-gradient border-b border-white/10 sticky top-0 z-30 shadow-lg text-white">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <div>
               <h1 className="font-bold text-lg leading-tight">Operations Desk</h1>
               <p className="text-[10px] text-emerald-300 font-mono tracking-widest">{empData.id} • {email}</p>
             </div>
          </div>
          <div className="flex gap-3 items-center">
             <BrandMark size="md" />
             <Badge className="bg-emerald-500/90 border border-emerald-400/40 shadow-sm hidden sm:inline-flex">Session Active</Badge>
             <a href="/"><Button variant="outline" size="sm" className="border-white/20 text-slate-300 hover:text-white hover:bg-white/10 transition-all duration-200"><ArrowLeft className="w-4 h-4 mr-2"/> Exit System</Button></a>
          </div>
        </div>
      </header>

      <main className="w-full px-4 sm:px-8 py-6 space-y-6">
        <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 items-start">
        <DashboardNav groups={EMPLOYEE_NAV_GROUPS} activeTab={activeTab} onChange={setActiveTab} title="Operations Desk" />
        <div className="flex-1 w-full min-w-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">

          <TabsContent value="internal" className="w-full space-y-6">
            <div className="bg-white border border-blue-200 rounded-xl p-4 shadow-sm relative overflow-hidden w-full">
              <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
              <h3 className="font-bold text-[#0A2647] flex items-center gap-2 mb-3"><ClipboardList className="w-4 h-4 text-blue-500"/> MD Priority Tasks</h3>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeMdPriorityTasks.length === 0 ? (
                  <p className="text-sm text-slate-500 py-2">No pending tasks from MD.</p>
                ) : (
                  activeMdPriorityTasks.map((task) => (
                    <div key={task._id || task.id} className="flex flex-col bg-slate-50 border p-3 rounded-lg shadow-sm">
                      <div className="flex justify-between items-start">
                        <div>
                          <Badge variant="outline" className={`mb-1 ${task.priority === 'High' ? 'text-red-600 border-red-200 bg-red-50' : 'text-amber-600 border-amber-200 bg-amber-50'}`}>Priority Task</Badge>
                          <p className="font-semibold text-sm text-slate-800">{task.subject}</p>
                          <p className="text-xs text-slate-500 mt-1">{task.message}</p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 mt-3 border-t border-slate-200 pt-3">
                        <Input placeholder="Type your reply to MD..." className="h-8 text-xs bg-white" value={mdTaskReply[task._id || task.id] || ''} onChange={(e) => setMdTaskReply({...mdTaskReply, [task._id || task.id]: e.target.value})} />
                        <div className="flex gap-2 items-center">
                          <Input type="file" accept=".pdf, image/*" className="h-8 text-xs bg-white flex-1" onChange={(e) => onTaskFileChange(task._id || task.id, e)} />
                          <Button size="sm" disabled={uploadingTask} onClick={() => markTaskDone(task._id || task.id)} className="bg-blue-600 hover:bg-blue-700 h-8 text-xs shrink-0">
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1"/> {uploadingTask ? 'Sending...' : 'Send Reply & Close'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <InternalTrackingBoard
              desk="employee"
              jobs={wfJobs.filter((j) => INTERNAL_BOARD_STATUSES.includes(j.status))}
              onPatchJob={patchJob}
              onRemoveJob={removeJob}
              actorEmpId={empData.id}
            />
          </TabsContent>

          <TabsContent value="doc-team" className="w-full">
            <DocTeamWorkspace role="maker" actorEmpId={empData.id} />
          </TabsContent>

          <TabsContent value="submitted" className="w-full space-y-6">
            <SubmittedTrackingBoard
              jobs={wfJobs.filter((j) => SUBMITTED_BOARD_STATUSES.includes(j.status))}
              actorEmpId={empData.id}
              onPatchJob={patchJob}
              onRemoveJob={removeJob}
              onArchiveJob={archiveJob}
            />
            <WinningBidsBoard jobs={wfWinning} showClientName />
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
                   <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-5 mb-6 shadow-inner">
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
                                  
                                  {editingBid && (editingBid._id === b._id || editingBid.id === b.id) ? (
                                     <form onSubmit={handleSaveEditBid} className="space-y-3">
                                        <div>
                                           <Label className="text-[10px] uppercase font-bold text-slate-500">Edit Bid Number</Label>
                                           <Input value={editingBid.bid_no} onChange={e => setEditingBid({...editingBid, bid_no: e.target.value})} className="h-8 text-xs bg-slate-50" />
                                        </div>
                                        <div>
                                           <Label className="text-[10px] uppercase font-bold text-slate-500">Edit Description/Shortcut</Label>
                                           <Textarea rows={2} value={editingBid.description} onChange={e => setEditingBid({...editingBid, description: e.target.value})} className="text-xs bg-slate-50" />
                                        </div>
                                        <div className="flex gap-2">
                                           <Button type="button" onClick={() => setEditingBid(null)} variant="outline" className="flex-1 h-8 text-xs"><X className="w-3 h-3 mr-1"/> Cancel</Button>
                                           <Button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 h-8 text-xs"><CheckCircle2 className="w-3 h-3 mr-1"/> Save</Button>
                                        </div>
                                     </form>
                                  ) : (
                                     <div>
                                        <div className="flex justify-between items-start mb-2">
                                           <div className="bg-blue-50 border border-blue-200 text-blue-900 px-2 py-1 rounded shadow-sm flex items-center">
                                              <span className="text-[10px] uppercase font-bold text-blue-500 mr-2">BID NO:</span>
                                              <span className="text-xs font-black font-mono truncate max-w-[120px]">{b.bid_no || b.id || 'N/A'}</span>
                                           </div>
                                           <div className="flex gap-1 items-center">
                                              <Badge className="bg-blue-100 text-blue-800 border-0 shadow-sm mr-1">{b.status}</Badge>
                                              <Button variant="ghost" size="icon" onClick={() => setEditingBid(b)} className="h-6 w-6 p-0 text-slate-400 hover:text-blue-600 bg-slate-50 border"><Pencil className="w-3 h-3"/></Button>
                                              <Button variant="ghost" size="icon" onClick={() => handleDeleteBid(b._id || b.id)} className="h-6 w-6 p-0 text-red-400 hover:text-red-600 bg-slate-50 border"><Trash2 className="w-3 h-3"/></Button>
                                           </div>
                                        </div>
                                        <h4 className="font-bold text-[#0A2647] mt-2 text-sm leading-tight line-clamp-2">{b.description || b.title}</h4>
                                     </div>
                                  )}
                                  
                                  {!editingBid && (
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
                                      </select>
                                    </div>
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
                                 {clientSuggestions.map(sug => {
                                    let displayBid = 'N/A';
                                    let displayDesc = sug.message;
                                    const match = sug.message.match(/\[BID: (.*?)\] (.*)/);
                                    if (match) { displayBid = match[1]; displayDesc = match[2]; }

                                    return (
                                    <div key={sug._id} className="border border-amber-200 rounded-xl p-4 bg-white shadow-sm flex flex-col justify-between hover:shadow-md transition relative">
                                       <div>
                                          <div className="flex justify-between items-start mb-2">
                                             <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[9px] font-mono">Suggested On: {new Date(sug.created_at).toLocaleDateString()}</Badge>
                                             {displayBid !== 'N/A' && <Badge className="bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-mono">{displayBid}</Badge>}
                                          </div>
                                          <h4 className="font-bold text-[#0A2647] mt-1 mb-2 text-sm leading-relaxed border border-slate-100 bg-slate-50 p-3 rounded-md">
                                             {displayDesc}
                                          </h4>
                                          {sug.client_reply ? (
                                             <Badge className={`w-full justify-center ${sug.client_reply.includes('Accepted') ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                                 Client Status: {sug.client_reply}
                                             </Badge>
                                          ) : (
                                             <Badge variant="outline" className="w-full justify-center text-slate-400 bg-slate-50">Waiting for Client Reply</Badge>
                                          )}
                                       </div>
                                       <div className="flex gap-2 border-t border-slate-100 pt-3 mt-3">
                                          <Button size="sm" onClick={() => handleConvertSuggestionToBid(sug)} className={`flex-1 h-9 text-xs shadow-sm ${sug.client_reply === 'Client Accepted the Tender' ? 'bg-[#16a34a] hover:bg-[#15803d]' : 'bg-slate-300 cursor-not-allowed opacity-50'}`}>
                                             <CheckCircle2 className="w-3.5 h-3.5 mr-1.5"/> Add to Tracker
                                          </Button>
                                          <Button size="sm" onClick={() => handleSuggestionResponse(sug, 'Rejected')} variant="outline" className="flex-1 border-red-200 text-red-600 hover:bg-red-50 h-9 text-xs">
                                             <XCircle className="w-3.5 h-3.5 mr-1.5"/> Remove
                                          </Button>
                                       </div>
                                    </div>
                                 )})}
                              </CardContent>
                           </Card>
                           )})}
                     </div>
                  )}
               </CardContent>
            </Card>
          </TabsContent>

          {false ? (
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
                      <Label className="text-xs font-bold text-slate-600">Phone Number</Label>
                      <Input type="tel" value={officerForm.phone} onChange={e=>setOfficerForm({...officerForm, phone: e.target.value})} className="mt-1 bg-white h-9 text-sm"/>
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
                            {officer.phone && <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-sm py-1 shadow-sm">📞 {officer.phone}</Badge>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          ) : null}

          <TabsContent value="clients" className="w-full space-y-6">
            <Card className="tender-shadow border-t-4 border-t-blue-600 mt-6 w-full">
              <CardHeader className="bg-blue-50/50 border-b pb-4">
                 <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg">
                    <Briefcase className="w-5 h-5 text-blue-600" /> Active Clients Directory
                 </CardTitle>
                 <CardDescription>View client details, access their Google Drive vault, or login to troubleshoot.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 max-h-[700px] overflow-y-auto">
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
                                      <div className="mt-1">
                                        <WhatsAppVerifiedBadge
                                          email={client.email}
                                          phone={client.phone}
                                          verified={client.whatsapp_verified === true}
                                          onChanged={(v) => setApprovedClients(prev => prev.map(c => c.email === client.email ? { ...c, whatsapp_verified: v } : c))}
                                        />
                                      </div>
                                   </div>
                                   <Badge className="bg-emerald-100 text-emerald-800 border-0 h-fit"><CheckCircle2 className="w-3 h-3 mr-1"/> Active</Badge>
                                </div>
                             </div>
                             
                             <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-4 border-t border-slate-100">
                                <Button size="sm" onClick={() => setViewClientDocs(client)} variant="outline" className="flex-1 text-purple-600 border-purple-200 hover:bg-purple-50 h-9">
                                   <FileText className="w-4 h-4 mr-2" /> View Vault Docs
                                </Button>
                                <Button size="sm" onClick={() => setStationeryClient(client)} variant="outline" className="flex-1 text-indigo-700 border-indigo-200 hover:bg-indigo-50 h-9">
                                   <PenTool className="w-4 h-4 mr-2" /> Upload Stationery
                                </Button>
                                {client.drive_folder_link || client.drive_link ? (
                                   <Button size="sm" onClick={() => window.open(client.drive_folder_link || client.drive_link, '_blank')} variant="outline" className="flex-1 text-blue-600 border-blue-200 hover:bg-blue-50 h-9">
                                      <Database className="w-4 h-4 mr-2" /> Open Drive
                                   </Button>
                                ) : null}
                                <Button size="sm" onClick={() => openClientBypass(client.email)} className="flex-1 bg-[#0A2647] hover:bg-[#144272] h-9">
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

          <TabsContent value="alerts" className="w-full space-y-6">
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

                  <div className="mt-8">
                     <h4 className="font-bold text-slate-700 text-sm mb-3">Pending Action Alerts</h4>
                     {mdTasks.filter(t => t.target_type === 'client_alert' && t.status !== 'Completed').length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-4 bg-slate-50 rounded border border-dashed">No active alerts pushed to clients.</p>
                     ) : (
                        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                           {mdTasks.filter(t => t.target_type === 'client_alert' && t.status !== 'Completed').map(alert => (
                              <div key={alert._id} className="bg-red-50 border border-red-100 p-3 rounded-lg flex flex-col relative">
                                 <span className="text-[9px] text-red-400 font-bold mb-1">To: {alert.target_id}</span>
                                 <p className="text-xs text-red-900 mb-2">"{alert.message}"</p>
                                 <Button size="sm" onClick={() => markTaskDone(alert._id || alert.id)} variant="outline" className="h-6 text-[10px] w-fit self-end border-red-200 text-red-600 hover:bg-red-100">
                                    <X className="w-3 h-3 mr-1"/> Close & Remove
                                 </Button>
                              </div>
                           ))}
                        </div>
                     )}
                  </div>
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

                  <div className="mt-8">
                     <h4 className="font-bold text-slate-700 text-sm mb-3">Active Client Queries</h4>
                     <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                        {approvedClients.filter(c => c.officer_queries && c.officer_queries.some(q => !q.is_closed)).length === 0 ? (
                           <p className="text-xs text-slate-400 text-center py-4 bg-slate-50 rounded border border-dashed">No active queries pending.</p>
                        ) : (
                           approvedClients.filter(c => c.officer_queries && c.officer_queries.some(q => !q.is_closed)).map(client => (
                              client.officer_queries.filter(q => !q.is_closed).map((q, idx) => (
                                 <div key={idx} className="bg-orange-50 border border-orange-200 p-3 rounded-lg flex flex-col relative shadow-sm">
                                    <div className="flex justify-between items-start mb-1">
                                       <span className="text-[9px] text-orange-500 font-bold">To: {client.company_name || client.email}</span>
                                       <Badge className={q.reply_submitted ? 'bg-emerald-100 text-emerald-800 border-0 text-[9px]' : 'bg-red-100 text-red-800 border-0 text-[9px] animate-pulse'}>
                                          {q.reply_submitted ? 'Client Replied' : 'Pending Client'}
                                       </Badge>
                                    </div>
                                    <p className="text-xs font-bold text-orange-900 mb-1">{q.subject}</p>
                                    <p className="text-xs text-orange-800 mb-2 bg-white p-2 rounded border border-orange-100">"{q.message}"</p>
                                    
                                    {/* 🚀 FIX: Showing Client's Reply & Attached PDF */}
                                    {q.reply_submitted && (
                                       <div className="mb-3 bg-emerald-50 border border-emerald-100 p-2 rounded">
                                          <span className="text-[9px] font-bold text-emerald-600 uppercase block mb-1">Client's Reply:</span>
                                          <p className="text-xs text-emerald-900 font-medium">"{q.reply_text}"</p>
                                          {q.reply_file && (
                                             <Button size="sm" variant="outline" onClick={() => {
                                                 window.open(`/api/vault/document?email=${encodeURIComponent(client.email)}&docId=${encodeURIComponent(`query_response_${q.id}`)}`, '_blank');
                                             }} className="mt-2 h-7 text-[10px] border-emerald-300 text-emerald-700 bg-white w-fit">
                                                <FileText className="w-3 h-3 mr-1"/> View Attached File
                                             </Button>
                                          )}
                                       </div>
                                    )}

                                    <div className="flex gap-2 justify-end mt-1 pt-2 border-t border-orange-200">
                                       <Button size="sm" onClick={() => handleCloseQuery(q.id, client.email)} className="h-7 text-[10px] bg-[#16a34a] hover:bg-[#15803d]">
                                          <CheckCircle2 className="w-3 h-3 mr-1"/> {q.reply_submitted ? 'Verify & Close' : 'Force Close Query'}
                                       </Button>
                                    </div>
                                 </div>
                              ))
                           ))
                        )}
                     </div>

                     {/* 🚀 NEW: Query History Section */}
                     <h4 className="font-bold text-slate-700 text-sm mb-3 mt-8 border-t pt-6">Resolved Queries History</h4>
                     <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                        {approvedClients.filter(c => c.officer_queries && c.officer_queries.some(q => q.is_closed)).length === 0 ? (
                           <p className="text-xs text-slate-400 text-center py-4 bg-slate-50 rounded border border-dashed">No resolved queries.</p>
                        ) : (
                           approvedClients.filter(c => c.officer_queries && c.officer_queries.some(q => q.is_closed)).map(client => (
                              client.officer_queries.filter(q => q.is_closed).map((q, idx) => (
                                 <div key={`hist-${idx}`} className="bg-slate-50 border border-slate-200 p-3 rounded-lg flex flex-col relative shadow-sm">
                                    <div className="flex justify-between items-start mb-1">
                                       <span className="text-[9px] text-slate-500 font-bold">To: {client.company_name || client.email}</span>
                                       <Badge className="bg-slate-200 text-slate-700 border-0 text-[9px]">Closed</Badge>
                                    </div>
                                    <p className="text-xs font-bold text-slate-700 mb-1">{q.subject}</p>
                                    {q.reply_submitted && <p className="text-[10px] text-emerald-600 font-bold">Reply: {q.reply_text}</p>}
                                 </div>
                              ))
                           ))
                        )}
                     </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="copilot-desk" className="w-full space-y-6">
            <GeminiWorkspace
              embedded
              tenderId={isEditingTender?._id || isEditingTender?.id || null}
              tenderLabel={isEditingTender ? (isEditingTender.title || isEditingTender.bid_no || 'this tender') : null}
              clients={approvedClients}
              tenders={publicTenders}
            />
          </TabsContent>

          <TabsContent value="publisher" className="w-full space-y-6">
            <div className="grid lg:grid-cols-5 gap-6">
               <div className="lg:col-span-2">
                 <PublishTenderForm
                   awaitingJobs={wfJobs.filter((j) => j.status === 'AWAITING_PUBLISH')}
                   editTender={isEditingTender}
                   onCancelEdit={() => setIsEditingTender(null)}
                   onPublished={() => {
                     setIsEditingTender(null);
                     fetchLiveOperationsData(email);
                   }}
                 />
               </div>
               <Card className="lg:col-span-3 tender-shadow self-start">
                 <CardHeader className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                    <div>
                       <CardTitle className="text-[#0A2647] flex items-center gap-2">Published Tenders <Badge variant="outline">{filteredTenders.length}</Badge></CardTitle>
                    </div>
                    <div className="relative shrink-0 w-full sm:w-[250px]">
                       <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                       <Input placeholder="Search Bid No or Title..." value={tenderSearch} onChange={e=>{ setTenderSearch(e.target.value); setTenderPage(1); }} className="pl-9 h-9 w-full bg-white shadow-sm text-xs" />
                    </div>
                 </CardHeader>
                 <CardContent className="space-y-4">
                    {filteredTenders.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No matching tenders found.</p>}
                    {pagedTenders.map((t) => (
                      <div key={t._id || t.id} className="border border-slate-200 rounded-lg p-4 bg-white hover:border-[#0A2647]/30 transition shadow-sm flex flex-col gap-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge className="bg-[#0A2647]">{t.district}</Badge>
                              {t.category && <Badge variant="outline" className="text-[10px]">{t.category}</Badge>}
                              {t.bid_no && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800 border-amber-200">Bid: {t.bid_no}</Badge>}
                              <span className="text-[10px] text-red-600 font-bold flex items-center bg-red-50 px-1.5 py-0.5 rounded"><Clock className="w-3 h-3 mr-1"/> Ends: {t.last_date && !isNaN(new Date(t.last_date)) ? new Date(t.last_date).toLocaleDateString() : 'N/A'}</span>
                            </div>
                            <p className="font-bold text-[#0A2647] text-base leading-tight line-clamp-2">{t.title}</p>
                            <p className="text-xs text-slate-500 mt-1">{t.department}</p>
                          </div>
                          <div className="flex flex-col gap-2">
                             <Button variant="ghost" size="icon" onClick={() => handleEditTender(t)} className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 h-8 w-8"><Pencil className="w-4 h-4" /></Button>
                             <Button variant="ghost" size="icon" onClick={() => handleDeleteTenderDB(t._id || t.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50 h-8 w-8"><Trash2 className="w-4 h-4" /></Button>
                          </div>
                        </div>
                        
                        <div className="border-t border-slate-100 pt-3 mt-2 flex flex-col sm:flex-row items-center gap-2">
                           <Button size="sm" onClick={() => handleViewPDF(t._id)} variant="outline" className="h-8 text-xs text-blue-600 border-blue-200 shadow-sm shrink-0">
                              <FileText className="w-3 h-3 mr-1.5"/> View PDF
                           </Button>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center justify-center gap-3 pt-2">
                      <Button variant="outline" size="sm" disabled={safeTenderPage === 1} onClick={() => setTenderPage(safeTenderPage - 1)}>Previous</Button>
                      <span className="text-xs font-bold">Page {safeTenderPage} of {empTenderPages}</span>
                      <Button variant="outline" size="sm" disabled={safeTenderPage === empTenderPages} onClick={() => setTenderPage(safeTenderPage + 1)}>Next</Button>
                    </div>
                 </CardContent>
               </Card>
            </div>

            <OperationsStoragePanel clients={approvedClients} uploadedBy={email} />
          </TabsContent>

          {/* 🚀 RESTORED: GUEST QUERIES AND SLA TRACKER */}
          <TabsContent value="ops-alerts" className="w-full"><OpsAlerts roster={teamMembers} /></TabsContent>
          <TabsContent value="chat" className="w-full overflow-hidden"><StaffChat selfId={empData.id} roster={teamMembers} /></TabsContent>
          <TabsContent value="sla" className="w-full space-y-6">
            
            {/* GUEST QUERIES */}
            <Card className="tender-shadow border-t-4 border-t-purple-500 w-full">
              <CardHeader className="bg-purple-50/30 border-b pb-4">
                 <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><Users className="w-5 h-5 text-purple-600" /> Public Visitor Queries (Leads)</CardTitle>
                 <CardDescription>Questions and Contact Requests submitted from the Guest Home Page.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 max-h-[500px] overflow-y-auto">
                 {guestQueries.length === 0 ? (
                    <div className="text-center py-8 text-slate-400"><MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-30"/><p className="text-sm font-semibold">No public queries pending.</p></div>
                 ) : (
                    <div className="grid md:grid-cols-2 gap-4">
                       {guestQueries.map(gq => (
                          <div key={gq._id} className="border border-purple-200 bg-white rounded-lg p-4 shadow-sm relative">
                             <div className="flex justify-between items-start mb-2">
                                <h4 className="font-bold text-[#0A2647] text-base">{gq.name}</h4>
                                <Badge className="bg-purple-100 text-purple-800 border-0">New Lead</Badge>
                             </div>
                             <p className="text-sm text-slate-600 mb-2 font-mono"><PhoneCall className="w-3 h-3 inline mr-1"/> {gq.phone}</p>
                             <div className="bg-slate-50 p-3 rounded border border-slate-100 mb-4">
                                <p className="text-xs text-slate-700 italic">"{gq.query}"</p>
                             </div>
                             <div className="flex gap-2">
                                <a href={`tel:${gq.phone}`} className="flex-1"><Button size="sm" className="w-full bg-purple-600 hover:bg-purple-700 h-8 text-xs"><PhoneCall className="w-3 h-3 mr-1"/> Call Lead</Button></a>
                                <Button size="sm" onClick={() => resolveGuestQuery(gq._id)} variant="outline" className="border-slate-300 text-slate-600 hover:bg-slate-100 h-8 text-xs"><CheckCircle2 className="w-3 h-3 mr-1"/> Mark Resolved</Button>
                             </div>
                          </div>
                       ))}
                    </div>
                 )}
              </CardContent>
            </Card>

            {/* HELPDESK TICKETS */}
            <Card className="tender-shadow border-t-4 border-t-amber-500 w-full">
              <CardHeader className="bg-amber-50/30 border-b pb-4">
                 <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg"><MessageSquare className="w-5 h-5 text-amber-600" /> Client Helpdesk & SLA Tracker</CardTitle>
                 <CardDescription>Resolve queries within 24 hours or escalate issues.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 max-h-[800px] overflow-y-auto">
                 {activeTickets.length > 0 && (
                    <div className="mb-8 space-y-4">
                       <h3 className="font-bold text-slate-700 mb-2 border-b pb-2">Active Action Required</h3>
                       <div className="grid md:grid-cols-2 gap-4">
                       {activeTickets.map(ticket => (
                          <div key={ticket._id} className="border border-amber-200 bg-white rounded-lg p-4 relative overflow-hidden shadow-sm hover:shadow-md transition flex flex-col justify-between">
                             <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                             <div>
                                <div className="flex justify-between items-start mb-2">
                                   <div>
                                     <Badge variant="outline" className="mb-1 bg-slate-100">{ticket.department}</Badge>
                                     <p className="text-xs text-muted-foreground">{ticket.client_email}</p>
                                   </div>
                                   <div className="flex gap-2 items-center">
                                      <Badge className="bg-amber-100 text-amber-800 border-0 animate-pulse shrink-0">Action Required</Badge>
                                      <Button variant="ghost" size="icon" onClick={() => deleteTicket(ticket._id)} className="h-6 w-6 p-0 text-red-400 hover:text-red-600 bg-white"><Trash2 className="w-3 h-3"/></Button>
                                   </div>
                                </div>
                                <div className="bg-amber-50 border border-amber-100 p-3 rounded-tr-xl rounded-br-xl rounded-bl-xl shadow-inner mb-4 mt-2">
                                   <p className="text-[10px] text-amber-500 font-bold uppercase mb-1">{new Date(ticket.created_at).toLocaleString()}</p>
                                   <h4 className="font-bold text-[#0A2647] text-sm mb-1">{ticket.subject}</h4>
                                   <p className="text-xs text-amber-900 leading-relaxed">"{ticket.message}"</p>
                                </div>
                             </div>
                             
                             <div className="flex flex-col gap-2 mt-4 pt-3 border-t">
                                <div className="flex gap-2">
                                   <Input placeholder="Type resolution note..." className="text-sm flex-1 bg-white focus-visible:ring-amber-500 h-9" value={ticketReply[ticket._id] || ''} onChange={(e) => setTicketReply(prev => ({...prev, [ticket._id]: e.target.value}))}/>
                                   <Button onClick={() => submitTicketReply(ticket._id)} className="bg-[#16a34a] hover:bg-[#15803d] shrink-0 h-9"><CheckCircle2 className="w-4 h-4 mr-1"/>Resolve</Button>
                                </div>
                                <div className="flex gap-2">
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
                                   <Button variant="ghost" size="icon" onClick={() => deleteTicket(ticket._id)} className="h-6 w-6 p-0 text-red-400 hover:text-red-600 bg-white border border-slate-200 shadow-sm"><Trash2 className="w-3 h-3"/></Button>
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
        </div>
        </div>
      </main>

      {/* MODALS */}
      <Dialog open={!!viewClientDocs} onOpenChange={() => setViewClientDocs(null)}>
        <DialogContent className="sm:max-w-2xl bg-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-[#0A2647] flex items-center gap-2"><FolderPlus className="w-5 h-5 text-purple-600"/> Client Vault Documents</DialogTitle>
            <DialogDescription>Documents securely uploaded by {viewClientDocs?.company_name}</DialogDescription>
          </DialogHeader>
          <div className="grid sm:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto p-1">
            {!viewClientDocs?.vault_docs || viewClientDocs.vault_docs.length === 0 ? (
              <p className="text-sm text-slate-500 col-span-2 text-center py-6">No documents uploaded by this client yet.</p>
            ) : (
              viewClientDocs.vault_docs.map(doc => (
                 <div key={doc.id} className="border border-slate-200 p-3 rounded-lg bg-slate-50 flex flex-col justify-between gap-3 shadow-sm hover:border-purple-300 transition">
                    <div>
                       <p className="font-bold text-slate-800 text-sm">{doc.name}</p>
                       <p className="text-xs text-slate-500 font-mono truncate">{doc.file_name}</p>
                       <Badge className={`mt-2 ${doc.status === 'verified' ? 'bg-emerald-100 text-emerald-800' : doc.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'} border-0`}>{doc.status}</Badge>
                    </div>
                    <Button size="sm" variant="outline" className="w-full text-blue-600 border-blue-200 hover:bg-blue-50 mb-2" onClick={() => {
                        window.open(`/api/vault/document?email=${encodeURIComponent(viewClientDocs.email)}&docId=${encodeURIComponent(doc.id)}`, '_blank');
                    }}>
                       <Eye className="w-4 h-4 mr-2"/> View Document
                    </Button>
                    
                    {doc.status === 'uploaded' && (
                        <div className="flex flex-col gap-2 border-t border-slate-200 pt-3">
                           <Input placeholder="Rejection reason..." className="h-8 text-xs bg-white" value={rejectReason[`${viewClientDocs.email}_${doc.id}`] || ''} onChange={e => setRejectReason({...rejectReason, [`${viewClientDocs.email}_${doc.id}`]: e.target.value})} />
                           <div className="flex gap-2">
                              <Button size="sm" onClick={() => openApprovalModal(viewClientDocs, doc)} className="flex-1 bg-[#16a34a] hover:bg-[#15803d] h-8 text-xs"><CheckCircle2 className="w-3.5 h-3.5 mr-1"/> Approve</Button>
                              <Button size="sm" onClick={() => handleVerifyVaultDoc(viewClientDocs.email, doc.id, 'rejected')} variant="outline" className="flex-1 border-red-200 text-red-600 hover:bg-red-50 h-8 text-xs"><XCircle className="w-3.5 h-3.5 mr-1"/> Reject</Button>
                           </div>
                        </div>
                    )}
                 </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
     <Dialog open={approvalModal.open} onOpenChange={(val) => !val && setApprovalModal({ open: false, email: '', docId: '', docName: '', clientName: '' })}>
        <DialogContent className="sm:max-w-md border-0 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-black text-[#0A2647] flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-600"/> Approve & Save Document</DialogTitle>
            <DialogDescription>Review the file name before saving it to the database and client's Google Drive.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
             <div><Label className="font-bold text-slate-700">Client Name</Label><Input type="text" value={approvalModal.clientName} disabled className="mt-1 bg-slate-50 text-slate-500" /></div>
             <div><Label className="font-bold text-slate-700">File Name (Auto-Generated) *</Label><Input type="text" value={customFileName} onChange={e => setCustomFileName(e.target.value)} required className="mt-1 border-2 h-11" /></div>
             
             {duplicateWarning && (
                <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex flex-col gap-2">
                   <div className="flex items-center gap-2 text-amber-800 text-sm font-bold"><AlertTriangle className="w-4 h-4"/> {duplicateWarning}</div>
                   <label className="flex items-center gap-2 text-sm cursor-pointer font-semibold text-amber-900 mt-1"><input type="checkbox" checked={overwriteDoc} onChange={e => setOverwriteDoc(e.target.checked)} className="w-4 h-4 accent-amber-600" /> Yes, replace the existing file.</label>
                </div>
             )}

             <Button onClick={() => handleVerifyVaultDoc(approvalModal.email, approvalModal.docId, 'verified', customFileName, overwriteDoc)} className="w-full bg-[#16a34a] hover:bg-[#15803d] h-12 mt-2 font-bold text-lg shadow-md" disabled={duplicateWarning && !overwriteDoc}>
                Confirm & Save to Drive
             </Button>
          </div>
        </DialogContent>
      </Dialog>

      <StationeryUploader
        client={stationeryClient}
        open={!!stationeryClient}
        onOpenChange={(open) => { if (!open) setStationeryClient(null); }}
      />
    </div>
  );
}
