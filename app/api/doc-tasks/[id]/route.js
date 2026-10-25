import { NextResponse } from 'next/server';
import { handleDocTaskDelete, handleDocTaskPut } from '@/lib/doc-team-tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function reply(result) {
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status || 400 });
  return NextResponse.json(result.body);
}

export async function PUT(request, { params }) {
  return reply(await handleDocTaskPut(request, params.id));
}

export async function DELETE(request, { params }) {
  return reply(await handleDocTaskDelete(request, params.id));
}
