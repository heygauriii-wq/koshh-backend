// 3.6 — Resolve an IG share-attachment media_id to its canonical permalink
// + media_type via the Instagram Graph API.
//
// Input:  ig_post_media_id from the webhook attachment payload (Step 11
//         captures this in dm-parser).
// Output: { permalink, media_type } on success, or null on any failure
//         (network error, token expiry, rate limit, missing media, parse
//         error). Caller maps null → metadata_unavailable reject.
//
// Endpoint: GET https://graph.instagram.com/v23.0/{media_id}?fields=permalink,media_type
//   - Host matches the rest of the codebase (resolveIgUsername uses the same).
//   - media_type returns IMAGE / VIDEO / CAROUSEL_ALBUM — orchestrator rejects
//     CAROUSEL_ALBUM as unsupported_content (carousel ingest not in MVP).

const TIMEOUT_MS = 5000;
const API_HOST = 'https://graph.instagram.com/v23.0';

export type InstagramMediaInfo = {
  permalink: string;
  media_type: string;     // 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' — string for forward-compat
};

let cachedAccessToken: string | undefined;

// Lazy-cached env read. The page token is provisioned at boot (see server.ts
// probeMetaToken) and validated against /me. We read it lazily here so test
// environments can stub before the first call.
function getAccessToken(): string {
  if (cachedAccessToken) return cachedAccessToken;
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'META_PAGE_ACCESS_TOKEN is not set. ' +
      'See M4a build guide / next-steps-action-list Step 9 for provisioning.',
    );
  }
  cachedAccessToken = token;
  return token;
}

export async function resolveInstagramMedia(
  mediaId: string,
): Promise<InstagramMediaInfo | null> {
  const params = new URLSearchParams({
    fields: 'permalink,media_type',
    access_token: getAccessToken(),
  });
  const url = `${API_HOST}/${encodeURIComponent(mediaId)}?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      // 4xx/5xx — token expired, media inaccessible, rate limit
      return null;
    }

    const body = (await res.json()) as {
      permalink?: string;
      media_type?: string;
    };

    if (!body.permalink || !body.media_type) {
      // Unexpected shape — treat as failure rather than guess
      return null;
    }

    return { permalink: body.permalink, media_type: body.media_type };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
