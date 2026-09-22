import {
  JOB_STATUS,
  INTERNAL_BOARD_STATUSES,
  SUBMITTED_BOARD_STATUSES,
} from '@/lib/workflow';
import { deleteR2Key } from '@/lib/cloudflare-r2';
import { pastPayloadGraceQuery } from '@/lib/tender-expiry';

export const PDF_PROTECT_JOB_STATUSES = [
  JOB_STATUS.AWAITING_PUBLISH,
  JOB_STATUS.LIVE,
  JOB_STATUS.AWAITING_CLIENT,
  ...INTERNAL_BOARD_STATUSES,
  ...SUBMITTED_BOARD_STATUSES,
  JOB_STATUS.WON,
];

const BATCH_LIMIT = 80;
const HAS_BLOB = { pdf_base64: { $exists: true, $nin: [null, ''] } };
const HAS_R2 = { pdf_r2_key: { $exists: true, $nin: [null, ''] } };

function tenderRefKeys(tender) {
  return [tender?._id, tender?.id, tender?.bid_no]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function r2KeysForTender(tender) {
  const keys = [];
  if (tender?.pdf_r2_key) keys.push(String(tender.pdf_r2_key).replace(/^\/+/, ''));
  const url = String(tender?.pdf_url || '').trim();
  if (url) {
    try {
      const pathname = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
      const idx = pathname.indexOf('tenders/');
      if (idx >= 0) keys.push(pathname.slice(idx).split('?')[0]);
    } catch {
      const idx = url.indexOf('tenders/');
      if (idx >= 0) keys.push(url.slice(idx).split('?')[0]);
    }
  }
  return [...new Set(keys.filter(Boolean))];
}

async function loadProtectedRefs(db) {
  const jobs = await db.collection('workflow_jobs')
    .find(
      { status: { $in: PDF_PROTECT_JOB_STATUSES } },
      { projection: { tender_id: 1, bid_no: 1 } },
    )
    .toArray();
  const refs = new Set();
  for (const job of jobs) {
    if (job.tender_id) refs.add(String(job.tender_id).trim());
    if (job.bid_no) refs.add(String(job.bid_no).trim());
  }
  return refs;
}

function isProtectedTender(tender, protectedRefs) {
  return tenderRefKeys(tender).some((key) => protectedRefs.has(key));
}

export async function purgeExpiredTenderPayloads(db, now = Date.now()) {
  const tenders = db.collection('tenders');
  const grace = pastPayloadGraceQuery(now);

  // Mongo win: drop inline blobs once R2 already holds a copy. Protected jobs
  // still open the PDF from R2. Never delete the tender document.
  const blobDup = await tenders.updateMany(
    { $and: [grace, HAS_BLOB, HAS_R2] },
    { $unset: { pdf_base64: '' } },
  );

  const candidates = await tenders.find(
    {
      $and: [
        grace,
        { $or: [HAS_BLOB, HAS_R2] },
      ],
    },
    {
      projection: {
        bid_no: 1,
        id: 1,
        pdf_r2_key: 1,
        pdf_url: 1,
        payload_purged_at: 1,
      },
    },
  ).limit(BATCH_LIMIT).toArray();

  const protectedRefs = await loadProtectedRefs(db);
  let r2Deleted = 0;
  let r2Kept = 0;
  let blobsUnset = 0;
  let skippedProtected = 0;

  for (const tender of candidates) {
    const protectedJob = isProtectedTender(tender, protectedRefs);
    const r2Keys = r2KeysForTender(tender);

    if (protectedJob) {
      skippedProtected += 1;
      r2Kept += r2Keys.length > 0 ? 1 : 0;
      continue;
    }

    let r2Ok = true;
    for (const key of r2Keys) {
      const deleted = await deleteR2Key(key);
      if (deleted) r2Deleted += 1;
      else r2Ok = false;
    }

    const unset = { pdf_base64: '' };
    if (r2Ok && r2Keys.length > 0) {
      unset.pdf_r2_key = '';
      unset.pdf_url = '';
    }

    const update = { $unset: unset };
    if (r2Ok) update.$set = { payload_purged_at: new Date(now) };

    await tenders.updateOne({ _id: tender._id }, update);
    blobsUnset += 1;
  }

  return {
    scanned: candidates.length,
    blob_dupes_unset: blobDup.modifiedCount,
    blobs_unset: blobsUnset,
    r2_deleted: r2Deleted,
    r2_kept_for_jobs: r2Kept,
    skipped_protected: skippedProtected,
    batch_limit: BATCH_LIMIT,
  };
}
