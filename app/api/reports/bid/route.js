import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { readDeskSession } from '@/lib/desk-guard';
import { belongsOnSuggestions } from '@/lib/job-board-state';
import { suggestionTenderRows } from '@/lib/suggestion-tenders';
import { resolveActorRole } from '@/lib/staff-auth';
import { asObjectId, canSeeJob, jobsCol, queueFilterForActor } from '@/lib/workflow';
import { originalTenderPackFile } from '@/lib/workflow-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const NO_PDF = 'This tender has no PDF, so a report cannot be written.';

async function staff() {
  const { desk } = await readDeskSession();
  if (desk !== 'md' && desk !== 'gm') return { error: NextResponse.json({ error: 'MD or GM only.' }, { status: 403 }) };
  return { error: null };
}

function suggestionFilter(actor) {
  return {
    $and: [
      queueFilterForActor(actor),
      {
        $or: [
          { status: 'AWAITING_CLIENT' },
          { status: 'LIVE', parked_client_email: { $exists: true, $nin: [null, ''] } },
        ],
      },
    ],
  };
}

function reportKey(job) {
  const bidNo = String(job?.bid_no || '').trim();
  return bidNo || `job:${job?._id || ''}`;
}

function publicReport(doc, jobId) {
  return {
    jobId: jobId || doc.job_id || '',
    bidNo: doc.bid_no || '',
    report: {
      core_details: doc.core_details || {},
      report_en: doc.report_en || null,
      report_te: doc.report_te || null,
    },
    markdown: doc.markdown || '',
  };
}

async function runExtractor(pdfPath, bidNo, jsonPath) {
  const script = path.join(process.cwd(), 'scripts', 'test-llm-pipeline-step3.js');
  const outputDir = path.join(process.cwd(), 'fixtures', 'reports');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      script,
      '--pdf', pdfPath,
      '--bid', bidNo,
      '--json-out', jsonPath,
      '--output', outputDir,
    ], { cwd: process.cwd() });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('close', (code) => resolve({ code, output: output.slice(-1500) }));
  });
}

export async function GET(request) {
  const gate = await staff();
  if (gate.error) return gate.error;
  const actor = await resolveActorRole(request);
  if (!actor?.role) return NextResponse.json({ error: 'Please sign in with a staff account.' }, { status: 401 });
  const db = await getDb();
  const jobs = await jobsCol(db).find(suggestionFilter(actor), {
    projection: {
      bid_no: 1,
      title: 1,
      department: 1,
      organisation: 1,
      tender_id: 1,
      parked_client_name: 1,
      parked_client_email: 1,
      client_name: 1,
      client_email: 1,
      status: 1,
      updated_at: 1,
      created_at: 1,
    },
  }).limit(500).toArray();
  const tenders = suggestionTenderRows(jobs);
  return NextResponse.json({ tenders, count: tenders.length });
}

export async function POST(request) {
  const gate = await staff();
  if (gate.error) return gate.error;
  const actor = await resolveActorRole(request);
  if (!actor?.role) return NextResponse.json({ error: 'Please sign in with a staff account.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const jobId = String(body.jobId || '').trim();
  const oid = asObjectId(jobId);
  if (!oid) return NextResponse.json({ error: 'Choose a tender from the Suggestion Bar.' }, { status: 400 });

  const db = await getDb();
  const job = await jobsCol(db).findOne({ _id: oid });
  if (!job || !canSeeJob(actor, job) || !belongsOnSuggestions(job)) {
    return NextResponse.json({ error: 'That tender is not on the Suggestion Bar.' }, { status: 404 });
  }

  const key = reportKey(job);
  const reports = db.collection('gem_bid_reports');
  if (!body.force) {
    const saved = await reports.findOne({ report_key: key });
    if (saved?.report_en && saved?.report_te) return NextResponse.json(publicReport(saved, jobId));
  }

  const pack = await originalTenderPackFile(db, job);
  if (!pack?.buffer?.length) return NextResponse.json({ error: NO_PDF }, { status: 400 });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-report-'));
  const pdfPath = path.join(dir, 'cover.pdf');
  const jsonPath = path.join(dir, 'report.json');
  try {
    fs.writeFileSync(pdfPath, pack.buffer);
    const result = await runExtractor(pdfPath, String(job.bid_no || jobId), jsonPath);
    if (result.code !== 0 || !fs.existsSync(jsonPath)) {
      return NextResponse.json({ error: 'The bid could not be read.', detail: result.output }, { status: 500 });
    }
    const generated = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (!generated?.report_en || !generated?.report_te) {
      return NextResponse.json({ error: 'The bid could not be read.' }, { status: 500 });
    }
    const now = new Date();
    const doc = {
      report_key: key,
      bid_no: String(job.bid_no || '').trim(),
      job_id: String(job._id),
      tender_id: String(job.tender_id || ''),
      report_en: generated.report_en,
      report_te: generated.report_te,
      markdown: generated.markdown || '',
      core_details: generated.core_details || {},
      created_by: actor.email || actor.name || actor.role || '',
      updated_at: now,
    };
    await reports.updateOne(
      { report_key: key },
      { $set: doc, $setOnInsert: { created_at: now } },
      { upsert: true },
    );
    return NextResponse.json(publicReport(doc, jobId));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
