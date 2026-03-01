alter table public.vote_topics
  add column if not exists country_code text;

update public.vote_topics
set country_code = upper(trim(country_code))
where country_code is not null;

update public.vote_topics
set country_code = 'KR'
where country_code is null
   or country_code = ''
   or country_code not in ('KR', 'US', 'JP', 'CN', 'UK', 'DE', 'FR', 'IT');

alter table public.vote_topics
  alter column country_code set default 'KR';

alter table public.vote_topics
  alter column country_code set not null;

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
  check (country_code in ('KR', 'US', 'JP', 'CN', 'UK', 'DE', 'FR', 'IT'));

create index if not exists vote_topics_country_status_created_idx
  on public.vote_topics(country_code, status, created_at desc);

insert into public.vote_topics (id, title, status, country_code)
values
  ('us-core-remote-vs-office', '원격 근무 vs 오피스 출근', 'LIVE', 'US'),
  ('jp-core-cash-vs-cashless', '현금 결제 vs 완전 캐시리스', 'LIVE', 'JP'),
  ('cn-core-superapp-vs-specialized', '슈퍼앱 하나로 해결 vs 앱별 전문 서비스', 'LIVE', 'CN'),
  ('uk-core-tea-vs-coffee', '매일 한 잔: 홍차 vs 커피', 'LIVE', 'UK'),
  ('de-core-train-vs-car', '출퇴근: 대중교통 vs 자가용', 'LIVE', 'DE'),
  ('fr-core-baguette-vs-croissant', '아침 선택: 바게트 vs 크루아상', 'LIVE', 'FR'),
  ('it-core-pasta-vs-pizza', '평생 하나만: 파스타 vs 피자', 'LIVE', 'IT')
on conflict (id) do update set
  title = excluded.title,
  status = excluded.status,
  country_code = excluded.country_code;

insert into public.vote_options (topic_id, option_key, option_label, position)
values
  ('us-core-remote-vs-office', 'remote', '원격 근무', 1),
  ('us-core-remote-vs-office', 'office', '오피스 출근', 2),
  ('jp-core-cash-vs-cashless', 'cash', '현금 결제 유지', 1),
  ('jp-core-cash-vs-cashless', 'cashless', '완전 캐시리스', 2),
  ('cn-core-superapp-vs-specialized', 'super_app', '슈퍼앱 하나로 해결', 1),
  ('cn-core-superapp-vs-specialized', 'specialized_apps', '앱별 전문 서비스', 2),
  ('uk-core-tea-vs-coffee', 'tea', '홍차', 1),
  ('uk-core-tea-vs-coffee', 'coffee', '커피', 2),
  ('de-core-train-vs-car', 'train', '대중교통', 1),
  ('de-core-train-vs-car', 'car', '자가용', 2),
  ('fr-core-baguette-vs-croissant', 'baguette', '바게트', 1),
  ('fr-core-baguette-vs-croissant', 'croissant', '크루아상', 2),
  ('it-core-pasta-vs-pizza', 'pasta', '파스타', 1),
  ('it-core-pasta-vs-pizza', 'pizza', '피자', 2)
on conflict (topic_id, option_key) do update set
  option_label = excluded.option_label,
  position = excluded.position;

drop function if exists public.get_topic_live_scoreboard(text);

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
      upper(coalesce(t.country_code, 'KR')) = upper(coalesce(nullif(p_country_code, ''), 'KR'))
      and (
        case
          when upper(coalesce(p_status, 'LIVE')) = 'ALL' then true
          else upper(coalesce(t.status, '')) = upper(coalesce(p_status, 'LIVE'))
        end
      )
  ),
  persistent_votes as (
    select
      v.topic_id,
      count(*)::bigint as total_votes,
      max(v.created_at) as last_vote_at
    from public.votes v
    join scoped_topics st on st.id = v.topic_id
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

grant execute on function public.get_topic_live_scoreboard(text, text) to anon, authenticated;

drop function if exists public.get_live_vote_demographics(text);

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
      and upper(coalesce(t.country_code, 'KR')) = upper(coalesce(nullif(p_country_code, ''), 'KR'))
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

grant execute on function public.get_live_vote_demographics(text, text) to anon, authenticated;
