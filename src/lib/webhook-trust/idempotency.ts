import { supabaseAdmin } from '../supabase-admin';

export type IdempotencyResult =
  | { fresh: true }
  | { fresh: false; reason: 'duplicate' };

// Atomic check-and-record. Returns fresh=true exactly once per key per
// table-lifetime (subject to the future 24h TTL prune). Concurrent racers
// see fresh=false on the loser.
//
// PRIMARY KEY uniqueness on `key` makes the second INSERT raise 23505
// (unique_violation). supabase-js surfaces this in error.code; we treat it
// as a duplicate, not an error.
export async function checkAndRecord(
  platform: 'meta' | 'tiktok',
  mid: string,
): Promise<IdempotencyResult> {
  const key = `${platform}:${mid}`;

  const { data, error } = await supabaseAdmin
    .from('processed_webhooks')
    .insert({ key })
    .select('key')
    .maybeSingle();

  if (error?.code === '23505') return { fresh: false, reason: 'duplicate' };
  if (error) throw error;

  if (!data) {
    // Defensive: ON CONFLICT DO NOTHING also yields no row without raising
    // an error; treat the same as duplicate.
    return { fresh: false, reason: 'duplicate' };
  }

  return { fresh: true };
}
