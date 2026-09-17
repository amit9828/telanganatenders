import { handleJobGet, handleJobDelete } from '@/lib/workflow-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  return handleJobGet(request, params.id);
}

export async function DELETE(request, { params }) {
  return handleJobDelete(request, params.id);
}
