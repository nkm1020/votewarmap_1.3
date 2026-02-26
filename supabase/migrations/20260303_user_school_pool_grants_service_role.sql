grant execute on function public.upsert_user_school_pool_slot(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.upsert_user_school_pool_slot(uuid, text, uuid, boolean) to service_role;

grant execute on function public.set_user_main_school_slot(uuid, text) to authenticated;
grant execute on function public.set_user_main_school_slot(uuid, text) to service_role;
