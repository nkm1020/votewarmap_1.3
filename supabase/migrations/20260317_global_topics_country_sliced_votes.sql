alter table public.vote_topics
  alter column country_code drop not null;

alter table public.vote_topics
  alter column country_code drop default;

update public.vote_topics
set country_code = upper(trim(country_code))
where country_code is not null;

update public.vote_topics
set country_code = null
where nullif(trim(coalesce(country_code, '')), '') is null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'vote_topics_country_code_check'
      and conrelid = 'public.vote_topics'::regclass
  ) then
    alter table public.vote_topics
      drop constraint vote_topics_country_code_check;
  end if;
end
$$;

alter table public.vote_topics
  add constraint vote_topics_country_code_check
  check (country_code is null or country_code in ('KR', 'US', 'JP', 'CN', 'UK', 'IE', 'DE', 'FR', 'IT'));

alter table public.votes
  add column if not exists country_code text;

alter table public.guest_votes_temp
  add column if not exists country_code text;

update public.votes v
set country_code = upper(trim(t.country_code))
from public.vote_topics t
where t.id = v.topic_id
  and (
    v.country_code is null
    or nullif(trim(coalesce(v.country_code, '')), '') is null
  );

update public.guest_votes_temp g
set country_code = upper(trim(t.country_code))
from public.vote_topics t
where t.id = g.topic_id
  and (
    g.country_code is null
    or nullif(trim(coalesce(g.country_code, '')), '') is null
  );

update public.votes
set country_code = 'KR'
where country_code is null
   or country_code = ''
   or country_code not in ('KR', 'US', 'JP', 'CN', 'UK', 'IE', 'DE', 'FR', 'IT');

update public.guest_votes_temp
set country_code = 'KR'
where country_code is null
   or country_code = ''
   or country_code not in ('KR', 'US', 'JP', 'CN', 'UK', 'IE', 'DE', 'FR', 'IT');

alter table public.votes
  alter column country_code set not null;

alter table public.guest_votes_temp
  alter column country_code set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'votes_country_code_check'
      and conrelid = 'public.votes'::regclass
  ) then
    alter table public.votes
      drop constraint votes_country_code_check;
  end if;
end
$$;

alter table public.votes
  add constraint votes_country_code_check
  check (country_code in ('KR', 'US', 'JP', 'CN', 'UK', 'IE', 'DE', 'FR', 'IT'));

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'guest_votes_temp_country_code_check'
      and conrelid = 'public.guest_votes_temp'::regclass
  ) then
    alter table public.guest_votes_temp
      drop constraint guest_votes_temp_country_code_check;
  end if;
end
$$;

alter table public.guest_votes_temp
  add constraint guest_votes_temp_country_code_check
  check (country_code in ('KR', 'US', 'JP', 'CN', 'UK', 'IE', 'DE', 'FR', 'IT'));

create index if not exists votes_country_topic_created_idx
  on public.votes(country_code, topic_id, created_at desc);

create index if not exists votes_country_sido_created_idx
  on public.votes(country_code, sido_code, created_at desc);

create index if not exists votes_country_sigungu_created_idx
  on public.votes(country_code, sigungu_code, created_at desc);

create index if not exists guest_votes_temp_country_topic_voted_idx
  on public.guest_votes_temp(country_code, topic_id, voted_at desc);

create index if not exists guest_votes_temp_country_sido_voted_idx
  on public.guest_votes_temp(country_code, sido_code, voted_at desc);

create index if not exists guest_votes_temp_country_sigungu_voted_idx
  on public.guest_votes_temp(country_code, sigungu_code, voted_at desc);

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
  with scoped_topics as (
    select
      t.id,
      t.created_at
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
    where upper(v.country_code) = upper(coalesce(nullif(trim(p_country_code), ''), 'KR'))
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
    where s.last_seen_at >= now() - interval '90 seconds'
      and upper(g.country_code) = upper(coalesce(nullif(trim(p_country_code), ''), 'KR'))
  ),
  guest_votes as (
    select
      g.topic_id,
      count(*)::bigint as realtime_votes,
      max(g.voted_at) as last_vote_at
    from active_guest g
    group by g.topic_id
  )
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
    st.created_at as topic_created_at
  from scoped_topics st
  left join persistent_votes pv
    on pv.topic_id = st.id
  left join guest_votes gv
    on gv.topic_id = st.id
  order by
    score desc,
    total_votes desc,
    realtime_votes desc,
    last_vote_at desc nulls last,
    topic_created_at desc,
    topic_id asc;
$$;

create or replace function public.get_live_vote_demographics(
  p_status text default 'LIVE',
  p_country_code text default 'KR'
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
      and upper(v.country_code) = upper(coalesce(nullif(trim(p_country_code), ''), 'KR'))
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
          when gender = 'prefer_not_to_say' then 1
          else 0
        end
      ),
      0
    )::bigint as unknown_gender_count,
    coalesce(sum(case when age between 10 and 19 then 1 else 0 end), 0)::bigint as teens_count,
    coalesce(sum(case when age between 20 and 29 then 1 else 0 end), 0)::bigint as twenties_count,
    coalesce(sum(case when age between 30 and 39 then 1 else 0 end), 0)::bigint as thirties_count,
    coalesce(sum(case when age between 40 and 49 then 1 else 0 end), 0)::bigint as forties_count,
    coalesce(sum(case when age >= 50 then 1 else 0 end), 0)::bigint as fifties_plus_count,
    coalesce(sum(case when age is null or age < 10 then 1 else 0 end), 0)::bigint as unknown_age_count,
    extract(year from now())::int as reference_year
  from enriched;
