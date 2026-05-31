import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks must be declared BEFORE the import of the module under test (vitest
// hoists vi.mock calls). Each mock is a stub: tests configure return values
// per-case via vi.mocked(...).mockResolvedValue(...).

vi.mock('../apify', () => ({
  scrapeInstagram: vi.fn(),
  scrapeFollowers: vi.fn(),
}));

vi.mock('../saved-items-repo', () => ({
  upsertOnSave: vi.fn(),
  updateScrapedContent: vi.fn(),
  updateMedia: vi.fn(),
  markFailed: vi.fn(),
  markReady: vi.fn(),
  incrementRetryCount: vi.fn(),
  updateVirality: vi.fn(),
  insertViewSnapshot: vi.fn(),
  discardForContentUnavailable: vi.fn(),
  getCreatorProfile: vi.fn(),
  upsertCreatorProfile: vi.fn(),
}));

vi.mock('../dm-stub', async () => {
  const actual = await vi.importActual<typeof import('../dm-stub')>('../dm-stub');
  return { ...actual, sendDM: vi.fn() };
});

vi.mock('../url-validation', () => ({
  validateUrl: vi.fn(),
}));

// linked_handles lookup — the orchestrator's lookupSender chains
// .from().select().eq().eq().is().maybeSingle(). Default: returns a row
// matching the test payload's user_id. Tests override per-case.
const linkedHandleStub = {
  user_id: 'usr-1',
  platform_user_id: 'IGSID_TEST',
};
const linkedHandleMaybeSingle = vi.fn();

vi.mock('../supabase-admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: linkedHandleMaybeSingle,
            }),
          }),
        }),
      }),
    }),
  },
}));

import { runPipeline } from './run';
import * as repo from '../saved-items-repo';
import * as apify from '../apify';
import * as dm from '../dm-stub';
import * as urlVal from '../url-validation';
import type { PipelinePayload } from './types';
import type { ScrapedItem } from '../apify/types';

function validReel(overrides: Partial<ScrapedItem> = {}): ScrapedItem {
  return {
    caption: 'cap',
    author_handle: 'auth',
    author_id: '123',
    post_date: '2026-04-01T00:00:00Z',
    thumbnail_url: 'https://x/thumb.jpg',
    view_count: 1000,
    like_count: 100,
    comments_count: 12,
    transcript: 'hello world',
    content_state: 'active',
    ...overrides,
  };
}

function validPayload(overrides: Partial<PipelinePayload> = {}): PipelinePayload {
  return {
    user_id: 'usr-1',
    sender_handle: 'tester',
    platform: 'instagram',
    raw_url: 'https://www.instagram.com/reel/X/',
    tags: ['t'],
    annotation: 'note',
    mid: 'm-1',
    url_index: 0,
    ...overrides,
  };
}

