// Shared with M4b (TikTok DM ingest) and M4c (dashboard ingest) per the
// M4a spec § Parsing rules:
//
//   - All `#words` extracted as tags
//   - Everything remaining after stripping URLs and tags = annotation
//     (free text, order preserved)
//   - Multiple URLs → multiple items, each runs the pipeline independently
//   - Bare link → save with empty annotation/tag fields
//   - Text-only or media DM (no URL) → handled by router, not here
//
// Pure function. No I/O. Returns deterministic arrays.

// Raw attachment shape from Meta's `messages` webhook. The parser only reads
// `type` and `payload.url`; M6 will read more fields off `parsed.attachments`
// when it owns media fetching.
export type AttachmentInput = {
  type?: string;
  payload?: { url?: string; [k: string]: unknown };
};

export type ParsedAttachment = {
  type: string;
  url: string | null;   // null = type didn't contribute a URL to urls[]
};

export type ParsedDM = {
  urls: string[];
  tags: string[];        // without the leading '#'
  annotation: string;    // empty string if no free text
  attachments: ParsedAttachment[];
};

// Strict URL regex — must include scheme. Downstream M3 does heavy validation;
// this is just an extractor.
const URL_REGEX = /https?:\/\/[^\s]+/g;

// \B asserts non-word boundary so '#tag' matches but '/path#frag' (URL fragment)
// doesn't. Belt-and-suspenders — URL extraction already runs first.
const TAG_REGEX = /\B#([A-Za-z0-9_]+)/g;

// Attachment types that represent a forwarded canonical IG post/Reel — their
// payload.url maps to something M3 can resolve. Per Meta docs (Nov 2025
// rename), `share` is the legacy name, `ig_post` the replacement; `reel` and
// `ig_reel` parallel the same idea for Reels. Other types (image/video/audio/
// file/story_mention/ephemeral) also carry payload.url but it's a private CDN
// link to user-uploaded media, not a canonical post — they do NOT feed urls[].
const SHARE_ATTACHMENT_TYPES = new Set(['ig_post', 'share', 'ig_reel', 'reel']);

export function parseDmBody(raw: string, attachments?: AttachmentInput[]): ParsedDM {
  const urls: string[] = [];
  const afterUrls = raw.replace(URL_REGEX, (match) => {
    urls.push(match);
    return ' ';
  });

  const tags: string[] = [];
  const afterTags = afterUrls.replace(TAG_REGEX, (_match, body: string) => {
    tags.push(body.toLowerCase());   // M9 tag search is case-insensitive; canonicalize early
    return ' ';
  });

  const annotation = afterTags.replace(/\s+/g, ' ').trim();

  // Attachment URLs append AFTER text URLs so ordering is deterministic.
  const parsedAttachments: ParsedAttachment[] = [];
  for (const att of attachments ?? []) {
    const type = att.type ?? 'unknown';
    const url = att.payload?.url;
    if (SHARE_ATTACHMENT_TYPES.has(type) && typeof url === 'string' && url.length > 0) {
      urls.push(url);
      parsedAttachments.push({ type, url });
    } else {
      parsedAttachments.push({ type, url: null });
    }
  }

  // Dedup by exact string — covers Meta's Nov 2025–Feb 2026 dual delivery,
  // where the same forwarded post arrives as both `share` and `ig_post` in
  // one payload, and the rare case of a user typing the IG URL while also
  // attaching the post.
  const dedupedUrls = Array.from(new Set(urls));

  return { urls: dedupedUrls, tags, annotation, attachments: parsedAttachments };
}
