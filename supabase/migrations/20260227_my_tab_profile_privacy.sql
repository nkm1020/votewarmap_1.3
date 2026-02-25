alter table public.users
  add column if not exists username text,
  add column if not exists privacy_show_leaderboard_name boolean not null default true,
  add column if not exists privacy_show_region boolean not null default false,
  add column if not exists privacy_show_activity_history boolean not null default false;

-- 기존 데이터와의 호환을 위해 username 규칙 체크를 재정의한다.
alter table public.users
  drop constraint if exists users_username_format_check;

alter table public.users
  add constraint users_username_format_check
  check (username is null or username ~ '^[a-z0-9_]{3,20}$');

-- 과거 데이터 중 규칙에 맞지 않는 username은 null 처리 후 backfill 한다.
update public.users
set username = null
where username is not null
  and username !~ '^[a-z0-9_]{3,20}$';

with base as (
  select
    u.id,
    lower(substr(replace(u.id::text, '-', ''), 1, 8)) as id8,
    row_number() over (
      partition by lower(substr(replace(u.id::text, '-', ''), 1, 8))
      order by u.created_at asc, u.id asc
    ) as rn
  from public.users u
  where u.username is null or btrim(u.username) = ''
)
update public.users u
set username =
  case
    when b.rn = 1 then 'user_' || b.id8
    else 'user_' || b.id8 || '_' || b.rn::text
  end
from base b
where u.id = b.id;

create unique index if not exists users_username_lower_uidx
  on public.users (lower(username))
  where username is not null;

create or replace function public.handle_auth_user_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  generated_username text;
begin
  generated_username := 'user_' || lower(substr(replace(new.id::text, '-', ''), 1, 8));

  insert into public.users (id, email, full_name, avatar_url, provider, username)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    new.raw_app_meta_data->>'provider',
    generated_username
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    provider = excluded.provider,
    username = coalesce(public.users.username, excluded.username),
    updated_at = now();

  return new;
end;
$$;

