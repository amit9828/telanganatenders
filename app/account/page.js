'use client';
import { useEffect, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Mail,
  CheckCircle2,
  FileText,
  IndianRupee,
  Calendar,
  Loader2,
  Percent,
  Upload,
  MessageSquare,
  Send,
  Clock
} from 'lucide-react';

function AccountPage() {
  const [isMounted, setIsMounted] = useState(false); // FIX 1: Prevents hydration crash
  const [email, setEmail] = useState('');
  const [tempEmail, setTempEmail] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // --- NEW PHASE 2 STATES ---
  const [tickets, setTickets] = useState([]);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketForm, setTicketForm] = useState({ department: 'Operations', subject: '', message: '' });
  
  const [profileForm, setProfileForm] = useState({ service_category: '', document_name: '', expiry_date: '', file_url: '' });
  const [profileLoading, setProfileLoading] = useState(false);

  // FIX 1: Safely load localStorage only after component mounts in the browser
  useEffect(() => {
    setIsMounted(true);
    const e = typeof window !== 'undefined' ? localStorage.getItem('tt_email') : '';
    if (e) setEmail(e);
  }, []);

  useEffect(() => {
    if (!email) return;
    setLoading(true);
    
    // Fetch User Data
    fetch(`/api/me?email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((d) => {
         setData(d);
         if(d.profile?.service_category) {
            setProfileForm(prev => ({ ...prev, service_category: d.profile.service_category }));
         }
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
      
    // Fetch Tickets
    fetchTickets();
  }, [email]);

  const fetchTickets = async () => {
    try {
       const r = await fetch(`/api/tickets?email=${encodeURIComponent(email)}`);
       const d = await r.json();
       setTickets(d.tickets || []);
    } catch(e) { console.error(e); }
  };

  const setMyEmail = (e) => {
    e.preventDefault();
    if (!tempEmail) return;
    localStorage.setItem('tt_email', tempEmail.toLowerCase());
    setEmail(tempEmail.toLowerCase());
  };

  const logout = () => {
    localStorage.removeItem('tt_email');
    setEmail('');
    setData(null);
  };

  // --- NEW PHASE 2 HANDLERS ---
  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setProfileLoading(true);
    try {
      const r = await fetch('/api/users/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ...profileForm })
      });
      if(r.ok) {
        toast.success('Profile updated successfully!');
        const res = await fetch(`/api/me?email=${encodeURIComponent(email)}`);
        const d = await res.json();
        setData(d);
        setProfileForm({ service_category: d.profile?.service_category || '', document_name: '', expiry_date: '', file_url: '' });
      } else {
        toast.error('Failed to update profile');
      }
    } catch(e) { toast.error('Error updating profile'); }
    setProfileLoading(false);
  };

  const handleRaiseTicket = async (e) => {
    e.preventDefault();
    if(!ticketForm.subject || !ticketForm.message) return toast.error('Please fill all fields');
    setTicketLoading(true);
    try {
      const r = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ...ticketForm })
      });
      if(r.ok) {
        toast.success('Ticket raised successfully! We will reply within 24 hours.');
        setTicketForm({ department: 'Operations', subject: '', message: '' });
        fetchTickets();
      } else {
        toast.error('Failed to raise ticket');
      }
    } catch(e) { toast.error('Error raising ticket'); }
    setTicketLoading(false);
  };

  // FIX 1: Do not render HTML until the client is fully mounted to prevent mismatch errors
  if (!isMounted) return null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b bg-white sticky top-0 z-30">
        <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <BrandLogo subtitle="My Account" />
          <div className="flex items-center gap-2">
            {email && (
              <Button variant="ghost" size="sm" onClick={logout}>
                Logout
              </Button>
            )}
            <a href="/">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-3 h-3 mr-1" /> Home
              </Button>
            </a>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {!email ? (
          <Card className="tender-shadow max-w-md mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[#0A2647]">
                <Mail className="w-5 h-5 text-[#16a34a]" /> Enter your email
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={setMyEmail} className="space-y-3">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={tempEmail}
                  onChange={(e) => setTempEmail(e.target.value)}
                  required
                />
                <Button type="submit" className="bg-[#0A2647] hover:bg-[#144272] w-full">
                  View My Account
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card className="tender-shadow">
              <CardContent className="p-6 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Signed in as</p>
                  <p className="text-lg font-bold text-[#0A2647]">{email}</p>
                </div>
                {data?.subscription ? (
                  <Badge className="bg-[#16a34a] hover:bg-[#15803d] text-base px-3 py-1">
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    {data.subscription.plan === 'year' ? 'Pro Annual' : 'Monthly'} active
                  </Badge>
                ) : (
                  <Badge variant="outline">No active subscription</Badge>
                )}
              </CardContent>
            </Card>

            {data?.subscription && (
              <Card className="tender-shadow bg-emerald-50 border-[#16a34a]">
                <CardContent className="p-6">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
                    <div className="flex items-center gap-3">
                      <Calendar className="w-8 h-8 text-[#16a34a]" />
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Your {data.subscription.plan === 'year' ? 'annual' : 'monthly'} pass
                        </p>
                        <p className="text-lg font-bold text-[#0A2647]">
                          Active until {new Date(data.subscription.expires_at).toDateString()}
                        </p>
                        {data.auto_renew && (
                          <p className="text-xs text-emerald-700 mt-1">
                            🔁 Auto-renews via Cashfree — cancel anytime
                          </p>
                        )}
                        {data.subscription_status === 'cancelled_pending' && (
                          <p className="text-xs text-amber-700 mt-1">
                            ⏳ Auto-renewal cancelled — premium ends at expiry
                          </p>
                        )}
                      </div>
                    </div>
                    {data.auto_renew && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          if (!confirm('Cancel auto-renewal? You keep premium until current expiry.')) return;
                          const r = await fetch('/api/subscription/cancel', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email }),
                          });
                          const d = await r.json();
                          if (r.ok) {
                            toast.success(d.message || 'Cancelled');
                            fetch(`/api/me?email=${encodeURIComponent(email)}`)
                              .then((r) => r.json())
                              .then((d) => setData(d));
                          } else {
                            toast.error(d.error || 'Failed');
                          }
                        }}
                      >
                        Cancel auto-renew
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* --- PHASE 2: PROFILE STRENGTH CARD --- */}
            <Card className="tender-shadow border-[#0A2647]/20">
              <CardHeader className="bg-slate-50 border-b pb-4">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
                    <Percent className="w-5 h-5 text-[#16a34a]" /> Profile Strength
                  </CardTitle>
                  <Badge className={data?.profile?.profile_score === 100 ? "bg-[#16a34a]" : "bg-amber-500"}>
                    {data?.profile?.profile_score || 20}% Complete
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={handleProfileUpdate} className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-semibold mb-1 block">Your Core Service/Product</label>
                      <select 
                        className="w-full border rounded-md p-2 text-sm bg-white"
                        value={profileForm.service_category}
                        onChange={(e) => setProfileForm({...profileForm, service_category: e.target.value})}
                        required
                      >
                        <option value="">Select Category</option>
                        <option value="IT & Electronics">IT & Electronics</option>
                        <option value="Medical & Healthcare">Medical & Healthcare</option>
                        <option value="Civil & Construction">Civil & Construction</option>
                        <option value="Manpower & Security">Manpower & Security</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-semibold mb-1 block">Upload Document (GST/MSME/ISO)</label>
                      <div className="flex gap-2">
                        <Input 
                          placeholder="Doc Name (e.g. GST)" 
                          className="w-1/2"
                          value={profileForm.document_name}
                          onChange={(e) => setProfileForm({...profileForm, document_name: e.target.value})}
                        />
                        <Input 
                          type="date" 
                          className="w-1/2" title="Expiry Date"
                          value={profileForm.expiry_date}
                          onChange={(e) => setProfileForm({...profileForm, expiry_date: e.target.value})}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">Upload to Drive & paste link here</p>
                      <Input 
                         placeholder="Google Drive Link" 
                         className="mt-1"
                         value={profileForm.file_url}
                         onChange={(e) => setProfileForm({...profileForm, file_url: e.target.value})}
                      />
                    </div>
                  </div>
                  <Button type="submit" disabled={profileLoading} className="w-full bg-[#0A2647] hover:bg-[#144272]">
                     {profileLoading ? 'Saving...' : 'Update Profile & Documents'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* --- PHASE 2: 24-HOUR SLA TICKETING CARD --- */}
            <Card className="tender-shadow">
              <CardHeader className="bg-slate-50 border-b pb-4">
                <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
                  <MessageSquare className="w-5 h-5 text-[#16a34a]" /> Support & Tickets (24-Hour SLA)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 grid md:grid-cols-2 gap-6">
                {/* Raise Ticket Form */}
                <div>
                  <h4 className="font-semibold text-sm mb-3">Raise a New Ticket</h4>
                  <form onSubmit={handleRaiseTicket} className="space-y-3">
                    <select 
                      className="w-full border rounded-md p-2 text-sm bg-white"
                      value={ticketForm.department}
                      onChange={(e) => setTicketForm({...ticketForm, department: e.target.value})}
                    >
                      <option value="Operations">Operations (Tender Queries)</option>
                      <option value="Accounts">Accounts (Billing/EMD)</option>
                      <option value="Technical">Technical Support</option>
                    </select>
                    <Input 
                      placeholder="Subject" 
                      value={ticketForm.subject}
                      onChange={(e) => setTicketForm({...ticketForm, subject: e.target.value})}
                      required
                    />
                    <textarea 
                      className="w-full border rounded-md p-2 text-sm h-24"
                      placeholder="Describe your issue..."
                      value={ticketForm.message}
                      onChange={(e) => setTicketForm({...ticketForm, message: e.target.value})}
                      required
                    ></textarea>
                    <Button type="submit" disabled={ticketLoading} className="w-full bg-[#16a34a] hover:bg-[#15803d]">
                      <Send className="w-4 h-4 mr-2"/> {ticketLoading ? 'Sending...' : 'Submit Ticket'}
                    </Button>
                  </form>
                </div>

                {/* Tickets List */}
                <div className="border-l pl-0 md:pl-6 max-h-[300px] overflow-y-auto">
                  <h4 className="font-semibold text-sm mb-3">Your Recent Tickets</h4>
                  {tickets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tickets raised yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {tickets.map(t => (
                        <div key={t._id} className="border rounded-md p-3 text-sm">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-semibold text-[#0A2647]">{t.subject}</span>
                            <Badge className={t.status === 'RESOLVED' ? 'bg-emerald-500' : 'bg-amber-500'}>{t.status}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                            <Clock className="w-3 h-3"/> 
                            {t.status === 'OPEN' ? `SLA: ${new Date(t.sla_deadline).toLocaleString()}` : `Resolved: ${new Date(t.replied_at).toLocaleDateString()}`}
                          </p>
                          {t.reply && (
                            <div className="bg-emerald-50 border border-emerald-100 p-2 rounded text-xs mt-2">
                              <span className="font-semibold text-emerald-800">Reply: </span>
                              {t.reply}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="tender-shadow">
              <CardHeader>
                <CardTitle className="text-[#0A2647] flex items-center gap-2">
                  Purchased PDFs ({data?.unlocked_tenders?.length || 0})
                  {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {/* FIX 2: Safe checking for empty or undefined arrays */}
                {(!data || !data.unlocked_tenders || data.unlocked_tenders.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No single PDF unlocks yet.
                  </p>
                )}
                {data?.unlocked_tenders?.map((t) => (
                  <div
                    key={t.id || t._id}
                    className="border rounded-md p-3 flex items-center justify-between hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[#0A2647] truncate">{t.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.department} · {t.district}
                      </p>
                    </div>
                    <a href={`/?open_tender=${t.id || t._id}`}>
                      <Button size="sm" className="bg-[#0A2647] hover:bg-[#144272]">
                        <FileText className="w-3 h-3 mr-1" /> Open
                      </Button>
                    </a>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="tender-shadow">
              <CardHeader>
                <CardTitle className="text-[#0A2647]">
                  Payment History ({data?.payments?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* FIX 2: Safe checking for empty or undefined arrays */}
                {(!data || !data.payments || data.payments.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No payments yet.
                  </p>
                )}
                {data?.payments?.length > 0 && (
                  <div className="space-y-1 text-sm">
                    <div className="grid grid-cols-4 font-semibold text-[#0A2647] border-b pb-2">
                      <span>Date</span>
                      <span>Plan</span>
                      <span>Amount</span>
                      <span>Expires</span>
                    </div>
                    {data.payments.map((p, i) => (
                      <div key={i} className="grid grid-cols-4 py-2 border-b last:border-0">
                        <span>{p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '-'}</span>
                        <span className="capitalize font-medium">{p.plan}</span>
                        <span className="flex items-center">
                          <IndianRupee className="w-3 h-3" /> {p.amount}
                        </span>
                        <span>
                          {p.expires_at
                            ? new Date(p.expires_at).toLocaleDateString()
                            : 'One-time'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

export default AccountPage;
