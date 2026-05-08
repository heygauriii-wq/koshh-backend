import { describe, it, expect } from 'vitest';
import { parseDmBody } from './dm-parser';

describe('parseDmBody', () => {
  it('extracts a single URL', () => {
    expect(parseDmBody('https://insta.com/reel/x')).toEqual({
      urls: ['https://insta.com/reel/x'],
      tags: [],
      annotation: '',
    });
  });

  it('extracts URL + tags + annotation in any order', () => {
    expect(parseDmBody('great hook #funny https://insta.com/reel/x #vibes')).toEqual({
      urls: ['https://insta.com/reel/x'],
      tags: ['funny', 'vibes'],
      annotation: 'great hook',
    });
  });

  it('preserves multiple URLs as separate entries', () => {
    const r = parseDmBody('https://a.com/x https://b.com/y');
    expect(r.urls).toEqual(['https://a.com/x', 'https://b.com/y']);
    expect(r.tags).toEqual([]);
    expect(r.annotation).toBe('');
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
    });
  });

  it('handles text-only DM (no URL)', () => {
    expect(parseDmBody('just chatting')).toEqual({
      urls: [],
      tags: [],
      annotation: 'just chatting',
    });
  });
});
