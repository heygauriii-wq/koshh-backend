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

export type ParsedDM = {
  urls: string[];
  tags: string[];        // without the leading '#'
  annotation: string;    // empty string if no free text
};

// Strict URL regex — must include scheme. Downstream M3 does heavy validation;
// this is just an extractor.
const URL_REGEX = /https?:\/\/[^\s]+/g;

// \B asserts non-word boundary so '#tag' matches but '/path#frag' (URL fragment)
// doesn't. Belt-and-suspenders — URL extraction already runs first.
const TAG_REGEX = /\B#([A-Za-z0-9_]+)/g;

export function parseDmBody(raw: string): ParsedDM {
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

  return { urls, tags, annotation };
}
