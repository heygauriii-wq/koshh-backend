// M12 — DM copy library. Typed dispatch table keyed by CopyKey.
// 13 entries: two take args (bound_elsewhere → masked_email, update_confirm → optional title).

export type CopyKey =
  | 'step1_ack'
  | 'link_confirm'
  | 'code_no_match'
  | 'cap_reached'
  | 'bound_elsewhere'
  | 'stranger'
  | 'no_url'
  | 'update_confirm'
  | 'content_unavailable'
  | 'unsupported_url'
  | 'malformed_url'
  | 'long_form_youtube'
  | 'metadata_unavailable';

type CopyFn<TArgs> = (args: TArgs) => string;

type CopyTable = {
  step1_ack: CopyFn<void>;
  link_confirm: CopyFn<void>;
  code_no_match: CopyFn<void>;
  cap_reached: CopyFn<void>;
  bound_elsewhere: CopyFn<{ masked_email: string }>;
  stranger: CopyFn<void>;
  no_url: CopyFn<void>;
  update_confirm: CopyFn<{ title?: string }>;
  content_unavailable: CopyFn<void>;
  unsupported_url: CopyFn<void>;
  malformed_url: CopyFn<void>;
  long_form_youtube: CopyFn<void>;
  metadata_unavailable: CopyFn<void>;
};

export const COPY: CopyTable = {
  step1_ack: () => 'Got it! Saving... ✓',
  link_confirm: () => "You're linked! Head to koshh.app to start saving content.",
  code_no_match: () => "That code didn't match — copy it directly from koshh.app and paste it here.",
  cap_reached: () => "You've reached the 5-handle limit. Remove a handle in Settings at koshh.app, then try again.",
  bound_elsewhere: ({ masked_email }) =>
    `This handle is already linked to a Koshh account. Sign in at koshh.app — did you forget which email you used? We'll send a recovery link to ${masked_email}.`,
  stranger: () => "Hey! This handle isn't connected to a Koshh account. Sign up at koshh.app to get started.",
  no_url: () => 'Koshh only accepts links for now — send an Instagram, TikTok, or YouTube Shorts URL to save it.',
  update_confirm: ({ title } = {}) =>
    title ? `Updated ✓ "${title}" — we refreshed your annotation and tags.` : 'Updated ✓ — we refreshed your annotation and tags.',
  content_unavailable: () => 'That content appears to have been deleted. Nothing was saved.',
  unsupported_url: () => "That link doesn't look right. Koshh supports Instagram Reels, TikTok videos, and YouTube Shorts. Check the URL and try again.",
  malformed_url: () => "That link doesn't look right. Check the URL and try again.",
  long_form_youtube: () => "Koshh supports YouTube Shorts only (≤60s). Long-form YouTube isn't supported yet.",
  metadata_unavailable: () => "We couldn't read that post's details. Make sure it's a public Reel and try again.",
};

export function resolveCopy<K extends CopyKey>(
  key: K,
  args: Parameters<CopyTable[K]>[0],
): string {
  // @ts-expect-error TS can't quite line up the generic call site
  return COPY[key](args);
}
