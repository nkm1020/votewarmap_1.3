create extension if not exists pgcrypto;

create table if not exists public.support_products (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  currency text not null check (currency in ('KRW', 'USD')),
  amount_minor integer not null check (amount_minor > 0),
  payment_method text not null check (payment_method in ('CARD', 'PAYPAL')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (currency, amount_minor, payment_method)
);

create index if not exists support_products_active_sort_idx
  on public.support_products(is_active, currency, sort_order, amount_minor);

alter table public.support_products enable row level security;

drop policy if exists "support_products_select_all" on public.support_products;
create policy "support_products_select_all"
on public.support_products
for select
using (true);

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.support_products(id) on delete restrict,
  provider text not null check (provider in ('toss')),
  payment_method text not null check (payment_method in ('CARD', 'PAYPAL')),
  currency text not null check (currency in ('KRW', 'USD')),
  amount_minor integer not null check (amount_minor > 0),
  provider_order_id text not null unique,
  provider_payment_key text unique,
  status text not null check (status in ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELED', 'REFUNDED', 'EXPIRED')),
  idempotency_key uuid not null unique,
  failure_code text,
  failure_message text,
  raw_last_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  canceled_at timestamptz,
  refunded_at timestamptz,
  expired_at timestamptz
);

create index if not exists payment_orders_user_created_idx
  on public.payment_orders(user_id, created_at desc);

create index if not exists payment_orders_status_idx
  on public.payment_orders(status, updated_at desc);

create index if not exists payment_orders_provider_payment_key_idx
  on public.payment_orders(provider_payment_key)
  where provider_payment_key is not null;

alter table public.payment_orders enable row level security;

drop policy if exists "payment_orders_select_own" on public.payment_orders;
create policy "payment_orders_select_own"
on public.payment_orders
for select
using (auth.uid() = user_id);

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('toss')),
  event_type text not null,
  provider_event_id text,
  provider_payment_key text,
  payload jsonb not null,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists payment_webhook_events_provider_event_uidx
  on public.payment_webhook_events(provider, provider_event_id)
  where provider_event_id is not null;

create unique index if not exists payment_webhook_events_provider_hash_uidx
  on public.payment_webhook_events(provider, payload_hash);

create index if not exists payment_webhook_events_received_idx
  on public.payment_webhook_events(received_at desc);

alter table public.payment_webhook_events enable row level security;

create table if not exists public.user_entitlements (
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_key text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  source_order_id uuid references public.payment_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, entitlement_key)
);

create index if not exists user_entitlements_active_idx
  on public.user_entitlements(entitlement_key, revoked_at)
  where revoked_at is null;

alter table public.user_entitlements enable row level security;

drop policy if exists "user_entitlements_select_own" on public.user_entitlements;
create policy "user_entitlements_select_own"
on public.user_entitlements
for select
using (auth.uid() = user_id);

create or replace function public.set_generic_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_support_products_updated_at on public.support_products;
create trigger trg_support_products_updated_at
before update on public.support_products
for each row
execute function public.set_generic_updated_at();

drop trigger if exists trg_payment_orders_updated_at on public.payment_orders;
create trigger trg_payment_orders_updated_at
before update on public.payment_orders
for each row
execute function public.set_generic_updated_at();

drop trigger if exists trg_user_entitlements_updated_at on public.user_entitlements;
create trigger trg_user_entitlements_updated_at
before update on public.user_entitlements
for each row
execute function public.set_generic_updated_at();

insert into public.support_products (id, title, currency, amount_minor, payment_method, is_active, sort_order)
values
  ('11111111-1111-4111-8111-111111111001', '커피 한 잔 후원', 'KRW', 3000, 'CARD', true, 10),
  ('11111111-1111-4111-8111-111111111002', '든든한 후원', 'KRW', 10000, 'CARD', true, 20),
  ('11111111-1111-4111-8111-111111111003', '슈퍼 서포터 후원', 'KRW', 30000, 'CARD', true, 30),
  ('22222222-2222-4222-8222-222222222001', 'Coffee Support', 'USD', 300, 'PAYPAL', true, 10),
  ('22222222-2222-4222-8222-222222222002', 'Strong Support', 'USD', 1000, 'PAYPAL', true, 20),
  ('22222222-2222-4222-8222-222222222003', 'Super Supporter', 'USD', 3000, 'PAYPAL', true, 30)
on conflict (id) do update set
  title = excluded.title,
  currency = excluded.currency,
  amount_minor = excluded.amount_minor,
  payment_method = excluded.payment_method,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

create or replace function public.recompute_supporter_entitlement(p_user_id uuid)
returns table (
  has_supporter_badge boolean,
  granted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest_confirmed_order_id uuid;
  v_has_supporter_badge boolean := false;
  v_granted_at timestamptz := null;
begin
  select po.id
    into v_latest_confirmed_order_id
  from public.payment_orders po
  where po.user_id = p_user_id
    and po.status = 'CONFIRMED'
  order by coalesce(po.confirmed_at, po.updated_at, po.created_at) desc
  limit 1;

  if v_latest_confirmed_order_id is not null then
    insert into public.user_entitlements (
      user_id,
      entitlement_key,
      granted_at,
      revoked_at,
      source_order_id
    )
    values (
      p_user_id,
      'supporter_badge',
      now(),
      null,
      v_latest_confirmed_order_id
    )
    on conflict (user_id, entitlement_key) do update set
      revoked_at = null,
      source_order_id = excluded.source_order_id,
      granted_at = case
        when public.user_entitlements.revoked_at is not null then now()
        else public.user_entitlements.granted_at
      end,
      updated_at = now();
  else
    update public.user_entitlements
    set
      revoked_at = coalesce(revoked_at, now()),
      source_order_id = null,
      updated_at = now()
    where user_id = p_user_id
      and entitlement_key = 'supporter_badge'
      and revoked_at is null;
  end if;

  select
    (ue.user_id is not null and ue.revoked_at is null),
    ue.granted_at
  into v_has_supporter_badge, v_granted_at
  from public.user_entitlements ue
  where ue.user_id = p_user_id
    and ue.entitlement_key = 'supporter_badge'
  limit 1;

  return query
  select coalesce(v_has_supporter_badge, false), v_granted_at;
end;
$$;

revoke execute on function public.recompute_supporter_entitlement(uuid) from public;
revoke execute on function public.recompute_supporter_entitlement(uuid) from anon;
revoke execute on function public.recompute_supporter_entitlement(uuid) from authenticated;
grant execute on function public.recompute_supporter_entitlement(uuid) to service_role;
