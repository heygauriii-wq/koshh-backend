import { supabaseAdmin } from '../lib/supabase-admin';
import { sendDM } from '../lib/dm-stub';
import { maskEmail } from '../lib/mask-email';

export type LinkDMPayload = {
  sender_handle: string;
  platform: 'instagram' | 'tiktok';
  body: string;
  // mid passed for log correlation only — idempotency was M11's job upstream
  mid: string;
};

export type LinkDMResult =
  | { ok: true;  outcome: 'linked' | 'revived' | 'already_linked' }
  | { ok: false; reason: 'code_no_match' | 'bound_elsewhere' | 'cap_reached' };

const FIVE_HANDLE_CAP = 5;
const LINK_CODE_REGEX = /^koshh_[a-f0-9]{8}$/;

export async function handleLinkDM(payload: LinkDMPayload): Promise<LinkDMResult> {
  const link_code = payload.body.trim().toLowerCase();

  // Defense in depth — M4a's router already gated on this regex.
  if (!LINK_CODE_REGEX.test(link_code)) {
    await sendDM({ handle: payload.sender_handle, platform: payload.platform, copy_key: 'code_no_match' });
    return { ok: false, reason: 'code_no_match' };
  }

  const user = await matchLinkCode(link_code);
  if (!user) {
    await sendDM({ handle: payload.sender_handle, platform: payload.platform, copy_key: 'code_no_match' });
    return { ok: false, reason: 'code_no_match' };
  }

  // Bound-elsewhere check runs before cap — recovery DM is a more important
  // user-facing signal than "you're at cap."
  const existing = await getLiveBinding(payload.sender_handle, payload.platform);

  if (existing && existing.user_id !== user.id) {
    const ownerEmail = await getUserEmail(existing.user_id);
    await sendDM({
      handle: payload.sender_handle,
      platform: payload.platform,
      copy_key: 'bound_elsewhere',
      args: { masked_email: maskEmail(ownerEmail) },
    });
    return { ok: false, reason: 'bound_elsewhere' };
  }

  if (existing && existing.user_id === user.id) {
    // Idempotent re-link from the same user's already-linked handle.
    await sendDM({ handle: payload.sender_handle, platform: payload.platform, copy_key: 'link_confirm' });
    return { ok: true, outcome: 'already_linked' };
  }

  const liveCount = await countLiveHandles(user.id);
  if (liveCount >= FIVE_HANDLE_CAP) {
    await sendDM({ handle: payload.sender_handle, platform: payload.platform, copy_key: 'cap_reached' });
    return { ok: false, reason: 'cap_reached' };
  }

  const result = await reviveOrInsert(user.id, payload.sender_handle, payload.platform);

  await sendDM({ handle: payload.sender_handle, platform: payload.platform, copy_key: 'link_confirm' });
  return { ok: true, outcome: result.action };
}

async function matchLinkCode(link_code: string): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('link_code', link_code)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getLiveBinding(handle: string, platform: string) {
  const { data, error } = await supabaseAdmin
    .from('linked_handles')
    .select('user_id')
    .eq('handle', handle)
    .eq('platform', platform)
    .is('unlinked_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getUserEmail(user_id: string): Promise<string> {
  // D-012: email is denormalized onto public.users from auth.users via the
  // sync trigger. Normal table SELECT, no admin-API path.
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', user_id)
    .single();
  if (error || !data?.email) {
    throw new Error(`could not resolve email for user ${user_id}: ${error?.message ?? 'no email'}`);
  }
  return data.email;
}

async function countLiveHandles(user_id: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('linked_handles')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user_id)
    .is('unlinked_at', null);
  if (error) throw error;
  return count ?? 0;
}

async function reviveOrInsert(
  user_id: string,
  handle: string,
  platform: 'instagram' | 'tiktok'
): Promise<{ action: 'linked' | 'revived' }> {
  const { data: revived, error: reviveErr } = await supabaseAdmin
    .from('linked_handles')
    .update({ unlinked_at: null })
    .eq('user_id', user_id)
    .eq('handle', handle)
    .eq('platform', platform)
    .not('unlinked_at', 'is', null)
    .select()
    .maybeSingle();

  if (reviveErr) throw reviveErr;
  if (revived) return { action: 'revived' };

  const { error: insertErr } = await supabaseAdmin
    .from('linked_handles')
    .insert({ user_id, handle, platform });

  if (insertErr) {
    // 23505 = unique_violation against linked_handles_unique_live. Means a
    // concurrent handler INSERTed the same (handle, platform) live row between
    // our bound-elsewhere check and now. Partial unique index keeps integrity;
    // throw so M11's retry re-runs bound-elsewhere with the committed row.
    if ((insertErr as { code?: string }).code === '23505') {
      throw new Error(`link_race_lost: ${insertErr.message}`);
    }
    throw insertErr;
  }

  return { action: 'linked' };
}
