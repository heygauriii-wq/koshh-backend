import { describe, it, expect } from 'vitest';
import { routeDM } from './dm-router';
import { parseDmBody } from './dm-parser';

describe('routeDM', () => {
  it('routes to "save" when URLs are present', () => {
    const body = 'https://insta.com/reel/x';
    expect(routeDM(parseDmBody(body), body)).toEqual({ kind: 'save' });
  });

  it('routes to "link" on bare link code', () => {
    const body = 'koshh_a3f8c2b1';
    expect(routeDM(parseDmBody(body), body)).toEqual({ kind: 'link' });
  });

  it('routes to "save" when both link code and URL present (URL precedence)', () => {
    const body = 'koshh_a3f8c2b1 https://insta.com/reel/x';
    expect(routeDM(parseDmBody(body), body)).toEqual({ kind: 'save' });
  });

  it('routes to "no_url" on text-only', () => {
    const body = 'hi how are you';
    expect(routeDM(parseDmBody(body), body)).toEqual({ kind: 'no_url' });
  });

  it('is case-insensitive on link code', () => {
    const body = 'KOSHH_A3F8C2B1';
    expect(routeDM(parseDmBody(body), body)).toEqual({ kind: 'link' });
  });

  it('tolerates surrounding whitespace on link code', () => {
    const body = '   koshh_a3f8c2b1\n';
    expect(routeDM(parseDmBody(body), body)).toEqual({ kind: 'link' });
  });

  it('rejects malformed link codes', () => {
    expect(routeDM(parseDmBody('koshh_xyz'), 'koshh_xyz')).toEqual({ kind: 'no_url' });
    expect(routeDM(parseDmBody('koshh_'), 'koshh_')).toEqual({ kind: 'no_url' });
  });

  describe('attachment routing', () => {
    it('routes ig_post attachment-only DM through the has-URL pipeline', () => {
      const parsed = parseDmBody('', [
        { type: 'ig_post', payload: { url: 'https://lookaside.fbsbx.com/abc' } },
      ]);
      expect(routeDM(parsed, '')).toEqual({ kind: 'save' });
      expect(parsed.urls).toEqual(['https://lookaside.fbsbx.com/abc']);
    });

    it('routes legacy share attachment-only DM through the has-URL pipeline', () => {
      const parsed = parseDmBody('', [
        { type: 'share', payload: { url: 'https://lookaside.fbsbx.com/legacy' } },
      ]);
      expect(routeDM(parsed, '')).toEqual({ kind: 'save' });
      expect(parsed.urls).toEqual(['https://lookaside.fbsbx.com/legacy']);
    });

    it('routes ig_reel attachment-only DM to "save"', () => {
      const parsed = parseDmBody('', [
        { type: 'ig_reel', payload: { url: 'https://lookaside.fbsbx.com/r' } },
      ]);
      expect(routeDM(parsed, '')).toEqual({ kind: 'save' });
    });

    it('dedupes share + ig_post dual-delivery into one URL', () => {
      const parsed = parseDmBody('', [
        { type: 'share', payload: { url: 'https://lookaside.fbsbx.com/x' } },
        { type: 'ig_post', payload: { url: 'https://lookaside.fbsbx.com/x' } },
      ]);
      expect(routeDM(parsed, '')).toEqual({ kind: 'save' });
      expect(parsed.urls).toEqual(['https://lookaside.fbsbx.com/x']);
    });

    it('attachment + text-URL: both kept, text first then attachment, routes to "save"', () => {
      const body = 'check this https://instagram.com/p/text-url';
      const parsed = parseDmBody(body, [
        { type: 'ig_post', payload: { url: 'https://lookaside.fbsbx.com/att' } },
      ]);
      expect(routeDM(parsed, body)).toEqual({ kind: 'save' });
      expect(parsed.urls).toEqual([
        'https://instagram.com/p/text-url',
        'https://lookaside.fbsbx.com/att',
      ]);
    });

    it('image-only DM routes to "unsupported_attachment"', () => {
      const parsed = parseDmBody('', [
        { type: 'image', payload: { url: 'https://lookaside.fbsbx.com/img' } },
      ]);
      expect(routeDM(parsed, '')).toEqual({ kind: 'unsupported_attachment' });
    });

    it('story_mention DM routes to "unsupported_attachment"', () => {
      const parsed = parseDmBody('', [
        { type: 'story_mention', payload: { url: 'https://lookaside.fbsbx.com/story' } },
      ]);
      expect(routeDM(parsed, '')).toEqual({ kind: 'unsupported_attachment' });
    });

    it('unknown attachment type with no text routes to "unsupported_attachment"', () => {
      const parsed = parseDmBody('', [
        { type: 'weird_new_type', payload: { url: 'https://x' } },
      ]);
      expect(routeDM(parsed, '')).toEqual({ kind: 'unsupported_attachment' });
    });

    it('image attachment + link code: link wins (no URL surfaced)', () => {
      // Edge case worth pinning down: a user could attach a photo while
      // pasting a link code. parser doesn't feed image URLs into urls[], so
      // the link code path is reached.
      const body = 'koshh_a3f8c2b1';
      const parsed = parseDmBody(body, [
        { type: 'image', payload: { url: 'https://lookaside.fbsbx.com/img' } },
      ]);
      expect(routeDM(parsed, body)).toEqual({ kind: 'link' });
    });
  });
});
