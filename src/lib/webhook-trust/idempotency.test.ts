import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { checkAndRecord } from './idempotency';
import { supabaseAdmin } from '../supabase-admin';

// File-scoped prefix prevents cross-file cleanup races — webhooks-meta.test.ts
// uses 'vitest_wh_%' so its rows are never wiped by this file's cleanup, and
// vice versa. Cleans both meta: and tiktok: keyspaces (platform-keyspace test).
async function cleanup() {
  await supabaseAdmin.from('processed_webhooks').delete().like('key', 'meta:vitest_idem_%');
  await supabaseAdmin.from('processed_webhooks').delete().like('key', 'tiktok:vitest_idem_%');
}

describe('checkAndRecord', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it('returns fresh=true on first call, fresh=false on second', async () => {
    const mid = `vitest_idem_${Date.now()}_a`;

    const first = await checkAndRecord('meta', mid);
    expect(first).toEqual({ fresh: true });

    const second = await checkAndRecord('meta', mid);
    expect(second).toEqual({ fresh: false, reason: 'duplicate' });
  });

  it('different mids do not collide', async () => {
    const a = await checkAndRecord('meta', `vitest_idem_${Date.now()}_b1`);
    const b = await checkAndRecord('meta', `vitest_idem_${Date.now()}_b2`);
    expect(a.fresh).toBe(true);
    expect(b.fresh).toBe(true);
  });

  it('platform prefixes are independent keyspaces', async () => {
    const mid = `vitest_idem_${Date.now()}_c`;
    const meta = await checkAndRecord('meta', mid);
    const tiktok = await checkAndRecord('tiktok', mid);
    expect(meta.fresh).toBe(true);
    expect(tiktok.fresh).toBe(true);
  });
});
