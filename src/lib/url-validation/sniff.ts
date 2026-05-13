import type { SniffContext, SniffResult } from './types';

const TIKTOK_SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);

// 3.1 — Sniff platform from URL pattern. Pure, no HTTP.
//   - parse failure → malformed_url
//   - unrecognized platform → unsupported_platform
//   - accepted: IG /reel|p|tv/, IG lookaside CDN (when ig_post_media_id given),
//     TikTok canonical /video/N, TikTok short hosts, YT /shorts/ (accept
//     directly), YT watch?v= / youtu.be / /embed/ (ambiguous, needs 3.4
//     duration check)
//
// `ctx.ig_post_media_id` is set by M4a's webhook handler when the URL came
// from an ig_post / share attachment. Lookaside URLs are pre-signed CDN links
// (lookaside.fbsbx.com) that point at media bytes — there's no post_id in the
// URL itself, so we need the media_id to resolve back to a canonical permalink
// via the IG Graph API (3.6).
export function sniff(rawUrl: string, ctx: SniffContext = {}): SniffResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'reject', reason: 'malformed_url' };
  }

  // Non-http(s) schemes (javascript:, data:, file:, mailto:, ftp:) are
  // syntactically valid URLs but never reach 3.2/3.4 fetch calls. Reject
  // up front so no path/host logic ever sees them.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { kind: 'reject', reason: 'malformed_url' };
  }

  const path = url.pathname.replace(/\/+$/, '');
  const host = url.hostname.toLowerCase();

  // ---- Instagram ----
  // Carousel rejection happens downstream — can't tell from URL alone.
  if (host === 'instagram.com' || host === 'www.instagram.com') {
    if (/^\/(reel|p|tv)\/[A-Za-z0-9_-]+/.test(path)) {
      return { kind: 'instagram', url };
    }
    return { kind: 'reject', reason: 'unsupported_platform' };
  }

  // ---- Instagram lookaside (forwarded ig_post share) ----
  // lookaside.fbsbx.com is Meta's signed-CDN host. The URL itself has no
  // post_id — we need the ig_post_media_id from the attachment payload to
  // resolve via the IG Graph API. Without it, we can't canonicalize, so
  // reject as malformed.
  if (host === 'lookaside.fbsbx.com') {
    if (ctx.ig_post_media_id) {
      return { kind: 'instagram_lookaside', media_id: ctx.ig_post_media_id };
    }
    return { kind: 'reject', reason: 'malformed_url' };
  }

  // ---- TikTok ----
  if (TIKTOK_SHORT_HOSTS.has(host)) {
    return { kind: 'tiktok_short', url };
  }
  if (host === 'tiktok.com' || host === 'www.tiktok.com') {
    if (/^\/t\//.test(path)) {
      return { kind: 'tiktok_short', url };
    }
    if (/\/video\/\d+/.test(path)) {
      return { kind: 'tiktok_canonical', url };
    }
    return { kind: 'reject', reason: 'unsupported_platform' };
  }

  // ---- YouTube ----
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (/^\/shorts\/[A-Za-z0-9_-]+/.test(path)) {
      return { kind: 'youtube_shorts', url };
    }
    if (path === '/watch' && url.searchParams.has('v')) {
      return { kind: 'youtube_ambiguous', url };
    }
    if (/^\/embed\/[A-Za-z0-9_-]+/.test(path)) {
      return { kind: 'youtube_ambiguous', url };
    }
    return { kind: 'reject', reason: 'unsupported_platform' };
  }
  if (host === 'youtu.be') {
    if (/^\/[A-Za-z0-9_-]+/.test(path)) {
      return { kind: 'youtube_ambiguous', url };
    }
    return { kind: 'reject', reason: 'malformed_url' };
  }

  // ---- Anything else (Pinterest, FB, X, LinkedIn, ...) ----
  return { kind: 'reject', reason: 'unsupported_platform' };
}
