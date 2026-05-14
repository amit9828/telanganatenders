'use client';
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

let cache = null;
let cacheTime = 0;

export function useSettings() {
  const [settings, setSettings] = useState(cache);
  useEffect(() => {
    if (cache && Date.now() - cacheTime < 60_000) {
      setSettings(cache);
      return;
    }
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        cache = d;
        cacheTime = Date.now();
        setSettings(d);
      })
      .catch(() => {});
  }, []);
  return settings;
}

export default function BrandLogo({ subtitle, size = 'md' }) {
  const s = useSettings();
  const dim = size === 'sm' ? 'w-9 h-9' : size === 'lg' ? 'w-12 h-12' : 'w-10 h-10';
  return (
    <a href="/" className="flex items-center gap-2 sm:gap-3 min-w-0">
      <div
        className={`${dim} rounded-lg flex items-center justify-center overflow-hidden shrink-0 ${
          s?.logo_base64 ? 'bg-white border border-slate-200' : 'navy-gradient'
        }`}
      >
        {s?.logo_base64 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:${s.logo_mime || 'image/png'};base64,${s.logo_base64}`}
            alt="logo"
            className="w-full h-full object-contain"
          />
        ) : (
          <ShieldCheck className="w-5 h-5 text-white" />
        )}
      </div>
      <div className="min-w-0">
        <h1 className="text-base sm:text-lg font-bold text-[#0A2647] leading-none truncate">
          {s?.brand_name?.split(' ')[0] || 'Telangana'}{' '}
          <span className="text-[#16a34a]">
            {s?.brand_name?.split(' ').slice(1).join(' ') || 'Tenders'}
          </span>
        </h1>
        <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
          {subtitle || s?.tagline || 'Official Government Tender Portal'}
        </p>
      </div>
    </a>
  );
}
