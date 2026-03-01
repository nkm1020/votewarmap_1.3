alter table public.vote_options
  add column if not exists persona_tag text;

update public.vote_options
set persona_tag = lower(trim(persona_tag))
where persona_tag is not null;

update public.vote_options
set persona_tag = null
where persona_tag is not null
  and persona_tag not in ('egen', 'teto');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vote_options_persona_tag_check'
      and conrelid = 'public.vote_options'::regclass
  ) then
    alter table public.vote_options
      add constraint vote_options_persona_tag_check
      check (persona_tag is null or persona_tag in ('egen', 'teto'));
  end if;
end
$$;
