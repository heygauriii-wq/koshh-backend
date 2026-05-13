import type { ParsedDM } from './dm-parser';

// Decision lives at M4a DFD § "Why the router lives here":
//
//   - any URLs present (text or share-attachment) → 'save'
//   - body matches /^koshh_[a-f0-9]{8}$/ AND no URLs → 'link'
//   - attachments present but none surfaced a URL → 'unsupported_attachment'
//     (image/video/audio/file/story_mention/ephemeral/unknown — see parser)
//   - neither → 'no_url'
//
// Exact-match on the link code, not LIKE. If the body has both a code and a
// URL, save wins (URL takes precedence) — the user can re-DM the bare code.
//
// The parser already merges share-attachment URLs (ig_post/share/ig_reel/reel)
// into parsed.urls and records non-share attachments in parsed.attachments
// with url:null, so the URL-vs-attachment decision is type-driven, not
// url-presence-driven. See dm-parser.ts.

const LINK_CODE_REGEX = /^koshh_[a-f0-9]{8}$/;

export type Route =
  | { kind: 'link' }
  | { kind: 'save' }
  | { kind: 'no_url' }
  | { kind: 'unsupported_attachment' };

export function routeDM(parsed: ParsedDM, body: string): Route {
  if (parsed.urls.length > 0) return { kind: 'save' };

  // Need raw trimmed body — parsed.annotation has whitespace-collapsed.
  const trimmed = body.trim().toLowerCase();
  if (LINK_CODE_REGEX.test(trimmed)) return { kind: 'link' };

  if (parsed.attachments.length > 0) return { kind: 'unsupported_attachment' };

  return { kind: 'no_url' };
}
