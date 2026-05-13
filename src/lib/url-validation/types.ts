// M3 — public + internal types for URL validation.

export type Platform = 'instagram' | 'tiktok' | 'youtube_shorts';

export type M3RejectReason =
  | 'unsupported_platform'   // Pinterest, FB, X, etc.
  | 'unsupported_content'    // IG carousel, future content types
  | 'long_form_youtube'      // YT video > 60s
  | 'malformed_url'          // regex didn't extract post_id, or short URL didn't resolve
  | 'metadata_unavailable';  // platform API failure, quota, deleted/private content, parse error

// Public input — either a bare URL string, or a richer object with optional
// share-attachment context. M4a's webhook handler passes ig_post_media_id so
// M3 can resolve `lookaside.fbsbx.com` URLs back to canonical permalinks via
// the IG Graph API. Text URLs and Reel shares (which arrive canonical) use
// the bare-string form.
export type M3Input = string | {
  raw_url: string;
  ig_post_media_id?: string;
  attachment_type?: string;
};

export type M3Accept = {
  ok: true;
  platform: Platform;
  post_id: string;
  canonical_url: string;
};

export type M3Reject = {
  ok: false;
  reason: M3RejectReason;
  user_message: string;
};

export type M3Result = M3Accept | M3Reject;

// Internal — produced by sniff (3.1), consumed by extract (3.3) and the orchestrator
export type SniffResult =
  | { kind: 'instagram'; url: URL }
  | { kind: 'instagram_lookaside'; media_id: string }  // ig_post share — needs Graph API resolution
  | { kind: 'tiktok_canonical'; url: URL }
  | { kind: 'tiktok_short'; url: URL }
  | { kind: 'youtube_shorts'; url: URL }              // direct /shorts/ — accept
  | { kind: 'youtube_ambiguous'; url: URL }           // watch?v= or youtu.be — needs duration check
  | { kind: 'reject'; reason: M3RejectReason };

// Internal — context passed into sniff alongside the URL. Optional; present
// only when M3 is called with share-attachment context.
export type SniffContext = {
  ig_post_media_id?: string;
};
