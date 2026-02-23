create extension if not exists pgcrypto;

alter table public.schools
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists geocode_provider text,
  add column if not exists geocoded_at timestamptz,
  add column if not exists geocode_status text,
  add column if not exists geocode_attempted_at timestamptz;

create table if not exists public.guest_vote_sessions (
  id uuid primary key,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists guest_vote_sessions_last_seen_idx on public.guest_vote_sessions(last_seen_at);

alter table public.guest_vote_sessions enable row level security;

create table if not exists public.guest_votes_temp (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.guest_vote_sessions(id) on delete cascade,
  topic_id text not null references public.vote_topics(id) on delete cascade,
  option_key text not null,
  school_id uuid not null references public.schools(id) on delete restrict,
  aggregate_school_id uuid not null references public.schools(id) on delete restrict,
  sido_code text,
  sigungu_code text,
  voted_at timestamptz not null default now(),
  constraint guest_votes_temp_topic_option_fk
    foreign key (topic_id, option_key)
    references public.vote_options(topic_id, option_key),
  constraint guest_votes_temp_session_topic_uidx unique (session_id, topic_id)
);

create index if not exists guest_votes_temp_topic_idx on public.guest_votes_temp(topic_id, voted_at desc);
create index if not exists guest_votes_temp_region_idx on public.guest_votes_temp(topic_id, sido_code, sigungu_code);
create index if not exists guest_votes_temp_aggregate_school_idx on public.guest_votes_temp(topic_id, aggregate_school_id);

alter table public.guest_votes_temp enable row level security;

-- 정책 전환: 기존 영구 guest 투표는 모두 제거.
delete from public.votes where guest_token is not null;

create or replace function public.get_region_vote_stats(
  p_topic_id text,
  p_level text default 'sido'
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

grant execute on function public.get_region_vote_stats(text, text) to anon, authenticated;

create or replace function public.get_top_schools_by_region(
  p_level text default 'sido',
  p_topic_id text default null
)
returns table(
  region_code text,
  school_id uuid,
  school_name text,
  vote_count bigint,
  last_vote_at timestamptz,
  latitude double precision,
  longitude double precision,
  sido_code text,
  sigungu_code text
)
language sql
security definer
set search_path = public
as $$
  with active_guest as (
    select
      g.topic_id,
      g.aggregate_school_id,
      g.sido_code,
      g.sigungu_code,
      g.voted_at as created_at
    from public.guest_votes_temp g
    join public.guest_vote_sessions s
      on s.id = g.session_id
    where s.last_seen_at >= now() - interval '90 seconds'
      and (p_topic_id is null or g.topic_id = p_topic_id)
  ),
  combined_votes as (
    select
      v.topic_id,
      v.aggregate_school_id,
      v.sido_code,
      v.sigungu_code,
      v.created_at
    from public.votes v
    where p_topic_id is null or v.topic_id = p_topic_id

    union all

    select
      g.topic_id,
      g.aggregate_school_id,
      g.sido_code,
      g.sigungu_code,
      g.created_at
    from active_guest g
  ),
  scoped as (
    select
      case
        when lower(coalesce(p_level, 'sido')) = 'sigungu'
          then nullif(coalesce(v.sigungu_code, s.sigungu_code), '')
        else nullif(coalesce(v.sido_code, s.sido_code), '')
      end as region_code,
      s.id as school_id,
      s.school_name,
      count(*)::bigint as vote_count,
      max(v.created_at) as last_vote_at,
      s.latitude,
      s.longitude,
      s.sido_code,
      s.sigungu_code
    from combined_votes v
    join public.schools s
      on s.id = v.aggregate_school_id
    group by
      1,
      s.id,
      s.school_name,
      s.latitude,
      s.longitude,
      s.sido_code,
      s.sigungu_code
  ),
  ranked as (
    select
      *,
      row_number() over (
        partition by region_code
        order by vote_count desc, last_vote_at desc, school_id asc
      ) as rn
    from scoped
    where region_code is not null
  )
  select
    region_code,
    school_id,
    school_name,
    vote_count,
    last_vote_at,
    latitude,
    longitude,
    sido_code,
    sigungu_code
  from ranked
  where rn = 1;
$$;

grant execute on function public.get_top_schools_by_region(text, text) to anon, authenticated;

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

  if v_birth_year is null or v_gender is null then
    if p_birth_year is null or p_gender is null then
      raise exception 'profile is required for merge';
    end if;

    if p_birth_year < 1900 or p_birth_year > 2100 then
      raise exception 'birth year is out of range';
    end if;

    if p_gender not in ('male', 'female', 'other', 'prefer_not_to_say') then
      raise exception 'gender is invalid';
    end if;

    update public.users
    set
      birth_year = coalesce(birth_year, p_birth_year),
      gender = coalesce(gender, p_gender)
    where id = p_user_id;

    v_birth_year := coalesce(v_birth_year, p_birth_year);
    v_gender := coalesce(v_gender, p_gender);
    v_profile_updated := true;
  end if;

  for r in
    select
      g.id,
      g.topic_id,
      g.option_key,
      g.school_id,
      g.aggregate_school_id,
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

grant execute on function public.promote_guest_session_votes_to_user(uuid, uuid, smallint, text) to authenticated;
