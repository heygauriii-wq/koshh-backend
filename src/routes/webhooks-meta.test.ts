import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';
import webhooksMetaRouter from './webhooks-meta';
import { supabaseAdmin } from '../lib/supabase-admin';
import * as dmStub from '../lib/dm-stub';
import * as bossModule from '../jobs/boss';

// Adapted from build guide §4.6: real boss exports a `boss` singleton (not a
// getBoss accessor), so the mock shape mirrors that.
vi.mock('../lib/dm-stub', () => ({ sendDM: vi.fn() }));
vi.mock('../jobs/boss', () => ({
  boss: { send: vi.fn().mockResolvedValue('job-id-mock') },
}));

const SECRET = process.env.META_APP_SECRET!;

function sign(buf: Buffer): string {
  return 'sha256=' + crypto.createHmac('sha256', SECRET).update(buf).digest('hex');
}

function makeApp() {
  const app = express();
  app.use('/', webhooksMetaRouter);
  return app;
}

function makeBody(opts: {
  mid: string;
  text: string;
  username: string;
  isEcho?: boolean;
  attachments?: Array<{ type: string; payload: Record<string, unknown> }>;
}) {
  return {
    object: 'instagram',
    entry: [{
      id: 'page_123',
      time: Date.now(),
      messaging: [{
        sender: { id: 'sid', username: opts.username },
        recipient: { id: 'rid' },
        timestamp: Date.now(),
        message: {
          mid: opts.mid,
          text: opts.text,
          is_echo: opts.isEcho ?? false,
          ...(opts.attachments ? { attachments: opts.attachments } : {}),
        },
      }],
    }],
  };
}

// Sends the JSON STRING (not a Buffer) — supertest's .send(Buffer) with
// content-type: application/json doesn't deliver bytes intact through
// superagent. String round-trips byte-stably with our HMAC signing.
async function postSigned(app: express.Express, body: object) {
  const json = JSON.stringify(body);
  return request(app)
    .post('/webhooks/meta')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', sign(Buffer.from(json, 'utf8')))
    .send(json);
}

async function seedLinkedHandle(handle: string) {
  const { data: u } = await supabaseAdmin.auth.admin.createUser({
    email: `webhooks-test-${Date.now()}-${Math.random()}@koshh.test`,
    email_confirm: true,
  });
  const userId = u.user!.id;
  await supabaseAdmin
    .from('linked_handles')
    .insert({ user_id: userId, handle, platform: 'instagram' });
  return userId;
}

// File-scoped 'vitest_wh_' prefix prevents cross-file cleanup races —
// idempotency.test.ts uses 'vitest_idem_'.
async function cleanup() {
  await supabaseAdmin.from('processed_webhooks').delete().like('key', 'meta:vitest_wh_%');
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, email')
    .like('email', 'webhooks-test-%@koshh.test');
  for (const u of users ?? []) {
    await supabaseAdmin.auth.admin.deleteUser(u.id);
  }
}

