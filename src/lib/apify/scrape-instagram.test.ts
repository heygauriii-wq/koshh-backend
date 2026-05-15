import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock apify-client BEFORE importing the adapter so the ApifyClient
// constructor in the module never tries to instantiate a real client.
const mockCall = vi.fn();
const mockListItems = vi.fn();

vi.mock('apify-client', () => ({
  // class form (not arrow vi.fn) — the adapter calls `new ApifyClient(...)`
  // and arrow functions can't be constructed.
  ApifyClient: class {
    actor() {
      return { call: mockCall };
    }
    dataset() {
      return { listItems: mockListItems };
    }
  },
}));

// The adapter throws at module-import time if APIFY_TOKEN is absent.
// test/setup.ts seeds it before any test file runs; the apify-client mock
// above swallows the actual HTTP call.
import { scrapeInstagram } from './scrape-instagram';

describe('scrapeInstagram', () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockListItems.mockReset();
    mockCall.mockResolvedValue({ defaultDatasetId: 'mock-ds-id' });
  });

  it('shapes a live reel response into ScrapedItem with flat transcript', async () => {
    mockListItems.mockResolvedValue({
      items: [{
        id: '3350638485823625271',
        type: 'Video',
        shortCode: 'C5_2_NORRg3',
        caption: 'How many lakes did you recognize?',
        ownerUsername: 'geodesaurus',
        ownerId: '407580734',
        timestamp: '2024-04-20T21:09:52.000Z',
        displayUrl: 'https://scontent/displayUrl.jpg',
        videoUrl: 'https://scontent/video.mp4',
        videoViewCount: 209074,
        videoPlayCount: 564372,
        likesCount: 34286,
        commentsCount: 1450,
        transcript: 'Um, yes, hello. It is not Spooky Lake Month anymore.',
      }],
    });

    const r = await scrapeInstagram('C5_2_NORRg3', 'https://www.instagram.com/p/C5_2_NORRg3/');

    expect(r.content_state).toBe('active');
    expect(r.caption).toBe('How many lakes did you recognize?');
    expect(r.author_handle).toBe('geodesaurus');
    expect(r.author_id).toBe('407580734');
    expect(r.thumbnail_url).toBe('https://scontent/displayUrl.jpg');
    expect(r.view_count).toBe(564372); // prefers videoPlayCount
    expect(r.like_count).toBe(34286);
    expect(r.comments_count).toBe(1450);
    expect(r.transcript).toBe('Um, yes, hello. It is not Spooky Lake Month anymore.');
  });

  it('passes username:[canonical_url] + includeTranscript:true + resultsLimit:1', async () => {
    mockListItems.mockResolvedValue({
      items: [{
        caption: 'x',
        ownerUsername: 'a',
        timestamp: '2026-01-01T00:00:00Z',
        videoPlayCount: 1,
        likesCount: 1,
        commentsCount: 0,
      }],
    });

    await scrapeInstagram('XYZ', 'https://www.instagram.com/reel/XYZ/');

    expect(mockCall).toHaveBeenCalledWith({
      username: ['https://www.instagram.com/reel/XYZ/'],
      resultsLimit: 1,
      includeTranscript: true,
    });
  });

  it('returns deleted state when items array is empty', async () => {
    mockListItems.mockResolvedValue({ items: [] });
    const r = await scrapeInstagram('GONE_1', 'https://www.instagram.com/reel/GONE_1/');
    expect(r.content_state).toBe('deleted');
    expect(r.caption).toBe('');
  });

  it('returns deleted state when item has an error key', async () => {
    mockListItems.mockResolvedValue({ items: [{ error: 'not_found' }] });
    const r = await scrapeInstagram('GONE_2', 'https://www.instagram.com/reel/GONE_2/');
    expect(r.content_state).toBe('deleted');
  });

  it('returns deleted state when caption empty and zero views (heuristic)', async () => {
    mockListItems.mockResolvedValue({
      items: [{
        caption: '',
        videoViewCount: 0,
        ownerUsername: 'whoever',
      }],
    });
    const r = await scrapeInstagram('GHOST', 'https://www.instagram.com/reel/GHOST/');
    expect(r.content_state).toBe('deleted');
  });

  it('falls back to videoViewCount when videoPlayCount is absent', async () => {
    mockListItems.mockResolvedValue({
      items: [{
        caption: 'has caption',
        ownerUsername: 'a',
        timestamp: '2026-01-01T00:00:00Z',
        videoViewCount: 42,
        likesCount: 0,
        commentsCount: 0,
      }],
    });
    const r = await scrapeInstagram('FALLBACK', 'https://www.instagram.com/reel/FALLBACK/');
    expect(r.view_count).toBe(42);
  });

  it('returns transcript: null when actor omits the field (paid flag off, etc.)', async () => {
    mockListItems.mockResolvedValue({
      items: [{
        caption: 'no transcript field',
        ownerUsername: 'creator',
        timestamp: '2026-04-01T00:00:00Z',
        videoPlayCount: 100,
        likesCount: 5,
        commentsCount: 0,
      }],
    });
    const r = await scrapeInstagram('NO_TRANSCRIPT', 'https://x');
    expect(r.transcript).toBeNull();
    expect(r.content_state).toBe('active');
  });
});
