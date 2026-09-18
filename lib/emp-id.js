function empNumber(value) {
  const m = String(value || '').trim().match(/^EMP-(\d+)$/i);
  return m ? Number(m[1]) : 0;
}

export async function maxEmpNumber(db) {
  const docs = await db.collection('employees').find({}, { projection: { emp_id: 1 } }).toArray();
  let max = 1000;
  for (const doc of docs) {
    const n = empNumber(doc.emp_id);
    if (n > max) max = n;
  }
  return max;
}

export async function allocateEmpId(db) {
  const max = await maxEmpNumber(db);
  return `EMP-${max + 1}`;
}

/** Keep the oldest row for each emp_id; assign later duplicates a fresh EMP-N. */
export async function repairDuplicateEmpIds(db) {
  const docs = await db.collection('employees').find({}).sort({ created_at: 1, _id: 1 }).toArray();
  let max = 1000;
  for (const doc of docs) {
    const n = empNumber(doc.emp_id);
    if (n > max) max = n;
  }
  const seen = new Set();
  let repaired = 0;
  for (const doc of docs) {
    const id = String(doc.emp_id || '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      continue;
    }
    max += 1;
    const fresh = `EMP-${max}`;
    seen.add(fresh);
    await db.collection('employees').updateOne({ _id: doc._id }, { $set: { emp_id: fresh } });
    repaired += 1;
  }
  return repaired;
}

export async function ensureUniqueEmpIds(db) {
  const repaired = await repairDuplicateEmpIds(db);
  try {
    await db.collection('employees').createIndex({ emp_id: 1 }, { unique: true, sparse: true });
  } catch (err) {
    console.warn('[emp-id] unique index:', err?.message || err);
  }
  return repaired;
}