describe('runPipeline', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) — also resets mock IMPLEMENTATIONS,
    // not just call history. Critical here because tests set mockRejectedValue
    // on shared mocks (insertViewSnapshot, updateVirality) that would otherwise
    // bleed into the next test and cause infinite retry loops.
    vi.resetAllMocks();

    linkedHandleMaybeSingle.mockResolvedValue({ data: linkedHandleStub, error: null });

    vi.mocked(urlVal.validateUrl).mockResolvedValue({
      ok: true,
      platform: 'instagram',
      post_id: 'X',
      canonical_url: 'https://www.instagram.com/reel/X/',
    });

    vi.mocked(repo.upsertOnSave).mockResolvedValue({ id: 'item-1', was_inserted: true });
    vi.mocked(repo.incrementRetryCount).mockResolvedValue(1);
    vi.mocked(apify.scrapeInstagram).mockResolvedValue(validReel());
    vi.mocked(apify.scrapeFollowers).mockResolvedValue({
      follower_count: 5000,
      follows_count: 100,
    });
    vi.mocked(repo.getCreatorProfile).mockResolvedValue(null);
  });

  it('happy path: upsert → scrape → creator → media → snapshot → virality → ready', async () => {
    await runPipeline(validPayload());

    expect(repo.upsertOnSave).toHaveBeenCalledTimes(1);
    expect(apify.scrapeInstagram).toHaveBeenCalledWith('X', 'https://www.instagram.com/reel/X/');
    expect(repo.updateScrapedContent).toHaveBeenCalledWith('item-1', expect.objectContaining({
      caption: 'cap',
      transcript: 'hello world',
    }));
    expect(apify.scrapeFollowers).toHaveBeenCalledWith('auth');
    expect(repo.upsertCreatorProfile).toHaveBeenCalledWith({
      platform: 'instagram',
      handle: 'auth',
      follower_count: 5000,
      follows_count: 100,
    });
    expect(repo.updateMedia).toHaveBeenCalledWith(
      'item-1',
      'https://www.instagram.com/reel/X/embed',
      null,
    );
    expect(repo.insertViewSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      item_id: 'item-1',
      views: 1000,
      likes: 100,
      comments: 12,
      follower_count: 5000,
    }));
    expect(repo.updateVirality).toHaveBeenCalled();
    expect(repo.markReady).toHaveBeenCalledWith('item-1');
    expect(dm.sendDM).not.toHaveBeenCalled();
  });

  it('update path: existing row → update_confirm DM, no scrape, no markReady', async () => {
    vi.mocked(repo.upsertOnSave).mockResolvedValue({ id: 'item-2', was_inserted: false });
    await runPipeline(validPayload());

    expect(apify.scrapeInstagram).not.toHaveBeenCalled();
    expect(dm.sendDM).toHaveBeenCalledWith(expect.objectContaining({
      copy_key: 'update_confirm',
      handle: 'tester',
      platform: 'instagram',
    }));
    expect(repo.markReady).not.toHaveBeenCalled();
  });

  it('stranger sender: linked_handles miss → no DM (no platform_user_id), no row', async () => {
    // linked_handles miss = no IGSID = can't send DM. Pipeline silently skips
    // the DM and returns early (upsertOnSave also won't be called because
    // sender validation fails first).
    linkedHandleMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await runPipeline(validPayload());

    expect(repo.upsertOnSave).not.toHaveBeenCalled();
    // No platform_user_id → sendDM not called (M12 contract: requires recipient_id)
    expect(dm.sendDM).not.toHaveBeenCalled();
  });

  it('stranger sender: linked to a DIFFERENT user → stranger DM', async () => {
    linkedHandleMaybeSingle.mockResolvedValueOnce({ data: { user_id: 'usr-other', platform_user_id: 'IGSID_OTHER' }, error: null });
    await runPipeline(validPayload());

    expect(repo.upsertOnSave).not.toHaveBeenCalled();
    expect(dm.sendDM).toHaveBeenCalledWith(expect.objectContaining({ copy_key: 'stranger' }));
  });

  it('M3 reject (malformed_url): maps to malformed_url copy_key, no row', async () => {
    vi.mocked(urlVal.validateUrl).mockResolvedValue({
      ok: false,
      reason: 'malformed_url',
      user_message: 'irrelevant',
    });
    await runPipeline(validPayload());

    expect(repo.upsertOnSave).not.toHaveBeenCalled();
    expect(dm.sendDM).toHaveBeenCalledWith(expect.objectContaining({ copy_key: 'malformed_url' }));
  });

  it('M3 reject (unsupported_content carousel): maps to unsupported_url', async () => {
    vi.mocked(urlVal.validateUrl).mockResolvedValue({
      ok: false,
      reason: 'unsupported_content',
      user_message: 'irrelevant',
    });
    await runPipeline(validPayload());
    expect(dm.sendDM).toHaveBeenCalledWith(expect.objectContaining({ copy_key: 'unsupported_url' }));
  });

  it('content unavailable: Apify deleted → discard + content_unavailable DM', async () => {
    vi.mocked(apify.scrapeInstagram).mockResolvedValue(validReel({ content_state: 'deleted' }));
    await runPipeline(validPayload());

    expect(repo.discardForContentUnavailable).toHaveBeenCalledWith('usr-1', 'instagram', 'X');
    expect(dm.sendDM).toHaveBeenCalledWith(expect.objectContaining({ copy_key: 'content_unavailable' }));
    expect(repo.markReady).not.toHaveBeenCalled();
  });

  it('non-IG platform after upsert: marks failed, no DM', async () => {
    vi.mocked(urlVal.validateUrl).mockResolvedValue({
      ok: true,
      platform: 'tiktok',
      post_id: 'T',
      canonical_url: 'https://www.tiktok.com/@x/video/T',
    });
    await runPipeline(validPayload());

    expect(repo.markFailed).toHaveBeenCalledWith('item-1', 'platform_not_supported_at_mvp');
    expect(apify.scrapeInstagram).not.toHaveBeenCalled();
    expect(dm.sendDM).not.toHaveBeenCalled();
  });

  it('creator profile cache HIT (fresh) skips the followers actor', async () => {
    vi.mocked(repo.getCreatorProfile).mockResolvedValue({
      platform: 'instagram',
      handle: 'auth',
      follower_count: 9999,
      follows_count: 1,
      fetched_at: new Date().toISOString(),
    });
    await runPipeline(validPayload());

    expect(apify.scrapeFollowers).not.toHaveBeenCalled();
    expect(repo.upsertCreatorProfile).not.toHaveBeenCalled();
    expect(repo.insertViewSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      follower_count: 9999,
    }));
  });

  it('creator profile cache STALE (>7d) refreshes via followers actor', async () => {
    vi.mocked(repo.getCreatorProfile).mockResolvedValue({
      platform: 'instagram',
      handle: 'auth',
      follower_count: 100,
      follows_count: 1,
      fetched_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await runPipeline(validPayload());

    expect(apify.scrapeFollowers).toHaveBeenCalledWith('auth');
    expect(repo.upsertCreatorProfile).toHaveBeenCalled();
    expect(repo.insertViewSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      follower_count: 5000,
    }));
  });

  it('followers actor returns null: no cache upsert, follower_count=null on snapshot, pipeline continues', async () => {
    vi.mocked(apify.scrapeFollowers).mockResolvedValue(null);
    await runPipeline(validPayload());

    expect(repo.upsertCreatorProfile).not.toHaveBeenCalled();
    expect(repo.insertViewSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      follower_count: null,
    }));
    expect(repo.markReady).toHaveBeenCalled();
  });

  it('followers actor throws: caught, pipeline continues with null follower', async () => {
    vi.mocked(apify.scrapeFollowers).mockRejectedValue(new Error('apify down'));
    await runPipeline(validPayload());

    expect(repo.insertViewSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      follower_count: null,
    }));
    expect(repo.markReady).toHaveBeenCalled();
  });

  it('view_snapshot retry exhaustion: markFailed, no markReady', async () => {
    vi.mocked(repo.insertViewSnapshot).mockRejectedValue(new Error('fk deadlock'));
    vi.mocked(repo.incrementRetryCount)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4);
    await runPipeline(validPayload());

    expect(repo.markFailed).toHaveBeenCalledWith('item-1', 'view_snapshot_insert_exhausted');
    expect(repo.markReady).not.toHaveBeenCalled();
  });

  it('virality failure: still marks ready (D-007)', async () => {
    vi.mocked(repo.updateVirality).mockRejectedValue(new Error('boom'));
    await runPipeline(validPayload());
    expect(repo.markReady).toHaveBeenCalled();
  });

  it('passes ig_post_media_id + attachment_type through to validateUrl (Hardening 2 F5)', async () => {
    await runPipeline(validPayload({
      attachment_type: 'ig_post',
      ig_post_media_id: '17900000000000000',
    }));

    expect(urlVal.validateUrl).toHaveBeenCalledWith({
      raw_url: 'https://www.instagram.com/reel/X/',
      ig_post_media_id: '17900000000000000',
      attachment_type: 'ig_post',
    });
  });

});
