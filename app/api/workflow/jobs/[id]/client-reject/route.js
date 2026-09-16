import { handleClientReject } from '@/lib/workflow-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  return handleClientReject(request, params.id);
}
