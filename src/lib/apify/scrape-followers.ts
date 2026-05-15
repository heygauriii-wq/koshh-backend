// Module 5 Phase 2 — apify/instagram-followers-count-scraper adapter.
// apify/instagram-reel-scraper does not return follower count; this is the
// second adapter, single-purpose, cached behind creator_profiles for 7 days.
//
// Note: this actor's input parameter is `usernames` (PLURAL), one letter
// off from the reel actor's `username` (singular). Both take arrays. TS
// won't catch the typo without the runtime check the actor would do anyway;
// keeping the two adapters separate makes the call site explicit.

import { ApifyClient } from 'apify-client';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) {
  throw new Error('APIFY_TOKEN not set');
}

const client = new ApifyClient({ token: APIFY_TOKEN });
const ACTOR_ID = 'apify/instagram-followers-count-scraper';

export type FollowersResult = {
  follower_count: number | null;
  follows_count: number | null;
};

export async function scrapeFollowers(handle: string): Promise<FollowersResult | null> {
  const run = await client.actor(ACTOR_ID).call({
    usernames: [handle],
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  if (!items || items.length === 0) {
    return null;
  }

  const raw = items[0] as Record<string, unknown>;
  return {
    follower_count: (raw.followersCount as number | undefined) ?? null,
    follows_count: (raw.followsCount as number | undefined) ?? null,
  };
}
