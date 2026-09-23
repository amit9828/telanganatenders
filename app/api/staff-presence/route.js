import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveActorRole, isMdEmployee } from '@/lib/staff-auth';
import { beaconIncrement, istDayKey } from '@/lib/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

let presenceIndex;

function ensurePresenceIndex(db) {
  if (!presenceIndex) {
    presenceIndex = db.collection('staff_presence').createIndex(
      { emp_id: 1, day: 1, tab: 1 },
      { unique: true, name: 'emp_day_tab' },
    ).catch((err) => {
      presenceIndex = null;
      console.warn('[staff-presence] index failed:', err?.message || err);
    });
  }
  return presenceIndex;
}

async function empIdForActor(db, actor) {
  if (actor?.empId) return String(actor.empId).trim();
  const email = String(actor?.email || '').trim().toLowerCase();
  if (email) {
    const emp = await db.collection('employees').findOne({
      email,
      deleted: { $ne: true },
      active: { $ne: false },
    }, { projection: { emp_id: 1 } });
    if (emp?.emp_id) return String(emp.emp_id);
    return email;
  }
  if (actor?.role === 'MD') {
    const adminEmail = String(actor.email || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    if (adminEmail) {
      const emp = await db.collection('employees').findOne({
        email: adminEmail,
        deleted: { $ne: true },
        active: { $ne: false },
      }, { projection: { emp_id: 1 } });
      if (emp?.emp_id) return String(emp.emp_id);
    }
    const roster = await db.collection('employees').find({
      deleted: { $ne: true },
      active: { $ne: false },
    }).project({ emp_id: 1, email: 1, role: 1, designation: 1 }).toArray();
    const md = roster.find((emp) => isMdEmployee(emp) && emp.emp_id);
    if (md?.emp_id) return String(md.emp_id);
    return adminEmail || 'MD';
  }
  return '';
}

export async function POST(request) {
  const actor = await resolveActorRole(request);
  if (!actor?.role) return json({ error: 'Please sign in.' }, 401);
  const body = await request.json().catch(() => ({}));
  const tab = String(body.tab || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(tab)) return json({ error: 'Unknown tab.' }, 400);

  const db = await getDb();
  const empId = await empIdForActor(db, actor);
  if (!empId) return json({ error: 'Employee ID required.' }, 401);

  await ensurePresenceIndex(db);
  const now = new Date();
  const latest = await db.collection('staff_presence')
    .find({ emp_id: empId })
    .sort({ last_beacon_at: -1 })
    .limit(1)
    .next();
  const decision = beaconIncrement(latest?.last_beacon_at, now);
  if (decision.ignore) return json({ ok: true, ignored: true });

  const day = istDayKey(now);
  await db.collection('staff_presence').updateOne(
    { emp_id: empId, day, tab },
    {
      $setOnInsert: { emp_id: empId, day, tab, created_at: now },
      $set: { last_beacon_at: now, updated_at: now },
      $inc: { seconds: decision.seconds },
    },
    { upsert: true },
  );
  return json({ ok: true, seconds: decision.seconds });
}
