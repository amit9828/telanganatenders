import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import Providers from './providers';

export const metadata = {
  title: 'Telangana Tenders — Official Government Tender Portal',
  description: 'Browse government tenders across Telangana districts. Calendar view, instant PDF access, monthly & yearly subscriptions.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
