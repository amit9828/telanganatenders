import { assertDesk } from '@/lib/desk-guard';
import { DeskAuthProvider } from '@/components/DeskAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function GmLayout({ children }) {
  await assertDesk('gm');
  return <DeskAuthProvider role="gm">{children}</DeskAuthProvider>;
}
