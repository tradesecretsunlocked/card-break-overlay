-- TSU TikTok bridge, additive schema.
-- Project: tsu-bridge (znyryhgjghjsobkzyfbx), us-east-2.
--
-- ADDITIVE ONLY. No existing table is altered destructively, no view is touched.
-- The one change to an existing table is a nullable column with a default, which is
-- what makes v_sales, v_sales_daily and v_break_pnl cross-platform for free.
--
-- Run once. Every statement is idempotent.

begin;

-- ---------------------------------------------------------------------------
-- 1. Platform tag on the shared event stream.
--    Defaulting to 'whatnot' means all 360k existing rows stay correct and every
--    view that reads bridge_events keeps working untouched.
-- ---------------------------------------------------------------------------
alter table public.bridge_events
  add column if not exists platform text not null default 'whatnot';

alter table public.bridge_events_archive
  add column if not exists platform text not null default 'whatnot';

comment on column public.bridge_events.platform is
  'Source platform for the event: whatnot | loupe | tiktok. Defaults to whatnot so historical rows and every existing view remain correct. Added 2026-08-16 for the TikTok integration.';

create index if not exists bridge_events_platform_idx
  on public.bridge_events (platform, occurred_at desc);

-- Makes the alreadyEmitted() replay guard a single index hit rather than a scan
-- over 360k rows on every webhook.
create index if not exists bridge_events_sale_id_idx
  on public.bridge_events ((payload->>'saleId'))
  where payload ? 'saleId';

-- ---------------------------------------------------------------------------
-- 2. Per client platform entitlement.
--    Same entitled + enabled pair as client_services, deliberately: enabled true
--    with entitled false is the failure mode that 403s every feature with no other
--    symptom, and keeping the shape identical means the debugging instinct transfers.
-- ---------------------------------------------------------------------------
create table if not exists public.client_platforms (
  bridge_key      text not null references public.bridge_keys(key) on delete cascade,
  platform        text not null check (platform in ('whatnot', 'loupe', 'tiktok')),
  entitled        boolean not null default false,
  enabled         boolean not null default true,
  provisioned_at  timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Optional overrides. Normally left null: the bridge reads overlay_id and sport from
  -- the overlay's own `overlay_warmup` event, which cannot drift from what the board
  -- is showing. Set these only when a client is provisioned before their overlay has
  -- ever connected.
  overlay_id      text,
  default_sport   text,
  notes           text,
  primary key (bridge_key, platform)
);

comment on table public.client_platforms is
  'Which platforms a client is provisioned for. Roughly 80 percent of clients run exactly one. Both entitled (they have access) and enabled (it is on) must be true before the bridge will serve them.';

alter table public.client_platforms enable row level security;

drop policy if exists client_platforms_admin_all on public.client_platforms;
create policy client_platforms_admin_all on public.client_platforms
  for all to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. TikTok Shop authorization.
