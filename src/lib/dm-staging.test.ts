import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { supabaseAdmin } from './supabase-admin';
import {
  insertStagingRows,
  tryMergeAnnotation,
  sweepReady,
  MERGE_WINDOW_MS,
  type StagingInsert,
} from './dm-staging';
import * as bossModule from '../jobs/boss';

vi.mock('../jobs/boss', () => ({
  boss: { send: vi.fn().mockResolvedValue('job-id-mock') },
}));

async function seedUser(): Promise<string> {
  const { data: u } = await supabaseAdmin.auth.admin.createUser({
    email: `dm-staging-test-${Date.now()}-${Math.random()}@koshh.test`,
    email_confirm: true,
  });
  return u.user!.id;
}

async function cleanup() {
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, email')
    .like('email', 'dm-staging-test-%@koshh.test');
  for (const u of users ?? []) {
    await supabaseAdmin.auth.admin.deleteUser(u.id);
  }
}

function makeRow(overrides: Partial<StagingInsert>): StagingInsert {
  return {
    user_id: '00000000-0000-0000-0000-000000000000',
    sender_handle: 'test_handle',
    platform: 'instagram',
    raw_url: 'https://example.com/post',
    url_index: 0,
    annotation: '',
    tags: [],
    attachment_type: null,
    ig_post_media_id: null,
    title: null,
    save_mid: `mid_${Date.now()}_${Math.random()}`,
    ...overrides,
  };
}

