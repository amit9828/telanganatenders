import { assertDesk } from '@/lib/desk-guard';
import { DeskAuthProvider } from '@/components/DeskAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TlLayout({ children }) {
  await assertDesk('tl');
  return <DeskAuthProvider role="tl">{children}</DeskAuthProvider>;
}
