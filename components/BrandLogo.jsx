'use client';
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

let cache = null;
let cacheTime = 0;

export function invalidateSettingsCache() {
  cache = null;
  cacheTime = 0;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('tt-settings-updated'));
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(cache);

  useEffect(() => {
    const load = (force = false) => {
      if (!force && cache && Date.now() - cacheTime < 60_000) {
        setSettings(cache);
        return;
      }
      fetch(`/api/settings?t=${Date.now()}`)
        .then((r) => r.json())
        .then((d) => {
          const brandData = d.settings || d;
          cache = brandData;
          cacheTime = Date.now();
          setSettings(brandData);
        })
        .catch(() => {});
    };

    load(false);
    const onUpdate = () => load(true);
    window.addEventListener('tt-settings-updated', onUpdate);
    return () => window.removeEventListener('tt-settings-updated', onUpdate);
  }, []);

  return settings;
}

export function BrandMark({ size = 'md', className = '' }) {
  const s = useSettings();
  const dim = size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-12 h-12' : 'w-10 h-10';
  return (
    <div
      className={`${dim} rounded-lg flex items-center justify-center overflow-hidden shrink-0 ${
        s?.logo ? 'bg-white border border-white/20 p-0.5' : 'bg-white/10'
      } ${className}`}
    >
      {s?.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.logo} alt="Brand Logo" className="w-full h-full object-contain" />
      ) : (
        <ShieldCheck className="w-5 h-5 text-emerald-400" />
      )}
    </div>
  );
}

export default function BrandLogo({ subtitle, size = 'md' }) {
  const s = useSettings();
  const dim = size === 'sm' ? 'w-9 h-9' : size === 'lg' ? 'w-12 h-12' : 'w-10 h-10';

  const brandName = s?.name || 'TG Tenders';
  const tagline = s?.tagline || 'Official Government Tender Portal';

  const firstWord = brandName.split(' ')[0];
  const remainingWords = brandName.split(' ').slice(1).join(' ');

  return (
    <a href="/" className="flex items-center gap-2 sm:gap-3 min-w-0">
      <div
        className={`${dim} rounded-lg flex items-center justify-center overflow-hidden shrink-0 ${
          s?.logo ? 'bg-white border border-slate-200 p-0.5' : 'navy-gradient'
        }`}
      >
        {s?.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={s.logo}
            alt="Brand Logo"
            className="w-full h-full object-contain"
          />
        ) : (
          <ShieldCheck className="w-5 h-5 text-white" />
        )}
      </div>

      <div className="min-w-0">
        <h1 className="text-base sm:text-lg font-bold leading-none truncate">
          <span className="text-[#0A2647]">{firstWord}</span>{' '}
          <span className="text-[#16a34a]">{remainingWords}</span>
        </h1>
        <p className="text-[10px] sm:text-xs text-muted-foreground truncate font-medium">
          {subtitle || tagline}
        </p>
      </div>
    </a>
  );
}
