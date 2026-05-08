// 3.4 — Check whether a YouTube video is a Short (≤60s) via Data API v3.
// Input:  post_id already extracted by 3.3.
// Output:
//   - true  → ≤60s, treat as Short, accept
//   - false → >60s (long-form), reject as long_form_youtube
//   - null  → API failure / quota / not found / parse error → reject as metadata_unavailable

const TIMEOUT_MS = 5000;
const SHORTS_MAX_SECONDS = 60;
const API_BASE = 'https://www.googleapis.com/youtube/v3/videos';

const ISO_8601_DURATION = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

// Six lines of regex beats a npm dep. PT0S accepted as 0s (some just-uploaded
// shorts before YT computes the duration); we treat it as ≤60s.
function parseIsoDurationSeconds(iso: string): number | null {
  const m = iso.match(ISO_8601_DURATION);
  if (!m) return null;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  const seconds = m[3] ? parseInt(m[3], 10) : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

let cachedApiKey: string | undefined;

// Lazy-cached env read. First call inside this module-load throws cleanly if
// the env var isn't set; subsequent calls hit the cache. M13 will eventually
// own key rotation; until then process.env is the source.
function getApiKey(): string {
  if (cachedApiKey) return cachedApiKey;
  const key = process.env.YOUTUBE_DATA_API_KEY;
  if (!key) {
    throw new Error(
      'YOUTUBE_DATA_API_KEY is not set. ' +
      'See M3 build guide Phase 0 for provisioning instructions.',
    );
  }
  cachedApiKey = key;
  return key;
}

export async function isYoutubeShortByPostId(post_id: string): Promise<boolean | null> {
  const params = new URLSearchParams({
    part: 'contentDetails',
    id: post_id,
    key: getApiKey(),
  });
  const url = `${API_BASE}?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      // 4xx/5xx — quota exhausted, key invalid, server hiccup
      return null;
    }

    const body = (await res.json()) as {
      items?: Array<{ contentDetails?: { duration?: string } }>;
    };

    if (!body.items || body.items.length === 0) {
      // Deleted, private, unlisted-without-link, or wrong post_id
      return null;
    }

    const duration = body.items[0]?.contentDetails?.duration;
    if (!duration) return null;

    const seconds = parseIsoDurationSeconds(duration);
    if (seconds === null) return null;

    return seconds <= SHORTS_MAX_SECONDS;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
