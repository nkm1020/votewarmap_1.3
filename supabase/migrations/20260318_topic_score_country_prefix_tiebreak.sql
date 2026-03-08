do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'votes'
      and column_name = 'country_code'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'guest_votes_temp'
      and column_name = 'country_code'
  ) then
    raise exception
      '20260317_global_topics_country_sliced_votes.sql must be applied before 20260318_topic_score_country_prefix_tiebreak.sql';
  end if;
end
$$;

create or replace function public.get_topic_live_scoreboard(
  p_status text default 'LIVE',
  p_country_code text default 'KR'
)
returns table (
  topic_id text,
  total_votes bigint,
  realtime_votes bigint,
  score bigint,
  last_vote_at timestamptz,
  topic_created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with normalized_country as (
    select upper(coalesce(nullif(trim(p_country_code), ''), 'KR')) as requested_country
  ),
  scoped_topics as (
    select
      t.id,
      t.created_at,
      upper(split_part(t.id, '-', 1)) as topic_prefix
    from public.vote_topics t
    where
      case
        when upper(coalesce(p_status, 'LIVE')) = 'ALL' then true
        else upper(coalesce(t.status, '')) = upper(coalesce(p_status, 'LIVE'))
      end
  ),
  persistent_votes as (
    select
      v.topic_id,
      count(*)::bigint as total_votes,
      max(v.created_at) as last_vote_at
    from public.votes v
    join scoped_topics st
      on st.id = v.topic_id
    join normalized_country nc
      on true
    where upper(v.country_code) = nc.requested_country
    group by v.topic_id
  ),
  active_guest as (
    select
      g.topic_id,
      g.voted_at
    from public.guest_votes_temp g
    join public.guest_vote_sessions s
      on s.id = g.session_id
    join scoped_topics st
      on st.id = g.topic_id
    join normalized_country nc
      on true
    where s.last_seen_at >= now() - interval '90 seconds'
      and upper(g.country_code) = nc.requested_country
  ),
  guest_votes as (
    select
      g.topic_id,
      count(*)::bigint as realtime_votes,
      max(g.voted_at) as last_vote_at
    from active_guest g
    group by g.topic_id
  ),
  scored_topics as (
    select
      st.id as topic_id,
      coalesce(pv.total_votes, 0)::bigint as total_votes,
      coalesce(gv.realtime_votes, 0)::bigint as realtime_votes,
      (coalesce(pv.total_votes, 0) + coalesce(gv.realtime_votes, 0) * 2)::bigint as score,
      case
        when pv.last_vote_at is null then gv.last_vote_at
        when gv.last_vote_at is null then pv.last_vote_at
        else greatest(pv.last_vote_at, gv.last_vote_at)
      end as last_vote_at,
      st.created_at as topic_created_at,
      case
        when st.topic_prefix in ('KR', 'US', 'JP', 'CN', 'UK', 'IE', 'DE', 'FR', 'IT')
          and st.topic_prefix = nc.requested_country then 1
        else 0
      end as country_prefix_match
    from scoped_topics st
    join normalized_country nc
      on true
    left join persistent_votes pv
      on pv.topic_id = st.id
    left join guest_votes gv
      on gv.topic_id = st.id
  )
  select
    topic_id,
    total_votes,
    realtime_votes,
    score,
    last_vote_at,
    topic_created_at
  from scored_topics
  order by
    score desc,
    country_prefix_match desc,
    total_votes desc,
    realtime_votes desc,
    last_vote_at desc nulls last,
    topic_created_at desc,
    topic_id asc;
$$;
