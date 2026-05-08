import type { ParsedDM } from './dm-parser';

// Decision lives at M4a DFD § "Why the router lives here":
//
//   - body matches /^koshh_[a-f0-9]{8}$/ AND no URLs → 'link'
//   - URLs present (regardless of body) → 'save'
//   - neither → 'no_url'
//
// Exact-match on the link code, not LIKE. If the body has both a code and a
// URL, save wins (URL takes precedence) — the user can re-DM the bare code.

const LINK_CODE_REGEX = /^koshh_[a-f0-9]{8}$/;

export type Route = 'link' | 'save' | 'no_url';

export function routeDM(parsed: ParsedDM, body: string): Route {
  if (parsed.urls.length > 0) return 'save';

  // Need raw trimmed body — parsed.annotation has whitespace-collapsed.
  const trimmed = body.trim().toLowerCase();
  if (LINK_CODE_REGEX.test(trimmed)) return 'link';

  return 'no_url';
}
