create extension if not exists pgcrypto;

create table if not exists public.users (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    email text unique not null,
    password_hash text,
    google_id text unique,
    role text not null default 'operator' check (role in ('admin','manager','inspector','operator')),
    profile_image text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.assets (
    id text primary key,
    type text not null,
    location text not null,
    status text not null default 'Active' check (status in ('Active','Maintenance','Inactive')),
    batch_number text,
    vendor text,
    qr_data jsonb,
    created_by uuid references public.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.inventory (
    id text primary key,
    type text not null,
    batch text not null,
    vendor text not null,
    warranty_months integer default 0,
    supply_date date,
    status text not null default 'In Stock' check (status in ('In Stock','Deployed','Maintenance','Disposed')),
    asset_id text references public.assets(id) on delete set null,
    created_by uuid references public.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.inspections (
    id uuid primary key default gen_random_uuid(),
    asset_id text references public.assets(id) on delete cascade,
    status text not null default 'Pending' check (status in ('Passed','Failed','Pending')),
    inspected_at timestamptz not null default now(),
    inspector_id uuid references public.users(id) on delete set null,
    notes text,
    wear_level smallint not null default 0 check (wear_level between 0 and 5),
    corrosion_level smallint not null default 0 check (corrosion_level between 0 and 5),
    crack_level smallint not null default 0 check (crack_level between 0 and 5),
    deformation_level smallint not null default 0 check (deformation_level between 0 and 5),
    vibration_level smallint not null default 0 check (vibration_level between 0 and 5),
    temperature_c numeric(6,2),
    maintenance_count integer not null default 0 check (maintenance_count >= 0),
    previous_failures integer not null default 0 check (previous_failures >= 0),
    created_at timestamptz not null default now()
);

create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    type text not null default 'info',
    icon text not null default 'fa-circle-info',
    text text not null,
    entity_id text,
    created_at timestamptz not null default now(),
    is_read boolean not null default false
);

create table if not exists public.portals (
    id uuid primary key default gen_random_uuid(),
    name text unique not null,
    status text not null default 'Disconnected' check (status in ('Connected','Disconnected','Warning')),
    last_sync timestamptz,
    api_version text,
    data_points integer not null default 0,
    last_error text,
    uptime numeric(5,2),
    updated_at timestamptz not null default now()
);

create index if not exists idx_assets_status on public.assets(status);
create index if not exists idx_assets_created_at on public.assets(created_at desc);
create index if not exists idx_inventory_status on public.inventory(status);
create index if not exists idx_inventory_vendor on public.inventory(vendor);
create index if not exists idx_inspections_asset on public.inspections(asset_id);
create index if not exists idx_inspections_date on public.inspections(inspected_at desc);
create index if not exists idx_notifications_created on public.notifications(created_at desc);

alter table public.users enable row level security;
alter table public.assets enable row level security;
alter table public.inventory enable row level security;
alter table public.inspections enable row level security;
alter table public.notifications enable row level security;
alter table public.portals enable row level security;

-- The Netlify backend uses the Supabase server-side secret key, so no public
-- SELECT/INSERT/UPDATE/DELETE policies are required for these tables.

-- Optional initial portal configuration. These are system records, not dashboard demo data.
