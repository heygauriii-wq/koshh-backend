import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('resolveInstagramMedia (3.6)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('META_PAGE_ACCESS_TOKEN', 'test-page-token-EAA');
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('returns permalink + media_type on success', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        permalink: 'https://www.instagram.com/p/Cabc123/',
        media_type: 'VIDEO',
      }), { status: 200 }),
    );

    const { resolveInstagramMedia } = await import('./instagram-graph');
    const r = await resolveInstagramMedia('17891234567890');

    expect(r).toEqual({
      permalink: 'https://www.instagram.com/p/Cabc123/',
      media_type: 'VIDEO',
    });
  });

  it('passes media_id + token in the Graph API request', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        permalink: 'https://www.instagram.com/reel/Cxyz999/',
        media_type: 'VIDEO',
      }), { status: 200 }),
    );

    const { resolveInstagramMedia } = await import('./instagram-graph');
    await resolveInstagramMedia('17891234567890');

    const callUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '');
    expect(callUrl).toContain('https://graph.instagram.com/v23.0/17891234567890');
    expect(callUrl).toContain('fields=permalink%2Cmedia_type');
    expect(callUrl).toContain('access_token=test-page-token-EAA');
  });

  it('returns null on 4xx (token expired / inaccessible media)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid OAuth token' } }), {
        status: 401,
      }),
    );

    const { resolveInstagramMedia } = await import('./instagram-graph');
    const r = await resolveInstagramMedia('17891234567890');
    expect(r).toBeNull();
  });

  it('returns null on 5xx (Meta server hiccup)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 503 }));

    const { resolveInstagramMedia } = await import('./instagram-graph');
    const r = await resolveInstagramMedia('17891234567890');
    expect(r).toBeNull();
  });

  it('returns null on network error / timeout', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('aborted'));

    const { resolveInstagramMedia } = await import('./instagram-graph');
    const r = await resolveInstagramMedia('17891234567890');
    expect(r).toBeNull();
  });

  it('returns null when response is missing permalink', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ media_type: 'VIDEO' }), { status: 200 }),
    );

    const { resolveInstagramMedia } = await import('./instagram-graph');
    const r = await resolveInstagramMedia('17891234567890');
    expect(r).toBeNull();
  });

  it('returns null when response is missing media_type', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ permalink: 'https://www.instagram.com/p/x/' }), {
        status: 200,
      }),
    );

    const { resolveInstagramMedia } = await import('./instagram-graph');
    const r = await resolveInstagramMedia('17891234567890');
    expect(r).toBeNull();
  });

  it('throws helpful error when META_PAGE_ACCESS_TOKEN is missing', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('META_PAGE_ACCESS_TOKEN', '');
    vi.resetModules();

    const { resolveInstagramMedia } = await import('./instagram-graph');
    await expect(resolveInstagramMedia('17891234567890')).rejects.toThrow(
      /META_PAGE_ACCESS_TOKEN is not set/,
    );
  });
});
