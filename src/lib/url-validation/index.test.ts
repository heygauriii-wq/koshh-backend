import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateUrl } from './index';

describe('validateUrl (M3 integration)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('YOUTUBE_DATA_API_KEY', 'test-key-AIza0000');
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  describe('instagram', () => {
    it.each([
      'https://www.instagram.com/reel/Cabc123/',
      'https://instagram.com/p/Cabc123/',
      'https://instagram.com/tv/Cabc123/',
    ])('accepts %s with same post_id', async (url) => {
      const r = await validateUrl(url);
      expect(r).toEqual({
        ok: true,
        platform: 'instagram',
        post_id: 'Cabc123',
        canonical_url: 'https://www.instagram.com/reel/Cabc123/',
      });
    });
  });

  describe('tiktok', () => {
    it('accepts canonical tiktok URLs without HTTP', async () => {
      const r = await validateUrl('https://www.tiktok.com/@user/video/7123456789012345678');
      expect(r).toMatchObject({
        ok: true,
        platform: 'tiktok',
        post_id: '7123456789012345678',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('resolves vm.tiktok.com via HEAD then accepts', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { Location: 'https://www.tiktok.com/@user/video/7123456789012345678' },
        }),
      );
      const r = await validateUrl('https://vm.tiktok.com/ZMabc/');
      expect(r).toMatchObject({
        ok: true,
        platform: 'tiktok',
        post_id: '7123456789012345678',
      });
    });

    it('rejects vm.tiktok.com if HEAD fails', async () => {
      fetchSpy.mockRejectedValue(new Error('timeout'));
      const r = await validateUrl('https://vm.tiktok.com/ZMabc/');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('malformed_url');
    });
  });

  describe('youtube', () => {
    it('accepts /shorts/ URL without API call', async () => {
      const r = await validateUrl('https://www.youtube.com/shorts/abc123XYZ');
      expect(r).toMatchObject({
        ok: true,
        platform: 'youtube_shorts',
        post_id: 'abc123XYZ',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('accepts youtu.be/ as Short when ≤60s', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          items: [{ contentDetails: { duration: 'PT45S' } }],
        }), { status: 200 }),
      );
      const r = await validateUrl('https://youtu.be/abc123XYZ');
      expect(r).toMatchObject({
        ok: true,
        platform: 'youtube_shorts',
        post_id: 'abc123XYZ',
      });
    });

    it('rejects youtu.be/ as long_form_youtube when >60s', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          items: [{ contentDetails: { duration: 'PT5M' } }],
        }), { status: 200 }),
      );
      const r = await validateUrl('https://youtu.be/abc123XYZ');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('long_form_youtube');
    });

    it('rejects watch?v= as metadata_unavailable on empty items', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      );
      const r = await validateUrl('https://www.youtube.com/watch?v=abc123XYZ');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('metadata_unavailable');
    });
  });

  describe('rejects', () => {
    it.each([
      ['https://pinterest.com/pin/123', 'unsupported_platform'],
      ['https://twitter.com/user/status/123', 'unsupported_platform'],
      ['not a url', 'malformed_url'],
      ['', 'malformed_url'],
    ])('%s → %s', async (url, reason) => {
      const r = await validateUrl(url);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe(reason);
        expect(r.user_message).toBeTruthy();
      }
    });
  });
});
