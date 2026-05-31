// Module 5 Phase 5 — the orchestrator. One pg-boss job = one whole pipeline.
// Steps 2..9 from the spec, IG-only at MVP. Each step is either an in-line
// branch or a private helper below.
//
// The contract with pg-boss: throw on UNEXPECTED failures (DB unreachable,
// undefined bug) — pg-boss will retry per retryLimit. Return on EXPECTED
// failure paths (stranger sender, M3 reject, content unavailable) — these
// produced the right user-facing DM already; retrying would just duplicate.

import { validateUrl } from '../url-validation';
import { sendDM, copyKeyForRejectReason } from '../dm-stub';
import { scrapeInstagram, scrapeFollowers } from '../apify';
import { fetchMedia } from '../media-stub';
import { supabaseAdmin } from '../supabase-admin';
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
} from '../saved-items-repo';
import type { Platform } from '../apify/types';
import type { PipelinePayload, PipelineContext } from './types';

const MAX_RETRIES = 3;                  // D-007
const CREATOR_PROFILE_TTL_DAYS = 7;

export async function runPipeline(payload: PipelinePayload): Promise<void> {
  const ctx: PipelineContext = { payload };

  // Step 5.2 — sender re-validation. M4a's 4a.5 already filters strangers,
  // but defense in depth costs ~1ms and M4c (dashboard ingest) won't have
  // M4a's gate when it ships.
  const sender = await lookupSender(payload.sender_handle, payload.platform);
  if (!sender || sender.user_id !== payload.user_id) {
    if (sender?.platform_user_id) {
      await sendDM({
        recipient_id: sender.platform_user_id,
        handle: payload.sender_handle,
        platform: payload.platform,
        copy_key: 'stranger',
      });
    }
    return;
  }

  // Step 5.3 — URL validation. Pass attachment context so M3 can resolve
  // ig_post lookaside.fbsbx.com URLs via the Graph API (Hardening 2 F5).
  const validated = await validateUrl({
    raw_url: payload.raw_url,
    ig_post_media_id: payload.ig_post_media_id ?? undefined,
    attachment_type: payload.attachment_type ?? undefined,
  });
  if (!validated.ok) {
    if (sender.platform_user_id) {
      await sendDM({
        recipient_id: sender.platform_user_id,
        handle: payload.sender_handle,
        platform: payload.platform,
        copy_key: copyKeyForRejectReason(validated.reason),
      });
    }
    return;
  }
  ctx.validated = {
    platform: validated.platform,
    post_id: validated.post_id,
    canonical_url: validated.canonical_url,
  };

  // Step 5.3.5 — atomic upsert lookup. was_inserted=true → continue;
  // was_inserted=false → existing save being refreshed, fire update_confirm.
  const { id, was_inserted } = await upsertOnSave({
    user_id: payload.user_id,
    platform: ctx.validated.platform,
    post_id: ctx.validated.post_id,
    canonical_url: ctx.validated.canonical_url,
    saved_by_handle: payload.sender_handle,
    saved_by_platform: payload.platform,
    annotation: payload.annotation,
    tags: payload.tags,
  });
  ctx.item_id = id;

  if (!was_inserted) {
    if (sender.platform_user_id) {
      await sendDM({
        recipient_id: sender.platform_user_id,
        handle: payload.sender_handle,
        platform: payload.platform,
        copy_key: 'update_confirm',
      });
    }
    return;
  }

  // Step 5.4 — IG-only guard. M3 accepts TikTok and YT Shorts shapes, but
  // adapters for those don't exist at MVP. Marking failed (not throwing)
  // because pg-boss-retrying a platform-not-supported case is pointless.
  if (ctx.validated.platform !== 'instagram') {
    await markFailed(id, 'platform_not_supported_at_mvp');
    return;
  }

  // Step 5.4 — Apify reel scrape.
  const scraped = await scrapeInstagram(ctx.validated.post_id, ctx.validated.canonical_url);
  if (scraped.content_state !== 'active') {
    await discardForContentUnavailable(
      payload.user_id,
      ctx.validated.platform,
      ctx.validated.post_id,
    );
    if (sender.platform_user_id) {
      await sendDM({
        recipient_id: sender.platform_user_id,
        handle: payload.sender_handle,
        platform: payload.platform,
        copy_key: 'content_unavailable',
      });
    }
    return;
  }
  await updateScrapedContent(id, scraped);

  // Step 5.4.5 — creator profile (cached, 7d TTL). Best-effort: any failure
  // leaves followerCount=null and the pipeline continues. Virality (5.8)
  // handles the null gracefully via a fallback denominator.
  const followerCount = await resolveCreatorFollowerCount(
    ctx.validated.platform,
    scraped.author_handle,
  );

  // Step 5.5 — media stub. M6 swap target.
  const media = await fetchMedia({
    platform: ctx.validated.platform,
    post_id: ctx.validated.post_id,
  });
  await updateMedia(id, media.embed_url, media.thumbnail_path);

  // Step 5.6 — hook extraction. DEFERRED to M5a (Scope/05a-hook-extraction.md).
  // The reel actor returns a flat transcript with no per-segment timing, so
  // the original "first 3-5s by timestamp" design doesn't work. M5a will use
  // LLM extraction on the flat transcript string.

  // Step 5.7 — first view_snapshots row, with 3 in-code retries on transient
  // FK / deadlock errors. retry_count is persisted on saved_items so a
  // pg-boss whole-job retry would see the prior attempts (current shape can
  // under-retry across pg-boss retries; documented limitation).
  let snapshotOK = false;
  while ((await incrementRetryCount(id)) <= MAX_RETRIES) {
    try {
      await insertViewSnapshot({
        item_id: id,
        views: scraped.view_count,
        likes: scraped.like_count,
        comments: scraped.comments_count,
        follower_count: followerCount,
        virality_coefficient: null,
        signals: null,
      });
      snapshotOK = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!snapshotOK) {
    await markFailed(id, 'view_snapshot_insert_exhausted');
    return;
  }

  // Step 5.8 — virality (best-effort). D-007: still mark ready on failure.
  try {
    const { coefficient, signals } = computeVirality({
      view_count: scraped.view_count,
      like_count: scraped.like_count,
      follower_count: followerCount,
    });
    await updateVirality(id, coefficient, signals);
  } catch (err) {
    console.warn('[m5] virality calc failed; proceeding to mark ready', {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 5.9 — terminal happy state. M9 filters WHERE pipeline_status='ready'.
  await markReady(id);
}

async function lookupSender(
  handle: string,
  platform: string,
): Promise<{ user_id: string; platform_user_id: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from('linked_handles')
    .select('user_id, platform_user_id')
    .eq('handle', handle)
    .eq('platform', platform)
    .is('unlinked_at', null)
    .maybeSingle();
  if (error) throw new Error(`lookupSender failed: ${error.message}`);
  return (data as { user_id: string; platform_user_id: string | null } | null) ?? null;
}

async function resolveCreatorFollowerCount(
  platform: Platform,
  handle: string,
): Promise<number | null> {
  if (!handle) return null;
  try {
    const cached = await getCreatorProfile(platform, handle);
    if (cached && isFresh(cached.fetched_at, CREATOR_PROFILE_TTL_DAYS)) {
      return cached.follower_count;
    }
    const fresh = await scrapeFollowers(handle);
    if (!fresh) {
      // Don't cache the miss — let the next ingestion retry cleanly.
      return null;
    }
    await upsertCreatorProfile({
      platform,
      handle,
      follower_count: fresh.follower_count,
      follows_count: fresh.follows_count,
    });
    return fresh.follower_count;
  } catch (err) {
    console.warn('[m5] creator profile resolution failed', {
      platform,
      handle,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function isFresh(fetched_at: string, ttl_days: number): boolean {
  const fetched = new Date(fetched_at).getTime();
  const ttl_ms = ttl_days * 24 * 60 * 60 * 1000;
  return Date.now() - fetched < ttl_ms;
}

function computeVirality(scraped: {
  view_count: number;
  like_count: number;
  follower_count: number | null;
}): { coefficient: number; signals: object } {
  // Placeholder until M8 ships the real formula. follower_count_resolved on
  // signals lets M8 spot rows whose denominator used the fallback so it can
  // preferentially recompute those when a real follower count later resolves.
  const denom = Math.max(scraped.follower_count ?? 1, 1);
  const coefficient = (scraped.view_count + scraped.like_count * 5) / denom;
  return {
    coefficient,
    signals: {
      view_count: scraped.view_count,
      like_count: scraped.like_count,
      follower_count: scraped.follower_count,
      follower_count_resolved: scraped.follower_count !== null,
      formula_version: 'm5-placeholder-1',
    },
  };
}
