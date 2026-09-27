import { assertDesk } from '@/lib/desk-guard';
import { DeskAuthProvider } from '@/components/DeskAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminLayout({ children }) {
  await assertDesk('md');
  return <DeskAuthProvider role="md">{children}</DeskAuthProvider>;
}
