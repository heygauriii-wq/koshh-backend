-- M11-owned (Webhook Trust). M4a is the first reader/writer, so it ships here.
-- See [[11-webhook-trust]] and [[04a-meta-dm-ingest-dfd]].

create table public.processed_webhooks (
  key          text primary key,
  processed_at timestamptz not null default now()
);

comment on table public.processed_webhooks is
  'Module 11 — idempotency store for inbound platform webhooks. Two-keyspace: meta:{mid} and tiktok:{tt_mid}. 24h TTL enforced by a periodic prune job (deferred until table grows).';
comment on column public.processed_webhooks.key is
  'Platform-prefixed message ID. e.g. meta:m_abc123. Prefix prevents cross-platform collision.';

-- Index on processed_at supports the future TTL prune job. Cheap; <100/day at MVP scale.
create index processed_webhooks_processed_at on public.processed_webhooks (processed_at);

-- RLS: deny-all to authenticated and anon. All writes are service-role
-- (M4a/M4b webhook handler) and all reads are service-role (the same handler
-- doing the idempotency check). No FE surface. Enabling RLS without policies
-- is a deliberate "no client access" stance, not an oversight.
alter table public.processed_webhooks enable row level security;
