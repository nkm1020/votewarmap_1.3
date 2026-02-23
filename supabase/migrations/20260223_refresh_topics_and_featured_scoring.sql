delete from public.vote_topics
where id = 'popular-vote';

insert into public.vote_topics (id, title, status)
values
  ('food-lifelong-noodle-vs-rice', '평생 한 가지만 먹어야 한다면?', 'LIVE'),
  ('food-soft-vs-hard-peach', '찍먹 vs 부먹을 넘어서는 난제', 'LIVE'),
  ('food-no-cola-chicken-vs-no-kimchi-ramen', '여름의 고통', 'LIVE'),
  ('food-mintchoco-vs-no-chocolate', '민초의 난', 'LIVE'),
  ('rel-lover-passenger-vs-friend-passenger', '질투의 화신', 'LIVE'),
  ('rel-lover-peel-shrimp-vs-friend-peel-shrimp', '깻잎 논쟁의 뒤를 이을 ''새우'' 논쟁', 'LIVE'),
  ('rel-ghosting-vs-rebound-breakup', '이별의 순간', 'LIVE'),
  ('rel-slow-long-vs-fast-short-reply', '연락 스타일', 'LIVE'),
  ('work-competent-toxic-boss-vs-kind-incompetent-boss', '직장 상사 고르기', 'LIVE'),
  ('work-long-commute-bigco-vs-nearby-sme', '출퇴근의 지옥', 'LIVE'),
  ('work-highpay-6day-vs-lowpay-4day', '월급 vs 휴일', 'LIVE'),
  ('work-invisible-vs-levitation-10cm', '투명인간 vs 공중부양', 'LIVE'),
  ('imagination-past-lotto-vs-future-spouse', '과거 vs 미래', 'LIVE'),
  ('imagination-all-languages-vs-best-looks', '지식 vs 외모', 'LIVE'),
  ('imagination-army-winter-vs-summer', '군대 다시 가기', 'LIVE')
on conflict (id) do update set
  title = excluded.title,
  status = excluded.status;

insert into public.vote_options (topic_id, option_key, option_label, position)
values
  ('food-lifelong-noodle-vs-rice', 'noodles_only', '평생 면 요리만 먹기', 1),
  ('food-lifelong-noodle-vs-rice', 'rice_only', '평생 밥 요리만 먹기', 2),
  ('food-soft-vs-hard-peach', 'soft_peach', '물렁한 복숭아(물복)', 1),
  ('food-soft-vs-hard-peach', 'hard_peach', '딱딱한 복숭아(딱복)', 2),
  ('food-no-cola-chicken-vs-no-kimchi-ramen', 'no_cola_chicken', '콜라 없는 치킨', 1),
  ('food-no-cola-chicken-vs-no-kimchi-ramen', 'no_kimchi_ramen', '김치 없는 라면', 2),
  ('food-mintchoco-vs-no-chocolate', 'mintchoco_forever', '치약 맛 나는 민트초코 평생 먹기', 1),
  ('food-mintchoco-vs-no-chocolate', 'no_chocolate_forever', '평생 초콜릿 못 먹기', 2),
  ('rel-lover-passenger-vs-friend-passenger', 'lover_car_friend_passenger', '내 애인 차에 친구 조수석 태우기', 1),
  ('rel-lover-passenger-vs-friend-passenger', 'friend_car_lover_passenger', '내 친구 차에 애인 조수석 태우기', 2),
  ('rel-lover-peel-shrimp-vs-friend-peel-shrimp', 'lover_peels_friend_shrimp', '애인이 내 친구 새우 까주기', 1),
  ('rel-lover-peel-shrimp-vs-friend-peel-shrimp', 'friend_peels_lover_shrimp', '친구가 내 애인 새우 까주기', 2),
  ('rel-ghosting-vs-rebound-breakup', 'ghosting_breakup', '잠수 이별(이유도 모름)', 1),
  ('rel-ghosting-vs-rebound-breakup', 'rebound_breakup', '환승 이별(이유가 뻔함)', 2),
  ('rel-slow-long-vs-fast-short-reply', 'slow_long_reply', '답장 늦지만 정성 가득한 장문', 1),
  ('rel-slow-long-vs-fast-short-reply', 'fast_short_reply', '답장 빠르지만 ''ㅇㅇ''만 보내는 단답', 2),
  ('work-competent-toxic-boss-vs-kind-incompetent-boss', 'competent_toxic_boss', '일은 진짜 잘하는데 성격 파탄인 상사', 1),
  ('work-competent-toxic-boss-vs-kind-incompetent-boss', 'kind_incompetent_boss', '성격은 천사인데 일 못해서 내가 다 해야 하는 상사', 2),
  ('work-long-commute-bigco-vs-nearby-sme', 'long_commute_bigco', '왕복 4시간 거리 대기업 (연봉 동일)', 1),
  ('work-long-commute-bigco-vs-nearby-sme', 'nearby_sme', '집 앞 5분 거리 중소기업 (연봉 동일)', 2),
  ('work-highpay-6day-vs-lowpay-4day', 'highpay_sixday', '월 500 벌고 주 6일 근무', 1),
  ('work-highpay-6day-vs-lowpay-4day', 'lowpay_fourday', '월 250 벌고 주 4일 근무', 2),
  ('work-invisible-vs-levitation-10cm', 'invisibility', '아무도 나를 못 보는 능력', 1),
  ('work-invisible-vs-levitation-10cm', 'levitation_10cm', '10cm만 떠서 다닐 수 있는 능력', 2),
  ('imagination-past-lotto-vs-future-spouse', 'past_lotto', '과거로 가서 로또 번호 알려주기', 1),
  ('imagination-past-lotto-vs-future-spouse', 'future_spouse', '미래로 가서 내 배우자 보고 오기', 2),
  ('imagination-all-languages-vs-best-looks', 'all_languages_master', '세상의 모든 언어를 마스터하기', 1),
  ('imagination-all-languages-vs-best-looks', 'best_looks', '세상에서 가장 아름다운 외모 갖기', 2),
  ('imagination-army-winter-vs-summer', 'army_winter_2y', '겨울만 계속되는 군대 2년', 1),
  ('imagination-army-winter-vs-summer', 'army_summer_2y', '여름만 계속되는 군대 2년', 2)
on conflict (topic_id, option_key) do update set
  option_label = excluded.option_label,
  position = excluded.position;

create or replace function public.get_topic_live_scoreboard(
  p_status text default 'LIVE'
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
      case
        when upper(coalesce(p_status, 'LIVE')) = 'ALL' then true
        else upper(t.status) = upper(coalesce(p_status, 'LIVE'))
      end
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

grant execute on function public.get_topic_live_scoreboard(text) to anon, authenticated;
