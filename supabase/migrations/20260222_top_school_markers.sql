alter table public.schools
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists geocode_provider text,
  add column if not exists geocoded_at timestamptz,
  add column if not exists geocode_status text,
  add column if not exists geocode_attempted_at timestamptz;

alter table public.schools
  alter column geocode_status set default 'pending';

update public.schools
set geocode_status = 'pending'
where geocode_status is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'schools_geocode_status_check'
      and conrelid = 'public.schools'::regclass
  ) then
    alter table public.schools
      add constraint schools_geocode_status_check
      check (geocode_status in ('pending', 'ok', 'failed'));
  end if;
end;
$$;

alter table public.schools
  alter column geocode_status set not null;

create index if not exists schools_lat_lng_idx
  on public.schools(latitude, longitude)
  where latitude is not null and longitude is not null;

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
  where rn = 1
  order by region_code;
$$;

grant execute on function public.get_top_schools_by_region(text, text) to anon, authenticated;
