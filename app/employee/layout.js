import { assertDesk } from '@/lib/desk-guard';
import { DeskAuthProvider } from '@/components/DeskAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function EmployeeLayout({ children }) {
  await assertDesk('employee');
  return <DeskAuthProvider role="employee">{children}</DeskAuthProvider>;
}
