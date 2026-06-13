'use client';
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

let cache = null;
let cacheTime = 0;

// ==========================================
// FETCHING SETTINGS FROM BACKEND
// ==========================================
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
        // Correctly fetching 'd.settings' matching our latest backend
        const brandData = d.settings || d; 
        cache = brandData;
        cacheTime = Date.now();
        setSettings(brandData);
      })
      .catch(() => {});
  }, []);
  
  return settings;
}

// ==========================================
// BRAND LOGO UI COMPONENT
// ==========================================
export default function BrandLogo({ subtitle, size = 'md' }) {
  const s = useSettings();
  const dim = size === 'sm' ? 'w-9 h-9' : size === 'lg' ? 'w-12 h-12' : 'w-10 h-10';

  // Setting defaults to prevent undefined errors
  const brandName = s?.name || 'Telangana Tenders';
  const tagline = s?.tagline || 'Official Government Tender Portal';
  
  // Splitting the name to apply different colors to each word
  const firstWord = brandName.split(' ')[0];
  const remainingWords = brandName.split(' ').slice(1).join(' ');

  return (
    <a href="/" className="flex items-center gap-2 sm:gap-3 min-w-0">
      
      {/* LOGO IMAGE DISPLAY */}
      <div
        className={`${dim} rounded-lg flex items-center justify-center overflow-hidden shrink-0 ${
          s?.logo ? 'bg-white border border-slate-200 p-0.5' : 'navy-gradient'
        }`}
      >
        {s?.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={s.logo} // Uses the direct logo data string from the database
            alt="Brand Logo"
            className="w-full h-full object-contain"
          />
        ) : (
          <ShieldCheck className="w-5 h-5 text-white" />
        )}
      </div>

      {/* BRAND NAME & TAGLINE DISPLAY */}
      <div className="min-w-0">
        <h1 className="text-base sm:text-lg font-bold leading-none truncate">
          {/* First word in Navy Blue */}
          <span className="text-[#0A2647]">{firstWord}</span>{' '}
          {/* Remaining words in Green */}
          <span className="text-[#16a34a]">{remainingWords}</span>
        </h1>
        <p className="text-[10px] sm:text-xs text-muted-foreground truncate font-medium">
          {subtitle || tagline}
        </p>
      </div>
      
    </a>
  );
}
