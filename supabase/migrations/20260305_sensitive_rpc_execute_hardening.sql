-- Restrict sensitive SECURITY DEFINER RPCs to service_role only.
-- These functions accept user IDs as arguments, so direct authenticated execution
-- can lead to cross-account access if called outside trusted server routes.
do $$
declare
  fn text;
  sensitive_functions text[] := array[
    'public.upsert_user_school_pool_slot(uuid,text,uuid,boolean)',
    'public.set_user_main_school_slot(uuid,text)',
    'public.promote_guest_session_votes_to_user(uuid,uuid,smallint,text)',
    'public.get_game_user_rank(uuid,text,text)',
    'public.get_region_battle_user_rank(uuid,text)',
    'public.get_my_vote_comparison_metrics(uuid)',
    'public.get_my_vote_comparison_metrics_with_dummy(uuid,boolean)',
    'public.get_my_vote_comparison_metrics_segments(uuid,boolean)',
    'public.merge_guest_votes_to_user(text,uuid)'
  ];
begin
  foreach fn in array sensitive_functions loop
    if to_regprocedure(fn) is null then
      continue;
    end if;

    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('revoke execute on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
