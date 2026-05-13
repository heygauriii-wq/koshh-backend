-- M4a Step 10 — dm_staging: per-URL buffer between webhook receive and pg-boss
-- enqueue, scoped to the annotation-merge window. Save events insert; text
-- events update annotation; sweeper job enqueues rows whose ready_at has passed.
--
-- Pre-launch this is also the de facto "saves" surface: rows persist after
-- enqueue (enqueued_at non-null) and downstream modules (M3 / M5 / M6 / M9)
-- can read from here as the saves source-of-truth. Schema may evolve.

create table public.dm_staging (
  id                 uuid primary key default gen_random_uuid(),

  -- identity
  user_id            uuid not null references public.users(id) on delete cascade,
  sender_handle      text not null,
  platform           text not null check (platform in ('instagram', 'tiktok')),

  -- content
  raw_url            text not null,
  annotation         text not null default '',
  tags               text[] not null default array[]::text[],

  -- attachment metadata (M4a Step 11)
  attachment_type    text,
  ig_post_media_id   text,
  title              text,

  -- trace
  save_mid           text not null,
  url_index          int  not null default 0,

  -- merge-window + enqueue lifecycle
  ready_at           timestamptz not null,
  enqueued_at        timestamptz,

  created_at         timestamptz not null default now()
);

comment on table public.dm_staging is
  'Module 4a Step 10 — per-URL save buffer for the annotation-merge window. Rows persist after enqueued_at is set; downstream modules treat this as the saves source-of-truth pre-launch.';
comment on column public.dm_staging.ready_at is
  'now() + merge window at insert. Sweeper picks up rows where ready_at <= now() AND enqueued_at IS NULL.';
comment on column public.dm_staging.enqueued_at is
  'NULL until pg-boss enqueue succeeds. Non-NULL = already handed off to ingest-pipeline.';

-- Sweeper's hot path: find rows ready to enqueue, ordered by ready_at.
create index dm_staging_pending_idx
  on public.dm_staging (ready_at)
  where enqueued_at is null;

-- Merge lookup: text event → find recent unfilled staging row from same sender.
-- annotation='' is the "unfilled" predicate; first-arriving text wins the merge.
create index dm_staging_merge_idx
  on public.dm_staging (sender_handle, platform, created_at desc)
  where enqueued_at is null and annotation = '';

-- RLS deny-all to authenticated/anon. All writes happen via service_role
-- (webhook handler + sweeper). No FE surface yet — when M5/M9 needs reads,
-- add a select-own policy here.
alter table public.dm_staging enable row level security;
