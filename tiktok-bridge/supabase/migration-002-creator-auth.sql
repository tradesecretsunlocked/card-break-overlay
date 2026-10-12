-- TSU TikTok bridge, migration 002: creator authorization leg. ADDITIVE ONLY.
-- Needed for live_rooms/* (viewer stats) which require a CREATOR token (user_type 1).
-- Safe to re-run. Nothing is dropped or rewritten.

alter table public.tiktok_oauth_state add column if not exists kind text not null default 'seller';

create table if not exists public.tiktok_creator_auth (
  bridge_key          text primary key references public.bridge_keys(key) on delete cascade,
  open_id             text,
  access_token        text not null,
  refresh_token       text not null,
  access_expires_at   timestamptz not null,
  refresh_expires_at  timestamptz,
  granted_scopes      jsonb,
  user_type           integer,
  status              text not null default 'active',
  last_error          text,
  last_refresh_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.tiktok_creator_auth is
  'Creator-side OAuth token (user_type 1), one per bridge key. A creator token and a seller token are different credentials and are never interchangeable. Tokens are secrets: service role only, no client policy.';

alter table public.tiktok_creator_auth enable row level security;
