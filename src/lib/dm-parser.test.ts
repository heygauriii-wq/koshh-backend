import { describe, it, expect } from 'vitest';
import { parseDmBody } from './dm-parser';

describe('parseDmBody', () => {
  it('extracts a single URL', () => {
    expect(parseDmBody('https://insta.com/reel/x')).toEqual({
      urls: ['https://insta.com/reel/x'],
      tags: [],
      annotation: '',
      attachments: [],
    });
  });

  it('extracts URL + tags + annotation in any order', () => {
    expect(parseDmBody('great hook #funny https://insta.com/reel/x #vibes')).toEqual({
      urls: ['https://insta.com/reel/x'],
      tags: ['funny', 'vibes'],
      annotation: 'great hook',
      attachments: [],
    });
  });

  it('preserves multiple URLs as separate entries', () => {
    const r = parseDmBody('https://a.com/x https://b.com/y');
    expect(r.urls).toEqual(['https://a.com/x', 'https://b.com/y']);
    expect(r.tags).toEqual([]);
    expect(r.annotation).toBe('');
    expect(r.attachments).toEqual([]);
  });

  it('lowercases tags', () => {
    expect(parseDmBody('#FUNNY #Vibes').tags).toEqual(['funny', 'vibes']);
  });

  it('does not match # in URL fragments as tags', () => {
    const r = parseDmBody('https://example.com/path#section');
    expect(r.urls).toEqual(['https://example.com/path#section']);
    expect(r.tags).toEqual([]);
  });

  it('handles bare-link DM', () => {
    expect(parseDmBody('https://x')).toEqual({
      urls: ['https://x'],
      tags: [],
      annotation: '',
      attachments: [],
    });
  });

  it('handles text-only DM (no URL)', () => {
    expect(parseDmBody('just chatting')).toEqual({
      urls: [],
      tags: [],
      annotation: 'just chatting',
      attachments: [],
    });
  });

  describe('attachment URL extraction', () => {
    it('extracts ig_post payload URL into urls[]', () => {
      const r = parseDmBody('', [
        { type: 'ig_post', payload: { url: 'https://lookaside.fbsbx.com/abc' } },
      ]);
      expect(r.urls).toEqual(['https://lookaside.fbsbx.com/abc']);
      expect(r.attachments).toEqual([
        { type: 'ig_post', url: 'https://lookaside.fbsbx.com/abc' },
      ]);
    });

    it('extracts legacy share payload URL into urls[]', () => {
      const r = parseDmBody('', [
        { type: 'share', payload: { url: 'https://lookaside.fbsbx.com/legacy' } },
      ]);
      expect(r.urls).toEqual(['https://lookaside.fbsbx.com/legacy']);
    });

    it('extracts ig_reel and reel URLs', () => {
      const r = parseDmBody('', [
        { type: 'ig_reel', payload: { url: 'https://lookaside.fbsbx.com/r1' } },
        { type: 'reel', payload: { url: 'https://lookaside.fbsbx.com/r2' } },
      ]);
      expect(r.urls).toEqual([
        'https://lookaside.fbsbx.com/r1',
        'https://lookaside.fbsbx.com/r2',
      ]);
    });

    it('dedupes the share + ig_post dual-delivery case', () => {
      const r = parseDmBody('', [
        { type: 'share', payload: { url: 'https://lookaside.fbsbx.com/x' } },
        { type: 'ig_post', payload: { url: 'https://lookaside.fbsbx.com/x' } },
      ]);
      expect(r.urls).toEqual(['https://lookaside.fbsbx.com/x']);
      expect(r.attachments).toEqual([
        { type: 'share', url: 'https://lookaside.fbsbx.com/x' },
        { type: 'ig_post', url: 'https://lookaside.fbsbx.com/x' },
      ]);
    });

    it('orders text URLs first, then attachment URLs', () => {
      const r = parseDmBody('check this https://instagram.com/p/text-url', [
        { type: 'ig_post', payload: { url: 'https://lookaside.fbsbx.com/att' } },
      ]);
      expect(r.urls).toEqual([
        'https://instagram.com/p/text-url',
        'https://lookaside.fbsbx.com/att',
      ]);
    });

    it('records image attachments structurally but does not feed urls[]', () => {
      const r = parseDmBody('', [
        { type: 'image', payload: { url: 'https://lookaside.fbsbx.com/img.jpg' } },
      ]);
      expect(r.urls).toEqual([]);
      expect(r.attachments).toEqual([{ type: 'image', url: null }]);
    });

    it('records story_mention attachments structurally but does not feed urls[]', () => {
      const r = parseDmBody('', [
        { type: 'story_mention', payload: { url: 'https://lookaside.fbsbx.com/story' } },
      ]);
      expect(r.urls).toEqual([]);
      expect(r.attachments).toEqual([{ type: 'story_mention', url: null }]);
    });

    it('records unknown attachment types with url:null', () => {
      const r = parseDmBody('', [
        { type: 'weird_new_type', payload: { url: 'https://x' } },
      ]);
      expect(r.urls).toEqual([]);
      expect(r.attachments).toEqual([{ type: 'weird_new_type', url: null }]);
    });
  });
});
