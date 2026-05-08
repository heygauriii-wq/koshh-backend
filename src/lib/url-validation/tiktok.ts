// 3.2 — Resolve TikTok short URL to canonical via HEAD request.
// Input:  URL whose host is vm.tiktok.com / vt.tiktok.com or whose path is /t/...
// Output: canonical TikTok URL (tiktok.com/@user/video/N) or null.
//
// Notes:
//   - HEAD with redirect: 'manual' so we read Location ourselves (auto-follow
//     risks chaining through arbitrary redirectors).
//   - 5s timeout via AbortController.
//   - Validate that Location parses as a canonical TikTok URL — defense
//     against TikTok ever changing their redirect target shape.
//   - Fallback to ranged GET if HEAD returns no usable Location.

const CANONICAL_RE = /^\/@[^/]+\/video\/\d+/;
const TIMEOUT_MS = 5000;

export async function resolveTikTokShortUrl(shortUrl: URL): Promise<URL | null> {
  const headResult = await tryRedirectFetch(shortUrl, 'HEAD');
  if (headResult) return headResult;

  const getResult = await tryRedirectFetch(shortUrl, 'GET');
  return getResult;
}

async function tryRedirectFetch(
  shortUrl: URL,
  method: 'HEAD' | 'GET',
): Promise<URL | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(shortUrl.toString(), {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined,
    });

    const location = res.headers.get('location');
    if (!location) return null;

    let canonical: URL;
    try {
      canonical = new URL(location, shortUrl);
    } catch {
      return null;
    }

    const host = canonical.hostname.toLowerCase();
    if (host !== 'tiktok.com' && host !== 'www.tiktok.com') {
      return null;
    }
    if (!CANONICAL_RE.test(canonical.pathname)) {
      return null;
    }

    return canonical;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