--    Tokens are secrets. No policy grants any client role access; the bridge reads
--    this table with the service role only.
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_shop_auth (
  shop_id             text primary key,
  bridge_key          text not null references public.bridge_keys(key) on delete cascade,
  shop_cipher         text not null,
  shop_name           text,
  shop_region         text,
  seller_type         text,
  access_token        text not null,
  refresh_token       text not null,
  access_expires_at   timestamptz not null,
  refresh_expires_at  timestamptz,
  open_id             text,
  seller_name         text,
  seller_base_region  text,
  user_type           integer,
  granted_scopes      text[],
  status              text not null default 'active' check (status in ('active','expiring','revoked')),
  last_refresh_at     timestamptz,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.tiktok_shop_auth is
  'TikTok Shop OAuth state per client. access_token lives 7 days; refresh_expires_at is an ABSOLUTE timestamp from TikTok and must never be derived from a duration. Service role only.';
comment on column public.tiktok_shop_auth.shop_cipher is
  'Required on nearly every business API call. A missing cipher returns error 106013.';

create index if not exists tiktok_shop_auth_bridge_key_idx on public.tiktok_shop_auth (bridge_key);
create index if not exists tiktok_shop_auth_expiry_idx on public.tiktok_shop_auth (status, access_expires_at);

alter table public.tiktok_shop_auth enable row level security;
-- Intentionally no policies. Service role bypasses RLS; nothing else may read tokens.

-- ---------------------------------------------------------------------------
-- 4. OAuth state, single use, 30 minute life.
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_oauth_state (
  state       text primary key,
  bridge_key  text not null references public.bridge_keys(key) on delete cascade,
  created_at  timestamptz not null default now(),
  consumed_at timestamptz
);

comment on table public.tiktok_oauth_state is
  'Single use CSRF state for the seller authorization handshake. Binds an auth_code callback to the bridge_key that started it.';

create index if not exists tiktok_oauth_state_created_idx on public.tiktok_oauth_state (created_at);
alter table public.tiktok_oauth_state enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Webhook dedupe log.
--    TikTok guarantees AT LEAST ONCE delivery with NO ordering guarantee, so the
--    primary key here is the whole dedupe mechanism.
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_webhook_log (
  tts_notification_id text primary key,
  event_type          text,
  shop_id             text,
  received_at         timestamptz not null default now()
);

comment on table public.tiktok_webhook_log is
  'Dedupe ledger for TikTok webhooks. Delivery is at-least-once with no ordering guarantee, so tts_notification_id being the primary key is what makes replays harmless.';

create index if not exists tiktok_webhook_log_received_idx on public.tiktok_webhook_log (received_at desc);
alter table public.tiktok_webhook_log enable row level security;

-- ---------------------------------------------------------------------------
-- 6. Live sessions.
--    line_items[].room_id is READ ONLY and NOT FILTERABLE on the order API, so
--    session grouping has to happen on our side.
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_live_sessions (
  bridge_key   text not null references public.bridge_keys(key) on delete cascade,
  room_id      text not null,
  live_id      text,
  break_id     text,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  metrics      jsonb,
  primary key (bridge_key, room_id)
);

comment on table public.tiktok_live_sessions is
  'Maps a TikTok LIVE room to a TSU break. Needed because room_id on order line items is read-only and cannot be used as an order search filter.';

create index if not exists tiktok_live_sessions_open_idx
  on public.tiktok_live_sessions (bridge_key) where ended_at is null;

alter table public.tiktok_live_sessions enable row level security;

drop policy if exists tiktok_live_sessions_admin_all on public.tiktok_live_sessions;
create policy tiktok_live_sessions_admin_all on public.tiktok_live_sessions
  for all to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. Reconciliation cursor.
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_sync_cursor (
  shop_id          text primary key,
  last_update_time timestamptz,
  updated_at       timestamptz not null default now()
);

comment on table public.tiktok_sync_cursor is
  'High-water mark for the order reconciliation poller. The poller deliberately rewinds 16 hours from this point, because the TikTok webhook retry ladder runs 15.5 hours before a message is dropped.';

alter table public.tiktok_sync_cursor enable row level security;

-- ---------------------------------------------------------------------------
-- 8. Backfill: every existing client is a Whatnot client.
--    entitled=true, enabled=true preserves today's behaviour exactly.
--    Nobody is given TikTok here. That is a deliberate, explicit, per client action.
-- ---------------------------------------------------------------------------
insert into public.client_platforms (bridge_key, platform, entitled, enabled, notes)
select k.key, 'whatnot', true, true, 'backfilled 2026-08-16 from existing active bridge keys'
from public.bridge_keys k
where k.active = true and k.archived_at is null
on conflict (bridge_key, platform) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK, if it comes to that. The column drops are the only lossy part.
-- ---------------------------------------------------------------------------
-- begin;
--   drop table if exists public.tiktok_sync_cursor;
--   drop table if exists public.tiktok_live_sessions;
--   drop table if exists public.tiktok_webhook_log;
--   drop table if exists public.tiktok_oauth_state;
--   drop table if exists public.tiktok_shop_auth;
--   drop table if exists public.client_platforms;
--   alter table public.bridge_events         drop column if exists platform;
--   alter table public.bridge_events_archive drop column if exists platform;
-- commit;
