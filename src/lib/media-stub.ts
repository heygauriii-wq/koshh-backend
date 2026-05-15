// Module 5 Phase 3 — placeholder for M6 (Media Storage). Returns a deterministic
// embed URL per platform and a null thumbnail_path. M6's real implementation
// will fetch thumbnail bytes, upload to the `thumbnails` Storage bucket, and
// possibly hit oEmbed for validation. Call sites stay identical.

import type { Platform } from './apify/types';

export async function fetchMedia({
  platform,
  post_id,
}: {
  platform: Platform;
  post_id: string;
}): Promise<{ embed_url: string; thumbnail_path: string | null }> {
  switch (platform) {
    case 'instagram':
      return {
        embed_url: `https://www.instagram.com/reel/${post_id}/embed`,
        thumbnail_path: null,
      };
    case 'tiktok':
      return {
        embed_url: `https://www.tiktok.com/embed/${post_id}`,
        thumbnail_path: null,
      };
    case 'youtube_shorts':
      return {
        embed_url: `https://www.youtube.com/embed/${post_id}`,
        thumbnail_path: null,
      };
  }
}
