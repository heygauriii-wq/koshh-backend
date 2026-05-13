// M4a Step 10 — DM staging operations. Per-URL buffer between webhook receive
// and pg-boss enqueue, scoped to the annotation-merge window.
//
// Save event arrives → insertStagingRows (one per URL).
// Text event arrives → tryMergeAnnotation (silent if any row merged).
// Sweeper (every 5s) → sweepReady (enqueues rows whose ready_at has passed).
//
// Pre-launch this table doubles as the saves source-of-truth. Rows persist
// after enqueued_at is set; downstream modules read history from here.

import { supabaseAdmin } from './supabase-admin';
import { boss } from '../jobs/boss';

export const MERGE_WINDOW_MS = 10_000;

type Platform = 'instagram' | 'tiktok';

export type StagingInsert = {
  user_id: string;
  sender_handle: string;
  platform: Platform;
  raw_url: string;
  url_index: number;
  annotation: string;
  tags: string[];
  attachment_type: string | null;
  ig_post_media_id: string | null;
  title: string | null;
  save_mid: string;
};

// Insert one staging row per URL. ready_at = now + window so the sweeper holds
// the row long enough for a follow-up text event to merge its annotation in.
export async function insertStagingRows(rows: StagingInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const ready_at = new Date(Date.now() + MERGE_WINDOW_MS).toISOString();
  const { error } = await supabaseAdmin
    .from('dm_staging')
    .insert(rows.map((r) => ({ ...r, ready_at })));
  if (error) throw error;
}

// Find any unmerged staging row(s) from this sender within the window and
// stamp the annotation + tags onto them. Returns the count merged so the
// webhook handler can decide whether to suppress the no_url reply (count > 0
// = the text was a power-user annotation, stay silent).
//
// "Unmerged" predicate is annotation = '' — first text event wins; subsequent
// text events fall through to no_url as today.
export async function tryMergeAnnotation(input: {
  sender_handle: string;
  platform: Platform;
  annotation: string;
  tags: string[];
}): Promise<{ merged_count: number }> {
  const cutoff = new Date(Date.now() - MERGE_WINDOW_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('dm_staging')
    .update({ annotation: input.annotation, tags: input.tags })
    .eq('sender_handle', input.sender_handle)
    .eq('platform', input.platform)
    .eq('annotation', '')
    .is('enqueued_at', null)
    .gte('created_at', cutoff)
    .select('id');
  if (error) throw error;
  return { merged_count: data?.length ?? 0 };
}

// Sweeper body — pulls all pending rows whose window has elapsed, enqueues
// each to ingest-pipeline, marks enqueued_at. Single-replica safe (Railway
// runs one instance). For concurrent sweepers we'd need FOR UPDATE SKIP
// LOCKED via an RPC; defer until that's a real constraint.
//
// boss.send failure leaves the row unmarked so the next sweep retries.
// markEnqueued failure leaves a small risk of duplicate boss.send on retry,
// but M5's worker will dedup by save_mid + url_index when it's built.
export async function sweepReady(): Promise<{ swept: number; errors: number }> {
  const { data: rows, error: selectErr } = await supabaseAdmin
    .from('dm_staging')
    .select('*')
    .lte('ready_at', new Date().toISOString())
    .is('enqueued_at', null)
    .order('ready_at', { ascending: true })
    .limit(100);
  if (selectErr) throw selectErr;
  if (!rows || rows.length === 0) return { swept: 0, errors: 0 };

  let swept = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      await boss.send('ingest-pipeline', {
        user_id: row.user_id,
        sender_handle: row.sender_handle,
        platform: row.platform,
        raw_url: row.raw_url,
        annotation: row.annotation,
        tags: row.tags,
        mid: row.save_mid,
        url_index: row.url_index,
        attachment_type: row.attachment_type ?? undefined,
        ig_post_media_id: row.ig_post_media_id ?? undefined,
        title: row.title ?? undefined,
      });

      const { error: markErr } = await supabaseAdmin
        .from('dm_staging')
        .update({ enqueued_at: new Date().toISOString() })
        .eq('id', row.id);
      if (markErr) throw markErr;

      swept++;
    } catch (e) {
      console.error(JSON.stringify({
        kind: 'dm_staging_sweep_error',
        ts: new Date().toISOString(),
        staging_id: row.id,
        save_mid: row.save_mid,
        error: e instanceof Error ? e.message : String(e),
      }));
      errors++;
    }
  }
  return { swept, errors };
}
