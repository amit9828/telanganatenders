'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error('Application Error Boundary caught:', error);
  }, [error]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 px-4 py-16">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-r from-[#0A2647] to-blue-900 px-8 py-10 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl transform translate-x-10 -translate-y-10 pointer-events-none"></div>
          <div className="relative z-10 w-16 h-16 mx-auto mb-4 rounded-full bg-white/10 flex items-center justify-center border border-white/20">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <h1 className="relative z-10 text-xl font-black text-white uppercase tracking-wide">Something Went Wrong</h1>
        </div>

        <div className="p-8 text-center">
          <p className="text-slate-600 font-medium mb-2">
            We hit an unexpected error while loading this page.
          </p>
          <p className="text-slate-400 text-sm mb-8">
            Our team has been notified. Please try again, and if the problem persists, contact support.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => reset()}
              className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-lg bg-[#16a34a] hover:bg-[#15803d] text-white font-bold text-sm shadow-lg shadow-emerald-600/20 transition"
            >
              <RefreshCw className="w-4 h-4" /> Try Again
            </button>
            <a
              href="/"
              className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-lg border-2 border-slate-200 hover:border-[#0A2647] text-slate-600 hover:text-[#0A2647] font-bold text-sm transition"
            >
              <Home className="w-4 h-4" /> Go Home
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
