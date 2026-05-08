import type { Platform } from './types';

// 3.5 — Build the canonical_url for display.
//
// canonical_url is for UI display only. Dedup keys on (platform, post_id),
// not on URL strings (D-003). If we ever need a URL-shaped key, build it
// from this function — don't store it separately.
export function buildCanonicalUrl(platform: Platform, post_id: string): string {
  switch (platform) {
    case 'instagram':
      // /reel/ is the canonical form for video content on Instagram.
      // /p/ and /tv/ resolve to the same content, but /reel/ is what the
      // share sheet emits and what most users will expect to see.
      return `https://www.instagram.com/reel/${post_id}/`;

    case 'tiktok':
      // The full canonical form (with @user) is reachable; the /video/N form
      // is just one 301 away in the user's browser. We don't have @user
      // without scraping, so /video/N is the cleanest URL we can build.
      return `https://www.tiktok.com/video/${post_id}`;

    case 'youtube_shorts':
      return `https://www.youtube.com/shorts/${post_id}`;
  }
}
