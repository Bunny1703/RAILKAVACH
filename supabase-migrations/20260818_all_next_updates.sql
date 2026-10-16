-- RAILKAVACH consolidated performance/support migration.
-- Safe to run more than once.

alter table public.assets add column if not exists qr_data jsonb;

alter table public.inspections add column if not exists wear_level smallint not null default 0 check (wear_level between 0 and 5);
alter table public.inspections add column if not exists corrosion_level smallint not null default 0 check (corrosion_level between 0 and 5);
alter table public.inspections add column if not exists crack_level smallint not null default 0 check (crack_level between 0 and 5);
alter table public.inspections add column if not exists deformation_level smallint not null default 0 check (deformation_level between 0 and 5);
alter table public.inspections add column if not exists vibration_level smallint not null default 0 check (vibration_level between 0 and 5);
alter table public.inspections add column if not exists temperature_c numeric(6,2);
alter table public.inspections add column if not exists maintenance_count integer not null default 0 check (maintenance_count >= 0);
alter table public.inspections add column if not exists previous_failures integer not null default 0 check (previous_failures >= 0);

create index if not exists idx_inspections_asset_date on public.inspections(asset_id, inspected_at desc);
create index if not exists idx_inspections_status on public.inspections(status);
create index if not exists idx_assets_type on public.assets(type);
create index if not exists idx_assets_location on public.assets(location);
create index if not exists idx_assets_vendor on public.assets(vendor);
create index if not exists idx_notifications_read_created on public.notifications(is_read, created_at desc);
