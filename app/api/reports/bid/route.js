import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { readDeskSession } from '@/lib/desk-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reportsDir = path.join(process.cwd(), 'fixtures', 'reports');

async function allowed() {
  const { desk } = await readDeskSession();
  return desk === 'md' || desk === 'gm';
}

function safeBase(file) {
  const base = path.basename(String(file || '')).replace(/\.pdf$/i, '');
  if (!base || base.includes('..') || !/^[A-Za-z0-9 ._()\-]+$/.test(base)) return '';
  return base;
}

function listReports() {
  if (!fs.existsSync(reportsDir)) return [];
  return fs.readdirSync(reportsDir)
    .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
    .map((name) => name.replace(/\.json$/i, ''))
    .sort();
}

export async function GET(request) {
  if (!(await allowed())) return NextResponse.json({ error: 'MD or GM only.' }, { status: 403 });
  const file = safeBase(new URL(request.url).searchParams.get('file'));
  if (!file) return NextResponse.json({ files: listReports() });
  const jsonPath = path.join(reportsDir, `${file}.json`);
  const mdPath = path.join(reportsDir, `${file}-Report.md`);
  if (!fs.existsSync(jsonPath)) return NextResponse.json({ error: 'No saved report for that bid.' }, { status: 404 });
  const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const markdown = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
  return NextResponse.json({ file, report, markdown });
}

export async function POST(request) {
  if (!(await allowed())) return NextResponse.json({ error: 'MD or GM only.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const file = safeBase(body.file);
  if (!file) return NextResponse.json({ error: 'Choose a saved bid.' }, { status: 400 });
  const script = path.join(process.cwd(), 'scripts', 'test-llm-pipeline-step3.js');
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [script, '--file', file], { cwd: process.cwd() });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('close', (code) => resolve({ code, output: output.slice(-4000) }));
  });
  if (result.code !== 0) {
    return NextResponse.json({ error: 'The bid could not be read.', detail: result.output }, { status: 500 });
  }
  return NextResponse.json({ ok: true, file });
}
