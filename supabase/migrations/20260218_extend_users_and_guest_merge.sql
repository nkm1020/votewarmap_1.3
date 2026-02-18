alter table public.users
  add column if not exists birth_year smallint check (birth_year between 1900 and 2100),
  add column if not exists gender text check (gender in ('male', 'female', 'other', 'prefer_not_to_say')),
  add column if not exists school_id uuid references public.schools(id) on delete set null,
  add column if not exists sido_code text,
  add column if not exists sigungu_code text;

create index if not exists users_school_id_idx on public.users(school_id);
create index if not exists users_sido_code_idx on public.users(sido_code);
create index if not exists users_sigungu_code_idx on public.users(sigungu_code);

create or replace function public.merge_guest_votes_to_user(
  p_guest_token text,
  p_user_id uuid
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
begin
  if p_guest_token is null or btrim(p_guest_token) = '' then
    raise exception 'guest token is required';
  end if;

  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  for r in
    select id, topic_id
    from public.votes
    where guest_token = p_guest_token
      and user_id is null
  loop
    if exists (
      select 1
      from public.votes uv
      where uv.topic_id = r.topic_id
        and uv.user_id = p_user_id
    ) then
      delete from public.votes where id = r.id;
      v_skipped := v_skipped + 1;
    else
      update public.votes
      set
        user_id = p_user_id,
        guest_token = null,
        merged_from_guest = true
      where id = r.id;

      v_moved := v_moved + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'moved', v_moved,
    'skipped', v_skipped
  );
end;
$$;

grant execute on function public.merge_guest_votes_to_user(text, uuid) to authenticated;
