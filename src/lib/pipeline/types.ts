// Module 5 Phase 5 — types for the ingest-pipeline queue payload + the
// internal context passed step-to-step inside src/lib/pipeline/run.ts.
//
// The shape of PipelinePayload must match what M4a's sweeper writes via
// boss.send('ingest-pipeline', ...) in src/lib/dm-staging.ts.

import type { Platform } from '../apify/types';

// DM-source platform is narrower than content platform: users only save FROM
// Instagram or TikTok DMs (no YT DMs). YT shorts can be the content saved
// (validated.platform), never the DM-source.
export type DMSourcePlatform = 'instagram' | 'tiktok';

export type PipelinePayload = {
  user_id: string;
  sender_handle: string;
  platform: DMSourcePlatform;
  raw_url: string;
  tags: string[];
  annotation: string | null;
  mid: string;
  url_index: number;
  // Hardening 2 additions — M3 needs ig_post_media_id to resolve
  // lookaside.fbsbx.com URLs back to canonical permalinks.
  attachment_type?: 'ig_post' | 'ig_reel' | 'share' | 'reel' | null;
  ig_post_media_id?: string | null;
  title?: string | null;
};

export type PipelineContext = {
  payload: PipelinePayload;
  item_id?: string;
  validated?: {
    platform: Platform;
    post_id: string;
    canonical_url: string;
  };
};
