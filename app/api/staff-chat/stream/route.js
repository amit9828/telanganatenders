import { resolveActorRole } from '@/lib/staff-auth';
import { getDb } from '@/lib/db';
import {
  chatSenderId,
  pairFilter,
  peerReadAt,
  peerTyping,
  presenceMap,
  publicChatMessage,
  threadKey,
  touchPresence,
} from '@/lib/staff-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) {
    return new Response(JSON.stringify({ error: 'Please sign in.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const from = chatSenderId(actor);
  if (!from) {
    return new Response(JSON.stringify({ error: 'Employee ID required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const peer = String(request.nextUrl.searchParams.get('peer') || '').trim();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      let lastId = '';
      const tick = async () => {
        const db = await getDb();
        await touchPresence(db, from);
        if (!peer) {
          send('presence', { me: from, presence: await presenceMap(db, [from]) });
          return;
        }
        const filter = { thread_key: threadKey(from, peer), ...pairFilter(from, peer) };
        const latest = await db.collection('staff_chats').find(filter)
          .project({ file_base64: 0, file_url: 0 })
          .sort({ created_at: -1 })
          .limit(1)
          .toArray();
        const head = latest[0];
        const stamp = head ? String(head._id) : '';
        send('state', {
          me: from,
          peer_read_at: await peerReadAt(db, from, peer),
          peer_typing: await peerTyping(db, from, peer),
          presence: await presenceMap(db, [peer, from]),
          latest_id: stamp,
          latest: head ? publicChatMessage(head) : null,
          changed: Boolean(stamp && stamp !== lastId),
        });
        lastId = stamp || lastId;
      };
      try {
        await tick();
        const id = setInterval(() => {
          tick().catch(() => {});
        }, 2500);
        const ping = setInterval(() => {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        }, 15000);
        if (request.signal) {
          request.signal.addEventListener('abort', () => {
            clearInterval(id);
            clearInterval(ping);
            try { controller.close(); } catch { /* already closed */ }
          });
        }
      } catch {
        controller.close();
      }
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
