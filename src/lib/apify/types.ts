// Module 5 — Apify adapter boundary types. The raw actor responses are loose
// `any` blobs; everything outside src/lib/apify/ only sees these strict shapes.
//
// Live-verified 2026-05-15 against apify/instagram-reel-scraper and
// apify/instagram-followers-count-scraper. See
// Scope/Build-Guides/Pending/05-pipeline-orchestration-build.md (Phase 2).

export type Platform = 'instagram' | 'tiktok' | 'youtube_shorts';

export type ScrapedItem = {
  caption: string;
  author_handle: string;
  author_id: string | null;       // ownerId from the actor — stable join key
  post_date: string;              // ISO 8601
  thumbnail_url: string | null;   // displayUrl from actor; M6 fetches bytes from here
  view_count: number;             // videoPlayCount preferred, fall back to videoViewCount
  like_count: number;
  comments_count: number;
  // FLAT STRING — no per-segment timing from apify/instagram-reel-scraper.
  // Hook extraction by transcript timestamp is deferred to M5a.
  transcript: string | null;
  content_state: 'active' | 'deleted' | 'private';
};

export type CreatorProfile = {
  platform: Platform;
  handle: string;
  follower_count: number | null;
  follows_count: number | null;
  fetched_at: string;             // ISO 8601 — Step 4.5 enforces 7-day TTL on this
};
