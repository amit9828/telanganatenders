import { handleFiles } from '@/lib/workflow-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  return handleFiles(request, params.id);
}
