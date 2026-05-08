// M4a — Meta Messenger Platform webhook entry point.
// GET = subscription handshake. POST = inbound DM delivery.
//
// POST flow:
//   4a.1 Receive (Express) + drop echoes
//   4a.2 Verify HMAC + mid idempotency
//   4a.3 Parse DM body (URLs + tags + annotation)
//   4a.4 Route — link / save / no_url
//   4a.5 Validate sender against linked_handles (save path only)
//   4a.6 Send ack DM via M12 stub
//   4a.7 Hand off to M5 — boss.send('ingest-pipeline', ...) per URL
//
// Spec ack-before-pipeline-work: 4a.6 must complete before we return.
// Promise.allSettled at the end awaits both ack sends + queue pushes.

import { Router, type Request, type Response } from 'express';
import {
  captureRawBody,
  verifyMetaSignature,
  checkAndRecord,
} from '../lib/webhook-trust';
import { parseDmBody } from '../lib/dm-parser';
import { routeDM } from '../lib/dm-router';
import { handleLinkDM } from '../handlers/link-dm';
import { sendDM } from '../lib/dm-stub';
import { supabaseAdmin } from '../lib/supabase-admin';
import { boss } from '../jobs/boss';

const router = Router();

const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
if (!META_VERIFY_TOKEN) throw new Error('META_VERIFY_TOKEN is not set');

// Dev-only fallback for resolving Meta's IG-Scoped User ID to a handle when
// sender.username isn't populated and the Graph API resolver also fails (today
// the token isn't a valid Page Access Token; M12 / M13 will fix). JSON shape:
// { "<ig-scoped-id>": "<handle>" }. Empty/unset = no fallback.
const IG_HANDLE_MAP: Record<string, string> = (() => {
  const raw = process.env.META_TEST_IG_HANDLE_MAP;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, String(v).toLowerCase()]),
    );
  } catch (e) {
    console.error('META_TEST_IG_HANDLE_MAP is not valid JSON; ignoring', e);
    return {};
  }
})();

const RESOLVER_TIMEOUT_MS = 5000;

// Resolve an IG-Scoped User ID to a username via Graph API. Returns null on
// any failure (network, bad token, missing field) — caller falls back to map.
// When M12 ships a working Page Access Token, this path lights up automatically
// without any M4a code change.
async function resolveIgUsername(igScopedId: string): Promise<string | null> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESOLVER_TIMEOUT_MS);
  try {
    const url = `https://graph.facebook.com/v18.0/${encodeURIComponent(igScopedId)}?fields=username&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { username?: string };
    return body.username?.toLowerCase() ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// GET — subscription handshake. Meta hits this once per `messages` field
// subscription change. M11-owned but lives here until M11's full module ships.
router.get('/webhooks/meta', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// POST — inbound DM. captureRawBody is required for HMAC verify (raw bytes,
// not parsed JSON). Applied as global parser in server.ts (Resolution X);
// keep it in the route signature for explicitness in case server.ts changes.
router.post('/webhooks/meta', captureRawBody, async (req: Request, res: Response) => {
  // 4a.2a — signature verify
  const sig = verifyMetaSignature(req);
  if (!sig.ok) {
    if (sig.reason === 'mismatch') return res.sendStatus(401);
    if (sig.reason === 'missing_signature') return res.sendStatus(401);
    if (sig.reason === 'malformed_signature') return res.sendStatus(400);
    if (sig.reason === 'no_raw_body') return res.sendStatus(500);
    return res.sendStatus(400);
  }

  const body = req.body as MetaWebhookPayload;
  const entries = body?.entry ?? [];
  const sends: Promise<unknown>[] = [];

  for (const entry of entries) {
    for (const ev of entry.messaging ?? []) {
      // 4a.1a — drop echoes BEFORE idempotency to avoid polluting processed_webhooks
      if (ev.message?.is_echo) continue;

      const mid = ev.message?.mid;
      const senderId = ev.sender?.id;
      const text = ev.message?.text ?? '';

      // 3-tier identity resolution:
      //   1. Meta-delivered sender.username (rare for classic Page-based webhooks)
      //   2. Graph API lookup (no-ops today; works when M12 sorts the token)
      //   3. Env-var fallback map (dev unblock; remove after tier 2 lights up)
      let senderHandle = ev.sender?.username?.toLowerCase();
      if (!senderHandle && senderId) {
        senderHandle =
          (await resolveIgUsername(senderId)) ??
          IG_HANDLE_MAP[senderId];
      }

      if (!mid || !senderHandle) continue;

      // 4a.2b — idempotency
      const idem = await checkAndRecord('meta', mid);
      if (!idem.fresh) continue;

      // 4a.3 — parse
      const parsed = parseDmBody(text);

      // 4a.4 — route
      const route = routeDM(parsed, text);

      if (route === 'link') {
        sends.push(handleLinkDM({
          sender_handle: senderHandle,
          platform: 'instagram',
          body: text.trim().toLowerCase(),
          mid,
        }));
        continue;
      }

      if (route === 'no_url') {
        sends.push(sendDM({
          handle: senderHandle,
          platform: 'instagram',
          copy_key: 'no_url',
        }));
        continue;
      }

      // route === 'save' — 4a.5 sender validation
      const { data: live, error: liveErr } = await supabaseAdmin
        .from('linked_handles')
        .select('user_id')
        .eq('handle', senderHandle)
        .eq('platform', 'instagram')
        .is('unlinked_at', null)
        .maybeSingle();

      if (liveErr) throw liveErr;

      if (!live) {
        sends.push(sendDM({
          handle: senderHandle,
          platform: 'instagram',
          copy_key: 'stranger',
        }));
        continue;
      }

      // 4a.6 — ack
      sends.push(sendDM({
        handle: senderHandle,
        platform: 'instagram',
        copy_key: 'step1_ack',
      }));

      // 4a.7 — fan-out to M5: one job per URL, same mid + url_index for trace.
      // M3 invocation deferred to M5 step 5.3 per M4a DFD.
      for (let i = 0; i < parsed.urls.length; i++) {
        sends.push(
          boss.send('ingest-pipeline', {
            user_id: live.user_id,
            sender_handle: senderHandle,
            platform: 'instagram',
            raw_url: parsed.urls[i],
            annotation: parsed.annotation,
            tags: parsed.tags,
            mid,
            url_index: i,
          }),
        );
      }
    }
  }

  // ack-before-pipeline-work: await everything before responding. allSettled so
  // a single failed sendDM doesn't take down the rest of the batch. boss.send
  // is durable; if it fails we throw and let Meta retry (mid idempotency tolerates).
  await Promise.allSettled(sends);

  res.sendStatus(200);
});

export default router;

// Minimal subset of Meta's webhook payload that we actually read.
type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: Array<{
      sender?: { id?: string; username?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        attachments?: unknown[];
      };
    }>;
  }>;
};
