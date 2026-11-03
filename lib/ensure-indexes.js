let ensuring = null;

async function createIndex(col, spec, options) {
  try {
    if (options) await col.createIndex(spec, options);
    else await col.createIndex(spec);
  } catch (err) {
    console.error('[indexes]', col.collectionName, err?.message || err);
  }
}

export async function ensureAppIndexes(db) {
  if (!db) return;
  if (global.__ttIndexesReady) return;
  if (ensuring) return ensuring;
  ensuring = (async () => {
    // The old global bid index blocked one tender for many clients.
    await db.collection('doc_team_tasks').dropIndex('bidNumber_1').catch(() => {});
    await Promise.all([
      createIndex(db.collection('workflow_jobs'), { status: 1, assigned_emp_id: 1 }),
      createIndex(db.collection('workflow_jobs'), { status: 1, team_id: 1 }),
      createIndex(db.collection('workflow_jobs'), { client_email: 1 }),
      createIndex(db.collection('workflow_jobs'), { tender_id: 1 }),
      createIndex(db.collection('workflow_jobs'), { bid_no: 1 }),
      createIndex(db.collection('workflow_jobs'), { status: 1, updated_at: -1 }),
      createIndex(db.collection('workflow_jobs'), { status: 1, parked_client_email: 1, updated_at: -1 }),
      createIndex(db.collection('ops_alerts'), { recipient_emp_id: 1, status: 1, created_at: -1 }),
      createIndex(db.collection('workflow_archive'), { archived_at: -1 }),
      createIndex(db.collection('staff_chats'), { created_at: 1 }, { expireAfterSeconds: 7 * 24 * 3600 }),
      createIndex(db.collection('staff_chats'), { thread_key: 1, created_at: 1 }),
      createIndex(db.collection('staff_chats'), { job_id: 1, created_at: 1 }),
      createIndex(db.collection('staff_chats'), { from_emp_id: 1, created_at: -1 }),
      createIndex(db.collection('staff_chats'), { to_emp_id: 1, created_at: -1 }),
      createIndex(db.collection('staff_chat_reads'), { thread_key: 1, emp_id: 1 }, { unique: true }),
      createIndex(db.collection('staff_chat_presence'), { emp_id: 1 }, { unique: true }),
      createIndex(db.collection('staff_chat_typing'), { until: 1 }, { expireAfterSeconds: 10 }),
      createIndex(db.collection('staff_chat_files'), { created_at: 1 }, { expireAfterSeconds: 7 * 24 * 3600 }),
      createIndex(db.collection('tenders'), { last_date: 1 }),
      createIndex(db.collection('tenders'), { expired_at: 1, last_date: 1 }),
      createIndex(db.collection('tenders'), { district: 1, last_date: 1 }),
      createIndex(db.collection('tenders'), { title: 'text' }),
      createIndex(db.collection('users'), { is_approved: 1, created_at: -1 }),
      createIndex(db.collection('users'), { email: 1 }),
      createIndex(db.collection('dispatches'), { target_id: 1, created_at: -1 }),
      createIndex(db.collection('dispatches'), { target_type: 1, employee_id: 1 }),
      createIndex(db.collection('client_requests'), { status: 1, created_at: -1 }),
      createIndex(db.collection('employees'), { deleted: 1, active: 1, emp_id: 1 }),
      createIndex(db.collection('pricing_master'), { service_key: 1 }, { unique: true }),
      createIndex(db.collection('pricing_master'), { category: 1, is_active: 1 }),
      createIndex(db.collection('doc_team_tasks'), { workflowJobId: 1 }, { unique: true }),
      createIndex(db.collection('doc_team_tasks'), { bidNumber: 1, clientEmail: 1 }, {
        unique: true,
        partialFilterExpression: { bidNumber: { $type: 'string' }, clientEmail: { $type: 'string' } },
      }),
      createIndex(db.collection('doc_team_tasks'), { lastDate: 1 }),
      createIndex(db.collection('payments'), { order_id: 1 }, { unique: true }),
      createIndex(db.collection('payments'), { email: 1, created_at: -1 }),
      createIndex(db.collection('users'), { 'subscription.planType': 1, bid_balance: 1 }),
    ]);
    global.__ttIndexesReady = true;
  })().catch((err) => {
    ensuring = null;
    console.error('[indexes] ensure failed:', err?.message || err);
  });
  return ensuring;
}
