-- ============================================================================
-- AYUSH Federation of India - Belagavi
-- Supabase database schema
--
-- Apply this file to a fresh Supabase project to create the database. It is
-- reproducible and safe to re-run (uses CREATE TABLE IF NOT EXISTS).
--
-- IMPORTANT: Column names are quoted camelCase to match the field names used by
-- the existing frontend (index.html) so no frontend field mapping/rename is
-- required. The `id` column is the record primary key (e.g. 'afi_001',
-- 'afi_ann_001') and is the primary key for idempotent upserts.
-- ============================================================================

-- Realtime publication: needed for the app's live directory refresh. The DO
-- block adds each table only if it is not already a member, so the file stays
-- safe to re-run.
create publication if not exists supabase_realtime;

-- ----------------------------------------------------------------------------
-- members
-- ----------------------------------------------------------------------------
create table if not exists public.members (
    "id"            text primary key,
    "name"          text not null check (char_length("name") between 1 and 150),
    "mobile"        text not null check ("mobile" ~ '^[0-9]{10}$'),
    "qualification" text not null check (char_length("qualification") between 1 and 100),
    "regno"         text not null check (char_length("regno") between 1 and 60),
    "address"       text check (char_length("address") <= 500),
    "transaction"   text check (char_length("transaction") <= 100),
    "photoBase64"   text,
    "status"        text not null default 'pending' check ("status" in ('active', 'pending', 'inactive')),
    "approvedAt"    timestamptz,
    "source"        text,
    "createdAt"     timestamptz not null default now(),
    "updatedAt"     timestamptz
);

create index if not exists members_status_idx    on public.members ("status");
create index if not exists members_createdat_idx on public.members ("createdAt");
create index if not exists members_mobile_idx    on public.members ("mobile");

-- ----------------------------------------------------------------------------
-- announcements
-- ----------------------------------------------------------------------------
create table if not exists public.announcements (
    "id"        text primary key,
    "title"     text not null check (char_length("title") between 1 and 250),
    "content"   text not null check (char_length("content") between 1 and 5000),
    "category"  text check ("category" in ('General', 'Meeting', 'Event', 'Urgent')),
    "createdAt" timestamptz not null default now(),
    "updatedAt" timestamptz
);

create index if not exists announcements_category_idx   on public.announcements ("category");
create index if not exists announcements_createdat_idx  on public.announcements ("createdAt");

-- ----------------------------------------------------------------------------
-- cme
-- ----------------------------------------------------------------------------
create table if not exists public.cme (
    "id"          text primary key,
    "title"       text not null check (char_length("title") between 1 and 250),
    "description" text,
    "date"        text,
    "venue"       text check (char_length("venue") <= 300),
    "createdAt"   timestamptz not null default now(),
    "updatedAt"   timestamptz
);

create index if not exists cme_date_idx    on public.cme ("date");
create index if not exists cme_createdat_idx on public.cme ("createdAt");

-- ----------------------------------------------------------------------------
-- gallery
-- ----------------------------------------------------------------------------
create table if not exists public.gallery (
    "id"          text primary key,
    "title"       text not null check (char_length("title") between 1 and 250),
    "imageBase64" text,
    "createdAt"   timestamptz not null default now(),
    "updatedAt"   timestamptz
);

create index if not exists gallery_createdat_idx on public.gallery ("createdAt");

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- Model translated from the existing rules:
--   * Public (anon) can READ public content (members, announcements, cme, gallery).
--   * Writes are NOT available to public/anonymous users at all. The application's
--     admin writes flow through the backend (Express) using the service-role key,
--     which bypasses RLS. This keeps writes authenticated/server-side only.
-- ============================================================================

alter table public.members       enable row level security;
alter table public.announcements enable row level security;
alter table public.cme           enable row level security;
alter table public.gallery       enable row level security;

-- Public reads
drop policy if exists "public read members"       on public.members;
create policy "public read members" on public.members       for select using (true);

drop policy if exists "public read announcements" on public.announcements;
create policy "public read announcements" on public.announcements for select using (true);

drop policy if exists "public read cme"           on public.cme;
create policy "public read cme"           on public.cme           for select using (true);

drop policy if exists "public read gallery"       on public.gallery;
create policy "public read gallery"       on public.gallery       for select using (true);

-- No anon/authenticated write policies are created on purpose. Inserts, updates
-- and deletes are performed server-side via the service-role key. If you later
-- authenticate admin users with Supabase Auth, add role-based policies here.

-- ============================================================================
-- Realtime: publish the tables so the SPA can subscribe to postgres_changes.
-- Idempotent: each table is added only if it is not already a member.
-- ============================================================================
do $
begin
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'members') then
        alter publication supabase_realtime add table public.members;
    end if;

    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'announcements') then
        alter publication supabase_realtime add table public.announcements;
    end if;

    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'cme') then
        alter publication supabase_realtime add table public.cme;
    end if;

    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'gallery') then
        alter publication supabase_realtime add table public.gallery;
    end if;
end $;
