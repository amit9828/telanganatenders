import { handleFileGet } from '@/lib/workflow-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  return handleFileGet(request, params.id);
}
