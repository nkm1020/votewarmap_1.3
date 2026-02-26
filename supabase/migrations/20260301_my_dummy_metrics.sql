create or replace function public.get_my_vote_comparison_metrics_with_dummy(
  p_user_id uuid,
  p_include_dummy boolean default false
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
    where (v.user_id = p_user_id or (p_include_dummy and v.user_id is null and coalesce(v.guest_token, '') ilike 'dummy_%'))
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

grant execute on function public.get_my_vote_comparison_metrics_with_dummy(uuid, boolean) to authenticated;
