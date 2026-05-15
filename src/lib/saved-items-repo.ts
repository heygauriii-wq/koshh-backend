// Module 5 — single owner of all writes to saved_items, view_snapshots, and
// creator_profiles. Pipeline code calls these functions; no `UPDATE saved_items
// SET ...` lives outside this file (DFD note #5).

import { supabaseAdmin } from './supabase-admin';
import type { ScrapedItem, CreatorProfile, Platform } from './apify/types';

export type { Platform } from './apify/types';

export type UpsertSaveInput = {
  user_id: string;
  platform: Platform;
  post_id: string;
  canonical_url: string;
  saved_by_handle: string;
  saved_by_platform: Platform;
  annotation: string | null;
  tags: string[];
};

export type UpsertResult = {
  id: string;
  was_inserted: boolean;
};

// Step 3.5 — atomic insert-or-update on (user_id, platform, post_id).
// was_inserted comes from the (xmax = 0) trick in the RPC; PostgREST would
// strip that internal column otherwise.
export async function upsertOnSave(input: UpsertSaveInput): Promise<UpsertResult> {
  const { data, error } = await supabaseAdmin.rpc('upsert_saved_item', {
    p_user_id: input.user_id,
    p_platform: input.platform,
    p_post_id: input.post_id,
    p_canonical_url: input.canonical_url,
    p_saved_by_handle: input.saved_by_handle,
    p_saved_by_platform: input.saved_by_platform,
    p_annotation: input.annotation,
    p_tags: input.tags,
  });

  if (error) throw new Error(`upsertOnSave failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error('upsertOnSave returned no rows');

  return { id: data[0].id, was_inserted: data[0].was_inserted };
}

// Step 4 — write scraped content. transcript_segments stays null in MVP
// (the reel actor returns flat text only); hook stays null until M5a ships.
export async function updateScrapedContent(id: string, item: ScrapedItem): Promise<void> {
  const { error } = await supabaseAdmin
    .from('saved_items')
    .update({
      caption: item.caption,
      author_handle: item.author_handle,
      post_date: item.post_date,
      transcript: item.transcript,
      content_state: item.content_state,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(`updateScrapedContent failed: ${error.message}`);
}

// Step 5 — media stub (M6 swap target).
export async function updateMedia(
  id: string,
  embed_url: string,
  thumbnail_path: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('saved_items')
    .update({
      embed_url,
      thumbnail_path,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(`updateMedia failed: ${error.message}`);
}

// Step 6 — deferred to M5a; left exported so M5a's diff is a pipeline-only add.
export async function updateHook(id: string, hook: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from('saved_items')
    .update({ hook, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`updateHook failed: ${error.message}`);
}

// Step 7 — retry exhaustion path.
export async function markFailed(id: string, last_error: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('saved_items')
    .update({
      pipeline_status: 'failed',
      last_error,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(`markFailed failed: ${error.message}`);
}

// Step 7 — gate for the in-code retry loop. Returns the post-increment value.
export async function incrementRetryCount(id: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('increment_retry_count', { p_id: id });
  if (error) throw new Error(`incrementRetryCount failed: ${error.message}`);
  return data as number;
}

// Step 8 — virality mirror (latest snapshot's coefficient + signals).
export async function updateVirality(
  id: string,
  virality_coefficient: number,
  current_signals: object,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('saved_items')
    .update({
      virality_coefficient,
      current_signals,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(`updateVirality failed: ${error.message}`);
}

// Step 9 — terminal happy state.
export async function markReady(id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('saved_items')
    .update({ pipeline_status: 'ready', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`markReady failed: ${error.message}`);
}

// Step 4 — content unavailable path: delete the row we just inserted at 3.5.
// The pipeline_status='processing' guard is defensive; if the row somehow got
// marked ready between 3.5 and 5.4 (it shouldn't, single worker), we don't
// want to nuke a ready row.
export async function discardForContentUnavailable(
  user_id: string,
  platform: Platform,
  post_id: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('saved_items')
    .delete()
    .eq('user_id', user_id)
    .eq('platform', platform)
    .eq('post_id', post_id)
    .eq('pipeline_status', 'processing');
  if (error) throw new Error(`discardForContentUnavailable failed: ${error.message}`);
}

// Step 7 — first snapshot row. M8 will write the rest.
export async function insertViewSnapshot(snapshot: {
  item_id: string;
  views: number;
  likes: number | null;
  comments: number | null;
  follower_count: number | null;
  virality_coefficient: number | null;
  signals: object | null;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('view_snapshots')
    .insert(snapshot);
  if (error) throw new Error(`insertViewSnapshot failed: ${error.message}`);
}

// Step 4.5 — cache read. TTL gate lives in the orchestrator, not here.
export async function getCreatorProfile(
  platform: Platform,
  handle: string,
): Promise<CreatorProfile | null> {
  const { data, error } = await supabaseAdmin
    .from('creator_profiles')
    .select('platform, handle, follower_count, follows_count, fetched_at')
    .eq('platform', platform)
    .eq('handle', handle)
    .maybeSingle();
  if (error) throw new Error(`getCreatorProfile failed: ${error.message}`);
  return (data as CreatorProfile | null) ?? null;
}

// Step 4.5 — cache write. Stamps fetched_at = now() on every call.
export async function upsertCreatorProfile(input: {
  platform: Platform;
  handle: string;
  follower_count: number | null;
  follows_count: number | null;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('creator_profiles')
    .upsert(
      {
        platform: input.platform,
        handle: input.handle,
        follower_count: input.follower_count,
        follows_count: input.follows_count,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'platform,handle' },
    );
  if (error) throw new Error(`upsertCreatorProfile failed: ${error.message}`);
}
