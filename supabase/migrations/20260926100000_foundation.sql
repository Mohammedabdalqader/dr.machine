-- Mu'allim · Phase 1 foundation
-- Companies, people and roles, asset registry, documents, knowledge base, audit.
-- Every business table carries company_id and is protected by row-level security:
-- a signed-in user only ever sees rows of their own company.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;

-- ---------------------------------------------------------------- types

create type public.app_role as enum ('technician', 'engineer', 'manager', 'admin');
create type public.record_status as enum ('draft', 'approved', 'rejected');
create type public.document_kind as enum ('fault_log', 'manual');
create type public.document_status as enum ('uploaded', 'processing', 'ready', 'failed');

-- ---------------------------------------------------------------- companies and people

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region text not null default 'jo',
  plan text not null default 'pilot',
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  full_name text not null default '',
  role public.app_role not null default 'technician',
  language text not null default 'ar' check (language in ('ar', 'en')),
  created_at timestamptz not null default now()
);
create index profiles_company_idx on public.profiles (company_id);

-- Helpers used by RLS policies. SECURITY DEFINER so they can read profiles
-- without recursing into the profiles policies.
create function private.company_id() returns uuid
language sql stable security definer set search_path = ''
as $$ select company_id from public.profiles where id = (select auth.uid()) $$;

create function private.user_role() returns public.app_role
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = (select auth.uid()) $$;

create function private.has_role(roles public.app_role[]) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select role from public.profiles where id = (select auth.uid())) = any (roles), false) $$;

grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- Users may edit their own name and language, never their role or company.
create function private.protect_profile() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and (new.role is distinct from old.role or new.company_id is distinct from old.company_id) then
    raise exception 'role and company can only be changed by an administrator';
  end if;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles
for each row execute function private.protect_profile();

-- ---------------------------------------------------------------- asset registry

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (site_id, name)
);

create table public.machine_models (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  manufacturer text not null default '',
  code text not null,              -- short code as technicians write it, e.g. RS-37
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

create table public.machines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  line_id uuid references public.lines (id) on delete set null,
  model_id uuid references public.machine_models (id) on delete set null,
  tag text not null,               -- the name painted on the machine, e.g. C-02
  serial_number text not null default '',
  installed_on date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, tag)
);
create index machines_company_idx on public.machines (company_id);

-- ---------------------------------------------------------------- documents (imports)

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind public.document_kind not null,
  title text not null,
  file_name text not null,
  storage_path text not null,
  mime_type text not null default '',
  model_ids uuid[] not null default '{}',       -- empty = applies to all models
  status public.document_status not null default 'uploaded',
  stage text not null default 'queued',         -- pipeline step, see ingest-step function
  progress jsonb not null default '{}',
  stats jsonb not null default '{}',
  error text,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_company_idx on public.documents (company_id, created_at desc);

create table public.document_chunks (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  page int not null,
  chunk_index int not null default 0,
  content text not null,
  fts tsvector generated always as (to_tsvector('simple', content)) stored,
  embedding extensions.vector(1024),
  unique (document_id, page, chunk_index)
);
create index document_chunks_company_idx on public.document_chunks (company_id);
create index document_chunks_fts_idx on public.document_chunks using gin (fts);
create index document_chunks_embedding_idx on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------- knowledge base

create table public.fault_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  model_id uuid references public.machine_models (id) on delete set null,  -- null = all models
  title text not null default '',
  component text not null default '',
  symptoms text not null default '',
  error_codes text[] not null default '{}',
  root_cause text not null default '',
  fix_steps text[] not null default '{}',
  parts text[] not null default '{}',
  tools text[] not null default '{}',
  estimated_minutes int,
  safety_notes text[] not null default '{}',
  requires_qualified boolean not null default false,
  status public.record_status not null default 'draft',
  version int not null default 1,
  source_document_id uuid references public.documents (id) on delete set null,
  manual_refs jsonb not null default '[]',      -- [{document_id, page}]
  search_text text not null default '',
  fts tsvector generated always as (to_tsvector('simple', search_text)) stored,
  embedding extensions.vector(1024),
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fault_records_company_status_idx on public.fault_records (company_id, status);
create index fault_records_codes_idx on public.fault_records using gin (error_codes);
create index fault_records_fts_idx on public.fault_records using gin (fts);
create index fault_records_embedding_idx on public.fault_records
  using hnsw (embedding extensions.vector_cosine_ops);

create function private.fault_record_search_text() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.search_text := concat_ws(' ', new.title, new.component, new.symptoms,
    array_to_string(new.error_codes, ' '), new.root_cause);
  new.updated_at := now();
  return new;
end $$;
create trigger fault_records_search_text before insert or update on public.fault_records
for each row execute function private.fault_record_search_text();

