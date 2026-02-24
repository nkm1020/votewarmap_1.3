alter table public.users
  add column if not exists nickname text,
  add column if not exists avatar_preset text,
  add column if not exists signup_completed_at timestamptz;

create index if not exists users_signup_completed_at_idx on public.users(signup_completed_at);

-- 기존 사용자 보호: 마이그레이션 시점의 계정은 가입 완료로 간주한다.
update public.users
set signup_completed_at = coalesce(signup_completed_at, now())
where signup_completed_at is null;

alter table public.votes
  alter column birth_year drop not null,
  alter column gender drop not null,
  alter column school_id drop not null,
  alter column aggregate_school_id drop not null;

alter table public.guest_votes_temp
  alter column school_id drop not null,
  alter column aggregate_school_id drop not null;

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
