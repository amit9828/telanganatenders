import { assertDesk } from '@/lib/desk-guard';
import { DeskAuthProvider } from '@/components/DeskAuth';

export default async function TlLayout({ children }) {
  await assertDesk('tl');
  return <DeskAuthProvider>{children}</DeskAuthProvider>;
}