-- Full snapshot of every version, written by the records Edge Function.
create table public.fault_record_versions (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  fault_record_id uuid not null references public.fault_records (id) on delete cascade,
  version int not null,
  status public.record_status not null,
  snapshot jsonb not null,
  changed_by uuid references auth.users (id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index fault_record_versions_record_idx on public.fault_record_versions (fault_record_id, version desc);

-- Individual historical repairs (rows of an imported log). Evidence for a fault record:
-- "6 similar past cases on this model".
create table public.fault_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  fault_record_id uuid references public.fault_records (id) on delete set null,
  machine_id uuid references public.machines (id) on delete set null,
  machine_label text not null default '',       -- as written in the source
  source_document_id uuid references public.documents (id) on delete cascade,
  source_ref text not null default '',          -- e.g. work order number or row number
  occurred_on date,
  problem text not null default '',
  action_taken text not null default '',
  parts text not null default '',
  hours numeric(6, 2),
  technician_name text not null default '',
  raw jsonb not null default '{}',
  fts tsvector generated always as (to_tsvector('simple', problem || ' ' || action_taken)) stored,
  created_at timestamptz not null default now()
);
create index fault_cases_record_idx on public.fault_cases (fault_record_id);
create index fault_cases_document_idx on public.fault_cases (source_document_id);
create index fault_cases_fts_idx on public.fault_cases using gin (fts);

-- Working table for the fault-log import pipeline: which cases belong together.
create table public.ingestion_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  label text not null,
  case_ids uuid[] not null,
  existing_record_id uuid references public.fault_records (id) on delete set null,
  fault_record_id uuid references public.fault_records (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index ingestion_groups_document_idx on public.ingestion_groups (document_id, status);

-- ---------------------------------------------------------------- audit

create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_company_idx on public.audit_log (company_id, created_at desc);

-- ---------------------------------------------------------------- row-level security

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.lines enable row level security;
alter table public.machine_models enable row level security;
alter table public.machines enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.fault_records enable row level security;
alter table public.fault_record_versions enable row level security;
alter table public.fault_cases enable row level security;
alter table public.ingestion_groups enable row level security;
alter table public.audit_log enable row level security;

create policy "members read own company" on public.companies
  for select to authenticated using (id = (select private.company_id()));

create policy "members read colleagues" on public.profiles
  for select to authenticated using (company_id = (select private.company_id()));
create policy "users update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Asset registry: everyone reads; engineers, managers and admins maintain it.
do $$
declare t text;
begin
  foreach t in array array['sites', 'lines', 'machine_models', 'machines'] loop
    execute format('create policy "members read" on public.%I for select to authenticated
      using (company_id = (select private.company_id()))', t);
    execute format('create policy "maintainers insert" on public.%I for insert to authenticated
      with check (company_id = (select private.company_id())
        and (select private.has_role(array[''engineer'', ''manager'', ''admin'']::public.app_role[])))', t);
    execute format('create policy "maintainers update" on public.%I for update to authenticated
      using (company_id = (select private.company_id())
        and (select private.has_role(array[''engineer'', ''manager'', ''admin'']::public.app_role[])))
      with check (company_id = (select private.company_id()))', t);
    execute format('create policy "maintainers delete" on public.%I for delete to authenticated
      using (company_id = (select private.company_id())
        and (select private.has_role(array[''manager'', ''admin'']::public.app_role[])))', t);
  end loop;
end $$;

-- Documents: engineers+ upload; processing is done by Edge Functions (service role).
create policy "members read" on public.documents
  for select to authenticated using (company_id = (select private.company_id()));
create policy "engineers upload" on public.documents
  for insert to authenticated
  with check (company_id = (select private.company_id())
    and uploaded_by = (select auth.uid())
    and (select private.has_role(array['engineer', 'manager', 'admin']::public.app_role[])));
create policy "engineers delete" on public.documents
  for delete to authenticated
  using (company_id = (select private.company_id())
    and (select private.has_role(array['engineer', 'manager', 'admin']::public.app_role[])));

create policy "members read" on public.document_chunks
  for select to authenticated using (company_id = (select private.company_id()));

-- Knowledge: technicians only ever see approved records; reviewers see drafts too.
-- All writes go through the `records` Edge Function (versioning, embeddings, audit).
create policy "technicians read approved, reviewers read all" on public.fault_records
  for select to authenticated
  using (company_id = (select private.company_id())
    and (status = 'approved'
      or (select private.has_role(array['engineer', 'manager', 'admin']::public.app_role[]))));

create policy "reviewers read" on public.fault_record_versions
  for select to authenticated
  using (company_id = (select private.company_id())
    and (select private.has_role(array['engineer', 'manager', 'admin']::public.app_role[])));

create policy "members read" on public.fault_cases
  for select to authenticated using (company_id = (select private.company_id()));

create policy "reviewers read" on public.ingestion_groups
  for select to authenticated
  using (company_id = (select private.company_id())
    and (select private.has_role(array['engineer', 'manager', 'admin']::public.app_role[])));

create policy "managers read" on public.audit_log
  for select to authenticated
  using (company_id = (select private.company_id())
    and (select private.has_role(array['manager', 'admin']::public.app_role[])));

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 52428800, array[
  'application/pdf',
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream'
]);

-- Object paths are "<company_id>/<file>", so the first folder decides access.
create policy "members read company documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select private.company_id())::text);
create policy "engineers upload company documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select private.company_id())::text
    and (select private.has_role(array['engineer', 'manager', 'admin']::public.app_role[])));
create policy "engineers delete company documents" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select private.company_id())::text
    and (select private.has_role(array['engineer', 'manager', 'admin']::public.app_role[])));
