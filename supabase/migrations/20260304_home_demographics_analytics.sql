create or replace function public.get_live_vote_demographics(
  p_status text default 'LIVE'
)
returns table (
  total_member_votes bigint,
  male_count bigint,
  female_count bigint,
  other_count bigint,
  unknown_gender_count bigint,
  teens_count bigint,
  twenties_count bigint,
  thirties_count bigint,
  forties_count bigint,
  fifties_plus_count bigint,
  unknown_age_count bigint,
  reference_year integer
)
language sql
security definer
set search_path = public
as $$
  with scoped_votes as (
    select
      v.birth_year,
      nullif(trim(v.gender), '') as gender
    from public.votes v
    join public.vote_topics t
      on t.id = v.topic_id
    where
      v.user_id is not null
      and (
        case
          when upper(coalesce(p_status, 'LIVE')) = 'ALL' then true
          else upper(coalesce(t.status, '')) = upper(coalesce(p_status, 'LIVE'))
        end
      )
  ),
  enriched as (
    select
      sv.birth_year,
      sv.gender,
      extract(year from now())::int as current_year,
      case
        when sv.birth_year is null then null
        else extract(year from now())::int - sv.birth_year::int
      end as age
    from scoped_votes sv
  )
  select
    count(*)::bigint as total_member_votes,
    coalesce(sum(case when gender = 'male' then 1 else 0 end), 0)::bigint as male_count,
    coalesce(sum(case when gender = 'female' then 1 else 0 end), 0)::bigint as female_count,
    coalesce(sum(case when gender = 'other' then 1 else 0 end), 0)::bigint as other_count,
    coalesce(
      sum(
        case
          when gender is null or gender not in ('male', 'female', 'other', 'prefer_not_to_say') then 1
          else 0
        end
      ),
      0
    )::bigint as unknown_gender_count,
    coalesce(sum(case when age between 10 and 19 then 1 else 0 end), 0)::bigint as teens_count,
    coalesce(sum(case when age between 20 and 29 then 1 else 0 end), 0)::bigint as twenties_count,
    coalesce(sum(case when age between 30 and 39 then 1 else 0 end), 0)::bigint as thirties_count,
    coalesce(sum(case when age between 40 and 49 then 1 else 0 end), 0)::bigint as forties_count,
    coalesce(sum(case when age >= 50 and age <= 120 then 1 else 0 end), 0)::bigint as fifties_plus_count,
    coalesce(
      sum(
        case
          when age is null or age < 10 or age > 120 then 1
          else 0
        end
      ),
      0
    )::bigint as unknown_age_count,
    coalesce(max(current_year), extract(year from now())::int)::int as reference_year
  from enriched;
$$;

grant execute on function public.get_live_vote_demographics(text) to anon, authenticated;
