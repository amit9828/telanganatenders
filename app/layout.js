import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import Providers from './providers';

// 🚀 FIX: `font-family: 'Inter'` was declared in globals.css but never actually
// loaded anywhere — the browser silently fell back to the OS default sans-serif
// the whole time. next/font/google self-hosts the font (no external request,
// no layout shift) and exposes it as a CSS variable so both body copy (Inter)
// and headings (Plus Jakarta Sans, a warmer/rounder display face) are real.
const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const plusJakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-heading', display: 'swap' });

export const viewport = {
  themeColor: "#0A2647",
};

export const metadata = {
  title: "Telangana Tenders & Andhra Tenders | AP Tenders, GeM Tenders B2B Tenders Portal",
  description: "The No.1 B2B Tenders Portal for Telangana Tenders, Andhra Tenders (AP Tenders) and GeM Tenders. Access all live government tenders, GeM (Government e Marketplace) bids, and procurement contracts across Telangana and Andhra Pradesh.",
  manifest: "/manifest.json",
  // 🚀 Force Google to pick our official icon, bypassing default weird avatars
  icons: {
    icon: '/icon.png',
    shortcut: '/icon.png',
    apple: '/icon.png',
  },
  keywords: [
    // Brand & Core
    'TG Tenders', 'Telangana Tenders', 'tgtenders.in', 'B2B Tenders Portal', 'B2B Tender tracking',
    // GeM & National
    'GeM Tenders', 'Government e Marketplace', 'GeM portal services', 'Central government tenders',
    // Broad Keywords
    'Government Tenders', 'Tender Consultancy Services', 'e-Procurement Telangana', 'e-Procurement AP', 'Tender bidding experts',
    // Telangana Districts
    'Hyderabad Tenders', 'Warangal Tenders', 'Karimnagar Tenders', 'Nizamabad Tenders', 'Khammam Tenders', 'Nalgonda Tenders', 'Mahabubnagar Tenders',
    // Andhra Pradesh / Andhra Tenders
    'Andhra Tenders', 'Andhra Pradesh Tenders', 'AP Tenders', 'Visakhapatnam Tenders', 'Vijayawada Tenders', 'Guntur Tenders', 'Tirupati Tenders', 'Kurnool Tenders'
  ],
  openGraph: {
    title: 'Telangana Tenders & Andhra Tenders — GeM Tenders B2B Tenders Portal',
    description: 'The B2B Tenders Portal for Telangana Tenders, Andhra Tenders, AP Tenders and GeM Tenders — expert tracking and bidding services for Government e-Marketplace (GeM).',
    url: 'https://www.tgtenders.in',
    siteName: 'TG Tenders',
    images: [
      {
        url: 'https://www.tgtenders.in/icon.png', // WhatsApp/FB share logo
        width: 512,
        height: 512,
        alt: 'TG Tenders Logo',
      }
    ],
    locale: 'en_IN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Telangana Tenders & Andhra Tenders — GeM Tenders B2B Tenders Portal',
    description: 'Live Telangana Tenders, Andhra Tenders, AP Tenders and GeM Tenders in one B2B Tenders Portal.',
    images: ['https://www.tgtenders.in/icon.png'],
  },
  alternates: {
    canonical: 'https://www.tgtenders.in',
  },
  verification: {
    google: 'TIofzqsOpScixFgiAUOjXsJ9INu_f_fs4GCAm1WV-mg',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({ children }) {
  // 🚀 ULTRA SEO: Telling Google exactly who we are, what our logo is, and what we do.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://www.tgtenders.in/#organization",
        "name": "TG Tenders Consultancy",
        "alternateName": ["Telangana Tenders", "Andhra Tenders", "AP Tenders", "B2B Tenders Portal"],
        "url": "https://www.tgtenders.in",
        "logo": {
          "@type": "ImageObject",
          "url": "https://www.tgtenders.in/icon.png",
          "width": 512,
          "height": 512
        },
        "description": "The B2B Tenders Portal for Telangana Tenders, Andhra Tenders (AP Tenders) and GeM Tenders — leading Government e Marketplace (GeM) and state tender consultancy services."
      },
      {
        "@type": "WebSite",
        "@id": "https://www.tgtenders.in/#website",
        "url": "https://www.tgtenders.in",
        "name": "Telangana Tenders & Andhra Tenders — B2B Tenders Portal",
        "publisher": {
          "@id": "https://www.tgtenders.in/#organization"
        },
        "potentialAction": {
          "@type": "SearchAction",
          "target": "https://www.tgtenders.in/?q={search_term_string}",
          "query-input": "required name=search_term_string"
        }
      }
    ]
  };

  return (
    <html lang="en" className={`${inter.variable} ${plusJakarta.variable}`} suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
