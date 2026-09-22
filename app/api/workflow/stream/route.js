import { resolveActorRole, resolveClientEmail } from '@/lib/staff-auth';
import { canSeeJob } from '@/lib/workflow';
import { subscribeWorkflowEvents } from '@/lib/workflow-events';
import { clientIdentFromRequest, findExistingClient } from '@/lib/clients';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function staffPayload(event) {
  return {
    jobId: String(event.jobId || ''),
    status: event.status || '',
    tracking_status: event.tracking_status || '',
    display_status: event.display_status || '',
    updated_at: event.updated_at || '',
    archived: Boolean(event.archived),
  };
}

function clientPayload(event) {
  return staffPayload(event);
}

export async function GET(request) {
  const actor = await resolveActorRole(request);
  let mode = 'staff';
  let clientEmail = '';
  if (!actor?.role && !actor?.empId) {
    const ident = clientIdentFromRequest(request) || (await resolveClientEmail(request)) || '';
    if (!ident) {
      return new Response(JSON.stringify({ error: 'Please sign in.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const db = await getDb();
    const user = await findExistingClient(db, ident);
    if (!user?.email) {
      return new Response(JSON.stringify({ error: 'Client not found.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    mode = 'client';
    clientEmail = String(user.email).toLowerCase();
  }

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (event) => {
        if (!event?.jobId) return;
        if (mode === 'client') {
          if (String(event.client_email || '').toLowerCase() !== clientEmail) return;
          controller.enqueue(encoder.encode(`event: job\ndata: ${JSON.stringify(clientPayload(event))}\n\n`));
          return;
        }
        const visible = canSeeJob(actor, {
          status: event.status,
          assigned_emp_id: event.assigned_emp_id,
          team_id: event.team_id,
          routed_tl_emp_id: event.routed_tl_emp_id,
        });
        if (!visible) return;
        controller.enqueue(encoder.encode(`event: job\ndata: ${JSON.stringify(staffPayload(event))}\n\n`));
      };
      unsubscribe = subscribeWorkflowEvents(send);
      ping = setInterval(() => {
        try { controller.enqueue(encoder.encode(': ping\n\n')); } catch { /* closed */ }
      }, 15000);
      if (request.signal) {
        request.signal.addEventListener('abort', () => {
          clearInterval(ping);
          unsubscribe();
          try { controller.close(); } catch { /* already closed */ }
        });
      }
    },
    cancel() {
      clearInterval(ping);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'private, no-store',
      Connection: 'keep-alive',
    },
  });
}
