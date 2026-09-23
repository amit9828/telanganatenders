import { handleClientQuotation } from '@/lib/workflow-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  return handleClientQuotation(request, params.id);
}
