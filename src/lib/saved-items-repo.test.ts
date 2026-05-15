import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { supabaseAdmin } from './supabase-admin';
import {
  upsertOnSave,
  updateScrapedContent,
  updateMedia,
  markFailed,
  markReady,
  incrementRetryCount,
  updateVirality,
  insertViewSnapshot,
  discardForContentUnavailable,
  getCreatorProfile,
  upsertCreatorProfile,
} from './saved-items-repo';
import type { ScrapedItem } from './apify/types';

const EMAIL_PREFIX = 'm5-repo-test-';

async function seedUser(): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: `${EMAIL_PREFIX}${Date.now()}-${Math.random()}@koshh.test`,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user!.id;
}

async function cleanup() {
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, email')
    .like('email', `${EMAIL_PREFIX}%@koshh.test`);
  for (const u of users ?? []) {
    await supabaseAdmin.auth.admin.deleteUser(u.id);
  }
  await supabaseAdmin
    .from('creator_profiles')
    .delete()
    .like('handle', 'm5-test-%');
}

function sampleScraped(overrides: Partial<ScrapedItem> = {}): ScrapedItem {
  return {
    caption: 'sample caption',
    author_handle: 'sample_creator',
    author_id: '407580734',
    post_date: '2026-04-01T00:00:00Z',
    thumbnail_url: 'https://example.test/thumb.jpg',
    view_count: 1000,
    like_count: 50,
    comments_count: 10,
    transcript: 'hello world',
    content_state: 'active',
    ...overrides,
  };
}

