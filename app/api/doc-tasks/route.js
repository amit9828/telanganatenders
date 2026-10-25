import { NextResponse } from 'next/server';
import { handleDocTasksGet } from '@/lib/doc-team-tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function reply(result) {
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status || 400 });
  return NextResponse.json(result.body);
}

export async function GET(request) {
  return reply(await handleDocTasksGet(request));
}
