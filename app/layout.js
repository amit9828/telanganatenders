import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import Providers from './providers';

export const metadata = {
  // Ultra-optimized for ranking first on variations of Telangana and Maver Tenders
  title: {
    default: 'TG Tenders | Official Telangana Government Tender Portal up to 10 Lakhs',
    template: '%s | TG Tenders'
  },
  description: 'Access all latest Telangana government tenders under 10 Lakhs. View instant, high-speed verified PDFs, filter by district, and check tender due dates on our dynamic calendar.',
  keywords: [
    'TG Tenders', 
    'Telangana Tenders', 
    'Maver Tender', 
    'Government Tenders Telangana', 
    'tgtenders.in', 
    'Hyderabad Tenders', 
    'Telangana contractor portal',
    'TG Tenders account login'
  ],
  // Dynamic OpenGraph settings for high-authority social sharing signals
  openGraph: {
    title: 'TG Tenders — Telangana Government Tender Portal',
    description: 'Every government tender in Telangana up to 10 Lakhs in one calendar view.',
    url: 'https://www.tgtenders.in',
    siteName: 'TG Tenders',
    locale: 'en_IN',
    type: 'website',
  },
  // Tells Google this is the unique and authoritative URL for your business
  alternates: {
    canonical: 'https://www.tgtenders.in',
  },
  // Connects directly to your Google Search Console verification code
  verification: {
    google: 'googlebaf661f8a9a9c7cd', // Injected from file 5926b395-f3f9-4b04-98d0-4ca3d6a96aee
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
  // Advanced Structured JSON-LD Data for Google Rank Optimization
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "TG Tenders",
    "alternateName": ["Telangana Tenders", "Maver Tender", "TG Tenders Portal"],
    "url": "https://www.tgtenders.in",
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": "https://www.tgtenders.in/?q={search_term_string}"
      },
      "query-input": "required name=search_term_string"
    },
    "description": "Premium service portal for tracking and viewing small-scale government tenders in Telangana up to 10 Lakhs."
  };

  return (
    <html lang="en">
      <head>
        {/* Injects the schema directly into the head so Google reads your search query structure immediately */}
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
