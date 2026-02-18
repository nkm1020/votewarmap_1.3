create extension if not exists pgcrypto;

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('nais', 'local_xls')),
  school_code text not null,
  school_name text not null,
  school_level text not null check (school_level in ('middle', 'high', 'university', 'graduate')),
  campus_type text,
  parent_school_id uuid references public.schools(id) on delete set null,
  sido_name text,
  sido_code text,
  sigungu_name text,
  sigungu_code text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists schools_source_school_code_key on public.schools(source, school_code);
create index if not exists schools_school_name_idx on public.schools(school_name);
create index if not exists schools_school_level_idx on public.schools(school_level);
create index if not exists schools_parent_school_id_idx on public.schools(parent_school_id);
create index if not exists schools_sido_code_idx on public.schools(sido_code);
create index if not exists schools_sigungu_code_idx on public.schools(sigungu_code);

alter table public.schools enable row level security;

drop policy if exists "schools_select_all" on public.schools;
create policy "schools_select_all"
on public.schools
for select
using (true);

create table if not exists public.vote_topics (
  id text primary key,
  title text not null,
  status text not null default 'LIVE',
  created_at timestamptz not null default now()
);

create table if not exists public.vote_options (
  topic_id text not null references public.vote_topics(id) on delete cascade,
  option_key text not null,
  option_label text not null,
  position smallint not null check (position in (1, 2)),
  created_at timestamptz not null default now(),
  primary key (topic_id, option_key),
  unique (topic_id, position)
);

alter table public.vote_topics enable row level security;
alter table public.vote_options enable row level security;

drop policy if exists "vote_topics_select_all" on public.vote_topics;
create policy "vote_topics_select_all"
on public.vote_topics
for select
using (true);

drop policy if exists "vote_options_select_all" on public.vote_options;
create policy "vote_options_select_all"
on public.vote_options
for select
using (true);

insert into public.vote_topics (id, title, status)
values ('popular-vote', '서울 vs 부산 교통 개편안', 'LIVE')
on conflict (id) do update set
  title = excluded.title,
  status = excluded.status;

insert into public.vote_options (topic_id, option_key, option_label, position)
values
  ('popular-vote', 'seoul', '서울', 1),
  ('popular-vote', 'busan', '부산', 2)
on conflict (topic_id, option_key) do update set
  option_label = excluded.option_label,
  position = excluded.position;

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  topic_id text not null references public.vote_topics(id) on delete cascade,
  option_key text not null,
  user_id uuid references auth.users(id) on delete set null,
  guest_token text,
  school_id uuid not null references public.schools(id) on delete restrict,
  aggregate_school_id uuid not null references public.schools(id) on delete restrict,
  birth_year smallint not null check (birth_year between 1900 and 2100),
  gender text not null check (gender in ('male', 'female', 'other', 'prefer_not_to_say')),
  sido_code text,
  sigungu_code text,
  merged_from_guest boolean not null default false,
  created_at timestamptz not null default now(),
  constraint votes_topic_option_fk
    foreign key (topic_id, option_key)
    references public.vote_options(topic_id, option_key),
  constraint votes_identity_check
    check (
      (user_id is not null and guest_token is null) or
      (user_id is null and guest_token is not null)
    )
);

create unique index if not exists votes_topic_user_uidx
  on public.votes(topic_id, user_id)
  where user_id is not null;

create unique index if not exists votes_topic_guest_uidx
  on public.votes(topic_id, guest_token)
  where guest_token is not null;

create index if not exists votes_topic_created_idx on public.votes(topic_id, created_at desc);
create index if not exists votes_sido_code_idx on public.votes(sido_code);
create index if not exists votes_sigungu_code_idx on public.votes(sigungu_code);
create index if not exists votes_aggregate_school_idx on public.votes(aggregate_school_id);

alter table public.votes enable row level security;

drop policy if exists "votes_select_own" on public.votes;
create policy "votes_select_own"
on public.votes
for select
using (auth.uid() = user_id);

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
  with scoped as (
    select
      case
        when p_level = 'sigungu' then nullif(v.sigungu_code, '')
        else nullif(v.sido_code, '')
      end as region,
      o.position
    from public.votes v
    join public.vote_options o
      on o.topic_id = v.topic_id
     and o.option_key = v.option_key
    where v.topic_id = p_topic_id
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
  from agg;
$$;

grant execute on function public.get_region_vote_stats(text, text) to anon, authenticated;