describe('saved-items-repo', () => {
  let userId: string;

  beforeEach(async () => {
    userId = await seedUser();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('inserts on first call (was_inserted=true)', async () => {
    const r = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_INSERT_001',
      canonical_url: 'https://www.instagram.com/reel/CASE_INSERT_001/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: 'first',
      tags: ['m5-test'],
    });
    expect(r.was_inserted).toBe(true);
    expect(r.id).toBeTruthy();
  });

  it('updates on second call with same (user_id, platform, post_id); tags + annotation UNION', async () => {
    const r1 = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_UPDATE_002',
      canonical_url: 'https://www.instagram.com/reel/CASE_UPDATE_002/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: 'first',
      tags: ['old'],
    });
    const r2 = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_UPDATE_002',
      canonical_url: 'https://www.instagram.com/reel/CASE_UPDATE_002/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: 'second',
      tags: ['new'],
    });
    expect(r2.was_inserted).toBe(false);
    expect(r2.id).toBe(r1.id);

    const { data } = await supabaseAdmin
      .from('saved_items')
      .select('tags, annotation')
      .eq('id', r1.id)
      .single();
    expect(data?.tags).toEqual(['old', 'new']);
    expect(data?.annotation).toBe('first\nsecond');
  });

  it('re-DM with identical annotation does NOT duplicate it (line dedup)', async () => {
    const r1 = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_DEDUP_ANN_011',
      canonical_url: 'https://www.instagram.com/reel/CASE_DEDUP_ANN_011/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: 'same note',
      tags: [],
    });
    await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_DEDUP_ANN_011',
      canonical_url: 'https://www.instagram.com/reel/CASE_DEDUP_ANN_011/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: 'same note',
      tags: [],
    });
    const { data } = await supabaseAdmin
      .from('saved_items')
      .select('annotation')
      .eq('id', r1.id)
      .single();
    expect(data?.annotation).toBe('same note');
  });

  it('re-DM with overlapping tags does NOT duplicate them (tag dedup)', async () => {
    const r1 = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_DEDUP_TAGS_012',
      canonical_url: 'https://www.instagram.com/reel/CASE_DEDUP_TAGS_012/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: null,
      tags: ['fitness', 'morning'],
    });
    await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_DEDUP_TAGS_012',
      canonical_url: 'https://www.instagram.com/reel/CASE_DEDUP_TAGS_012/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: null,
      tags: ['morning', 'routine'],
    });
    const { data } = await supabaseAdmin
      .from('saved_items')
      .select('tags')
      .eq('id', r1.id)
      .single();
    expect(data?.tags).toEqual(['fitness', 'morning', 'routine']);
  });

  it('re-DM with empty new annotation keeps the existing one (never overwrites with empty)', async () => {
    const r1 = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_EMPTY_NEW_013',
      canonical_url: 'https://www.instagram.com/reel/CASE_EMPTY_NEW_013/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: 'my note',
      tags: [],
    });
    await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_EMPTY_NEW_013',
      canonical_url: 'https://www.instagram.com/reel/CASE_EMPTY_NEW_013/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: null,
      tags: [],
    });
    const { data } = await supabaseAdmin
      .from('saved_items')
      .select('annotation')
      .eq('id', r1.id)
      .single();
    expect(data?.annotation).toBe('my note');
  });

  it('re-DM with new annotation when existing was empty: takes the new value verbatim', async () => {
    const r1 = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_EMPTY_OLD_014',
      canonical_url: 'https://www.instagram.com/reel/CASE_EMPTY_OLD_014/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: null,
      tags: [],
    });
    await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_EMPTY_OLD_014',
      canonical_url: 'https://www.instagram.com/reel/CASE_EMPTY_OLD_014/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: 'second note',
      tags: [],
    });
    const { data } = await supabaseAdmin
      .from('saved_items')
      .select('annotation')
      .eq('id', r1.id)
      .single();
    expect(data?.annotation).toBe('second note');
  });

  it('updateScrapedContent + markReady + state transitions', async () => {
    const { id } = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_FLOW_003',
      canonical_url: 'https://www.instagram.com/reel/CASE_FLOW_003/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: null,
      tags: [],
    });
    await updateScrapedContent(id, sampleScraped({ caption: 'after scrape' }));
    await updateMedia(id, 'https://www.instagram.com/reel/CASE_FLOW_003/embed', null);
    await markReady(id);

    const { data } = await supabaseAdmin
      .from('saved_items')
      .select('pipeline_status, caption, embed_url')
      .eq('id', id)
      .single();
    expect(data?.pipeline_status).toBe('ready');
    expect(data?.caption).toBe('after scrape');
    expect(data?.embed_url).toBe('https://www.instagram.com/reel/CASE_FLOW_003/embed');
  });

  it('markFailed sets pipeline_status=failed and last_error', async () => {
    const { id } = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_FAIL_004',
      canonical_url: 'https://www.instagram.com/reel/CASE_FAIL_004/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: null,
      tags: [],
    });
    await markFailed(id, 'test_reason');
    const { data } = await supabaseAdmin
      .from('saved_items')
      .select('pipeline_status, last_error')
      .eq('id', id)
      .single();
    expect(data?.pipeline_status).toBe('failed');
    expect(data?.last_error).toBe('test_reason');
  });

  it('incrementRetryCount returns post-increment value', async () => {
    const { id } = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_RETRY_005',
      canonical_url: 'https://www.instagram.com/reel/CASE_RETRY_005/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: null,
      tags: [],
    });
    expect(await incrementRetryCount(id)).toBe(1);
    expect(await incrementRetryCount(id)).toBe(2);
    expect(await incrementRetryCount(id)).toBe(3);
  });

  it('updateVirality writes coefficient and signals', async () => {
    const { id } = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_VIR_006',
      canonical_url: 'https://www.instagram.com/reel/CASE_VIR_006/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: null,
      tags: [],
    });
    await updateVirality(id, 0.42, { src: 'unit-test' });
    const { data } = await supabaseAdmin
      .from('saved_items')
      .select('virality_coefficient, current_signals')
      .eq('id', id)
      .single();
    expect(data?.virality_coefficient).toBe(0.42);
    expect(data?.current_signals).toEqual({ src: 'unit-test' });
  });

  it('insertViewSnapshot appends a row keyed to item_id', async () => {
    const { id } = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_SNAP_007',
      canonical_url: 'https://www.instagram.com/reel/CASE_SNAP_007/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: null,
      tags: [],
    });
    await insertViewSnapshot({
      item_id: id,
      views: 1000,
      likes: 50,
      comments: 10,
      follower_count: 5000,
      virality_coefficient: null,
      signals: null,
    });
    const { data } = await supabaseAdmin
      .from('view_snapshots')
      .select('views, likes, comments, follower_count')
      .eq('item_id', id);
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({ views: 1000, likes: 50, comments: 10, follower_count: 5000 });
  });

  it('discardForContentUnavailable only deletes when pipeline_status=processing', async () => {
    const { id } = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_DISCARD_008',
      canonical_url: 'https://www.instagram.com/reel/CASE_DISCARD_008/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: null,
      tags: [],
    });
    await discardForContentUnavailable(userId, 'instagram', 'CASE_DISCARD_008');
    const { data } = await supabaseAdmin
      .from('saved_items')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it('discardForContentUnavailable does NOT delete a ready row (defensive guard)', async () => {
    const { id } = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_DISCARD_GUARD_009',
      canonical_url: 'https://www.instagram.com/reel/CASE_DISCARD_GUARD_009/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: null,
      tags: [],
    });
    await markReady(id);
    await discardForContentUnavailable(userId, 'instagram', 'CASE_DISCARD_GUARD_009');
    const { data } = await supabaseAdmin
      .from('saved_items')
      .select('id, pipeline_status')
      .eq('id', id)
      .maybeSingle();
    expect(data?.pipeline_status).toBe('ready');
  });

  it('FTS search_tsv matches annotation/caption/transcript content', async () => {
    const { id } = await upsertOnSave({
      user_id: userId,
      platform: 'instagram',
      post_id: 'CASE_FTS_010',
      canonical_url: 'https://www.instagram.com/reel/CASE_FTS_010/',
      saved_by_handle: 'tester',
      saved_by_platform: 'instagram',
      annotation: 'fitness routine',
      tags: [],
    });
    await updateScrapedContent(
      id,
      sampleScraped({ caption: 'morning workout', transcript: 'so today I want to talk' }),
    );
    const { data } = await supabaseAdmin
      .from('saved_items')
      .select('id')
      .textSearch('search_tsv', 'fitness', { config: 'simple' });
    expect(data?.some((r) => r.id === id)).toBe(true);
  });

  it('getCreatorProfile returns null on miss, upsertCreatorProfile makes it return a row', async () => {
    const handle = `m5-test-${Date.now()}`;
    expect(await getCreatorProfile('instagram', handle)).toBeNull();
    await upsertCreatorProfile({
      platform: 'instagram',
      handle,
      follower_count: 12345,
      follows_count: 67,
    });
    const profile = await getCreatorProfile('instagram', handle);
    expect(profile).not.toBeNull();
    expect(profile?.follower_count).toBe(12345);
    expect(profile?.follows_count).toBe(67);
  });

  it('upsertCreatorProfile updates an existing row on conflict (platform, handle)', async () => {
    const handle = `m5-test-update-${Date.now()}`;
    await upsertCreatorProfile({
      platform: 'instagram',
      handle,
      follower_count: 100,
      follows_count: 10,
    });
    await upsertCreatorProfile({
      platform: 'instagram',
      handle,
      follower_count: 200,
      follows_count: 20,
    });
    const profile = await getCreatorProfile('instagram', handle);
    expect(profile?.follower_count).toBe(200);
  });
});
