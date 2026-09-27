import { assertDesk } from '@/lib/desk-guard';
import { DeskAuthProvider } from '@/components/DeskAuth';

export default async function ClientLayout({ children }) {
  await assertDesk('client');
  return <DeskAuthProvider>{children}</DeskAuthProvider>;
}
