alter table public.users
  add column if not exists country_code text;

update public.users
set country_code = upper(trim(country_code))
where country_code is not null;

update public.users
set country_code = 'KR'
where country_code is null
   or country_code = ''
   or country_code !~ '^[A-Z]{2}$';

alter table public.users
  alter column country_code set default 'KR';

alter table public.users
  alter column country_code set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_country_code_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_country_code_check
      check (country_code ~ '^[A-Z]{2}$');
  end if;
end;
$$;

create index if not exists users_country_code_idx on public.users(country_code);