$$;

drop function if exists public.get_region_vote_stats(text, text);

create or replace function public.get_region_vote_stats(
  p_topic_id text,
  p_level text default 'sido',
  p_country_code text default 'KR'
)
returns table (
  region text,
  total bigint,
  count_a bigint,
  count_b bigint,
  winner text
)
language sql
security definer
set search_path = public
as $$
  with active_guest as (
    select
      g.topic_id,
      g.option_key,
      g.sido_code,
      g.sigungu_code
    from public.guest_votes_temp g
    join public.guest_vote_sessions s
      on s.id = g.session_id
    where s.last_seen_at >= now() - interval '90 seconds'
      and g.topic_id = p_topic_id
      and upper(g.country_code) = upper(coalesce(nullif(trim(p_country_code), ''), 'KR'))
  ),
  scoped as (
    select
      case
        when lower(coalesce(p_level, 'sido')) = 'sigungu' then nullif(v.sigungu_code, '')
        else nullif(v.sido_code, '')
      end as region,
      o.position
    from public.votes v
    join public.vote_options o
      on o.topic_id = v.topic_id
     and o.option_key = v.option_key
    where v.topic_id = p_topic_id
      and upper(v.country_code) = upper(coalesce(nullif(trim(p_country_code), ''), 'KR'))

    union all

    select
      case
        when lower(coalesce(p_level, 'sido')) = 'sigungu' then nullif(g.sigungu_code, '')
        else nullif(g.sido_code, '')
      end as region,
      o.position
    from active_guest g
    join public.vote_options o
      on o.topic_id = g.topic_id
     and o.option_key = g.option_key
  ),
  agg as (
    select
      region,
      count(*)::bigint as total,
      sum(case when position = 1 then 1 else 0 end)::bigint as count_a,
      sum(case when position = 2 then 1 else 0 end)::bigint as count_b
    from scoped
    where region is not null
    group by region
  )
  select
    region,
    total,
    count_a,
    count_b,
    case
      when count_a > count_b then 'A'
      when count_b > count_a then 'B'
      else 'TIE'
    end as winner
  from agg
  order by region;
$$;

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
    where
      upper(v.country_code) = upper(coalesce(nullif(trim(p_country_code), ''), 'KR'))
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

create or replace function public.promote_guest_session_votes_to_user(
  p_session_id uuid,
  p_user_id uuid,
  p_birth_year smallint,
  p_gender text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_moved int := 0;
  v_skipped int := 0;
  v_birth_year smallint;
  v_gender text;
  v_profile_updated boolean := false;
begin
  if p_session_id is null then
    raise exception 'session id is required';
  end if;

  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  select u.birth_year, u.gender
  into v_birth_year, v_gender
  from public.users u
  where u.id = p_user_id
  for update;

  if not found then
    raise exception 'user not found';
  end if;

  if p_birth_year is not null and (p_birth_year < 1900 or p_birth_year > 2100) then
    raise exception 'birth year is out of range';
  end if;

  if p_gender is not null and p_gender not in ('male', 'female', 'other', 'prefer_not_to_say') then
    raise exception 'gender is invalid';
  end if;

  if v_birth_year is null and p_birth_year is not null then
    v_birth_year := p_birth_year;
    v_profile_updated := true;
  end if;

  if v_gender is null and p_gender is not null then
    v_gender := p_gender;
    v_profile_updated := true;
  end if;

  if v_profile_updated then
    update public.users
    set
      birth_year = v_birth_year,
      gender = v_gender
    where id = p_user_id;
  end if;

  for r in
    select
      g.id,
      g.topic_id,
      g.option_key,
      g.school_id,
      g.aggregate_school_id,
      g.country_code,
      g.sido_code,
      g.sigungu_code,
      g.voted_at
    from public.guest_votes_temp g
    where g.session_id = p_session_id
    order by g.voted_at asc
  loop
    if exists (
      select 1
      from public.votes v
      where v.topic_id = r.topic_id
        and v.user_id = p_user_id
    ) then
      delete from public.guest_votes_temp where id = r.id;
      v_skipped := v_skipped + 1;
    else
      insert into public.votes (
        topic_id,
        option_key,
        user_id,
        guest_token,
        school_id,
        aggregate_school_id,
        country_code,
        birth_year,
        gender,
        sido_code,
        sigungu_code,
        merged_from_guest,
        created_at
      )
      values (
        r.topic_id,
        r.option_key,
        p_user_id,
        null,
        r.school_id,
        r.aggregate_school_id,
        r.country_code,
        v_birth_year,
        v_gender,
        r.sido_code,
        r.sigungu_code,
        true,
        r.voted_at
      );

      delete from public.guest_votes_temp where id = r.id;
      v_moved := v_moved + 1;
    end if;
  end loop;

  delete from public.guest_vote_sessions where id = p_session_id;

  return jsonb_build_object(
    'moved', v_moved,
    'skipped', v_skipped,
    'profileUpdated', v_profile_updated
  );
end;
$$;

grant execute on function public.get_region_vote_stats(text, text, text) to anon, authenticated;
