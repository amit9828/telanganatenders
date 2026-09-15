import { handleChecklist } from '@/lib/workflow-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(request, { params }) {
  return handleChecklist(request, params.id);
}
