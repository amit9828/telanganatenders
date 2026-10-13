'use client';
import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from 'next-themes';

export default function Providers({ children }) {
  return (
    <SessionProvider refetchOnWindowFocus={false}>
      {/*
        🚀 Dark-mode foundation: `next-themes` was already a dependency (the
        Toaster even calls useTheme()), but nothing ever provided the context,
        so it silently no-op'd to "system" every render. `defaultTheme="light"`
        keeps today's look unchanged until a real toggle is added; the CSS
        variables in globals.css are ready for `.dark` the moment one is.
      */}
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
        {children}
      </ThemeProvider>
    </SessionProvider>
  );
}
