-- M2 — linked_handles: bindings between Koshh users and social handles (IG, TikTok).
-- Soft-delete via unlinked_at; see D-011 (no grace period) and D-004 (snapshot strings).

create table public.linked_handles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  handle      text not null,
  platform    text not null check (platform in ('instagram', 'tiktok')),
  unlinked_at timestamptz null,
  created_at  timestamptz not null default now()
);

comment on table public.linked_handles is
  'Module 2 — bindings between a Koshh user and a social handle (IG, TikTok). Soft-delete via unlinked_at; see D-011 for no-grace policy.';
comment on column public.linked_handles.unlinked_at is
  'NULL = live binding. Non-NULL = soft-deleted (instant unlink, kept for archive + revive).';

-- Partial unique index — enforces "one live binding per (handle, platform)" and
-- also serves the M4a/M4b/M5 sender-lookup read path (every save DM resolves
-- sender → user_id via this index). Soft-deleted rows are excluded, which is
-- what makes the revive-or-insert logic in handleLinkDM safe.
create unique index linked_handles_unique_live
  on public.linked_handles (handle, platform)
  where unlinked_at is null;

-- Per-user lookup — used by FE Settings list and the 5-cap count.
create index linked_handles_user_live
  on public.linked_handles (user_id)
  where unlinked_at is null;

-- RLS: read-own only. Writes happen exclusively via service_role (BE webhook
-- handler) or via the unlink_handle SECURITY DEFINER RPC.
alter table public.linked_handles enable row level security;

create policy linked_handles_select_own
  on public.linked_handles
  for select
  using (auth.uid() = user_id);

-- unlink_handle RPC — FE-callable. SECURITY DEFINER bypasses RLS for the UPDATE;
-- auth.uid() filter scopes the update to the caller's own row.
create or replace function public.unlink_handle(p_handle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.linked_handles
     set unlinked_at = now()
   where id          = p_handle_id
     and user_id     = auth.uid()
     and unlinked_at is null;

  if not found then
    raise exception 'handle_not_found_or_already_unlinked'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.unlink_handle(uuid) from public;
grant execute on function public.unlink_handle(uuid) to authenticated;
