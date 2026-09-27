import { assertDesk } from '@/lib/desk-guard';
import { DeskAuthProvider } from '@/components/DeskAuth';

export default async function EmployeeLayout({ children }) {
  await assertDesk('employee');
  return <DeskAuthProvider>{children}</DeskAuthProvider>;
}
