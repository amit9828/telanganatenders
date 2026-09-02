'use client';
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import BrandLogo from '@/components/BrandLogo';
import GeminiWorkspace from '@/components/GeminiWorkspace';
import StationeryUploader from '@/components/StationeryUploader';
import L1BenchmarkDropzone from '@/components/L1BenchmarkDropzone';
import WhatsAppVerifiedBadge from '@/components/WhatsAppVerifiedBadge';
import AiMatchmakerPanel from '@/components/AiMatchmakerPanel';
import DocumentLetterheadGenerator from '@/components/DocumentLetterheadGenerator';
import LetterheadManager from '@/components/LetterheadManager';
import LiveScrapedTendersPanel from '@/components/LiveScrapedTendersPanel';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea'; 
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'; 
import {
  ArrowLeft, Users, FileText, PlusCircle, BellRing, 
  MessageSquare, Send, CheckCircle2, ShieldCheck, 
  Briefcase, Kanban, Building2, LayoutDashboard, AlertCircle, Contact, MonitorPlay, Loader2,
  Database, Lock, Globe, MapPin, Target, UploadCloud, Clock, LogIn, XCircle, Lightbulb, Search, Trophy, Trash2, Star, Pencil, Eye, X, FolderPlus, TrendingDown, RefreshCw, Sparkles, AlertTriangle, PenTool, Activity, Bot
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
  const [analyzingTender, setAnalyzingTender] = useState(false);
  const [launchingGem, setLaunchingGem] = useState(false);
  const [publicTenders, setPublicTenders] = useState([]); 
  const [suggestions, setSuggestions] = useState([]); 
  const [tickets, setTickets] = useState([]); 
  const [guestQueries, setGuestQueries] = useState([]); // 🚀 RESTORED STATE

  const [tenderForm, setTenderForm] = useState({
    bid_no: '', title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: ''
  });
  const [publishing, setPublishing] = useState(false);
  const [isEditingTender, setIsEditingTender] = useState(null); 
  const [pdfName, setPdfName] = useState('');
  const [pdfBase64, setPdfBase64] = useState('');
  const [tenderSearch, setTenderSearch] = useState(''); 
  
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

  const [publishWinModalOpen, setPublishWinModalOpen] = useState(false);
  const [winForm, setWinForm] = useState({ bid_id: null, contract_value: '', validity: '' });
  const [processingWin, setProcessingWin] = useState(false);

  const [mdTaskReply, setMdTaskReply] = useState({});
  const [viewClientDocs, setViewClientDocs] = useState(null);
  const [stationeryClient, setStationeryClient] = useState(null);

  const [ticketReply, setTicketReply] = useState({});
  const [taskForm, setTaskForm] = useState({ target_type: 'client_alert', target_id: '', subject: '', message: '' });
  const [dispatches, setDispatches] = useState([]);
  const [bidRequests, setBidRequests] = useState([]);
  const [bidReply, setBidReply] = useState({});
  const [bidAssignee, setBidAssignee] = useState({});
  const [rejectReason, setRejectReason] = useState({});
  const [teamMembers, setTeamMembers] = useState([]);
  const [l1Data, setL1Data] = useState({});
  const [pendingUsers, setPendingUsers] = useState([]);
  const [mdTaskFile, setMdTaskFile] = useState({});
  const [uploadingTask, setUploadingTask] = useState(false);
  const [operatorDocs, setOperatorDocs] = useState([]);
  const [sharingDocId, setSharingDocId] = useState(null);
  const [targetClientEmail, setTargetClientEmail] = useState('');
  const [uploadingOpPdf, setUploadingOpPdf] = useState(false);
  const [aiDrafts, setAiDrafts] = useState([]);
  // 🚀 AI Bulk Publisher — review queue state
  const [reviewDraft, setReviewDraft] = useState(null);
  const [draftForm, setDraftForm] = useState({ bid_no: '', title: '', department: '', last_date: '', district: '', category: 'Product', emd_amount: '', supply_details: '' });
  const [publishingDraft, setPublishingDraft] = useState(false);
  const [draftPdfRefs, setDraftPdfRefs] = useState({ pdf_url: null, pdf_r2_key: null });
// 🚀 FIX: Employee Live Tracking (Auto-Refresh without Cache)
  useEffect(() => {
    setIsMounted(true);
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_emp_email') : 'employee@tgtenders.in';
    const finalEmail = e || 'employee@tgtenders.in';
    setEmail(finalEmail);
    
    // అటెండెన్స్ లాగ్
    fetch('/api/employee/activity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: finalEmail, action: 'LOGIN', details: 'Employee started session on portal.' })
    }).catch(err => console.log('Attendance log failed', err));

    const syncEmployeeData = () => {
        fetchLiveOperationsData(finalEmail);
    };
    
    syncEmployeeData(); // ఫస్ట్ టైమ్ కాల్
    // 🚀 PERF FIX: Poll every 60s (not 10s) and only while this tab is visible —
    // matches the same guard already used in Admin/Client dashboards, so an
    // employee tab left open/minimized in the background stops silently
    // generating 12 DB-touching requests every 10 seconds all day.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncEmployeeData();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchLiveOperationsData = async (userEmail) => {
    try {
      // 🚀 PERF FIX: All 12 endpoints now fire in a single Promise.all instead of
      // 10 in parallel + 2 more awaited sequentially afterward — eliminates the
      // extra round-trip latency the sequential `operator/docs`/`ai/drafts`
      // calls were adding on top of the already-parallel batch.
      const [tasksRes, bidsRes, officersRes, clientsRes, tendersRes, ticketsRes, pendRes, reqRes, guestRes, empRes, opDocsRes, draftsRes] = await Promise.all([
        fetch(`/api/dispatches?t=${Date.now()}`), 
        fetch(`/api/bids?t=${Date.now()}`), 
        fetch(`/api/gov-officers?t=${Date.now()}`),
        fetch(`/api/users/approved?t=${Date.now()}`), 
        fetch(`/api/tenders?t=${Date.now()}`), 
        fetch(`/api/tickets?t=${Date.now()}`),
        fetch(`/api/users/pending?t=${Date.now()}`),
        fetch(`/api/client-requests?t=${Date.now()}`),
        fetch(`/api/guest-queries?t=${Date.now()}`),
        fetch(`/api/employees?t=${Date.now()}`),
        fetch(`/api/operator/docs?t=${Date.now()}`),
        fetch(`/api/ai/drafts?t=${Date.now()}`)
      ]);

      if (opDocsRes.ok) {
         const opData = await opDocsRes.json();
         setOperatorDocs(opData.docs || []);
      }

      if (draftsRes.ok) {
         const dData = await draftsRes.json();
         setAiDrafts(dData.drafts || []);
      }
      if (tasksRes.ok) {
        const tData = await tasksRes.json();
        const allDispatches = tData.dispatches || [];
        setDispatches(allDispatches);
        setMdTasks(allDispatches.filter(d => d.target_type === 'employee_task'));
        setSuggestions(allDispatches.filter(d => d.subject === 'New Tender Suggestion from Officer' && d.status !== 'Completed' && d.client_reply !== 'Client Accepted the Tender'));
      }
      if (bidsRes.ok) { const bData = await bidsRes.json(); setBids(bData.bids || []); }
      if (officersRes.ok) { const oData = await officersRes.json(); setOfficers(oData.officers || []); }
      if (clientsRes.ok) { const cData = await clientsRes.json(); setApprovedClients(cData.users || []); }
      if (tendersRes.ok) { const pData = await tendersRes.json(); setPublicTenders(pData.tenders || []); }
      if (ticketsRes.ok) { const tkData = await ticketsRes.json(); setTickets(tkData.tickets || []); }
      if (pendRes.ok) { const pendData = await pendRes.json(); setPendingUsers(pendData.users || []); }
      if (reqRes.ok) { const reqData = await reqRes.json(); setBidRequests(reqData.requests || []); }
      if (guestRes.ok) { const gData = await guestRes.json(); setGuestQueries(gData.queries || gData['guest-queries'] || []); } 
      if (empRes.ok) { const eData = await empRes.json(); setTeamMembers(eData.team || []); }
    } catch (err) { console.error("Employee Sync Error", err); } finally { setLoading(false); }
  };

  const onPdfChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') return toast.error('Please upload a PDF file');
    if (file.size > 4 * 1024 * 1024) return toast.error('PDF file is too large! Please upload under 4MB.');
    
    const reader = new FileReader();
    reader.onload = () => { 
        const base64Str = reader.result?.toString().split(',')[1] || '';
        setPdfBase64(base64Str); 
        setPdfName(file.name); 
        toast.success(`PDF Loaded. Starting AI Analysis...`);
        
        // 🚀 ఫైల్ అటాచ్ అవ్వగానే ఆటోమెటిక్ గా AI ని పిలవడం
        handleAITenderAnalysis(file, base64Str);
    };
    reader.readAsDataURL(file);
  };
  const handleViewPDF = async (tenderId) => {
    window.open(`/api/tenders/${tenderId}/pdf?email=${email}&role=employee`, '_blank');
    toast.success('Opening PDF Document...');
  };

  const launchGemLiveHunter = async () => {
    setLaunchingGem(true);
    try {
      const res = await fetch('http://localhost:4001/api/launch-gem', { method: 'POST' });
      if (!res.ok) throw new Error('launch failed');
      toast.success('Chrome opened on your screen. Solve CAPTCHA if prompted.');
    } catch {
      toast.error("Local agent not running. Run 'npm run gem:agent' in terminal.");
    } finally {
      setLaunchingGem(false);
    }
  };

  // 🚀 AI Auto-Fill Function (FIXED)
  const handleAITenderAnalysis = async (file, base64Data) => {
      setAnalyzingTender(true);
      toast.info("AI is reading the document. Please wait...", { duration: 3000 });
      
      try {
          const res = await fetch('/api/ai/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pdfBase64: base64Data, saveToDraft: false })
          });
          
          if (res.ok) {
              const { data } = await res.json();
              if (data) {
                  // 🚀 ఇక్కడ setTenderForm అని మార్చాం 🚀
                  setTenderForm(prev => ({
                      ...prev,
                      bid_no: data.bid_no !== "N/A" ? data.bid_no : prev.bid_no,
                      title: data.title !== "N/A" ? data.title : prev.title,
                      department: data.department !== "N/A" ? data.department : prev.department,
                      last_date: data.last_date !== "N/A" ? data.last_date : prev.last_date,
                      supply_details: `EMD: ${data.emd_amount}\nTurnover Req: ${data.turnover_req}\nMandatory Docs: ${(data.mandatory_docs || []).join(', ')}`
                  }));
                  toast.success("AI Successfully auto-filled the tender details!");
              }
          } else {
              toast.error("AI Analysis failed. You may need to enter manually.");
          }
      } catch (err) {
          toast.error("Network error during AI analysis.");
      }
      setAnalyzingTender(false);
  };
  
  // 🚀 కొత్త కోడ్: Handle Selection of AI Draft
  const handleSelectDraft = (draftId) => {
      if (!draftId) return;
      const draft = aiDrafts.find(d => d._id === draftId);
      if (!draft) return;

      setTenderForm({
          bid_no: draft.bid_no !== "N/A" ? draft.bid_no : "",
          title: draft.title !== "N/A" ? draft.title : "",
          department: draft.department !== "N/A" ? draft.department : "",
          last_date: draft.last_date !== "N/A" ? draft.last_date : "",
          district: draft.district !== "N/A" && DISTRICTS.includes(draft.district) ? draft.district : "",
          category: "Product",
          supply_details: `EMD: ${draft.emd_amount}\nTurnover Req: ${draft.turnover_req}\nMandatory Docs: ${(draft.mandatory_docs || []).join(', ')}`
      });
      setPdfBase64(draft.pdf_base64 || "");
      setPdfName(draft.pdf_filename || "AI_Draft_Document.pdf");
      // 🚀 FIX: drafts are listed with pdf_base64 projected out (and bulk-uploaded ones
      // never had it — the file lives in R2), so publishing from this form used to
      // create a tender with no document attached. Carry the R2 pointers instead.
      setDraftPdfRefs({ pdf_url: draft.pdf_url || null, pdf_r2_key: draft.pdf_r2_key || null });
      toast.success("AI Data Auto-Filled!");
  };

  // 🚀 AI BULK PUBLISHER — Review Pipeline
  // Opens the reviewer with the Gemini-extracted values pre-filled so the employee only
  // has to correct what the model got wrong.
  const openDraftReview = (draft) => {
      setReviewDraft(draft);
      setDraftForm({
          bid_no: draft.bid_no || '',
          title: draft.title || '',
          department: draft.department || '',
          last_date: draft.last_date || '',
          district: DISTRICTS.includes(draft.district) ? draft.district : '',
          category: ['Product', 'Service', 'Works'].includes(draft.category) ? draft.category : 'Product',
          emd_amount: draft.emd_amount || '',
          supply_details: draft.supply_details || '',
      });
  };

  const publishDraftToLive = async () => {
      if (!reviewDraft) return;
      if (!draftForm.title || !draftForm.department || !draftForm.last_date || !draftForm.bid_no) {
          return toast.error('Bid number, title, department and last date are all required.');
      }

      setPublishingDraft(true);
      try {
          const res = await fetch('/api/ai/drafts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: reviewDraft._id, ...draftForm, publishedBy: empData.name || 'Employee' }),
          });
          const data = await res.json().catch(() => null);

          if (!res.ok) {
              toast.error(data?.error || `Failed to publish (${res.status})`, { duration: 8000 });
              return;
          }

          toast.success(`"${draftForm.title}" is now live on the portal.`);
          setAiDrafts(prev => prev.filter(d => d._id !== reviewDraft._id));
          setReviewDraft(null);
          fetchLiveOperationsData(email);
      } catch (err) {
          console.error('Publish draft error:', err);
          toast.error('Network error while publishing.');
      } finally {
          setPublishingDraft(false);
      }
  };

  const discardDraft = async (draft) => {
      if (!confirm(`Discard the draft for "${draft.title || draft.pdf_filename}"? This cannot be undone.`)) return;
      try {
          const res = await fetch(`/api/ai/drafts?id=${draft._id}`, { method: 'DELETE' });
          if (!res.ok) return toast.error('Failed to discard draft.');
          toast.success('Draft discarded.');
          setAiDrafts(prev => prev.filter(d => d._id !== draft._id));
          if (reviewDraft?._id === draft._id) setReviewDraft(null);
      } catch (err) {
          toast.error('Network error while discarding.');
      }
  };

  // 🚀 పాత దానికి బదులు ఈ కొత్త ఫంక్షన్ పెట్టు: 
  const handlePublishTender = async (e) => {
    e.preventDefault();
    if(!tenderForm.title || !tenderForm.department || !tenderForm.last_date || !tenderForm.bid_no) return toast.error('Please fill all required fields');
    setPublishing(true);
    try {
      const url = isEditingTender ? `/api/tenders/${isEditingTender}` : '/api/tenders';
      const method = isEditingTender ? 'PUT' : 'POST';
      const r = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...tenderForm,
          // Only send the blob when there is one; an auto-filled draft carries R2
          // pointers instead so the file is never duplicated into MongoDB.
          ...(pdfBase64 ? { pdf_base64: pdfBase64 } : {}),
          ...(draftPdfRefs.pdf_url ? { pdf_url: draftPdfRefs.pdf_url } : {}),
          ...(draftPdfRefs.pdf_r2_key ? { pdf_r2_key: draftPdfRefs.pdf_r2_key } : {}),
          pdf_filename: pdfName || 'tender.pdf',
        })
      });
      if(r.ok) {
        toast.success(isEditingTender ? 'Tender updated successfully!' : 'Tender published successfully!');
        
        // 🚀 Auto Delete Draft after publish
        const drafted = aiDrafts.find(d => d.bid_no === tenderForm.bid_no);
        if (drafted) {
           await fetch(`/api/ai/drafts?id=${drafted._id}`, { method: 'DELETE' });
           setAiDrafts(prev => prev.filter(d => d._id !== drafted._id));
        }

        setTenderForm({ bid_no: '', title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: '' });
        setPdfBase64(''); setPdfName(''); setIsEditingTender(null);
        setDraftPdfRefs({ pdf_url: null, pdf_r2_key: null });
        fetchLiveOperationsData(email); 
      } else {
        toast.error('Failed to save tender');
      }
    } catch (err) { toast.error('Network error'); }
    setPublishing(false);
  };

  const handleDeleteTenderDB = async (id) => {
    if(!confirm("Are you sure you want to permanently delete this tender from the Live Portal?")) return;
    try {
      const res = await fetch(`/api/tenders/${id}`, { method: 'DELETE' });
      if(res.ok) { toast.success("Tender deleted successfully."); fetchLiveOperationsData(email); }
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

  const handlePublishWin = async (e) => {
      e.preventDefault();
      if (!winForm.contract_value || !winForm.validity) return toast.error("Please fill in contract value and validity.");
      setProcessingWin(true);
      try {
          const res = await fetch('/api/bids/update', {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bid_id: winForm.bid_id, status: 'Won', contract_value: winForm.contract_value, validity: winForm.validity })
          });
          if (res.ok) {
              toast.success("Winning Bid Published to Client Ledger!");
              logActivity('PUBLISHED_WIN', `Published bid ${winForm.bid_id} as Won`);
              setPublishWinModalOpen(false);
              setWinForm({ bid_id: null, contract_value: '', validity: '' });
              fetchLiveOperationsData(email);
          } else toast.error("Failed to publish win.");
      } catch (err) { toast.error("Network Error."); }
      setProcessingWin(false);
  };

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
  
  const handleOperatorPdfUpload = async (e) => {
     const file = e.target.files?.[0];
     if (!file) return;
     if (file.type !== 'application/pdf') return toast.error('Please upload a PDF file');
     
     setUploadingOpPdf(true);
     const reader = new FileReader();
     reader.onload = async () => {
        try {
           const res = await fetch('/api/operator/docs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                 name: file.name,
                 file_base64: reader.result.toString().split(',')[1],
                 uploaded_by: email
              })
           });
           if (res.ok) {
              toast.success("Document stored successfully in Operations Storage!");
              fetchLiveOperationsData(email);
           } else {
              toast.error("Failed to store document.");
           }
        } catch (err) {
           toast.error("Network error during upload.");
        } finally {
           setUploadingOpPdf(false);
        }
     };
     reader.readAsDataURL(file);
  };

  const handleShareDocWithClient = async (docId) => {
     if (!targetClientEmail) return toast.error("Please select a client to share with.");
     try {
        const res = await fetch('/api/operator/share', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ docId, client_email: targetClientEmail })
        });
        if (res.ok) {
           toast.success("Document successfully shared with the client!");
           setSharingDocId(null);
           setTargetClientEmail('');
        } else {
           toast.error("Failed to share document.");
        }
     } catch (e) {
        toast.error("Network error.");
     }
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

  const handleProcessBidRequest = async (reqId, status) => {
      const reply = bidReply[reqId];
      const assigneeId = bidAssignee[reqId];
      if(status === 'Assigned' && !assigneeId) return toast.error('Please select an employee from the dropdown to assign.');
      try {
          let endpoint = '/api/client-requests/reply';
          let payload = { req_id: reqId, status: status, reply: reply || 'Processed by Operations' };
          if (status === 'Assigned' && assigneeId) {
              const emp = teamMembers.find(t => t.emp_id === assigneeId);
              endpoint = '/api/client-requests/assign';
              payload = { req_id: reqId, emp_id: emp.emp_id, emp_name: emp.name, status: 'Assigned', reply: reply || 'Assigned to Employee' };
          }
          const res = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          if(res.ok) { 
              toast.success(`Client Request ${status}!`); 
              setBidReply(prev => ({...prev, [reqId]: ''})); 
              setBidAssignee(prev => ({...prev, [reqId]: ''})); 
              fetchLiveOperationsData(email); 
          } else toast.error("Failed to update status.");
      } catch(err) { toast.error("Network Error."); }
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

  const deleteDispatch = async (id, isRequest = true) => {
      if(!confirm("Permanently delete this task?")) return;
      if(isRequest) {
          setBidRequests(prev => prev.filter(r => r._id !== id));
          await fetch(`/api/client-requests?id=${id}`, { method: 'DELETE' });
      } else {
          setDispatches(prev => prev.filter(d => d._id !== id));
          await fetch(`/api/dispatches?id=${id}`, { method: 'DELETE' });
      }
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

  const handleViewDocument = (req) => {
      if (req.file_base64 || req.document_base64) {
          const cleanBase64 = (req.file_base64 || req.document_base64).replace(/^data:(.*,)?/, '');
          const byteCharacters = atob(cleanBase64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
          const blob = new Blob([new Uint8Array(byteNumbers)], {type: 'application/pdf'});
          window.open(URL.createObjectURL(blob), '_blank');
          return;
      }

      const docLink = req.file_url || req.document_url || req.file || req.attachment || req.pdf;
      if (docLink) {
          const finalUrl = docLink.startsWith('http') ? docLink : (docLink.startsWith('/') ? docLink : `/uploads/${docLink}`);
          window.open(finalUrl, '_blank');
      } else if (req.link_or_id && req.link_or_id.startsWith('http')) {
          window.open(req.link_or_id, '_blank');
      } else { toast.info("No file attached. The link/ID reference is shown above."); }
  };

  const submitL1Price = async (tender_id) => {
      const data = l1Data[tender_id];
      if (!data?.price) return toast.error('Please enter the L1 Price');
      try {
          await fetch(`/api/tenders/${tender_id}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
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
        toast.success(`Query Raised! Client's dashboard is now locked until they reply.`);
        logActivity('RAISED_QUERY', `Locked client ${queryForm.client_email} for document request.`);
        setQueryForm({ client_email: '', subject: '', message: '' });
        fetchLiveOperationsData(email);
      } else { toast.error('Failed to raise query.'); }
    } catch (err) { toast.error('Network Error while raising query.'); }
  };

  const handleCloseQuery = async (queryId, clientEmail) => {
    if(!confirm("Are you sure you want to close this query?")) return;
    try {
      const res = await fetch('/api/queries/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryId, email: clientEmail })
      });
      if (res.ok) {
        toast.success(`Query Closed successfully.`);
        fetchLiveOperationsData(email);
      }
    } catch (err) { toast.error('Network Error.'); }
  };

  const [lossModalOpen, setLossModalOpen] = useState(false);
  const [lossForm, setLossForm] = useState({ bid_id: null, l1_price: '', l1_winner: '' });

  const updateBidStatus = async (id, newStatus) => {
    if (newStatus === 'Won') {
        setWinForm({ bid_id: id, contract_value: '', validity: '' });
        setPublishWinModalOpen(true);
        return;
    }
    if (newStatus === 'Lost') {
        setLossForm({ bid_id: id, l1_price: '', l1_winner: '' });
        setLossModalOpen(true);
        return;
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

  const handleProcessLoss = async (e) => {
      e.preventDefault();
      if (!lossForm.l1_price) return toast.error("Please enter the L1 Price.");
      
      try {
          await fetch('/api/bids/update', {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bid_id: lossForm.bid_id, status: 'Lost', l1_price: lossForm.l1_price, l1_winner: lossForm.l1_winner })
          });
          
          await fetch(`/api/bids?id=${lossForm.bid_id}`, { method: 'DELETE' });

          toast.success("L1 Price saved to Database & Bid removed from active tracking.");
          setLossModalOpen(false);
          fetchLiveOperationsData(email);
      } catch (err) {
          toast.error("Network Error.");
      }
  };
// 🚀 FIX: Employee Task File Upload
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

  // 🚀 FIX: LocalStorage Injection for Instant Employee Bypass
  const handleImpersonate = (targetEmail) => {
    if (!targetEmail) return toast.error('Enter a valid client email');
    const toastId = toast.loading(`Connecting to ${targetEmail}'s portal...`);

    try {
      localStorage.setItem('tt_email', targetEmail);
      toast.success("Successfully Connected!", { id: toastId });
      setTimeout(() => {
          window.open('/client', '_blank');
      }, 800);
    } catch (e) { 
      toast.error("Error connecting to client portal.", { id: toastId }); 
    }
  };
  const logActivity = (action, details) => {
    fetch('/api/employee/activity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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

  const filteredTenders = publicTenders.filter(t => 
     t.bid_no?.toLowerCase().includes(tenderSearch.toLowerCase()) || 
     t.title?.toLowerCase().includes(tenderSearch.toLowerCase())
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

      <main className="w-full px-4 sm:px-8 py-6 space-y-6">
        <div className="bg-white border border-blue-200 rounded-xl p-4 shadow-sm relative overflow-hidden w-full">
           <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
           <h3 className="font-bold text-[#0A2647] flex items-center gap-2 mb-3"><LayoutDashboard className="w-4 h-4 text-blue-500"/> Tasks Assigned by MD / Admin</h3>
           <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mdTasks.length === 0 ? (
                 <p className="text-sm text-slate-500 py-2">No pending tasks from MD.</p>
              ) : (
                 mdTasks.map(task => (
                    <div key={task._id || task.id} className="flex flex-col bg-slate-50 border p-3 rounded-lg shadow-sm">
                       <div className="flex justify-between items-start">
                          <div>
                             <Badge variant="outline" className={`mb-1 ${task.priority === 'High' ? 'text-red-600 border-red-200 bg-red-50' : 'text-amber-600 border-amber-200 bg-amber-50'}`}>Priority Task</Badge>
                             <p className="font-semibold text-sm text-slate-800">{task.subject}</p>
                             <p className="text-xs text-slate-500 mt-1">{task.message}</p>
                          </div>
                          {task.status === 'Completed' && <Badge className="bg-emerald-100 text-emerald-800 border-0 shrink-0"><CheckCircle2 className="w-3 h-3 mr-1"/> Done</Badge>}
                       </div>
                       
                      {task.status !== 'Completed' && (
                           <div className="flex flex-col gap-2 mt-3 border-t border-slate-200 pt-3">
                              <Input placeholder="Type your reply to MD..." className="h-8 text-xs bg-white" value={mdTaskReply[task._id || task.id] || ''} onChange={(e) => setMdTaskReply({...mdTaskReply, [task._id || task.id]: e.target.value})} />
                              <div className="flex gap-2 items-center">
                                 <Input type="file" accept=".pdf, image/*" className="h-8 text-xs bg-white flex-1" onChange={(e) => onTaskFileChange(task._id || task.id, e)} />
                                 <Button size="sm" disabled={uploadingTask} onClick={() => markTaskDone(task._id || task.id)} className="bg-blue-600 hover:bg-blue-700 h-8 text-xs shrink-0">
                                    <CheckCircle2 className="w-3.5 h-3.5 mr-1"/> {uploadingTask ? 'Sending...' : 'Send Reply & Close'}
                                 </Button>
                              </div>
                           </div>
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
              <Users className="w-4 h-4 mr-2 hidden sm:block"/> Clients DB
            </TabsTrigger>
            <TabsTrigger value="alerts" className="flex-1 min-w-[150px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <BellRing className="w-4 h-4 mr-2 hidden sm:block"/> Alerts & Queries
            </TabsTrigger>
            <TabsTrigger value="matchmaker" className="flex-1 min-w-[150px] py-2.5 data-[state=active]:bg-indigo-700 data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <Target className="w-4 h-4 mr-2 hidden sm:block"/> AI Matchmaker
            </TabsTrigger>
            <TabsTrigger value="live-scraped" className="flex-1 min-w-[150px] py-2.5 data-[state=active]:bg-teal-700 data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <Activity className="w-4 h-4 mr-2 hidden sm:block"/> Live Scraped
            </TabsTrigger>
            <TabsTrigger value="publisher" className="flex-1 min-w-[150px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <PlusCircle className="w-4 h-4 mr-2 hidden sm:block"/> Published Tenders
            </TabsTrigger>
            <TabsTrigger value="copilot-desk" className="flex-1 min-w-[150px] py-2.5 data-[state=active]:bg-violet-700 data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <Bot className="w-4 h-4 mr-2 hidden sm:block"/> Co-Pilot Chat Desk
            </TabsTrigger>
            <TabsTrigger value="drafts" className="flex-1 min-w-[150px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <Sparkles className="w-4 h-4 mr-2 hidden sm:block"/> Ready to Publish
              {aiDrafts.length > 0 && (
                <Badge className="ml-2 bg-purple-600 text-white hover:bg-purple-600 px-1.5 py-0 text-[10px]">{aiDrafts.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="sla" className="flex-1 min-w-[150px] py-2.5 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white font-bold text-xs sm:text-sm">
              <MessageSquare className="w-4 h-4 mr-2 hidden sm:block"/> Helpdesk
            </TabsTrigger>
          </TabsList>

          {/* ==================== AI BULK PUBLISHER — REVIEW PIPELINE ==================== */}
          <TabsContent value="drafts" className="w-full space-y-6">
            <Card className="shadow-sm border-0 ring-1 ring-slate-200 w-full">
              <CardHeader className="bg-purple-50/50 pb-4 border-b">
                <CardTitle className="text-[#0A2647] flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600"/> Ready for Publishing (Pending Drafts)
                </CardTitle>
                <CardDescription>
                  Tenders uploaded in bulk by the MD and read by AI. Review the extracted details, check the source PDF, then publish to the live portal.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                {aiDrafts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                      <CheckCircle2 className="w-7 h-7 text-slate-400"/>
                    </div>
                    <p className="font-bold text-slate-700">The review queue is empty</p>
                    <p className="text-sm text-slate-500 mt-1 max-w-md">
                      When the MD drops tender PDFs into the Bulk AI Dropzone, they will appear here for your review.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {aiDrafts.map(draft => {
                      const missingFields = ['bid_no', 'title', 'department', 'last_date'].filter(f => !draft[f]);
                      return (
                        <div key={draft._id} className="border border-slate-200 rounded-xl bg-white p-4 flex flex-col shadow-sm hover:shadow-md hover:border-purple-300 transition">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <Badge variant="outline" className="border-purple-200 bg-purple-50 text-purple-700 font-mono text-[10px] truncate max-w-[70%]">
                              {draft.bid_no || 'No Bid No.'}
                            </Badge>
                            {missingFields.length > 0 && (
                              <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px] shrink-0">
                                {missingFields.length} field{missingFields.length > 1 ? 's' : ''} missing
                              </Badge>
                            )}
                          </div>

                          <p className="font-bold text-sm text-[#0A2647] leading-snug line-clamp-2 min-h-[2.5rem]">
                            {draft.title || 'Untitled tender'}
                          </p>
                          <p className="text-xs text-slate-500 mt-1 truncate">{draft.department || 'Department not detected'}</p>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[11px] text-slate-500">
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {draft.last_date || 'No date'}</span>
                            {draft.district && <span className="flex items-center gap-1"><MapPin className="w-3 h-3"/> {draft.district}</span>}
                          </div>

                          <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
                            <Button size="sm" onClick={() => openDraftReview(draft)} className="flex-1 bg-purple-600 hover:bg-purple-700 h-8 text-xs">
                              <Pencil className="w-3.5 h-3.5 mr-1"/> Review
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => window.open(`/api/ai/drafts/${draft._id}/file`, '_blank')} className="h-8 text-xs" title="View source PDF">
                              <Eye className="w-3.5 h-3.5"/>
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => discardDraft(draft)} className="h-8 text-xs border-red-200 text-red-600 hover:bg-red-50" title="Discard draft">
                              <Trash2 className="w-3.5 h-3.5"/>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

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
                                        <option value="Won">Won</option>
                                        <option value="Lost">Lost</option>
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

          <TabsContent value="matchmaker" className="w-full space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3">
              <div>
                <p className="font-bold text-[#0A2647] text-sm">AI Matchmaker &amp; Competitor Intel</p>
                <p className="text-xs text-slate-500 mt-0.5">Open Chrome via the local GeM agent, then run matching from the panel below.</p>
              </div>
              <Button
                onClick={launchGemLiveHunter}
                disabled={launchingGem}
                variant="outline"
                className="border-emerald-300 text-emerald-800 hover:bg-emerald-50 shadow-sm shrink-0"
              >
                {launchingGem
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Launching…</>
                  : <>🚀 Launch GeM Live Hunter</>}
              </Button>
            </div>
            <AiMatchmakerPanel />
            <L1BenchmarkDropzone />
          </TabsContent>

          <TabsContent value="live-scraped" className="w-full space-y-6">
            <LiveScrapedTendersPanel />
          </TabsContent>

          <TabsContent value="copilot-desk" className="w-full space-y-6">
            <GeminiWorkspace
              embedded
              tenderId={isEditingTender || null}
              tenderLabel={isEditingTender ? (tenderForm.title || tenderForm.bid_no || 'this tender') : null}
              clients={approvedClients}
              tenders={publicTenders}
            />
          </TabsContent>

          <TabsContent value="publisher" className="w-full space-y-6">
            <LetterheadManager />
            <DocumentLetterheadGenerator
              tenders={publicTenders}
              clients={approvedClients}
              defaultTenderId={isEditingTender || ''}
            />
            <L1BenchmarkDropzone />
            <div className="grid lg:grid-cols-5 gap-6">
               
               <Card className={`border-0 shadow-md lg:col-span-2 h-fit ${isEditingTender ? 'ring-2 ring-blue-500' : ''}`}>
                 <CardHeader className="pb-4 border-b border-slate-100 flex flex-row justify-between items-center">
                    <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
                       {isEditingTender ? <><Pencil className="w-5 h-5 text-blue-600"/> Edit Tender</> : <><PlusCircle className="w-5 h-5"/> Publish New Tender</>}
                    </CardTitle>
                    {isEditingTender && (
                       <Button variant="ghost" size="sm" onClick={() => { setIsEditingTender(null); setTenderForm({ bid_no: '', title: '', department: '', last_date: '', district: '', category: 'Product', supply_details: '' }); }} className="h-7 text-xs text-slate-500 hover:text-red-500">Cancel Edit</Button>
                    )}
                 </CardHeader>
                 <CardContent className="pt-5">
                    {aiDrafts.length > 0 && !isEditingTender && (
                       <div className="mb-6 border border-purple-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="bg-purple-100 text-purple-900 px-4 py-2 font-bold flex items-center gap-2">
                             <Target className="w-4 h-4"/> Pending for Publish (AI Bulk Uploads)
                             <Badge className="bg-purple-600 text-white ml-auto">{aiDrafts.length}</Badge>
                          </div>
                          <div className="p-3 bg-purple-50/50 flex flex-col gap-2 max-h-[250px] overflow-y-auto">
                             {aiDrafts.map(d => (
                                <div key={d._id} className="bg-white border border-purple-100 p-3 rounded-lg flex justify-between items-center hover:border-purple-300 transition shadow-sm">
                                   <div>
                                      <p className="font-bold text-sm text-[#0A2647]">{d.bid_no}</p>
                                      <p className="text-xs text-slate-500">{d.department} - {d.title}</p>
                                   </div>
                                   <Button size="sm" onClick={(e) => { e.preventDefault(); handleSelectDraft(d._id); }} className="bg-purple-600 hover:bg-purple-700 h-8 text-xs shrink-0">
                                      Auto-Fill & Review
                                   </Button>
                                </div>
                             ))}
                          </div>
                       </div>
                    )}
                   <form onSubmit={handlePublishTender} className="space-y-4">
                      <div><Label className="text-sm font-bold text-[#0A2647] mb-1 block">Document Title (Work) *</Label><Input required value={tenderForm.title} onChange={e=>setTenderForm({...tenderForm, title: e.target.value})} className="bg-white h-10"/></div>
                      <div><Label className="text-sm font-bold text-[#0A2647] mb-1 block">Bid Number (Internal Use) *</Label><Input required value={tenderForm.bid_no} onChange={e=>setTenderForm({...tenderForm, bid_no: e.target.value})} placeholder="e.g. GEM/2026/B/..." className="bg-white h-10"/></div>
                      <div><Label className="text-sm font-bold text-[#0A2647] mb-1 block">Department Name *</Label><Input required value={tenderForm.department} onChange={e=>setTenderForm({...tenderForm, department: e.target.value})} className="bg-white h-10"/></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div><Label className="text-sm font-bold text-[#0A2647] mb-1 block">Last Date *</Label><Input required type="date" value={tenderForm.last_date} onChange={e=>setTenderForm({...tenderForm, last_date: e.target.value})} className="bg-white h-10 text-sm"/></div>
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
                      <div><Label className="text-sm font-bold text-[#0A2647] mb-1 block">Supply / Tender Details</Label><textarea className="w-full border rounded-md p-3 h-24 text-sm bg-white outline-none focus:ring-1 focus:ring-slate-300" value={tenderForm.supply_details} onChange={e=>setTenderForm({...tenderForm, supply_details: e.target.value})}></textarea></div>
                      
                      {/* 🚀 FIX: Updated PDF Upload Box with AI Loading Animation */}
                      <div>
                        <Label className="text-sm font-bold text-[#0A2647] mb-1 block">PDF Document {isEditingTender && '(Optional to replace)'}</Label>
                        <div className={`border-2 border-dashed border-slate-200 rounded-md p-6 text-center bg-slate-50 hover:bg-slate-100 cursor-pointer transition relative group ${analyzingTender ? 'animate-pulse bg-blue-50' : ''}`}>
                           <input type="file" accept="application/pdf" onChange={onPdfChange} disabled={analyzingTender} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed" />
                           {analyzingTender ? (
                              <div className="flex flex-col items-center">
                                 <Loader2 className="w-6 h-6 text-blue-600 animate-spin mb-2" />
                                 <span className="text-sm font-bold text-blue-600">AI is analyzing document...</span>
                              </div>
                           ) : (
                              <>
                                 <UploadCloud className="w-6 h-6 text-[#16a34a] mx-auto mb-2 group-hover:scale-110 transition-transform" />
                                 <span className="text-sm font-bold text-[#0A2647]">{pdfName || (isEditingTender ? 'Upload new PDF to replace old' : 'Drop PDF here for AI Auto-Fill')}</span>
                              </>
                           )}
                        </div>
                      </div>

                      <Button type="submit" disabled={publishing || analyzingTender} className={`w-full h-11 text-base font-bold shadow-md ${isEditingTender ? 'bg-blue-600 hover:bg-blue-700' : 'bg-[#16a34a] hover:bg-[#15803d]'}`}>
                         {publishing ? (isEditingTender ? 'Updating...' : 'Publishing...') : (isEditingTender ? 'Save Changes' : 'Publish Tender')}
                      </Button>
                   </form>
                 </CardContent>
               </Card>

               <Card className="lg:col-span-3 tender-shadow">
                 <CardHeader className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                    <div>
                       <CardTitle className="text-[#0A2647] flex items-center gap-2">Published Tenders <Badge variant="outline">{filteredTenders.length}</Badge></CardTitle>
                    </div>
                    <div className="relative shrink-0 w-full sm:w-[250px]">
                       <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                       <Input placeholder="Search Bid No or Title..." value={tenderSearch} onChange={e=>setTenderSearch(e.target.value)} className="pl-9 h-9 w-full bg-white shadow-sm text-xs" />
                    </div>
                 </CardHeader>
                 <CardContent className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                    {filteredTenders.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No matching tenders found.</p>}
                    {filteredTenders.map((t) => (
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
                           <div className="bg-emerald-50/50 p-1.5 rounded-md border border-emerald-100 flex flex-1 flex-col sm:flex-row gap-2 items-center w-full">
                              <Select value={suggestForm[t._id] || ''} onValueChange={v => setSuggestForm({...suggestForm, [t._id]: v})}>
                                 <SelectTrigger className="h-8 bg-slate-50 border-emerald-200 text-xs font-semibold focus:ring-emerald-500 w-full">
                                    <SelectValue placeholder="Select Client to Suggest" />
                                 </SelectTrigger>
                                 <SelectContent>
                                    {approvedClients.map(c => {
                                       const safeId = c.client_id || (c.email ? `CLI-${c.email.substring(0,4).toUpperCase()}X` : 'CLI-XXXX');
                                       return <SelectItem key={c.email} value={c.email}>{safeId} ({c.company_name || c.name})</SelectItem>
                                    })}
                                 </SelectContent>
                              </Select>
                              <Button size="sm" onClick={() => handleSuggestTender(t._id, t.title, t.bid_no)} className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs w-full sm:w-auto shadow-sm shrink-0">
                                 <Send className="w-3 h-3 mr-1.5"/> Suggest to Client
                              </Button>
                           </div>
                        </div>
                      </div>
                    ))}
                 </CardContent>
               </Card>
            </div>

            {/* 🚀 NEW: Operator Storage & Client Sharing Block */}
            <Card className="shadow-sm border-t-4 border-t-purple-600 w-full mt-6">
               <CardHeader className="bg-purple-50/50 border-b pb-4">
                  <CardTitle className="text-purple-900 flex items-center gap-2"><FolderPlus className="w-5 h-5 text-purple-600"/> Operations Storage & Client Sharing</CardTitle>
                  <CardDescription>Upload blank proformas, GeM formats, or reference docs here and share directly to clients.</CardDescription>
               </CardHeader>
               <CardContent className="pt-4">
                  <div className="flex flex-col sm:flex-row gap-4 mb-6">
                     <label className="flex-1 border-2 border-dashed border-purple-300 bg-purple-50 rounded-lg flex flex-col items-center justify-center h-24 cursor-pointer hover:bg-purple-100 transition shadow-sm">
                        <UploadCloud className="w-6 h-6 text-purple-500 mb-1"/>
                        <span className="text-[10px] font-bold text-purple-700 uppercase">{uploadingOpPdf ? 'Uploading...' : 'Upload New Document to Storage'}</span>
                        <input type="file" accept="application/pdf" onChange={handleOperatorPdfUpload} disabled={uploadingOpPdf} className="hidden"/>
                     </label>
                  </div>
                  
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[300px] overflow-y-auto pr-2">
                     {operatorDocs.length === 0 ? (
                        <p className="text-xs text-slate-500 col-span-full text-center py-4">No documents stored yet.</p>
                     ) : (
                        operatorDocs.map(doc => (
                           <div key={doc._id} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm flex flex-col justify-between hover:border-purple-300 transition">
                              <div className="flex items-start justify-between mb-3">
                                 <div className="min-w-0 pr-2">
                                    <h4 className="text-sm font-bold text-[#0A2647] truncate" title={doc.name}>{doc.name}</h4>
                                    <p className="text-[9px] text-slate-400 mt-0.5">Uploaded: {new Date(doc.created_at).toLocaleDateString()}</p>
                                 </div>
                                 <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-blue-500 hover:bg-blue-50" onClick={() => {
                                     window.open(`/api/operator/docs/${doc._id}/file`, '_blank');
                                 }}><Eye className="w-3.5 h-3.5"/></Button>
                              </div>
                              <div className="border-t border-slate-100 pt-3 mt-auto">
                                 {sharingDocId === doc._id ? (
                                    <div className="flex flex-col gap-2">
                                       <Select value={targetClientEmail} onValueChange={setTargetClientEmail}>
                                          <SelectTrigger className="h-8 text-[10px] bg-slate-50"><SelectValue placeholder="Select Client"/></SelectTrigger>
                                          <SelectContent>
                                             {approvedClients.map(c => <SelectItem key={c.email} value={c.email}>{c.company_name} ({c.client_id})</SelectItem>)}
                                          </SelectContent>
                                       </Select>
                                       <div className="flex gap-2">
                                          <Button size="sm" onClick={() => handleShareDocWithClient(doc._id)} className="flex-1 bg-purple-600 hover:bg-purple-700 h-7 text-[10px]">Share</Button>
                                          <Button size="sm" variant="outline" onClick={() => setSharingDocId(null)} className="h-7 text-[10px] px-2 text-slate-500">Cancel</Button>
                                       </div>
                                    </div>
                                 ) : (
                                    <Button size="sm" variant="outline" onClick={() => setSharingDocId(doc._id)} className="w-full text-purple-600 border-purple-200 hover:bg-purple-50 h-8 text-xs"><Send className="w-3 h-3 mr-1"/> Share to Client</Button>
                                 )}
                              </div>
                           </div>
                        ))
                     )}
                  </div>
               </CardContent>
            </Card>
          </TabsContent>

          {/* 🚀 RESTORED: GUEST QUERIES AND SLA TRACKER */}
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
      </main>

      {/* MODALS */}
      <Dialog open={publishWinModalOpen} onOpenChange={setPublishWinModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700"><Trophy className="w-5 h-5"/> Publish Winning Bid</DialogTitle>
            <DialogDescription>
              Enter the final contract details to officially mark this bid as won and push it to the Client's Ledger.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePublishWin} className="space-y-4 pt-2">
            <div>
              <Label className="font-bold text-[#0A2647]">Total Contract Value (₹) *</Label>
              <Input type="text" required placeholder="e.g. ₹ 5,00,000" value={winForm.contract_value} onChange={e => setWinForm({...winForm, contract_value: e.target.value})} className="mt-1 font-bold"/>
            </div>
            <div>
              <Label className="font-bold text-[#0A2647]">Contract Validity / Due Date *</Label>
              <Input type="text" required placeholder="e.g. 1 Year (Dec 2027)" value={winForm.validity} onChange={e => setWinForm({...winForm, validity: e.target.value})} className="mt-1"/>
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setPublishWinModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={processingWin} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                 {processingWin ? 'Publishing...' : 'Confirm Win 🏆'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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

      {/* ========== AI DRAFT REVIEW & PUBLISH ========== */}
      <Dialog open={!!reviewDraft} onOpenChange={(val) => { if (!val && !publishingDraft) setReviewDraft(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto border-0 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-black text-[#0A2647] flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600"/> Review AI-Extracted Tender
            </DialogTitle>
            <DialogDescription>
              Verify every field against the source document before publishing. AI extraction can be wrong — you are the final check.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wide">Source document</p>
                <p className="text-sm font-semibold text-[#0A2647] truncate">{reviewDraft?.pdf_filename || 'draft.pdf'}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => reviewDraft && window.open(`/api/ai/drafts/${reviewDraft._id}/file`, '_blank')}
                className="shrink-0 border-blue-200 text-blue-700 hover:bg-blue-50"
              >
                <Eye className="w-4 h-4 mr-1.5"/> View PDF
              </Button>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Document Title (Work) *</Label>
                <Input value={draftForm.title} onChange={e => setDraftForm({ ...draftForm, title: e.target.value })} className="bg-white h-10"/>
              </div>
              <div>
                <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Bid Number *</Label>
                <Input value={draftForm.bid_no} onChange={e => setDraftForm({ ...draftForm, bid_no: e.target.value })} placeholder="e.g. GEM/2026/B/..." className="bg-white h-10"/>
              </div>
              <div>
                <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Department *</Label>
                <Input value={draftForm.department} onChange={e => setDraftForm({ ...draftForm, department: e.target.value })} className="bg-white h-10"/>
              </div>
              <div>
                <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Last Date *</Label>
                <Input type="date" value={draftForm.last_date} onChange={e => setDraftForm({ ...draftForm, last_date: e.target.value })} className="bg-white h-10 text-sm"/>
              </div>
              <div>
                <Label className="text-sm font-bold text-[#0A2647] mb-1 block">District</Label>
                <Select value={draftForm.district} onValueChange={val => setDraftForm({ ...draftForm, district: val })}>
                  <SelectTrigger className="bg-white h-10"><SelectValue placeholder="Select district"/></SelectTrigger>
                  <SelectContent className="max-h-[240px]">
                    {DISTRICTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Category</Label>
                <Select value={draftForm.category} onValueChange={val => setDraftForm({ ...draftForm, category: val })}>
                  <SelectTrigger className="bg-white h-10"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Product">Product</SelectItem>
                    <SelectItem value="Service">Service</SelectItem>
                    <SelectItem value="Works">Works</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-bold text-[#0A2647] mb-1 block">EMD Amount (₹)</Label>
                <Input value={draftForm.emd_amount} onChange={e => setDraftForm({ ...draftForm, emd_amount: e.target.value })} placeholder="e.g. 50000" className="bg-white h-10"/>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-sm font-bold text-[#0A2647] mb-1 block">Supply / Tender Details</Label>
                <Textarea value={draftForm.supply_details} onChange={e => setDraftForm({ ...draftForm, supply_details: e.target.value })} rows={3} placeholder="Any extra notes shown to clients..." className="bg-white text-sm"/>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-5 gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setReviewDraft(null)} disabled={publishingDraft}>Cancel</Button>
            <Button type="button" onClick={publishDraftToLive} disabled={publishingDraft} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
              {publishingDraft
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/> Publishing...</>
                : <><CheckCircle2 className="w-4 h-4 mr-2"/> Publish to Live</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lossModalOpen} onOpenChange={setLossModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600"><XCircle className="w-5 h-5"/> Process Lost Bid & Record L1</DialogTitle>
            <DialogDescription>Enter the winning L1 details. This bid will be removed from your tracking list and the intel will be saved.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleProcessLoss} className="space-y-4 pt-2">
            <div><Label className="font-bold text-[#0A2647]">L1 Winning Price (₹) *</Label><Input type="number" required placeholder="e.g. 450000" value={lossForm.l1_price} onChange={e => setLossForm({...lossForm, l1_price: e.target.value})} className="mt-1 font-bold"/></div>
            <div><Label className="font-bold text-[#0A2647]">L1 Winner Name (Optional)</Label><Input type="text" placeholder="e.g. XYZ Constructions" value={lossForm.l1_winner} onChange={e => setLossForm({...lossForm, l1_winner: e.target.value})} className="mt-1"/></div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setLossModalOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-red-600 hover:bg-red-700 text-white">Save L1 & Remove Bid</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <StationeryUploader
        client={stationeryClient}
        open={!!stationeryClient}
        onOpenChange={(open) => { if (!open) setStationeryClient(null); }}
      />

      <GeminiWorkspace
        tenderId={isEditingTender || null}
        tenderLabel={isEditingTender ? (tenderForm.title || tenderForm.bid_no || 'this tender') : null}
        clients={approvedClients}
        tenders={publicTenders}
      />
    </div>
  );
}