create or replace function public.get_game_user_rank(
  p_user_id uuid,
  p_mode_id text default 'all',
  p_period text default 'all'
)
returns table (
  rank bigint,
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
      timezone('Asia/Seoul', now()) as now_kst
  ),
  window_info as (
    select
      mode_id,
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
    r.score,
    r.achieved_at
  from ranked r
  where r.user_id = p_user_id
  limit 1;
$$;

grant execute on function public.get_game_user_rank(uuid, text, text) to authenticated;

create or replace function public.get_region_battle_user_rank(
  p_user_id uuid,
  p_period text default 'all'
)
returns table (
  rank bigint,
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
      timezone('Asia/Seoul', now()) as now_kst
  ),
  window_info as (
    select
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
    where w.start_kst is null
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
    r.score,
    r.achieved_at
  from ranked r
  where r.user_id = p_user_id
  limit 1;
$$;

grant execute on function public.get_region_battle_user_rank(uuid, text) to authenticated;

create or replace function public.get_my_vote_comparison_metrics(
  p_user_id uuid
)
returns table (
  my_region_match_rate numeric,
  nationwide_match_rate numeric,
  dominance_gap_delta numeric,
  region_national_flow numeric
)
language sql
security definer
set search_path = public
as $$
  with user_votes as (
    select
      v.topic_id,
      case
        when o.position = 1 then 'A'
        when o.position = 2 then 'B'
        else null
      end as my_side,
      case
        when nullif(v.sigungu_code, '') is not null then 'sigungu'
        else 'sido'
      end as region_level,
      coalesce(nullif(v.sigungu_code, ''), nullif(v.sido_code, '')) as region_code
    from public.votes v
    join public.vote_options o
      on o.topic_id = v.topic_id
     and o.option_key = v.option_key
    where v.user_id = p_user_id
      and o.position in (1, 2)
  ),
  topic_totals as (
    select
      v.topic_id,
      sum(case when o.position = 1 then 1 else 0 end)::numeric as count_a,
      sum(case when o.position = 2 then 1 else 0 end)::numeric as count_b
    from public.votes v
    join public.vote_options o
      on o.topic_id = v.topic_id
     and o.option_key = v.option_key
    where o.position in (1, 2)
    group by v.topic_id
  ),
  topic_summary as (
    select
      t.topic_id,
      case
        when t.count_a > t.count_b then 'A'
        when t.count_b > t.count_a then 'B'
        else 'TIE'
      end as national_winner,
      case
        when (t.count_a + t.count_b) > 0
          then abs((t.count_a - t.count_b) / (t.count_a + t.count_b)) * 100
        else 0
      end as national_margin
    from topic_totals t
  ),
  sido_totals as (
    select
      v.topic_id,
      nullif(v.sido_code, '') as region_code,
      sum(case when o.position = 1 then 1 else 0 end)::numeric as count_a,
      sum(case when o.position = 2 then 1 else 0 end)::numeric as count_b
    from public.votes v
    join public.vote_options o
      on o.topic_id = v.topic_id
     and o.option_key = v.option_key
    where o.position in (1, 2)
    group by v.topic_id, nullif(v.sido_code, '')
  ),
  sigungu_totals as (
    select
      v.topic_id,
      nullif(v.sigungu_code, '') as region_code,
      sum(case when o.position = 1 then 1 else 0 end)::numeric as count_a,
      sum(case when o.position = 2 then 1 else 0 end)::numeric as count_b
    from public.votes v
    join public.vote_options o
      on o.topic_id = v.topic_id
     and o.option_key = v.option_key
    where o.position in (1, 2)
    group by v.topic_id, nullif(v.sigungu_code, '')
  ),
  region_summary as (
    select
      s.topic_id,
      'sido'::text as region_level,
      s.region_code,
      case
        when s.count_a > s.count_b then 'A'
        when s.count_b > s.count_a then 'B'
        else 'TIE'
      end as region_winner,
      case
        when (s.count_a + s.count_b) > 0
          then abs((s.count_a - s.count_b) / (s.count_a + s.count_b)) * 100
        else 0
      end as region_margin
    from sido_totals s
    where s.region_code is not null

    union all

    select
      s.topic_id,
      'sigungu'::text as region_level,
      s.region_code,
      case
        when s.count_a > s.count_b then 'A'
        when s.count_b > s.count_a then 'B'
        else 'TIE'
      end as region_winner,
      case
        when (s.count_a + s.count_b) > 0
          then abs((s.count_a - s.count_b) / (s.count_a + s.count_b)) * 100
        else 0
      end as region_margin
    from sigungu_totals s
    where s.region_code is not null
  ),
  joined as (
    select
      uv.topic_id,
      uv.my_side,
      uv.region_level,
      uv.region_code,
      ts.national_winner,
      ts.national_margin,
      rs.region_winner,
      rs.region_margin
    from user_votes uv
    left join topic_summary ts
      on ts.topic_id = uv.topic_id
    left join region_summary rs
      on rs.topic_id = uv.topic_id
     and rs.region_level = uv.region_level
     and rs.region_code = uv.region_code
  )
  select
    coalesce(
      round(
        avg(
          case
            when j.region_winner in ('A', 'B')
              then case when j.my_side = j.region_winner then 100 else 0 end
            else null
          end
        )::numeric,
        2
      ),
      0
    ) as my_region_match_rate,
    coalesce(
      round(
        avg(
          case
            when j.national_winner in ('A', 'B')
              then case when j.my_side = j.national_winner then 100 else 0 end
            else null
          end
        )::numeric,
        2
      ),
      0
    ) as nationwide_match_rate,
    coalesce(
      round(
        avg(
          case
            when j.region_margin is not null and j.national_margin is not null
              then abs(j.region_margin - j.national_margin)
            else null
          end
        )::numeric,
        2
      ),
      0
    ) as dominance_gap_delta,
    coalesce(
      round(
        avg(
          case
            when j.region_winner in ('A', 'B') and j.national_winner in ('A', 'B')
              then case when j.region_winner = j.national_winner then 100 else 0 end
            else null
          end
        )::numeric,
        2
      ),
      0
    ) as region_national_flow
  from joined j;
$$;

grant execute on function public.get_my_vote_comparison_metrics(uuid) to authenticated;
