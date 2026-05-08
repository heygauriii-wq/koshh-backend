import { describe, it, expect } from 'vitest';
import { sniff } from './sniff';

describe('sniff (3.1)', () => {
  describe('instagram', () => {
    it.each([
      ['https://instagram.com/reel/Cabc123/', 'instagram'],
      ['https://www.instagram.com/p/Cabc123/', 'instagram'],
      ['https://instagram.com/tv/Cabc123/', 'instagram'],
      ['https://instagram.com/reel/Cabc123', 'instagram'],
    ])('%s → %s', (url, kind) => {
      const r = sniff(url);
      expect(r.kind).toBe(kind);
    });

    it('rejects IG profile URLs as unsupported_platform', () => {
      expect(sniff('https://instagram.com/gauriii_official')).toEqual({
        kind: 'reject',
        reason: 'unsupported_platform',
      });
    });
  });

  describe('tiktok', () => {
    it.each([
      ['https://vm.tiktok.com/ZMabc123/', 'tiktok_short'],
      ['https://vt.tiktok.com/ZMabc123/', 'tiktok_short'],
      ['https://tiktok.com/t/SHORT/', 'tiktok_short'],
      ['https://tiktok.com/@user/video/7123456789012345678', 'tiktok_canonical'],
      ['https://www.tiktok.com/@user/video/7123456789012345678', 'tiktok_canonical'],
    ])('%s → %s', (url, kind) => {
      expect(sniff(url).kind).toBe(kind);
    });
  });

  describe('youtube', () => {
    it.each([
      ['https://www.youtube.com/shorts/abc123XYZ', 'youtube_shorts'],
      ['https://youtube.com/shorts/abc123XYZ', 'youtube_shorts'],
      ['https://www.youtube.com/watch?v=abc123XYZ', 'youtube_ambiguous'],
      ['https://m.youtube.com/watch?v=abc123XYZ', 'youtube_ambiguous'],
      ['https://youtu.be/abc123XYZ', 'youtube_ambiguous'],
      ['https://www.youtube.com/embed/abc123XYZ', 'youtube_ambiguous'],
    ])('%s → %s', (url, kind) => {
      expect(sniff(url).kind).toBe(kind);
    });

    it('rejects youtu.be without a path as malformed', () => {
      const r = sniff('https://youtu.be/');
      expect(r.kind).toBe('reject');
      if (r.kind === 'reject') expect(r.reason).toBe('malformed_url');
    });
  });

  describe('rejects', () => {
    it.each([
      ['https://pinterest.com/pin/123', 'unsupported_platform'],
      ['https://twitter.com/x/status/123', 'unsupported_platform'],
      ['https://x.com/x/status/123', 'unsupported_platform'],
      ['https://facebook.com/share/v/abc', 'unsupported_platform'],
      ['https://linkedin.com/posts/abc', 'unsupported_platform'],
    ])('%s → unsupported_platform', (url) => {
      const r = sniff(url);
      expect(r.kind).toBe('reject');
      if (r.kind === 'reject') expect(r.reason).toBe('unsupported_platform');
    });

    it.each([
      'not a url',
      'javascript:alert(1)',
      '',
      'http://',
    ])('garbage input %s → malformed_url', (url) => {
      const r = sniff(url);
      expect(r.kind).toBe('reject');
      if (r.kind === 'reject') expect(r.reason).toBe('malformed_url');
    });
  });
});
