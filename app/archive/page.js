'use client';
import { useEffect, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  FileText,
  MapPin,
  Building2,
  Clock,
  ArrowLeft,
  Eye,
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

function ArchivePage() {
  const [tenders, setTenders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [district, setDistrict] = useState('all');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ scope: 'all' });
      if (q.trim()) params.set('q', q.trim());
      if (district !== 'all') params.set('district', district);
      const r = await fetch(`/api/tenders?${params.toString()}`);
      const d = await r.json();
      setTenders(d.tenders || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line
  }, [q, district]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b bg-white sticky top-0 z-30">
        <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <BrandLogo subtitle="Tender Archive" />
          <a href="/">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-3 h-3 mr-1" /> Home
            </Button>
          </a>
        </div>
      </header>

      <section className="navy-gradient text-white">
        <div className="container mx-auto px-3 sm:px-4 py-8 sm:py-10">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold mb-2">
            Tender Archive
          </h2>
          <p className="text-slate-200 max-w-xl text-sm sm:text-base">
            Search and browse every published tender. Use keywords like work
            type, department or item.
          </p>
          <div className="mt-5 flex gap-2 max-w-2xl bg-white rounded-lg p-1 tender-shadow-lg">
            <div className="flex-1 flex items-center px-3 gap-2 min-w-0">
              <Search className="w-4 h-4 text-[#0A2647] shrink-0" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search across all tenders..."
                className="flex-1 min-w-0 py-2 text-sm text-[#0A2647] outline-none bg-transparent"
              />
            </div>
          </div>
        </div>
      </section>

      <main className="container mx-auto px-3 sm:px-4 py-6 space-y-4">
        <div className="flex flex-nowrap sm:flex-wrap gap-2 overflow-x-auto pb-1 -mx-2 px-2 sm:overflow-visible sm:mx-0 sm:px-0">
          <button
            onClick={() => setDistrict('all')}
            className={`shrink-0 px-3 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium border ${
              district === 'all'
                ? 'bg-[#0A2647] text-white border-[#0A2647]'
                : 'bg-white text-[#0A2647] border-slate-200'
            }`}
          >
            All Districts
          </button>
          {DISTRICTS.map((d) => (
            <button
              key={d}
              onClick={() => setDistrict(d)}
              className={`shrink-0 px-3 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium border ${
                district === d
                  ? 'bg-[#0A2647] text-white border-[#0A2647]'
                  : d === 'Hyderabad'
                  ? 'bg-emerald-50 text-[#15803d] border-[#16a34a]'
                  : 'bg-white text-slate-700 border-slate-200'
              }`}
            >
              {d === 'Hyderabad' ? '★ ' : ''}
              {d}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-[#0A2647]">
            {tenders.length} tenders found
          </h3>
        </div>

        {loading && (
          <Card className="p-6 text-center text-muted-foreground">
            Loading...
          </Card>
        )}
        {!loading && tenders.length === 0 && (
          <Card className="p-10 text-center">
            <FileText className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            <p className="text-muted-foreground">No matching tenders.</p>
          </Card>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          {tenders.map((t) => (
            <Card key={t.id} className="tender-shadow hover:tender-shadow-lg transition">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Badge
                    className={
                      t.district === 'Hyderabad' ? 'bg-[#16a34a]' : 'bg-[#0A2647]'
                    }
                  >
                    <MapPin className="w-3 h-3 mr-1" />
                    {t.district}
                  </Badge>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(t.last_date).toDateString()}
                  </span>
                </div>
                <h4 className="font-bold text-[#0A2647] mb-1 line-clamp-2">
                  {t.title}
                </h4>
                <p className="text-sm text-muted-foreground flex items-center gap-1 mb-2">
                  <Building2 className="w-3 h-3" /> {t.department}
                </p>
                {t.supply_details && (
                  <p className="text-sm text-slate-600 line-clamp-2 mb-3">
                    {t.supply_details}
                  </p>
                )}
                <a href={`/?tender=${t.id}`}>
                  <Button className="bg-[#16a34a] hover:bg-[#15803d] w-full">
                    <FileText className="w-4 h-4 mr-1" /> View on Home
                  </Button>
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}

export default ArchivePage;
