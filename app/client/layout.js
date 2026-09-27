import { assertDesk } from '@/lib/desk-guard';
import { DeskAuthProvider } from '@/components/DeskAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ClientLayout({ children }) {
  await assertDesk('client');
  return <DeskAuthProvider role="client">{children}</DeskAuthProvider>;
}
