import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleLinkDM } from './link-dm';
import { supabaseAdmin } from '../lib/supabase-admin';
import * as dmStub from '../lib/dm-stub';

vi.mock('../lib/dm-stub', () => ({ sendDM: vi.fn() }));

type TestUser = { id: string; link_code: string; email: string };

describe('handleLinkDM', () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeEach(async () => {
    userA = await createTestUser();
    userB = await createTestUser();
    vi.mocked(dmStub.sendDM).mockClear();
  });

  afterEach(async () => {
    // Cascade FK on auth.users → public.users → linked_handles cleans up
    // every row this test created, so the unique_live index stays clear for
    // the next test.
    await supabaseAdmin.auth.admin.deleteUser(userA.id);
    await supabaseAdmin.auth.admin.deleteUser(userB.id);
  });

  it('rejects unknown link codes with code_no_match', async () => {
    const result = await handleLinkDM({
      sender_handle: 'someone',
      platform: 'instagram',
      body: 'koshh_deadbeef', // valid format, not a real code
      mid: 'm-1',
    });
    expect(result).toEqual({ ok: false, reason: 'code_no_match' });
    expect(dmStub.sendDM).toHaveBeenCalledWith(
      expect.objectContaining({ copy_key: 'code_no_match' })
    );
  });

  it('rejects malformed link codes with code_no_match (defense in depth)', async () => {
    const result = await handleLinkDM({
      sender_handle: 'someone',
      platform: 'instagram',
      body: 'KOSHH_NOT_HEX',
      mid: 'm-2',
    });
    expect(result).toEqual({ ok: false, reason: 'code_no_match' });
  });

  it('inserts a new row on first link from this handle', async () => {
    const result = await handleLinkDM({
      sender_handle: 'gauriii',
      platform: 'instagram',
      body: userA.link_code,
      mid: 'm-3',
    });
    expect(result).toEqual({ ok: true, outcome: 'linked' });

    const { data: rows } = await supabaseAdmin
      .from('linked_handles')
      .select('*')
      .eq('user_id', userA.id);
    expect(rows).toHaveLength(1);
    expect(rows![0].handle).toBe('gauriii');
    expect(rows![0].unlinked_at).toBeNull();
  });

  it('revives a soft-deleted row instead of inserting', async () => {
    await seedLinkedHandle(userA.id, 'gauriii', 'instagram');
    await seedSoftDelete(userA.id, 'gauriii');

    const result = await handleLinkDM({
      sender_handle: 'gauriii',
      platform: 'instagram',
      body: userA.link_code,
      mid: 'm-4',
    });
    expect(result).toEqual({ ok: true, outcome: 'revived' });

    const { data: rows } = await supabaseAdmin
      .from('linked_handles')
      .select('*')
      .eq('user_id', userA.id);
    expect(rows).toHaveLength(1); // not 2
    expect(rows![0].unlinked_at).toBeNull();
  });

  it('idempotent: re-DM from already-linked handle returns already_linked', async () => {
    await seedLinkedHandle(userA.id, 'gauriii', 'instagram');

    const result = await handleLinkDM({
      sender_handle: 'gauriii',
      platform: 'instagram',
      body: userA.link_code,
      mid: 'm-5',
    });
    expect(result).toEqual({ ok: true, outcome: 'already_linked' });
    expect(dmStub.sendDM).toHaveBeenCalledWith(
      expect.objectContaining({ copy_key: 'link_confirm' })
    );
  });

  it('bound-elsewhere: handle owned by another user → recovery DM with masked email', async () => {
    await seedLinkedHandle(userB.id, 'gauriii', 'instagram');

    const result = await handleLinkDM({
      sender_handle: 'gauriii',
      platform: 'instagram',
      body: userA.link_code,
      mid: 'm-6',
    });
    expect(result).toEqual({ ok: false, reason: 'bound_elsewhere' });
    expect(dmStub.sendDM).toHaveBeenCalledWith(expect.objectContaining({
      copy_key: 'bound_elsewhere',
      args: expect.objectContaining({
        // userB email starts with 'phase-1-...' — first char + '***'
        masked_email: expect.stringMatching(/^p\*\*\*@/),
      }),
    }));
  });

  it('5-cap reached → cap_reached', async () => {
    for (let i = 1; i <= 5; i++) {
      await seedLinkedHandle(userA.id, `h${i}`, 'instagram');
    }

    const result = await handleLinkDM({
      sender_handle: 'h6',
      platform: 'instagram',
      body: userA.link_code,
      mid: 'm-7',
    });
    expect(result).toEqual({ ok: false, reason: 'cap_reached' });
  });

  it('cap counts only live rows', async () => {
    for (let i = 1; i <= 5; i++) {
      await seedLinkedHandle(userA.id, `live${i}`, 'instagram');
    }
    for (let i = 1; i <= 3; i++) {
      await seedLinkedHandle(userA.id, `dead${i}`, 'instagram');
      await seedSoftDelete(userA.id, `dead${i}`);
    }

    const result = await handleLinkDM({
      sender_handle: 'live6',
      platform: 'instagram',
      body: userA.link_code,
      mid: 'm-8',
    });
    expect(result).toEqual({ ok: false, reason: 'cap_reached' });
  });
});

let userCounter = 0;

async function createTestUser(): Promise<TestUser> {
  userCounter += 1;
  const email = `phase-1-${Date.now()}-${userCounter}@koshh.test`;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email, email_confirm: true,
  });
  if (error) throw error;
  const id = data.user!.id;
  const { data: row, error: selErr } = await supabaseAdmin
    .from('users')
    .select('link_code, email')
    .eq('id', id)
    .single();
  if (selErr) throw selErr;
  return { id, link_code: row!.link_code, email: row!.email };
}

async function seedLinkedHandle(user_id: string, handle: string, platform: 'instagram' | 'tiktok') {
  const { error } = await supabaseAdmin
    .from('linked_handles')
    .insert({ user_id, handle, platform });
  if (error) throw error;
}

async function seedSoftDelete(user_id: string, handle: string) {
  const { error } = await supabaseAdmin
    .from('linked_handles')
    .update({ unlinked_at: new Date().toISOString() })
    .eq('user_id', user_id)
    .eq('handle', handle);
  if (error) throw error;
}