describe('POST /webhooks/meta', () => {
  beforeEach(async () => {
    await cleanup();
    vi.mocked(dmStub.sendDM).mockClear();
    vi.mocked(bossModule.boss.send).mockClear();
  });
  afterAll(cleanup);

  it('rejects an unsigned POST with 401', async () => {
    const app = makeApp();
    const body = makeBody({ mid: 'vitest_wh_unsigned', text: 'hi', username: 'x' });
    const res = await request(app).post('/webhooks/meta').send(body);
    expect(res.status).toBe(401);
  });

  it('rejects a tampered signature with 401', async () => {
    const app = makeApp();
    const body = makeBody({ mid: 'vitest_wh_bad_sig', text: 'hi', username: 'x' });
    const json = JSON.stringify(body);
    const wrongSig = 'sha256=' + 'a'.repeat(64);
    const res = await request(app)
      .post('/webhooks/meta')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', wrongSig)
      .send(json);
    expect(res.status).toBe(401);
  });

  it('drops echoes silently', async () => {
    const app = makeApp();
    const body = makeBody({ mid: 'vitest_wh_echo', text: 'hi', username: 'x', isEcho: true });
    const res = await postSigned(app, body);
    expect(res.status).toBe(200);
    expect(vi.mocked(dmStub.sendDM)).not.toHaveBeenCalled();
    expect(vi.mocked(bossModule.boss.send)).not.toHaveBeenCalled();
  });

  it('processes a save DM end-to-end (inserts staging row, not direct boss.send)', async () => {
    const userId = await seedLinkedHandle('vitest_handle');
    const app = makeApp();
    const mid = `vitest_wh_save_${Date.now()}`;
    const body = makeBody({
      mid,
      text: 'great hook https://insta.com/reel/abc #funny',
      username: 'vitest_handle',
    });
    const res = await postSigned(app, body);

    expect(res.status).toBe(200);
    expect(vi.mocked(dmStub.sendDM)).toHaveBeenCalledWith(
      expect.objectContaining({ copy_key: 'step1_ack', handle: 'vitest_handle' }),
    );
    // Step 10: boss.send is deferred to the sweeper. Webhook just stages.
    expect(vi.mocked(bossModule.boss.send)).not.toHaveBeenCalled();

    const { data: rows } = await supabaseAdmin
      .from('dm_staging')
      .select('*')
      .eq('save_mid', mid);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({
      user_id: userId,
      sender_handle: 'vitest_handle',
      platform: 'instagram',
      raw_url: 'https://insta.com/reel/abc',
      tags: ['funny'],
      annotation: 'great hook',
      url_index: 0,
      enqueued_at: null,
    });
  });

  it('returns 200 silently on duplicate mid', async () => {
    await seedLinkedHandle('vitest_dup');
    const app = makeApp();
    const mid = `vitest_wh_dup_${Date.now()}`;
    const body = makeBody({ mid, text: 'https://x', username: 'vitest_dup' });

    const first = await postSigned(app, body);
    expect(first.status).toBe(200);

    vi.mocked(dmStub.sendDM).mockClear();

    const second = await postSigned(app, body);
    expect(second.status).toBe(200);
    expect(vi.mocked(dmStub.sendDM)).not.toHaveBeenCalled();

    // Idempotency: only one staging row total across both deliveries.
    const { data: rows } = await supabaseAdmin
      .from('dm_staging')
      .select('id')
      .eq('save_mid', mid);
    expect(rows).toHaveLength(1);
  });

  it('replies "stranger" when sender handle is not linked', async () => {
    const app = makeApp();
    const mid = `vitest_wh_stranger_${Date.now()}`;
    const body = makeBody({
      mid,
      text: 'https://insta.com/reel/x',
      username: 'never_linked_handle',
    });
    const res = await postSigned(app, body);

    expect(res.status).toBe(200);
    expect(vi.mocked(dmStub.sendDM)).toHaveBeenCalledWith(
      expect.objectContaining({ copy_key: 'stranger', handle: 'never_linked_handle' }),
    );
    // Stranger path bails before staging — no row inserted.
    const { data: rows } = await supabaseAdmin
      .from('dm_staging')
      .select('id')
      .eq('save_mid', mid);
    expect(rows).toHaveLength(0);
  });

  it('threads ig_post_media_id and title into the staging row for share attachments', async () => {
    const userId = await seedLinkedHandle('vitest_meta');
    const app = makeApp();
    const mid = `vitest_wh_meta_${Date.now()}`;
    const body = makeBody({
      mid,
      text: '',
      username: 'vitest_meta',
      attachments: [
        {
          type: 'ig_post',
          payload: {
            url: 'https://lookaside.fbsbx.com/abc',
            ig_post_media_id: '17891234567890',
            title: 'creator caption from IG',
          },
        },
      ],
    });
    const res = await postSigned(app, body);

    expect(res.status).toBe(200);
    const { data: rows } = await supabaseAdmin
      .from('dm_staging')
      .select('*')
      .eq('save_mid', mid);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({
      user_id: userId,
      raw_url: 'https://lookaside.fbsbx.com/abc',
      attachment_type: 'ig_post',
      ig_post_media_id: '17891234567890',
      title: 'creator caption from IG',
    });
  });

  it('replies "no_url" on text-only DMs (no recent save to merge into)', async () => {
    await seedLinkedHandle('vitest_nourl');
    const app = makeApp();
    const body = makeBody({
      mid: `vitest_wh_no_url_${Date.now()}`,
      text: 'just chatting',
      username: 'vitest_nourl',
    });
    const res = await postSigned(app, body);

    expect(res.status).toBe(200);
    expect(vi.mocked(dmStub.sendDM)).toHaveBeenCalledWith(
      expect.objectContaining({ copy_key: 'no_url' }),
    );
  });

  it('merges annotation into recent staging row and suppresses no_url reply', async () => {
    const userId = await seedLinkedHandle('vitest_merge');
    const app = makeApp();
    const saveMid = `vitest_wh_save_for_merge_${Date.now()}`;
    const textMid = `vitest_wh_text_for_merge_${Date.now()}`;

    // First: the save event with an attachment share. Stages a row, sends step1_ack.
    const saveRes = await postSigned(app, makeBody({
      mid: saveMid,
      text: '',
      username: 'vitest_merge',
      attachments: [
        {
          type: 'ig_reel',
          payload: { url: 'https://www.instagram.com/reel/Cabc/' },
        },
      ],
    }));
    expect(saveRes.status).toBe(200);
    expect(vi.mocked(dmStub.sendDM)).toHaveBeenCalledWith(
      expect.objectContaining({ copy_key: 'step1_ack' }),
    );

    vi.mocked(dmStub.sendDM).mockClear();

    // Then: a follow-up text event from same sender (the power-user annotation).
    const textRes = await postSigned(app, makeBody({
      mid: textMid,
      text: 'great hook #funny',
      username: 'vitest_merge',
    }));
    expect(textRes.status).toBe(200);

    // No second reply — the annotation merged silently.
    expect(vi.mocked(dmStub.sendDM)).not.toHaveBeenCalled();

    // Staging row got the annotation + tags.
    const { data: rows } = await supabaseAdmin
      .from('dm_staging')
      .select('annotation, tags, user_id')
      .eq('save_mid', saveMid);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({
      user_id: userId,
      annotation: 'great hook',
      tags: ['funny'],
    });
  });
});
