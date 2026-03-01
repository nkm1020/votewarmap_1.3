-- Requested mapping:
-- 1) 깻잎 관련 주제: "절대 안..." 선택지 => teto, 나머지 => egen
-- 2) "월 300 받는 백수 vs 월 1000 받는 직장인" 주제: "300받는 백수" 선택지 => teto, 나머지 => egen

-- Step 1: targeted topics' options default to egen
with target_topics as (
  select t.id
  from public.vote_topics t
  where
    (
      t.title like '%깻잎%'
      and exists (
        select 1
        from public.vote_options o
        where o.topic_id = t.id
          and o.option_label ~* '절대[[:space:]]*안'
      )
    )
    or (
      t.title like '%월%300%'
      and t.title like '%월%1000%'
      and t.title like '%백수%'
      and t.title like '%직장인%'
      and exists (
        select 1
        from public.vote_options o
        where o.topic_id = t.id
          and o.option_label ~* '300'
          and o.option_label like '%백수%'
      )
    )
)
update public.vote_options o
set persona_tag = 'egen'
from target_topics tt
where o.topic_id = tt.id;

-- Step 2: requested options override to teto
with target_topics as (
  select t.id
  from public.vote_topics t
  where
    (
      t.title like '%깻잎%'
      and exists (
        select 1
        from public.vote_options o
        where o.topic_id = t.id
          and o.option_label ~* '절대[[:space:]]*안'
      )
    )
    or (
      t.title like '%월%300%'
      and t.title like '%월%1000%'
      and t.title like '%백수%'
      and t.title like '%직장인%'
      and exists (
        select 1
        from public.vote_options o
        where o.topic_id = t.id
          and o.option_label ~* '300'
          and o.option_label like '%백수%'
      )
    )
)
update public.vote_options o
set persona_tag = 'teto'
from target_topics tt
where o.topic_id = tt.id
  and (
    o.option_label ~* '절대[[:space:]]*안'
    or (
      o.option_label ~* '300'
      and o.option_label like '%백수%'
    )
  );
