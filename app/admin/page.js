'use client';
import { useEffect, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  ShieldCheck,
  LogOut,
  Upload,
  FileText,
  Users,
  IndianRupee,
  Trash2,
  Plus,
  Image as ImageIcon,
  Lock,
} from 'lucide-react';

const DISTRICTS = [
  'Hyderabad',
  'Adilabad',
  'Nizamabad',
  'Karimnagar',
  'Medak',
  'Ranga Reddy',
  'Mahabubnagar',
  'Nalgonda',
  'Warangal',
  'Khammam',
];

function AdminPage() {
  const [token, setToken] = useState('');
  const [authChecking, setAuthChecking] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPwd, setLoginPwd] = useState('');
  const [loading, setLoading] = useState(false);

  const [tenders, setTenders] = useState([]);
  const [stats, setStats] = useState({ tenders: 0, users: 0, payments: 0, revenue: 0 });

  const [form, setForm] = useState({
    title: '',
    department: '',
    last_date: '',
    district: '',
    supply_details: '',
  });
  const [pdfBase64, setPdfBase64] = useState('');
  const [pdfName, setPdfName] = useState('');

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('tt_admin') : '';
    if (t) setToken(t);
    setAuthChecking(false);
  }, []);

  useEffect(() => {
    if (token) {
      refresh();
    }
    // eslint-disable-next-line
  }, [token]);

  const refresh = async () => {
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [tRes, sRes] = await Promise.all([
        fetch('/api/tenders', { headers }),
        fetch('/api/admin/stats', { headers }),
      ]);
      if (tRes.status === 401) {
        localStorage.removeItem('tt_admin');
        setToken('');
        return;
      }
      const tJson = await tRes.json();
      const sJson = await sRes.json();
      setTenders(tJson.tenders || []);
      setStats(sJson || {});
    } catch (err) {
      console.error('Refresh failed:', err);
    }
  };

  const login = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPwd }),
      });
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.error || 'Login failed');
        return;
      }
      localStorage.setItem('tt_admin', d.token);
      setToken(d.token);
      toast.success('Welcome back, Admin.');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('tt_admin');
    setToken('');
  };

  const onPdfChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      toast.error('Please upload a PDF file');
      return;
    }
    // Vercel లిమిట్ దాటకుండా 4MB లోపే ఉండేలా చూసుకునే చెక్
    if (file.size > 4 * 1024 * 1024) {
      toast.error('PDF file is too large! Please upload under 4MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result?.toString() || '';
      const b64 = result.split(',')[1] || '';
      setPdfBase64(b64);
      setPdfName(file.name);
      toast.success(`PDF loaded: ${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  const publish = async (e) => {
    e.preventDefault();
    if (!form.title || !form.department || !form.last_date || !form.district) {
      toast.error('Fill all required fields');
      return;
    }
    setLoading(true);
    try {
      // POSTing to /api/tenders which is handled by your updated route.js
      const r = await fetch('/api/tenders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...form,
          pdf_base64: pdfBase64,
          pdf_filename: pdfName || 'tender.pdf',
        }),
      });
      
      const d = await r.json().catch(() => ({}));
      
      if (!r.ok) {
        toast.error(d.error || `Server Error (${r.status}) - Try smaller PDF`);
        return;
      }
      
      toast.success(
        `Tender published! ${d.notified || ''} user(s) notified by email.`
      );
      setForm({
        title: '',
        department: '',
        last_date: '',
        district: '',
        supply_details: '',
      });
      setPdfBase64('');
      setPdfName('');
      refresh();
    } catch (err) {
      toast.error('Network Error: File might be too large for server limit.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this tender?')) return;
    await fetch(`/api/tenders/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    toast.success('Deleted');
    refresh();
  };

  if (authChecking) return <div className="p-10 text-center">Loading...</div>;

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
        <Card className="w-full max-w-md tender-shadow-lg">
          <CardHeader>
            <div className="w-12 h-12 navy-gradient rounded-lg flex items-center justify-center mb-2">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <CardTitle className="text-2xl text-[#0A2647]">
              Admin Login
            </CardTitle>
            <CardDescription>
              Secure access for the portal administrator only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={login} className="space-y-3">
              <div>
                <Label>Admin email</Label>
                <Input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Password</Label>
                <Input
                  type="password"
                  value={loginPwd}
                  onChange={(e) => setLoginPwd(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-[#0A2647] hover:bg-[#144272]"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </Button>
              <p className="text-xs text-muted-foreground text-center pt-1">
                Default: admin@telanganatenders.in / Admin@123
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b">
        <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <BrandLogo subtitle="Admin Dashboard" />
          <div className="flex items-center gap-1.5">
            <a href="/">
              <Button variant="outline" size="sm" className="text-xs sm:text-sm">
                View Site
              </Button>
            </a>
            <Button variant="ghost" size="sm" onClick={logout} className="text-xs sm:text-sm">
              <LogOut className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          <StatCard
            icon={<FileText className="w-4 h-4" />}
            label="Tenders"
            value={stats.tenders || 0}
          />
          <StatCard
            icon={<Users className="w-4 h-4" />}
            label="Registered Users"
            value={stats.users || 0}
          />
          <StatCard
            icon={<IndianRupee className="w-4 h-4" />}
            label="Payments"
            value={stats.payments || 0}
          />
          <StatCard
            icon={<IndianRupee className="w-4 h-4" />}
            label="Revenue"
            value={`₹${stats.revenue || 0}`}
            accent
          />
        </div>

        {/* Brand & Security Settings */}
        <BrandSettings token={token} />

        <div className="grid lg:grid-cols-5 gap-4 sm:gap-6">
          {/* Publish form */}
          <Card className="lg:col-span-2 tender-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[#0A2647]">
                <Plus className="w-4 h-4" /> Publish New Tender
              </CardTitle>
              <CardDescription>
                Uploaded PDF is unlocked only for paid users — each PDF is auto-watermarked with the buyer's email. All registered users will receive an email alert on publish.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={publish} className="space-y-3">
                <div>
                  <Label>Document Title (Work) *</Label>
                  <Input
                    value={form.title}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                    placeholder="Construction of new road from..."
                    required
                  />
                </div>
                <div>
                  <Label>Department Name *</Label>
                  <Input
                    value={form.department}
                    onChange={(e) =>
                      setForm({ ...form, department: e.target.value })
                    }
                    placeholder="Roads & Buildings Dept"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Last Date *</Label>
                    <Input
                      type="date"
                      value={form.last_date}
                      onChange={(e) =>
                        setForm({ ...form, last_date: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div>
                    <Label>District *</Label>
                    <Select
                      value={form.district}
                      onValueChange={(v) =>
                        setForm({ ...form, district: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {DISTRICTS.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Supply / Tender Details</Label>
                  <Textarea
                    rows={3}
                    value={form.supply_details}
                    onChange={(e) =>
                      setForm({ ...form, supply_details: e.target.value })
                    }
                    placeholder="Brief description of supply items, scope, EMD, etc."
                  />
                </div>
                <div>
                  <Label>PDF Document (Keep under 4 MB)</Label>
                  <div className="border-2 border-dashed rounded-md p-4 text-center bg-slate-50">
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={onPdfChange}
                      className="hidden"
                      id="pdf-input"
                    />
                    <label
                      htmlFor="pdf-input"
                      className="cursor-pointer flex flex-col items-center"
                    >
                      <Upload className="w-6 h-6 text-[#16a34a] mb-1" />
                      <span className="text-sm font-medium text-[#0A2647]">
                        {pdfName || 'Click to upload PDF'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Stored securely. Locked behind paywall.
                      </span>
                    </label>
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#16a34a] hover:bg-[#15803d]"
                >
                  {loading ? 'Publishing...' : 'Publish Tender & Notify Users'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Tender list */}
          <Card className="lg:col-span-3 tender-shadow">
            <CardHeader>
              <CardTitle className="text-[#0A2647]">
                Published Tenders ({tenders.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[70vh] overflow-y-auto">
              {tenders.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No tenders yet. Publish your first one!
                </p>
              )}
              {tenders.map((t) => (
                <div
                  key={t._id || t.id}
                  className="border rounded-md p-3 flex items-start justify-between gap-3 hover:bg-slate-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        className={
                          t.district === 'Hyderabad'
                            ? 'bg-[#16a34a]'
                            : 'bg-[#0A2647]'
                        }
                      >
                        {t.district}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Last:{' '}
                        {new Date(t.last_date).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="font-semibold text-[#0A2647] truncate">
                      {t.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.department}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(t._id || t.id)}
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, accent }) {
  return (
    <Card className={accent ? 'border-[#16a34a] bg-emerald-50' : ''}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-[10px] sm:text-xs mb-1">
          {icon} {label}
        </div>
        <div className="text-xl sm:text-2xl font-bold text-[#0A2647]">{value}</div>
      </CardContent>
    </Card>
  );
}

function BrandSettings({ token }) {
  const [logoPreview, setLogoPreview] = useState('');
  const [brandName, setBrandName] = useState('Telangana Tenders');
  const [tagline, setTagline] = useState('Official Government Tender Portal');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) {
          if (d.settings.logo) setLogoPreview(d.settings.logo);
          if (d.settings.name) setBrandName(d.settings.name);
          if (d.settings.tagline) setTagline(d.settings.tagline);
        }
      })
      .catch((err) => console.error(err));
  }, []);

  const onLogoChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      toast.error('Please upload an image file (PNG/JPG/WebP/SVG)');
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      toast.error('Logo too large. Keep under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result?.toString() || '';
      setLogoPreview(result); 
    };
    reader.readAsDataURL(f);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { 
        name: brandName, 
        tagline: tagline,
        logo: logoPreview 
      };
      
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      
      if (!r.ok) {
        toast.error('Failed to save');
        return;
      }
      toast.success('Brand settings saved. Refresh the home page to see the new logo.');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('An error occurred while saving.');
    } finally {
      setSaving(false);
    }
  };

  const removeLogo = async () => {
    if (!confirm('Remove uploaded logo?')) return;
    await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: brandName, tagline: tagline, logo: null }),
    });
    setLogoPreview('');
    toast.success('Logo removed');
  };

  return (
    <Card className="tender-shadow">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-[#0A2647] text-base">
          <ImageIcon className="w-4 h-4" /> Brand Identity & Security
        </CardTitle>
        <CardDescription className="text-xs">
          Upload your logo (shown across the site) and set the brand name.
          Every paid PDF is automatically watermarked with the buyer's email.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-3 gap-4 items-start">
          <div className="flex flex-col items-center gap-3">
            <div className="w-24 h-24 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden flex items-center justify-center">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="logo" className="w-full h-full object-contain" />
              ) : (
                <ImageIcon className="w-8 h-8 text-slate-300" />
              )}
            </div>
            <div className="flex gap-2">
              <label className="cursor-pointer">
                <input type="file" accept="image/*" onChange={onLogoChange} className="hidden" />
                <span className="inline-flex items-center text-xs px-3 py-1.5 bg-[#0A2647] text-white rounded-md">
                  <Upload className="w-3 h-3 mr-1" /> Upload
                </span>
              </label>
              {logoPreview && (
                <button
                  onClick={removeLogo}
                  className="inline-flex items-center text-xs px-3 py-1.5 bg-white border rounded-md text-red-500"
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Remove
                </button>
              )}
            </div>
          </div>
          <div className="sm:col-span-2 space-y-3">
            <div>
              <Label>Brand Name</Label>
              <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} />
            </div>
            <div>
              <Label>Tagline</Label>
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={save}
                disabled={saving}
                className="bg-[#16a34a] hover:bg-[#15803d]"
              >
                {saving ? 'Saving...' : 'Save Brand Settings'}
              </Button>
              <span className="text-xs text-emerald-700 inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> PDF watermarking is ON for all paid downloads
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default AdminPage;
