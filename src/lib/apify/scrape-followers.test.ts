import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCall = vi.fn();
const mockListItems = vi.fn();

vi.mock('apify-client', () => ({
  ApifyClient: class {
    actor() {
      return { call: mockCall };
    }
    dataset() {
      return { listItems: mockListItems };
    }
  },
}));

import { scrapeFollowers } from './scrape-followers';

describe('scrapeFollowers', () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockListItems.mockReset();
    mockCall.mockResolvedValue({ defaultDatasetId: 'mock-ds-id' });
  });

  it('shapes a live followers response', async () => {
    mockListItems.mockResolvedValue({
      items: [{
        userName: 'geodesaurus',
        userId: '407580734',
        userFullName: 'Geo Rutherford',
        followersCount: 784710,
        followsCount: 894,
      }],
    });

    const r = await scrapeFollowers('geodesaurus');
    expect(r).toEqual({ follower_count: 784710, follows_count: 894 });
  });

  it('passes usernames:[handle] (PLURAL — different from the reel actor!)', async () => {
    mockListItems.mockResolvedValue({
      items: [{ followersCount: 1, followsCount: 1 }],
    });
    await scrapeFollowers('someone');
    expect(mockCall).toHaveBeenCalledWith({ usernames: ['someone'] });
  });

  it('returns null on empty items (profile not found / private / blocked)', async () => {
    mockListItems.mockResolvedValue({ items: [] });
    const r = await scrapeFollowers('does_not_exist');
    expect(r).toBeNull();
  });

  it('coerces missing counts to null instead of throwing', async () => {
    mockListItems.mockResolvedValue({ items: [{ userName: 'x' }] });
    const r = await scrapeFollowers('x');
    expect(r).toEqual({ follower_count: null, follows_count: null });
  });
});
