-- M12: store the platform-specific user ID (IGSID for IG) alongside handle.
-- Required for Send API recipient resolution. Nullable to allow existing rows
-- to coexist; M2 populates going forward; existing testers re-link once to backfill.

alter table public.linked_handles
  add column platform_user_id text;

create index linked_handles_platform_user_id_idx
  on public.linked_handles (platform_user_id)
  where platform_user_id is not null;