describe('dm-staging', () => {
  beforeEach(async () => {
    await cleanup();
    vi.mocked(bossModule.boss.send).mockClear();
  });
  afterAll(cleanup);

  describe('insertStagingRows', () => {
    it('inserts one row per URL with ready_at = now + window', async () => {
      const userId = await seedUser();
      const handle = `vit_ins_${Date.now()}`;
      const before = Date.now();

      await insertStagingRows([
        makeRow({ user_id: userId, sender_handle: handle, raw_url: 'https://a.com/1', url_index: 0 }),
        makeRow({ user_id: userId, sender_handle: handle, raw_url: 'https://a.com/2', url_index: 1 }),
      ]);

      const after = Date.now();
      const { data: rows } = await supabaseAdmin
        .from('dm_staging')
        .select('*')
        .eq('sender_handle', handle)
        .order('url_index');

      expect(rows).toHaveLength(2);
      expect(rows![0].raw_url).toBe('https://a.com/1');
      expect(rows![1].raw_url).toBe('https://a.com/2');

      const ready = new Date(rows![0].ready_at).getTime();
      expect(ready).toBeGreaterThanOrEqual(before + MERGE_WINDOW_MS - 50);
      expect(ready).toBeLessThanOrEqual(after + MERGE_WINDOW_MS + 50);
      expect(rows![0].enqueued_at).toBeNull();
    });

    it('no-op on empty array', async () => {
      await expect(insertStagingRows([])).resolves.toBeUndefined();
    });
  });

  describe('tryMergeAnnotation', () => {
    it('updates all unfilled rows from same sender within window', async () => {
      const userId = await seedUser();
      const handle = `vit_merge_${Date.now()}`;

      await insertStagingRows([
        makeRow({ user_id: userId, sender_handle: handle, raw_url: 'https://a.com/1', url_index: 0 }),
        makeRow({ user_id: userId, sender_handle: handle, raw_url: 'https://a.com/2', url_index: 1 }),
      ]);

      const r = await tryMergeAnnotation({
        sender_handle: handle,
        platform: 'instagram',
        annotation: 'great hook',
        tags: ['funny'],
      });

      expect(r.merged_count).toBe(2);

      const { data: rows } = await supabaseAdmin
        .from('dm_staging')
        .select('annotation, tags')
        .eq('sender_handle', handle);
      expect(rows![0].annotation).toBe('great hook');
      expect(rows![0].tags).toEqual(['funny']);
      expect(rows![1].annotation).toBe('great hook');
    });

    it('returns merged_count=0 when no recent unfilled row exists', async () => {
      const handle = `vit_nomerge_${Date.now()}`;

      const r = await tryMergeAnnotation({
        sender_handle: handle,
        platform: 'instagram',
        annotation: 'orphan text',
        tags: [],
      });

      expect(r.merged_count).toBe(0);
    });

    it('does NOT merge when the row already has an annotation', async () => {
      const userId = await seedUser();
      const handle = `vit_filled_${Date.now()}`;

      await insertStagingRows([
        makeRow({ user_id: userId, sender_handle: handle, annotation: 'already set' }),
      ]);

      const r = await tryMergeAnnotation({
        sender_handle: handle,
        platform: 'instagram',
        annotation: 'second text',
        tags: [],
      });

      expect(r.merged_count).toBe(0);
    });

    it('does NOT merge a row that is already enqueued', async () => {
      const userId = await seedUser();
      const handle = `vit_enqd_${Date.now()}`;

      await insertStagingRows([
        makeRow({ user_id: userId, sender_handle: handle }),
      ]);
      // Simulate the sweeper having already enqueued
      await supabaseAdmin
        .from('dm_staging')
        .update({ enqueued_at: new Date().toISOString() })
        .eq('sender_handle', handle);

      const r = await tryMergeAnnotation({
        sender_handle: handle,
        platform: 'instagram',
        annotation: 'too late',
        tags: [],
      });

      expect(r.merged_count).toBe(0);
    });

    it('does NOT merge a row older than the window', async () => {
      const userId = await seedUser();
      const handle = `vit_old_${Date.now()}`;

      await insertStagingRows([
        makeRow({ user_id: userId, sender_handle: handle }),
      ]);
      // Backdate created_at past the window
      const stale = new Date(Date.now() - MERGE_WINDOW_MS - 1000).toISOString();
      await supabaseAdmin
        .from('dm_staging')
        .update({ created_at: stale })
        .eq('sender_handle', handle);

      const r = await tryMergeAnnotation({
        sender_handle: handle,
        platform: 'instagram',
        annotation: 'stale match',
        tags: [],
      });

      expect(r.merged_count).toBe(0);
    });
  });

  describe('sweepReady', () => {
    it('enqueues rows whose ready_at has passed and marks enqueued_at', async () => {
      const userId = await seedUser();
      const handle = `vit_sweep_${Date.now()}`;

      await insertStagingRows([
        makeRow({
          user_id: userId,
          sender_handle: handle,
          raw_url: 'https://insta.com/p/x',
          annotation: 'merged note',
          tags: ['vibe'],
          attachment_type: 'ig_post',
          ig_post_media_id: '17891',
          title: 'creator caption',
        }),
      ]);
      // Backdate ready_at so it's eligible right now
      await supabaseAdmin
        .from('dm_staging')
        .update({ ready_at: new Date(Date.now() - 1000).toISOString() })
        .eq('sender_handle', handle);

      const result = await sweepReady();
      expect(result.swept).toBeGreaterThanOrEqual(1);
      expect(result.errors).toBe(0);

      expect(vi.mocked(bossModule.boss.send)).toHaveBeenCalledWith(
        'ingest-pipeline',
        expect.objectContaining({
          user_id: userId,
          sender_handle: handle,
          raw_url: 'https://insta.com/p/x',
          annotation: 'merged note',
          tags: ['vibe'],
          attachment_type: 'ig_post',
          ig_post_media_id: '17891',
          title: 'creator caption',
          url_index: 0,
        }),
      );

      const { data: rows } = await supabaseAdmin
        .from('dm_staging')
        .select('enqueued_at')
        .eq('sender_handle', handle);
      expect(rows![0].enqueued_at).not.toBeNull();
    });

    it('does NOT enqueue rows whose ready_at is still in the future', async () => {
      const userId = await seedUser();
      const handle = `vit_notready_${Date.now()}`;

      await insertStagingRows([
        makeRow({ user_id: userId, sender_handle: handle }),
      ]);

      const result = await sweepReady();

      const { data: rows } = await supabaseAdmin
        .from('dm_staging')
        .select('enqueued_at')
        .eq('sender_handle', handle);

      expect(rows![0].enqueued_at).toBeNull();
      // Other tests in the run may have left ready rows from cascade-cleanup races;
      // we just assert OUR row stayed unmarked. result.swept may be 0 or more.
      void result;
    });

    it('does NOT double-enqueue a row that was already swept', async () => {
      const userId = await seedUser();
      const handle = `vit_doubleguard_${Date.now()}`;

      await insertStagingRows([
        makeRow({ user_id: userId, sender_handle: handle }),
      ]);
      await supabaseAdmin
        .from('dm_staging')
        .update({
          ready_at: new Date(Date.now() - 1000).toISOString(),
          enqueued_at: new Date().toISOString(),
        })
        .eq('sender_handle', handle);

      vi.mocked(bossModule.boss.send).mockClear();
      const result = await sweepReady();

      // boss.send should not have been called for OUR row (already enqueued).
      // Other unrelated rows in the table may still be picked up — we assert
      // that no call had OUR sender_handle in its payload.
      const callsForOurRow = vi.mocked(bossModule.boss.send).mock.calls.filter(
        (call) => (call[1] as { sender_handle?: string })?.sender_handle === handle,
      );
      expect(callsForOurRow).toHaveLength(0);
      void result;
    });
  });
});
