update public.vote_topics
set country_code = upper(trim(country_code))
where country_code is not null;

-- Revert IE->UK merge for IE-scoped topics.
update public.vote_topics
set country_code = 'IE'
where country_code = 'UK'
  and (
    id = 'ie-core-gaa-vs-rugby'
    or id ilike 'ie-%'
  );

update public.vote_topics
set country_code = 'KR'
where country_code is null
   or country_code = ''
   or country_code not in ('KR', 'US', 'JP', 'CN', 'UK', 'IE', 'DE', 'FR', 'IT');

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
  check (country_code in ('KR', 'US', 'JP', 'CN', 'UK', 'IE', 'DE', 'FR', 'IT'));

insert into public.vote_topics (id, title, status, country_code)
values
  ('ie-core-gaa-vs-rugby', '국민 스포츠: GAA vs 럭비', 'LIVE', 'IE')
on conflict (id) do update set
  title = excluded.title,
  status = excluded.status,
  country_code = excluded.country_code;

insert into public.vote_options (topic_id, option_key, option_label, position)
values
  ('ie-core-gaa-vs-rugby', 'gaa', 'GAA', 1),
  ('ie-core-gaa-vs-rugby', 'rugby', '럭비', 2)
on conflict (topic_id, option_key) do update set
  option_label = excluded.option_label,
  position = excluded.position;
