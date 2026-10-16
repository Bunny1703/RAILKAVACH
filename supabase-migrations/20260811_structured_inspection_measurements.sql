-- RAIL KAVACH: structured inspection measurements
-- Run this once in Supabase SQL Editor for an existing project.
alter table public.inspections add column if not exists wear_level smallint not null default 0 check (wear_level between 0 and 5);
alter table public.inspections add column if not exists corrosion_level smallint not null default 0 check (corrosion_level between 0 and 5);
alter table public.inspections add column if not exists crack_level smallint not null default 0 check (crack_level between 0 and 5);
alter table public.inspections add column if not exists deformation_level smallint not null default 0 check (deformation_level between 0 and 5);
alter table public.inspections add column if not exists vibration_level smallint not null default 0 check (vibration_level between 0 and 5);
alter table public.inspections add column if not exists temperature_c numeric(6,2);
alter table public.inspections add column if not exists maintenance_count integer not null default 0 check (maintenance_count >= 0);
alter table public.inspections add column if not exists previous_failures integer not null default 0 check (previous_failures >= 0);
