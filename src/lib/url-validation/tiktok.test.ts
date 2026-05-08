import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveTikTokShortUrl } from './tiktok';

describe('resolveTikTokShortUrl (3.2)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('resolves vm.tiktok.com to canonical via HEAD 301', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 301,
        headers: { Location: 'https://www.tiktok.com/@user/video/7123456789012345678' },
      }),
    );

    const result = await resolveTikTokShortUrl(new URL('https://vm.tiktok.com/ZMabc/'));
    expect(result?.toString()).toBe('https://www.tiktok.com/@user/video/7123456789012345678');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://vm.tiktok.com/ZMabc/',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
    );
  });

  it('falls back to GET if HEAD returns no Location', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { Location: 'https://www.tiktok.com/@user/video/7123456789012345678' },
        }),
      );

    const result = await resolveTikTokShortUrl(new URL('https://vm.tiktok.com/ZMabc/'));
    expect(result?.toString()).toBe('https://www.tiktok.com/@user/video/7123456789012345678');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][1]).toMatchObject({ method: 'GET' });
  });

  it('rejects redirects to non-tiktok hosts', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 301,
        headers: { Location: 'https://evil.com/phish' },
      }),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 301,
        headers: { Location: 'https://evil.com/phish' },
      }),
    );

    const result = await resolveTikTokShortUrl(new URL('https://vm.tiktok.com/ZMabc/'));
    expect(result).toBeNull();
  });

  it('rejects redirects to tiktok.com but with non-canonical path', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 301,
        headers: { Location: 'https://www.tiktok.com/explore' },
      }),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 301,
        headers: { Location: 'https://www.tiktok.com/explore' },
      }),
    );

    const result = await resolveTikTokShortUrl(new URL('https://vm.tiktok.com/ZMabc/'));
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await resolveTikTokShortUrl(new URL('https://vm.tiktok.com/ZMabc/'));
    expect(result).toBeNull();
  });
});
