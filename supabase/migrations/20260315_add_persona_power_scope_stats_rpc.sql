drop function if exists public.get_persona_power_scope_stats(text, text, text);

create or replace function public.get_persona_power_scope_stats(
  p_country_code text default 'KR',
  p_sido_code text default null,
  p_sigungu_code text default null
)
returns table (
  egen_count bigint,
  teto_count bigint,
  mapped_votes bigint
)
language sql
security definer
set search_path = public
as $$
  with scoped_votes as (
    select o.persona_tag
    from public.votes v
    join public.vote_options o
      on o.topic_id = v.topic_id
     and o.option_key = v.option_key
    join public.vote_topics t
      on t.id = v.topic_id
    where
      upper(coalesce(t.country_code, 'KR')) = upper(coalesce(nullif(trim(p_country_code), ''), 'KR'))
      and o.persona_tag in ('egen', 'teto')
      and (
        case
          when nullif(trim(coalesce(p_sigungu_code, '')), '') is not null then v.sigungu_code = p_sigungu_code
          when nullif(trim(coalesce(p_sido_code, '')), '') is not null then v.sido_code = p_sido_code
          else true
        end
      )
  )
  select
    coalesce(sum(case when persona_tag = 'egen' then 1 else 0 end), 0)::bigint as egen_count,
    coalesce(sum(case when persona_tag = 'teto' then 1 else 0 end), 0)::bigint as teto_count,
    count(*)::bigint as mapped_votes
  from scoped_votes;
$$;

grant execute on function public.get_persona_power_scope_stats(text, text, text) to anon, authenticated;
