// M3 — public + internal types for URL validation.

export type Platform = 'instagram' | 'tiktok' | 'youtube_shorts';

export type M3RejectReason =
  | 'unsupported_platform'   // Pinterest, FB, X, etc.
  | 'unsupported_content'    // IG carousel, future content types
  | 'long_form_youtube'      // YT video > 60s
  | 'malformed_url'          // regex didn't extract post_id, or short URL didn't resolve
  | 'metadata_unavailable';  // YT API failure, quota, deleted/private video, parse error

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
  | { kind: 'tiktok_canonical'; url: URL }
  | { kind: 'tiktok_short'; url: URL }
  | { kind: 'youtube_shorts'; url: URL }              // direct /shorts/ — accept
  | { kind: 'youtube_ambiguous'; url: URL }           // watch?v= or youtu.be — needs duration check
  | { kind: 'reject'; reason: M3RejectReason };
