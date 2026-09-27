import { assertDesk } from '@/lib/desk-guard';
import { DeskAuthProvider } from '@/components/DeskAuth';

export default async function AdminLayout({ children }) {
  await assertDesk('md');
  return <DeskAuthProvider>{children}</DeskAuthProvider>;
}
