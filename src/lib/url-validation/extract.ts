// 3.3 — Extract post_id from a sniffed-and-resolved URL. Pure regex.
// By the time we get here, TikTok short URLs are already resolved to canonical
// (3.2 ran), so we only deal with canonical URLs per platform.
// Returns null on regex miss → caller maps to malformed_url reject.

const IG_PATH = /^\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/;
const TIKTOK_PATH = /\/video\/(\d+)/;
const YT_SHORTS_PATH = /^\/shorts\/([A-Za-z0-9_-]+)/;
const YT_EMBED_PATH = /^\/embed\/([A-Za-z0-9_-]+)/;
const YT_BE_PATH = /^\/([A-Za-z0-9_-]+)/;

export function extractInstagramPostId(url: URL): string | null {
  const m = url.pathname.match(IG_PATH);
  return m ? m[1] : null;
}

export function extractTikTokPostId(url: URL): string | null {
  const m = url.pathname.match(TIKTOK_PATH);
  return m ? m[1] : null;
}

// Returns post_id from any YT URL form: /shorts/, /embed/, watch?v=, youtu.be/.
// Caller decides whether duration check is needed (sniff already classified that).
export function extractYouTubePostId(url: URL): string | null {
  const shorts = url.pathname.match(YT_SHORTS_PATH);
  if (shorts) return shorts[1];

  const embed = url.pathname.match(YT_EMBED_PATH);
  if (embed) return embed[1];

  if (url.pathname === '/watch') {
    const v = url.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]+$/.test(v)) return v;
  }

  if (url.hostname === 'youtu.be') {
    const m = url.pathname.match(YT_BE_PATH);
    if (m) return m[1];
  }

  return null;
}
