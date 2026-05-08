import { describe, it, expect } from 'vitest';
import {
  extractInstagramPostId,
  extractTikTokPostId,
  extractYouTubePostId,
} from './extract';

const u = (s: string) => new URL(s);

describe('extract (3.3)', () => {
  describe('instagram', () => {
    it.each([
      ['https://instagram.com/reel/Cabc123/', 'Cabc123'],
      ['https://instagram.com/p/Cabc123/', 'Cabc123'],
      ['https://instagram.com/tv/Cabc123/', 'Cabc123'],
      ['https://www.instagram.com/reel/Cabc123_xyz/', 'Cabc123_xyz'],
      ['https://instagram.com/reel/Cabc123/?utm_source=share', 'Cabc123'],
    ])('%s → %s', (url, expected) => {
      expect(extractInstagramPostId(u(url))).toBe(expected);
    });

    it('returns null on bad path', () => {
      expect(extractInstagramPostId(u('https://instagram.com/profile'))).toBeNull();
    });
  });

  describe('tiktok', () => {
    it.each([
      ['https://tiktok.com/@user/video/7123456789012345678', '7123456789012345678'],
      ['https://www.tiktok.com/@user/video/7123456789012345678?lang=en', '7123456789012345678'],
    ])('%s → %s', (url, expected) => {
      expect(extractTikTokPostId(u(url))).toBe(expected);
    });

    it('rejects non-numeric video ids', () => {
      expect(extractTikTokPostId(u('https://tiktok.com/@user/video/abc'))).toBeNull();
    });
  });

  describe('youtube', () => {
    it.each([
      ['https://youtube.com/shorts/abc123XYZ', 'abc123XYZ'],
      ['https://www.youtube.com/watch?v=abc123XYZ', 'abc123XYZ'],
      ['https://youtu.be/abc123XYZ', 'abc123XYZ'],
      ['https://www.youtube.com/embed/abc123XYZ', 'abc123XYZ'],
      ['https://youtu.be/abc123XYZ?t=5', 'abc123XYZ'],
      ['https://www.youtube.com/watch?v=abc123XYZ&feature=share', 'abc123XYZ'],
    ])('%s → %s', (url, expected) => {
      expect(extractYouTubePostId(u(url))).toBe(expected);
    });

    it('returns null when v= is missing on /watch', () => {
      expect(extractYouTubePostId(u('https://youtube.com/watch'))).toBeNull();
    });
  });
});
