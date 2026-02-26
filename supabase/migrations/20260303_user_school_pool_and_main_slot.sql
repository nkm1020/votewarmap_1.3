alter table public.users
  add column if not exists main_school_slot text,
  add column if not exists school_edit_count integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_main_school_slot_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_main_school_slot_check
      check (main_school_slot is null or main_school_slot in ('middle', 'high', 'university', 'graduate'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_school_edit_count_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_school_edit_count_check
      check (school_edit_count >= 0);
  end if;
end;
$$;

create table if not exists public.user_school_pool (
  user_id uuid not null references public.users(id) on delete cascade,
  slot_type text not null check (slot_type in ('middle', 'high', 'university', 'graduate')),
  school_id uuid not null references public.schools(id) on delete restrict,
  aggregate_school_id uuid not null references public.schools(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, slot_type),
  unique (user_id, school_id)
);

create index if not exists user_school_pool_user_idx
  on public.user_school_pool(user_id);

create index if not exists user_school_pool_school_idx
  on public.user_school_pool(school_id);

create or replace function public.set_user_school_pool_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_user_school_pool_updated_at on public.user_school_pool;
create trigger trg_set_user_school_pool_updated_at
before update on public.user_school_pool
for each row
execute function public.set_user_school_pool_updated_at();

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

with school_backfill as (
  select
    u.id as user_id,
    case
      when s.school_level = 'middle' then 'middle'
      when s.school_level = 'high' then 'high'
      when s.school_level = 'university' then 'university'
      when s.school_level = 'graduate' then 'graduate'
      else null
    end as slot_type,
    s.id as school_id,
    coalesce(s.parent_school_id, s.id) as aggregate_school_id
  from public.users u
  join public.schools s
    on s.id = u.school_id
)
insert into public.user_school_pool (
  user_id,
  slot_type,
  school_id,
  aggregate_school_id
)
select
  b.user_id,
  b.slot_type,
  b.school_id,
  b.aggregate_school_id
from school_backfill b
where b.slot_type is not null
on conflict do nothing;

update public.users
set main_school_slot = b.slot_type
from (
  select
    u.id as user_id,
    case
      when s.school_level = 'middle' then 'middle'
      when s.school_level = 'high' then 'high'
      when s.school_level = 'university' then 'university'
      when s.school_level = 'graduate' then 'graduate'
      else null
    end as slot_type
  from public.users u
  join public.schools s
    on s.id = u.school_id
) b
where public.users.id = b.user_id
  and public.users.main_school_slot is null
  and b.slot_type is not null;

update public.users
set school_edit_count = 0
where school_edit_count is null;

grant execute on function public.upsert_user_school_pool_slot(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.upsert_user_school_pool_slot(uuid, text, uuid, boolean) to service_role;
grant execute on function public.set_user_main_school_slot(uuid, text) to authenticated;
grant execute on function public.set_user_main_school_slot(uuid, text) to service_role;
