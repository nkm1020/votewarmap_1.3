create table if not exists public.game_mode_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode_id text not null,
  run_id uuid not null,
  raw_score integer not null check (raw_score >= 0 and raw_score <= 9999),
  normalized_score integer not null check (normalized_score >= 0 and normalized_score <= 100),
  played_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  constraint game_mode_scores_user_mode_run_uidx unique (user_id, mode_id, run_id)
);

create index if not exists game_mode_scores_mode_played_idx
  on public.game_mode_scores(mode_id, played_at desc);

create index if not exists game_mode_scores_user_mode_score_idx
  on public.game_mode_scores(user_id, mode_id, normalized_score desc, played_at asc);

create index if not exists game_mode_scores_played_idx
  on public.game_mode_scores(played_at desc);

alter table public.game_mode_scores enable row level security;

create or replace function public.get_game_leaderboard(
  p_mode_id text default 'all',
  p_period text default 'all',
  p_limit int default 10
)
returns table (
  rank bigint,
  user_id uuid,
  score integer,
  achieved_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with params as (
    select
      case
        when lower(coalesce(p_mode_id, 'all')) = 'all' then 'all'
        else lower(coalesce(p_mode_id, 'all'))
      end as mode_id,
      case
        when lower(coalesce(p_period, 'all')) in ('daily', 'weekly', 'all') then lower(coalesce(p_period, 'all'))
        else 'all'
      end as period,
      greatest(1, least(coalesce(p_limit, 10), 50)) as limit_size,
      timezone('Asia/Seoul', now()) as now_kst
  ),
  window_info as (
    select
      mode_id,
      limit_size,
      case
        when period = 'daily' then date_trunc('day', now_kst)
        when period = 'weekly' then date_trunc('week', now_kst)
        else null
      end as start_kst
    from params
  ),
  scoped as (
    select
      s.user_id,
      s.mode_id,
      s.raw_score,
      s.normalized_score,
      s.played_at
    from public.game_mode_scores s
    cross join window_info w
    where
      w.start_kst is null
      or timezone('Asia/Seoul', s.played_at) >= w.start_kst
  ),
  mode_best as (
    select
      s.user_id,
      max(s.raw_score)::integer as score
    from scoped s
    cross join window_info w
    where w.mode_id <> 'all'
      and s.mode_id = w.mode_id
    group by s.user_id
  ),
  mode_best_with_time as (
    select
      m.user_id,
      m.score,
      min(s.played_at) as achieved_at
    from mode_best m
    join scoped s
      on s.user_id = m.user_id
     and s.raw_score = m.score
    cross join window_info w
    where s.mode_id = w.mode_id
    group by m.user_id, m.score
  ),
  user_mode_best_norm as (
    select
      s.user_id,
      s.mode_id,
      max(s.normalized_score)::integer as best_norm
    from scoped s
    group by s.user_id, s.mode_id
  ),
  user_mode_best_norm_time as (
    select
      b.user_id,
      b.mode_id,
      b.best_norm,
      min(s.played_at) as achieved_at
    from user_mode_best_norm b
    join scoped s
      on s.user_id = b.user_id
     and s.mode_id = b.mode_id
     and s.normalized_score = b.best_norm
    group by b.user_id, b.mode_id, b.best_norm
  ),
  global_best as (
    select
      user_id,
      sum(best_norm)::integer as score,
      min(achieved_at) as achieved_at
    from user_mode_best_norm_time
    group by user_id
  ),
  source_scores as (
    select
      m.user_id,
      m.score,
      m.achieved_at
    from mode_best_with_time m
    cross join window_info w
    where w.mode_id <> 'all'

    union all

    select
      g.user_id,
      g.score,
      g.achieved_at
    from global_best g
    cross join window_info w
    where w.mode_id = 'all'
  ),
  ranked as (
    select
      rank() over (order by score desc, achieved_at asc, user_id asc) as rank,
      user_id,
      score,
      achieved_at
    from source_scores
  )
  select
    r.rank,
    r.user_id,
    r.score,
    r.achieved_at
  from ranked r
  cross join window_info w
  order by r.rank asc, r.user_id asc
  limit (select limit_size from window_info limit 1);
$$;

grant execute on function public.get_game_leaderboard(text, text, int) to anon, authenticated;
