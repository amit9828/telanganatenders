import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function retired() {
  return NextResponse.json({ error: 'Live hunting has been removed.' }, { status: 410 });
}

export async function GET() {
  return retired();
}

export async function POST() {
  return retired();
}
