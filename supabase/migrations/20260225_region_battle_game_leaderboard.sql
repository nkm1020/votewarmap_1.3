create table if not exists public.region_battle_game_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  score integer not null check (score >= 0 and score <= 9999),
  played_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint region_battle_game_scores_user_run_uidx unique (user_id, run_id)
);

create index if not exists region_battle_game_scores_played_at_idx
  on public.region_battle_game_scores(played_at desc);

create index if not exists region_battle_game_scores_user_score_idx
  on public.region_battle_game_scores(user_id, score desc, played_at asc);

alter table public.region_battle_game_scores enable row level security;

create or replace function public.get_region_battle_leaderboard(
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
        when lower(coalesce(p_period, 'all')) in ('daily', 'weekly', 'all') then lower(coalesce(p_period, 'all'))
        else 'all'
      end as period,
      greatest(1, least(coalesce(p_limit, 10), 50)) as limit_size,
      timezone('Asia/Seoul', now()) as now_kst
  ),
  window_info as (
    select
      period,
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
      s.score,
      s.played_at
    from public.region_battle_game_scores s
    cross join window_info w
    where
      w.start_kst is null
      or timezone('Asia/Seoul', s.played_at) >= w.start_kst
  ),
  best_scores as (
    select
      user_id,
      max(score)::integer as score
    from scoped
    group by user_id
  ),
  best_with_time as (
    select
      b.user_id,
      b.score,
      min(s.played_at) as achieved_at
    from best_scores b
    join scoped s
      on s.user_id = b.user_id
     and s.score = b.score
    group by b.user_id, b.score
  ),
  ranked as (
    select
      rank() over (order by score desc, achieved_at asc, user_id asc) as rank,
      user_id,
      score,
      achieved_at
    from best_with_time
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

grant execute on function public.get_region_battle_leaderboard(text, int) to anon, authenticated;
