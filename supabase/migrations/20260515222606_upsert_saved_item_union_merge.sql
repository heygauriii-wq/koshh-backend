-- M5 amendment — switch upsert_saved_item from REPLACE semantics to UNION
-- semantics on re-DM of an already-saved Reel.
--
-- Decision change: the original "Locked decisions" in
-- Scope/Build-Guides/Pending/05-pipeline-orchestration-build.md called for
-- replace ("last DM wins"). User overrode 2026-05-15 in favor of union, so
-- re-DMing accumulates annotation lines and tags instead of overwriting.
--
-- Rules:
--   tags        — append new tags to existing (preserves existing order;
--                 dedupes; new tags only appear once even if already present)
--   annotation  — newline-append; dedupe per line so repeat sends don't grow;
--                 empty new value never overwrites existing; existing-empty
--                 takes the new value verbatim.

create or replace function public.upsert_saved_item(
  p_user_id uuid,
  p_platform text,
  p_post_id text,
  p_canonical_url text,
  p_saved_by_handle text,
  p_saved_by_platform text,
  p_annotation text,
  p_tags text[]
) returns table (id uuid, was_inserted boolean)
language sql
security definer
set search_path = public, extensions
as $$
  insert into public.saved_items (
    user_id, platform, post_id, canonical_url,
    saved_by_handle, saved_by_platform,
    annotation, tags
  ) values (
    p_user_id, p_platform, p_post_id, p_canonical_url,
    p_saved_by_handle, p_saved_by_platform,
    p_annotation, p_tags
  )
  on conflict (user_id, platform, post_id) do update
    set annotation = case
        -- new is null/empty/whitespace: keep existing untouched
        when nullif(trim(coalesce(excluded.annotation, '')), '') is null
          then saved_items.annotation
        -- existing is null/empty: take new verbatim
        when nullif(trim(coalesce(saved_items.annotation, '')), '') is null
          then excluded.annotation
        -- new line already appears in existing: dedupe (no growth on repeats)
        when excluded.annotation = any(string_to_array(saved_items.annotation, E'\n'))
          then saved_items.annotation
        -- otherwise newline-append
        else saved_items.annotation || E'\n' || excluded.annotation
      end,
      tags = saved_items.tags || (
        -- preserve existing order; append only tags not already present
        select coalesce(array_agg(t order by ord), array[]::text[])
        from unnest(excluded.tags) with ordinality as u(t, ord)
        where t <> all(saved_items.tags)
      ),
      updated_at = now()
  returning saved_items.id, (xmax = 0) as was_inserted;
$$;
