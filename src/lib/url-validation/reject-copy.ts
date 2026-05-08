import type { M3RejectReason } from './types';

// Canned user-facing messages, one per reject reason. M12 (DM Reply Sender)
// will import this map directly so DM copy stays in sync with M3's reasons.
// One source of truth: change here, every consumer updates.
export const REJECT_COPY: Record<M3RejectReason, string> = {
  unsupported_platform:
    "That link's from a platform Koshh doesn't support yet. Right now we handle Instagram Reels, TikTok videos, and YouTube Shorts.",
  unsupported_content:
    "That post looks like a carousel — Koshh saves video content only at the moment. Try sending a Reel or single video post.",
  long_form_youtube:
    "Koshh supports YouTube Shorts only (≤60s). Long-form YouTube isn't supported yet — try the /shorts/ URL if it's a Short.",
  malformed_url:
    "That link doesn't look right. Koshh supports Instagram Reels, TikTok videos, and YouTube Shorts.",
  metadata_unavailable:
    "Couldn't read that video's metadata — it might be private, deleted, or temporarily unavailable. If it's a YouTube Short, try the /shorts/ URL directly.",
};
