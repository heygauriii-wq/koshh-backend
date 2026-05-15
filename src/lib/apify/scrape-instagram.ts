// Module 5 Phase 2 — apify/instagram-reel-scraper adapter. Input schema
// verified live 2026-05-15:
//
//   username: string[]       REQUIRED. Despite the singular name, accepts an
//                            array of profile URLs OR direct reel URLs.
//   resultsLimit: number     1 for our single-URL case.
//   includeTranscript: bool  REQUIRED for transcript field. Paid add-on,
//                            defaults to false; the field is absent (not
//                            empty) without this flag.
//
// Things that look right but aren't (per the live audit):
//   directUrls, addParentData     do not exist on this actor.
//   captionTranscript[]           does not exist; transcript is a flat string.
//   ownerFollowedByCount          does not exist; use scrape-followers.ts.

import { ApifyClient } from 'apify-client';
import type { ScrapedItem } from './types';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) {
  throw new Error('APIFY_TOKEN not set');
}

const client = new ApifyClient({ token: APIFY_TOKEN });
const ACTOR_ID = 'apify/instagram-reel-scraper';

export async function scrapeInstagram(
  _post_id: string,
  canonical_url: string,
): Promise<ScrapedItem> {
  const run = await client.actor(ACTOR_ID).call({
    username: [canonical_url],
    resultsLimit: 1,
    includeTranscript: true,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  if (!items || items.length === 0) {
    return shapeMissing();
  }

  const raw = items[0] as Record<string, unknown>;

  // Heuristic for unavailable content. The reel actor returns slightly
  // different shapes for deleted vs private vs blocked-by-token; both an
  // explicit error key and "no caption + zero views" indicate the reel is
  // not retrievable. M8's refresh can reclassify deleted vs private later
  // if a clearer signal appears.
  const viewCount = (raw.videoViewCount as number | undefined) ?? 0;
  if (raw.error || (!raw.caption && viewCount === 0)) {
    return shapeMissing();
  }

  return {
    caption: (raw.caption as string | null) ?? '',
    author_handle: (raw.ownerUsername as string | null) ?? '',
    author_id: (raw.ownerId as string | null) ?? null,
    post_date: (raw.timestamp as string | null) ?? new Date().toISOString(),
    thumbnail_url: (raw.displayUrl as string | null) ?? null,
    view_count:
      (raw.videoPlayCount as number | undefined) ??
      (raw.videoViewCount as number | undefined) ??
      0,
    like_count: (raw.likesCount as number | undefined) ?? 0,
    comments_count: (raw.commentsCount as number | undefined) ?? 0,
    transcript: (raw.transcript as string | null) ?? null,
    content_state: 'active',
  };
}

function shapeMissing(): ScrapedItem {
  return {
    caption: '',
    author_handle: '',
    author_id: null,
    post_date: new Date().toISOString(),
    thumbnail_url: null,
    view_count: 0,
    like_count: 0,
    comments_count: 0,
    transcript: null,
    content_state: 'deleted',
  };
}
