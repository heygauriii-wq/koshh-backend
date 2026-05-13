import { sniff } from './sniff';
import { resolveTikTokShortUrl } from './tiktok';
import {
  extractInstagramPostId,
  extractTikTokPostId,
  extractYouTubePostId,
} from './extract';
import { isYoutubeShortByPostId } from './youtube';
import { resolveInstagramMedia } from './instagram-graph';
import { buildCanonicalUrl } from './assemble';
import { REJECT_COPY } from './reject-copy';
import type { M3Input, M3Result, M3RejectReason, Platform } from './types';

export type { M3Input, M3Result, M3Accept, M3Reject, M3RejectReason, Platform } from './types';
export { REJECT_COPY } from './reject-copy';

// M3 public surface. Stateless. Calls TikTok (HEAD), YouTube Data API v3 for
// short-URL / duration resolution, and IG Graph API for ig_post lookaside →
// permalink resolution. Otherwise pure. M4a/M4b/M4c/M5 import this function
// and nothing else from this module.
//
// Accepts either a bare URL string (text-extracted URLs, Reel shares) or a
// richer object carrying share-attachment context (ig_post_media_id) so M3
// can canonicalize lookaside.fbsbx.com URLs. See M3Input type for shape.
export async function validateUrl(input: M3Input): Promise<M3Result> {
  const raw_url = typeof input === 'string' ? input : input.raw_url;
  const ig_post_media_id = typeof input === 'string' ? undefined : input.ig_post_media_id;

  const sniffed = sniff(raw_url, { ig_post_media_id });

  switch (sniffed.kind) {
    case 'reject':
      return reject(sniffed.reason);

    case 'instagram': {
      const post_id = extractInstagramPostId(sniffed.url);
      if (!post_id) return reject('malformed_url');
      return accept('instagram', post_id);
    }

    case 'instagram_lookaside': {
      const media = await resolveInstagramMedia(sniffed.media_id);
      if (!media) return reject('metadata_unavailable');
      if (media.media_type === 'CAROUSEL_ALBUM') return reject('unsupported_content');

      // Re-sniff the resolved permalink. Should classify as 'instagram' —
      // if it doesn't, Graph returned something unexpected; reject defensively.
      const resniffed = sniff(media.permalink);
      if (resniffed.kind !== 'instagram') return reject('malformed_url');
      const post_id = extractInstagramPostId(resniffed.url);
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
