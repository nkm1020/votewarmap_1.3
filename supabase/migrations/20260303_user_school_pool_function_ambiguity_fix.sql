create or replace function public.upsert_user_school_pool_slot(
  p_user_id uuid,
  p_slot_type text,
  p_school_id uuid,
  p_set_as_main boolean default false
)
returns table (
  user_id uuid,
  slot_type text,
  school_id uuid,
  aggregate_school_id uuid,
  school_edit_count integer,
  main_school_slot text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_school record;
  v_existing record;
  v_aggregate_school_id uuid;
begin
  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  if p_school_id is null then
    raise exception 'school id is required';
  end if;

  if p_slot_type not in ('middle', 'high', 'university', 'graduate') then
    raise exception 'slot type is invalid';
  end if;

  select *
  into v_user
  from public.users
  where id = p_user_id
  for update;

  if not found then
    raise exception 'user not found';
  end if;

  select
    s.id,
    s.parent_school_id,
    s.sido_code,
    s.sigungu_code
  into v_school
  from public.schools s
  where s.id = p_school_id;

  if not found then
    raise exception 'school not found';
  end if;

  if exists (
    select 1
    from public.user_school_pool usp
    where usp.user_id = p_user_id
      and usp.school_id = p_school_id
      and usp.slot_type <> p_slot_type
  ) then
    raise exception '동일 학교는 다른 슬롯에 중복 등록할 수 없습니다.';
  end if;

  v_aggregate_school_id := coalesce(v_school.parent_school_id, v_school.id);

  select usp.*
  into v_existing
  from public.user_school_pool usp
  where usp.user_id = p_user_id
    and usp.slot_type = p_slot_type
  for update;

  if found then
    if v_existing.school_id <> p_school_id then
      if coalesce(v_user.school_edit_count, 0) >= 2 then
        raise exception '학교 변경 가능 횟수 2회를 모두 소진했습니다.';
      end if;

      update public.user_school_pool as usp
      set
        school_id = p_school_id,
        aggregate_school_id = v_aggregate_school_id
      where usp.user_id = p_user_id
        and usp.slot_type = p_slot_type;

      update public.users as u
      set school_edit_count = coalesce(u.school_edit_count, 0) + 1
      where u.id = p_user_id
      returning * into v_user;

      if v_user.main_school_slot = p_slot_type then
        update public.users as u
        set
          school_id = v_school.id,
          sido_code = v_school.sido_code,
          sigungu_code = v_school.sigungu_code
        where u.id = p_user_id
        returning * into v_user;
      end if;
    end if;
  else
    insert into public.user_school_pool (
      user_id,
      slot_type,
      school_id,
      aggregate_school_id
    )
    values (
      p_user_id,
      p_slot_type,
      p_school_id,
      v_aggregate_school_id
    );
  end if;

  if p_set_as_main then
    update public.users as u
    set
      school_id = v_school.id,
      main_school_slot = p_slot_type,
      sido_code = v_school.sido_code,
      sigungu_code = v_school.sigungu_code
    where u.id = p_user_id
    returning * into v_user;
  end if;

  return query
  select
    p_user_id,
    p_slot_type,
    p_school_id,
    v_aggregate_school_id,
    coalesce(v_user.school_edit_count, 0),
    v_user.main_school_slot;
end;
$$;

create or replace function public.set_user_main_school_slot(
  p_user_id uuid,
  p_slot_type text
)
returns table (
  user_id uuid,
  main_school_slot text,
  school_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
begin
  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  if p_slot_type not in ('middle', 'high', 'university', 'graduate') then
    raise exception 'slot type is invalid';
  end if;

  select
    usp.school_id,
    s.sido_code,
    s.sigungu_code
  into v_target
  from public.user_school_pool usp
  join public.schools s
    on s.id = usp.school_id
  where usp.user_id = p_user_id
    and usp.slot_type = p_slot_type
  limit 1;

  if not found then
    raise exception '선택한 슬롯에 등록된 학교가 없습니다.';
  end if;

  update public.users as u
  set
    school_id = v_target.school_id,
    main_school_slot = p_slot_type,
    sido_code = v_target.sido_code,
    sigungu_code = v_target.sigungu_code
  where u.id = p_user_id;

  return query
  select
    p_user_id,
    p_slot_type,
    v_target.school_id;
end;
$$;

grant execute on function public.upsert_user_school_pool_slot(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.upsert_user_school_pool_slot(uuid, text, uuid, boolean) to service_role;
grant execute on function public.set_user_main_school_slot(uuid, text) to authenticated;
grant execute on function public.set_user_main_school_slot(uuid, text) to service_role;
