'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { workflowFetch, staffHeaders, openStaffChatFile } from '@/components/workflow/api';
import { useIsMobile } from '@/hooks/use-mobile';
import { Check, CheckCheck, Download, Menu, MessageSquare, Paperclip, Pencil, Search, Send, Trash2, Forward } from 'lucide-react';

const MD_PEER = { emp_id: 'MD', name: 'Managing Director', designation: 'MD' };
const CHAT_MAX_BYTES = 4 * 1024 * 1024;

function contactId(row) {
  return String(row?.emp_id || '').trim();
}

function isActiveEmployee(row) {
  if (!row) return false;
  if (row.deleted === true || row.active === false) return false;
  return Boolean(String(row.emp_id || '').trim());
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

function formatWhen(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatPreviewTime(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const now = new Date();
  const sameDay = dt.toDateString() === now.toDateString();
  return sameDay
    ? dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function threadCacheKey(peer, jobId) {
  return jobId ? `job::${jobId}` : `peer::${peer}`;
}

function ChatImage({ id, alt }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let dead = false;
    let url = '';
    fetch(`/api/staff-chat/file?id=${encodeURIComponent(id)}`, {
      credentials: 'include',
      headers: staffHeaders(),
    }).then(async (res) => {
      if (!res.ok) throw new Error('preview');
      const blob = await res.blob();
      url = URL.createObjectURL(blob);
      if (!dead) setSrc(url);
    }).catch(() => {});
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  if (!src) return <p className="text-[11px] opacity-80">Loading image…</p>;
  return <img src={src} alt={alt || 'Image'} className="mt-1 max-h-52 rounded-lg object-cover w-full" />;
}

function ContactList({ contacts, peer, query, onQuery, onSelect }) {
  const filtered = contacts.filter((c) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [c.name, c.emp_id, c.designation, c.preview].some((v) => String(v || '').toLowerCase().includes(needle));
  });

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <div className="p-3 border-b">
        <p className="text-sm font-bold text-[#0A2647] mb-2">Chats</p>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search people"
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        {filtered.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-8 px-3">No teammates found.</p>
        )}
        {filtered.map((c) => {
          const active = peer === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-slate-50 transition ${
                active ? 'bg-sky-50' : 'hover:bg-slate-50'
              }`}
            >
              <div className="relative shrink-0">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-[#0A2647] text-white text-[11px] font-bold">{c.initials}</AvatarFallback>
                </Avatar>
                {c.online && <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-sm truncate ${c.unread ? 'font-black text-[#0A2647]' : 'font-semibold text-slate-800'}`}>{c.name}</p>
                  <span className="text-[10px] text-slate-400 shrink-0">{c.previewAt}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p className="text-[11px] text-slate-500 truncate">{c.preview || c.designation || c.emp_id}</p>
                  {c.unread > 0 && (
                    <Badge className="h-5 min-w-5 px-1.5 bg-red-600 hover:bg-red-600 text-white border-0 text-[10px] justify-center">
                      {c.unread > 9 ? '9+' : c.unread}
                    </Badge>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </ScrollArea>
    </div>
  );
}

export default function StaffChat({ selfId, roster = [], teammates, jobId = null }) {
  const [directory, setDirectory] = useState([]);
  const people = directory.length ? directory : (teammates || roster);
  const isMobile = useIsMobile();
  const compact = Boolean(jobId);
  const [me, setMe] = useState(selfId);
  const [peer, setPeer] = useState('');
  const [messages, setMessages] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reads, setReads] = useState({});
  const [presence, setPresence] = useState({});
  const [peerReadAt, setPeerReadAt] = useState(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [forwardMsg, setForwardMsg] = useState(null);
  const cacheRef = useRef(new Map());
  const endRef = useRef(null);
  const typingTimer = useRef(null);

  useEffect(() => {
    setMe(selfId);
  }, [selfId]);

  useEffect(() => {
    let cancelled = false;
    workflowFetch('/api/staff-chat/roster')
      .then((data) => {
        if (cancelled) return;
        if (data.me) setMe(data.me);
        setDirectory(Array.isArray(data.team) ? data.team : []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const list = useMemo(() => {
    const seenRow = new Set();
    const seenEmp = new Set();
    const out = [];
    const add = (row) => {
      const emp = contactId(row);
      const rowKey = String(row?._id || emp);
      if (!emp || emp === me || seenRow.has(rowKey) || seenEmp.has(emp)) return;
      seenRow.add(rowKey);
      seenEmp.add(emp);
      out.push(row);
    };
    if (me !== 'MD') add(MD_PEER);
    (people || []).filter(isActiveEmployee).forEach(add);
    return out;
  }, [people, me]);

  const contacts = useMemo(() => {
    const meta = new Map();
    for (const msg of inbox) {
      const other = msg.from_emp_id === me ? msg.to_emp_id : msg.from_emp_id;
      if (!other || other === me) continue;
      const prev = meta.get(other) || { last: null, unread: 0 };
      const ts = new Date(msg.created_at).getTime();
      const lastTs = prev.last ? new Date(prev.last.created_at).getTime() : 0;
      if (ts >= lastTs) prev.last = msg;
      const readAt = reads[other] ? new Date(reads[other]).getTime() : 0;
      if (msg.from_emp_id === other && msg.to_emp_id === me && ts > readAt) {
        prev.unread += 1;
      }
      meta.set(other, prev);
    }

    const rows = list.map((row) => {
      const id = contactId(row);
      const info = meta.get(id) || { last: null, unread: 0 };
      const last = info.last;
      const live = presence[id];
      return {
        id,
        emp_id: row.emp_id,
        name: row.name || id,
        designation: row.designation || '',
        initials: initials(row.name || id),
        preview: last ? (last.text || last.file_name || 'Attachment') : '',
        previewAt: last ? formatPreviewTime(last.created_at) : '',
        recency: last ? new Date(last.created_at).getTime() : 0,
        unread: peer === id ? 0 : info.unread,
        online: Boolean(live?.online),
      };
    });

    rows.sort((a, b) => {
      if (Boolean(b.unread) !== Boolean(a.unread)) return b.unread ? 1 : -1;
      if (b.recency !== a.recency) return b.recency - a.recency;
      return a.name.localeCompare(b.name);
    });
    return rows;
  }, [list, inbox, reads, me, peer, presence]);

  const active = contacts.find((c) => c.id === peer) || list.find((r) => contactId(r) === peer);

  const loadThread = useCallback(async (p, { silent = false } = {}) => {
    const target = p || peer;
    if (!target) return;
    try {
      const qs = new URLSearchParams();
      qs.set('peer', target);
      if (jobId) qs.set('job_id', jobId);
      const data = await workflowFetch(`/api/staff-chat?${qs.toString()}`);
      if (data.me) setMe(data.me);
      const next = (data.messages || []).filter((m) =>
        (m.from_emp_id === (data.me || me) && m.to_emp_id === target)
        || (m.from_emp_id === target && m.to_emp_id === (data.me || me))
      );
      cacheRef.current.set(threadCacheKey(target, jobId), next);
      setMessages(next);
      setPeerReadAt(data.peer_read_at || null);
      setPeerTyping(Boolean(data.peer_typing));
      if (data.presence) setPresence((prev) => ({ ...prev, ...data.presence }));
    } catch (e) {
      if (!silent) toast.error(e.message);
    }
  }, [peer, jobId, me]);

  const loadInbox = useCallback(async () => {
    try {
      const data = await workflowFetch('/api/staff-chat');
      if (data.me) setMe(data.me);
      setInbox(data.messages || []);
      if (data.reads) setReads(data.reads);
      if (data.presence) setPresence((prev) => ({ ...prev, ...data.presence }));
    } catch {
      /* inbox poll is best-effort */
    }
  }, []);

  const markRead = useCallback(async (id) => {
    if (!id) return;
    try {
      await workflowFetch('/api/staff-chat', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: id }),
      });
      setReads((prev) => ({ ...prev, [id]: new Date().toISOString() }));
    } catch {
      /* ignore */
    }
  }, []);

  const selectPeer = (id) => {
    setPeer(id);
    setSheetOpen(false);
    markRead(id);
    const cached = cacheRef.current.get(threadCacheKey(id, jobId));
    if (cached) setMessages(cached);
    loadThread(id, { silent: true });
  };

  useEffect(() => {
    loadInbox();
    if (peer) loadThread(peer, { silent: true });
  }, [loadInbox, loadThread, peer]);

  useEffect(() => {
    const id = setInterval(() => {
      loadInbox();
      if (peer) {
        loadThread(peer, { silent: true });
        markRead(peer);
      }
    }, 8000);
    return () => clearInterval(id);
  }, [loadInbox, loadThread, peer, markRead]);

  useEffect(() => {
    if (!peer || typeof EventSource === 'undefined') return undefined;
    const es = new EventSource(`/api/staff-chat/stream?peer=${encodeURIComponent(peer)}`, { withCredentials: true });
    const onState = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.me) setMe(data.me);
        if (data.peer_read_at) setPeerReadAt(data.peer_read_at);
        setPeerTyping(Boolean(data.peer_typing));
        if (data.presence) setPresence((prev) => ({ ...prev, ...data.presence }));
        if (data.changed) loadThread(peer, { silent: true });
      } catch {
        /* ignore */
      }
    };
    es.addEventListener('state', onState);
    es.onerror = () => {};
    return () => {
      es.removeEventListener('state', onState);
      es.close();
    };
  }, [peer, loadThread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, peer]);

  const notifyTyping = (on) => {
    if (!peer) return;
    workflowFetch('/api/staff-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_emp_id: peer, typing: on }),
    }).catch(() => {});
  };

  const send = async () => {
    if (!peer) return toast.error('Pick a teammate.');
    if (editingId) {
      if (!text.trim()) return;
      setBusy(true);
      try {
        await workflowFetch('/api/staff-chat', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingId, text: text.trim() }),
        });
        setText('');
        setEditingId('');
        await loadThread(peer, { silent: true });
      } catch (e) {
        toast.error(e.message);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!text && !file) return;
    if (file && file.size > CHAT_MAX_BYTES) {
      return toast.error('File must be 4 MB or smaller.');
    }
    setBusy(true);
    try {
      let fileId = '';
      if (file) {
        const assetForm = new FormData();
        assetForm.append('file', file);
        assetForm.append('to_emp_id', peer);
        const res = await fetch('/api/staff-chat/asset', {
          method: 'POST',
          credentials: 'include',
          headers: staffHeaders(),
          body: assetForm,
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `Upload failed (${res.status})`);
        fileId = payload.file_id || '';
        if (!fileId) throw new Error('Upload did not return a file id.');
      }
      await workflowFetch('/api/staff-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_emp_id: peer,
          text,
          ...(fileId ? { file_id: fileId } : {}),
          ...(jobId ? { job_id: jobId } : {}),
        }),
      });
      setText('');
      setFile(null);
      notifyTyping(false);
      await markRead(peer);
      await Promise.all([loadThread(peer, { silent: true }), loadInbox()]);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeMessage = async (id) => {
    try {
      await workflowFetch(`/api/staff-chat?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadThread(peer, { silent: true });
    } catch (e) {
      toast.error(e.message);
    }
  };

  const forwardTo = async (toId) => {
    if (!forwardMsg || !toId) return;
    try {
      await workflowFetch('/api/staff-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_emp_id: toId,
          forwarded_from_id: String(forwardMsg._id),
          ...(jobId ? { job_id: jobId } : {}),
        }),
      });
      toast.success('Forwarded.');
      setForwardMsg(null);
      selectPeer(toId);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const paneClass = compact
    ? 'h-[420px]'
    : 'h-[min(70vh,720px)] min-h-[520px] w-full overflow-hidden';

  const sidebar = (
    <ContactList
      contacts={contacts}
      peer={peer}
      query={query}
      onQuery={setQuery}
      onSelect={selectPeer}
    />
  );

  const peerLive = presence[peer];
  const statusLine = jobId
    ? 'Tender thread · 7-day history'
    : peerTyping
      ? 'typing…'
      : peerLive?.online
        ? 'Online'
        : peerLive?.last_seen_at
          ? `Last seen ${formatWhen(peerLive.last_seen_at)}`
          : (active?.designation || active?.emp_id || 'Staff');

  return (
    <div className={`w-full ${paneClass} rounded-xl border border-slate-200 bg-[#efeae2] overflow-hidden flex shadow-sm`}>
      <aside className="hidden md:flex w-[280px] shrink-0 flex-col border-r border-slate-200 bg-white">
        {sidebar}
      </aside>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" className="p-0 w-[85vw] max-w-sm">
          <SheetHeader className="sr-only">
            <SheetTitle>Chats</SheetTitle>
          </SheetHeader>
          {sidebar}
        </SheetContent>
      </Sheet>

      <section className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 px-3 bg-[#0A2647] text-white flex items-center gap-2 shrink-0">
          {isMobile && (
            <Button type="button" size="icon" variant="ghost" className="text-white hover:bg-white/10 h-8 w-8" onClick={() => setSheetOpen(true)}>
              <Menu className="w-4 h-4" />
            </Button>
          )}
          {peer && active ? (
            <>
              <div className="relative">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-white/15 text-white text-[10px] font-bold">{initials(active.name)}</AvatarFallback>
                </Avatar>
                {peerLive?.online && <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-[#0A2647]" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{active.name}</p>
                <p className="text-[10px] text-white/70 truncate">{statusLine}</p>
              </div>
            </>
          ) : (
            <p className="text-sm font-semibold">{jobId ? 'Tender thread' : 'Staff chat'}</p>
          )}
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
          {!peer ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="w-14 h-14 rounded-full bg-white/80 flex items-center justify-center mb-3">
                <MessageSquare className="w-6 h-6 text-[#0A2647]" />
              </div>
              <p className="font-bold text-[#0A2647]">Select a conversation</p>
              <p className="text-xs text-slate-600 mt-1">Pick a teammate from the list{isMobile ? ' (Chats button)' : ' on the left'} to open their 7-day thread.</p>
              {isMobile && (
                <Button className="mt-4 bg-[#0A2647]" size="sm" onClick={() => setSheetOpen(true)}>Open chats</Button>
              )}
            </div>
          ) : (
            <>
              {messages.map((m) => {
                const mine = m.from_emp_id === me;
                const read = mine && peerReadAt && new Date(peerReadAt).getTime() >= new Date(m.created_at).getTime();
                return (
                  <div key={m._id} className={`mb-2 flex ${mine ? 'justify-end' : 'justify-start'} group`}>
                    <div className={`max-w-[78%] rounded-2xl px-3 py-1.5 shadow-sm text-sm ${
                      mine ? 'bg-[#0A2647] text-white rounded-br-sm' : 'bg-white text-slate-800 rounded-bl-sm'
                    }`}>
                      {!mine && (
                        <span className="block text-[9px] font-bold mb-0.5 text-sky-700">
                          {m.from_name || m.from_emp_id}
                        </span>
                      )}
                      {m.forwarded_from && (
                        <p className={`text-[10px] italic mb-1 ${mine ? 'text-white/70' : 'text-slate-500'}`}>
                          Forwarded from {m.forwarded_from.from_name || m.forwarded_from.from_emp_id}
                        </p>
                      )}
                      {m.text ? <p className="whitespace-pre-wrap break-words">{m.text}</p> : null}
                      {m.has_file && m.is_image && <ChatImage id={m._id} alt={m.file_name} />}
                      {m.has_file && (
                        <div className="flex flex-wrap gap-2 mt-1">
                          <button
                            type="button"
                            onClick={() => openStaffChatFile(m._id).catch((e) => toast.error(e.message))}
                            className={`text-[10px] underline ${mine ? 'text-sky-200' : 'text-blue-600'}`}
                          >
                            {m.file_name || 'Open'}
                          </button>
                          <button
                            type="button"
                            onClick={() => openStaffChatFile(m._id, { download: true, fileName: m.file_name }).catch((e) => toast.error(e.message))}
                            className={`text-[10px] underline inline-flex items-center gap-0.5 ${mine ? 'text-sky-200' : 'text-blue-600'}`}
                          >
                            <Download className="w-3 h-3" /> Download
                          </button>
                        </div>
                      )}
                      <span className={`flex items-center gap-1 text-[9px] mt-1 ${mine ? 'text-white/60' : 'text-slate-400'}`}>
                        {formatWhen(m.created_at)}{m.edited_at ? ' · edited' : ''}
                        {mine && (read
                          ? <CheckCheck className="w-3 h-3 text-sky-300" />
                          : <Check className="w-3 h-3" />)}
                      </span>
                      <div className={`flex gap-1 mt-1 ${mine ? 'justify-end' : 'justify-start'} opacity-0 group-hover:opacity-100`}>
                        {mine && (
                          <button type="button" className="text-[9px] underline" onClick={() => { setEditingId(m._id); setText(m.text || ''); }}>
                            <Pencil className="w-3 h-3 inline mr-0.5" />Edit
                          </button>
                        )}
                        <button type="button" className="text-[9px] underline" onClick={() => setForwardMsg(m)}>
                          <Forward className="w-3 h-3 inline mr-0.5" />Forward
                        </button>
                        {mine && (
                          <button type="button" className="text-[9px] underline" onClick={() => removeMessage(m._id)}>
                            <Trash2 className="w-3 h-3 inline mr-0.5" />Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </>
          )}
        </div>

        <footer className="p-2 bg-[#f0f2f5] border-t border-slate-200 shrink-0">
          {forwardMsg && (
            <div className="mb-2 bg-white border rounded-lg p-2">
              <p className="text-[10px] font-bold text-[#0A2647] mb-1">Forward to</p>
              <div className="flex flex-wrap gap-1">
                {list.filter((row) => contactId(row) !== me).map((row) => (
                  <Button key={contactId(row)} size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => forwardTo(contactId(row))}>
                    {row.name || contactId(row)}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setForwardMsg(null)}>Cancel</Button>
              </div>
            </div>
          )}
          {editingId && (
            <p className="text-[10px] text-[#0A2647] font-semibold mb-1 px-1">
              Editing message <button type="button" className="underline ml-2" onClick={() => { setEditingId(''); setText(''); }}>cancel</button>
            </p>
          )}
          <div className="flex items-center gap-2">
            <label className="h-9 w-9 shrink-0 rounded-full bg-white border flex items-center justify-center cursor-pointer text-slate-500 hover:text-[#0A2647]">
              <Paperclip className="w-4 h-4" />
              <input
                type="file"
                className="sr-only"
                accept="image/*,.pdf,application/pdf"
                onChange={(e) => {
                  const picked = e.target.files?.[0] || null;
                  e.target.value = '';
                  if (picked && picked.size > CHAT_MAX_BYTES) {
                    toast.error('File must be 4 MB or smaller.');
                    return;
                  }
                  setFile(picked);
                }}
              />
            </label>
            <Input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (!peer) return;
                notifyTyping(true);
                clearTimeout(typingTimer.current);
                typingTimer.current = setTimeout(() => notifyTyping(false), 1500);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={!peer}
              placeholder={peer ? (file ? `File: ${file.name}` : 'Type a message') : 'Select a contact first'}
              className="h-9 bg-white rounded-full"
            />
            <Button type="button" size="icon" className="h-9 w-9 rounded-full bg-[#0A2647] hover:bg-[#144272]" onClick={send} disabled={busy || !peer}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
