-- M5 — Pipeline Orchestration. Owns saved_items (per-save row) and
-- view_snapshots (per-refresh history). Plus creator_profiles (per-creator
-- follower-count cache for Step 4.5) and the thumbnails Storage bucket.
--
-- RLS for saved_items belongs to M9 (the reader) and M10 (the mutator).
-- M5's writes go through service-role, which bypasses RLS — the table is
-- queryable only via service-role until M9 lands.

create type pipeline_status as enum ('processing', 'ready', 'failed');
create type content_state as enum ('active', 'deleted', 'private');

create table public.saved_items (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,

  -- identity (D-003, D-004)
  platform              text not null check (platform in ('instagram','tiktok','youtube_shorts')),
  post_id               text not null,
  canonical_url         text not null,
  saved_by_handle       text not null,
  saved_by_platform     text not null,

  -- user input (D-005)
  annotation            text,
  tags                  text[] not null default array[]::text[],

  -- content fields (populated by Apify at Step 4)
  caption               text,
  author_handle         text,
  post_date             timestamptz,
  transcript            text,
  transcript_segments   jsonb,  -- reserved for future Whisper-grade timing; null in MVP
  hook                  text,   -- reserved for M5a; null in MVP

  -- media (M6 owns behavior; columns live here per D-008)
  embed_url             text,
  thumbnail_path        text,

  -- virality (D-001 mirror of latest snapshot)
  virality_coefficient  double precision,
  current_signals       jsonb,

  -- state (D-007)
  pipeline_status       pipeline_status not null default 'processing',
  content_state         content_state not null default 'active',
  retry_count           int not null default 0,
  last_error            text,

  -- timestamps
  saved_at              timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- FTS (X-3): generated tsvector over user-visible text fields.
  -- 'simple' config (vs 'english') because content is multilingual
  -- (Hindi / Hinglish / English); revisit when M7's caption-language work lands.
  search_tsv            tsvector generated always as (
                          to_tsvector('simple',
                            coalesce(annotation, '') || ' ' ||
                            coalesce(caption, '')    || ' ' ||
                            coalesce(transcript, '')
                          )
                        ) stored,

  -- dedup (D-003)
  constraint saved_items_user_platform_post_unique
    unique (user_id, platform, post_id)
);

create index saved_items_user_saved_at_idx on public.saved_items (user_id, saved_at desc);
create index saved_items_tags_gin_idx on public.saved_items using gin (tags);
create index saved_items_search_tsv_idx on public.saved_items using gin (search_tsv);
-- Partial index keeps the index small: ready rows are the majority and
-- M9 filters WHERE pipeline_status = 'ready' (the inverse predicate), so
-- a small index over the hot in-flight + failed rows is what we want.
create index saved_items_pipeline_status_idx
  on public.saved_items (pipeline_status)
  where pipeline_status <> 'ready';

comment on table public.saved_items is
  'Module 5 — per-save row. M5 owns all writes (via src/lib/saved-items-repo.ts). M9 reads with pipeline_status = ready filter.';

-- view_snapshots: append-only, time-ordered virality history. M5 inserts the
-- first row at Step 7; M8 will insert subsequent rows on each refresh.
create table public.view_snapshots (
  id                    bigserial primary key,
  item_id               uuid not null references public.saved_items(id) on delete cascade,
  ts                    timestamptz not null default now(),
  views                 bigint not null,
  likes                 bigint,
  comments              bigint,
  follower_count        bigint,
  virality_coefficient  double precision,
  signals               jsonb
);

-- M10's "last 30 snapshots" query walks this index forward.
create index view_snapshots_item_ts_idx on public.view_snapshots (item_id, ts desc);

comment on table public.view_snapshots is
  'Module 5 — per-refresh virality history. Append-only; primary key is bigserial because rows are ~24x saved_items at MVP and never referenced externally.';

-- creator_profiles: per-creator follower-count cache. Read at Step 4.5 of the
-- pipeline; on miss or row older than 7 days, refreshed via the Apify
-- instagram-followers-count-scraper adapter. Composite natural PK because the
-- join key is (platform, handle); no synthetic id needed.
create table public.creator_profiles (
  platform        text not null check (platform in ('instagram','tiktok','youtube_shorts')),
  handle          text not null,
  follower_count  bigint,
  follows_count   bigint,
  fetched_at      timestamptz not null default now(),
  primary key (platform, handle)
);

comment on table public.creator_profiles is
  'Module 5 — per-creator follower-count cache. 7-day TTL enforced in app code (src/lib/pipeline/run.ts).';

-- thumbnails: public-read Supabase Storage bucket. M6 writes; FE reads via
-- public URL. No RLS policies for authenticated role — only service-role writes.
insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RPCs called from src/lib/saved-items-repo.ts.
-- ---------------------------------------------------------------------------

-- upsert_saved_item: atomic insert-or-update on (user_id, platform, post_id).
-- Returns was_inserted via the Postgres-internal xmax trick (zero on a fresh
-- insert, non-zero on update). The orchestrator branches on this to decide
-- continue-pipeline vs send update_confirm DM.
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
    set annotation = excluded.annotation,
        tags = excluded.tags,
        updated_at = now()
  returning saved_items.id, (xmax = 0) as was_inserted;
$$;

-- increment_retry_count: post-increment counter for Step 7's in-code retry
-- loop. Returns the new value so the caller can compare against MAX_RETRIES
-- without a second read.
create or replace function public.increment_retry_count(p_id uuid)
returns int
language sql
security definer
set search_path = public
as $$
  update public.saved_items
     set retry_count = retry_count + 1,
         updated_at = now()
   where id = p_id
   returning retry_count;
$$;
