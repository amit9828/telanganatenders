import { handleJobsGet, handleJobsPost } from '@/lib/workflow-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return handleJobsGet(request);
}

export async function POST(request) {
  return handleJobsPost(request);
}
