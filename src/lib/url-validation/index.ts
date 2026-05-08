import { sniff } from './sniff';
import { resolveTikTokShortUrl } from './tiktok';
import {
  extractInstagramPostId,
  extractTikTokPostId,
  extractYouTubePostId,
} from './extract';
import { isYoutubeShortByPostId } from './youtube';
import { buildCanonicalUrl } from './assemble';
import { REJECT_COPY } from './reject-copy';
import type { M3Result, M3RejectReason, Platform } from './types';

export type { M3Result, M3Accept, M3Reject, M3RejectReason, Platform } from './types';
export { REJECT_COPY } from './reject-copy';

// M3 public surface. Stateless. Calls TikTok (HEAD) and YouTube Data API v3
// for short-URL resolution / duration checks; otherwise pure. M4a/M4b/M4c/M5
// import this function and nothing else from this module.
export async function validateUrl(rawUrl: string): Promise<M3Result> {
  const sniffed = sniff(rawUrl);

  switch (sniffed.kind) {
    case 'reject':
      return reject(sniffed.reason);

    case 'instagram': {
      const post_id = extractInstagramPostId(sniffed.url);
      if (!post_id) return reject('malformed_url');
      return accept('instagram', post_id);
    }

    case 'tiktok_canonical': {
      const post_id = extractTikTokPostId(sniffed.url);
      if (!post_id) return reject('malformed_url');
      return accept('tiktok', post_id);
    }

    case 'tiktok_short': {
      const canonical = await resolveTikTokShortUrl(sniffed.url);
      if (!canonical) return reject('malformed_url');
      const post_id = extractTikTokPostId(canonical);
      if (!post_id) return reject('malformed_url');
      return accept('tiktok', post_id);
    }

    case 'youtube_shorts': {
      const post_id = extractYouTubePostId(sniffed.url);
      if (!post_id) return reject('malformed_url');
      return accept('youtube_shorts', post_id);
    }

    case 'youtube_ambiguous': {
      const post_id = extractYouTubePostId(sniffed.url);
      if (!post_id) return reject('malformed_url');

      const isShort = await isYoutubeShortByPostId(post_id);
      if (isShort === null) return reject('metadata_unavailable');
      if (isShort === false) return reject('long_form_youtube');
      return accept('youtube_shorts', post_id);
    }
  }
}

function reject(reason: M3RejectReason): M3Result {
  return { ok: false, reason, user_message: REJECT_COPY[reason] };
}

function accept(platform: Platform, post_id: string): M3Result {
  return {
    ok: true,
    platform,
    post_id,
    canonical_url: buildCanonicalUrl(platform, post_id),
  };
}
