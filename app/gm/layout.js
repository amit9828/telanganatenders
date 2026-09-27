import { assertDesk } from '@/lib/desk-guard';
import { DeskAuthProvider } from '@/components/DeskAuth';

export default async function GmLayout({ children }) {
  await assertDesk('gm');
  return <DeskAuthProvider>{children}</DeskAuthProvider>;
}
