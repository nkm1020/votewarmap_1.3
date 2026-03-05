create extension if not exists pgcrypto;

alter table public.guest_vote_sessions
  add column if not exists fingerprint_hash text;

create index if not exists guest_vote_sessions_fingerprint_idx
  on public.guest_vote_sessions(fingerprint_hash, last_seen_at desc);

alter table public.guest_votes_temp
  add column if not exists fingerprint_hash text;

create index if not exists guest_votes_temp_fingerprint_idx
  on public.guest_votes_temp(fingerprint_hash, voted_at desc);

create unique index if not exists guest_votes_temp_topic_fingerprint_uidx
  on public.guest_votes_temp(topic_id, fingerprint_hash)
  where fingerprint_hash is not null;

create table if not exists public.api_rate_limit_counters (
  scope text not null,
  key_hash text not null,
  window_seconds integer not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash, window_seconds, window_started_at)
);

create index if not exists api_rate_limit_counters_updated_idx
  on public.api_rate_limit_counters(updated_at desc);

alter table public.api_rate_limit_counters enable row level security;

create or replace function public.check_request_rate_limit(
  p_scope text,
  p_key text,
  p_window_seconds integer,
  p_max_requests integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  current_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window_started timestamptz;
  v_window_end timestamptz;
  v_key_hash text;
  v_count integer;
begin
  if p_scope is null or btrim(p_scope) = '' then
    raise exception 'scope_required';
  end if;

  if p_key is null or btrim(p_key) = '' then
    raise exception 'key_required';
  end if;

  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'invalid_window_seconds';
  end if;

  if p_max_requests is null or p_max_requests < 1 then
    raise exception 'invalid_max_requests';
  end if;

  v_window_started := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  v_window_end := v_window_started + make_interval(secs => p_window_seconds);
  v_key_hash := encode(digest(p_key, 'sha256'), 'hex');

  insert into public.api_rate_limit_counters (
    scope,
    key_hash,
    window_seconds,
    window_started_at,
    request_count,
    created_at,
    updated_at
  )
  values (
    p_scope,
    v_key_hash,
    p_window_seconds,
    v_window_started,
    1,
    v_now,
    v_now
  )
  on conflict (scope, key_hash, window_seconds, window_started_at)
  do update
    set request_count = public.api_rate_limit_counters.request_count + 1,
        updated_at = v_now
  returning request_count into v_count;

  allowed := v_count <= p_max_requests;
  current_count := v_count;
  retry_after_seconds := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (v_window_end - v_now)))::integer)
  end;

  return next;
end;
$$;

revoke all on function public.check_request_rate_limit(text, text, integer, integer) from public;
revoke all on function public.check_request_rate_limit(text, text, integer, integer) from anon;
revoke all on function public.check_request_rate_limit(text, text, integer, integer) from authenticated;
grant execute on function public.check_request_rate_limit(text, text, integer, integer) to postgres;
grant execute on function public.check_request_rate_limit(text, text, integer, integer) to service_role;

create table if not exists public.game_run_sessions (
  run_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode_id text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists game_run_sessions_user_mode_started_idx
  on public.game_run_sessions(user_id, mode_id, started_at desc);

create index if not exists game_run_sessions_expires_idx
  on public.game_run_sessions(expires_at);

alter table public.game_run_sessions enable row level security;
