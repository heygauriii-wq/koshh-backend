import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isYoutubeShortByPostId } from './youtube';

describe('isYoutubeShortByPostId (3.4)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('YOUTUBE_DATA_API_KEY', 'test-key-AIza0000');
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('returns true for a 45s video', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        items: [{ contentDetails: { duration: 'PT45S' } }],
      }), { status: 200 }),
    );

    const result = await isYoutubeShortByPostId('abc123');
    expect(result).toBe(true);

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('id=abc123');
    expect(calledUrl).toContain('part=contentDetails');
  });

  it('returns true for exactly 60s (boundary)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        items: [{ contentDetails: { duration: 'PT1M' } }],
      }), { status: 200 }),
    );
    expect(await isYoutubeShortByPostId('abc123')).toBe(true);
  });

  it('returns false for 61s (just over)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        items: [{ contentDetails: { duration: 'PT1M1S' } }],
      }), { status: 200 }),
    );
    expect(await isYoutubeShortByPostId('abc123')).toBe(false);
  });

  it('returns false for 1h30m', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        items: [{ contentDetails: { duration: 'PT1H30M' } }],
      }), { status: 200 }),
    );
    expect(await isYoutubeShortByPostId('abc123')).toBe(false);
  });

  it('returns null on empty items (deleted/private)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    expect(await isYoutubeShortByPostId('abc123')).toBeNull();
  });

  it('returns null on quota exhausted (403)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('quota', { status: 403 }));
    expect(await isYoutubeShortByPostId('abc123')).toBeNull();
  });

  it('returns null on 5xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    expect(await isYoutubeShortByPostId('abc123')).toBeNull();
  });

  it('returns null on unparseable duration', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        items: [{ contentDetails: { duration: 'WEIRD' } }],
      }), { status: 200 }),
    );
    expect(await isYoutubeShortByPostId('abc123')).toBeNull();
  });

  it('returns null on network error', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNRESET'));
    expect(await isYoutubeShortByPostId('abc123')).toBeNull();
  });

  it('throws if YOUTUBE_DATA_API_KEY is unset', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('YOUTUBE_DATA_API_KEY', '');
    vi.resetModules();
    const { isYoutubeShortByPostId: fresh } = await import('./youtube');
    await expect(fresh('abc123')).rejects.toThrow(/YOUTUBE_DATA_API_KEY/);
  });
});
