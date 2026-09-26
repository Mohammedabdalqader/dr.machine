-- Phase 2 · Diagnosis
-- Every request is stored with its inputs, the evidence retrieved and the answer,
-- for the feedback loop and for measuring quality.

create type public.diagnosis_status as enum ('answered', 'not_enough_data', 'escalated');

create table public.diagnoses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  machine_id uuid references public.machines (id) on delete set null,
  model_id uuid references public.machine_models (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  language text not null default 'ar' check (language in ('ar', 'en')),
  input_text text not null default '',
  input_error_code text not null default '',
  photo_paths text[] not null default '{}',
  understanding jsonb not null default '{}',   -- query rewrite + what vision saw
  evidence jsonb not null default '{}',        -- candidates and manual chunks with scores
  causes jsonb not null default '[]',          -- ranked answer shown to the technician
  safety_notes text[] not null default '{}',
  confidence text check (confidence in ('high', 'medium', 'low')),
  status public.diagnosis_status not null default 'answered',
  rejected_record_ids uuid[] not null default '{}',  -- "Not this"
  selected_record_id uuid references public.fault_records (id) on delete set null,  -- "Start fix"
  escalated_at timestamptz,
  escalation_note text not null default '',
  latency_ms int,
  usage jsonb not null default '[]',           -- per AI call: model, tokens, latency
  created_at timestamptz not null default now()
  -- photo_paths are validated by the diagnose function (must be inside the company folder).
);
create index diagnoses_company_idx on public.diagnoses (company_id, created_at desc);
create index diagnoses_machine_idx on public.diagnoses (machine_id, created_at desc);
create index diagnoses_escalated_idx on public.diagnoses (company_id, status) where status = 'escalated';

alter table public.diagnoses enable row level security;

-- Technicians see their own diagnoses; engineers and managers see the company's
-- (they handle escalations). Writes go through the diagnose function and the
-- diagnosis_feedback RPC below.
create policy "own or reviewer read" on public.diagnoses
  for select to authenticated
  using (company_id = (select private.company_id())
    and (user_id = (select auth.uid())
      or (select private.has_role(array['engineer', 'manager', 'admin']::public.app_role[]))));

-- ---------------------------------------------------------------- feedback

-- "Start fix", "Not this" and "Escalate" from the result screen.
create function public.diagnosis_feedback(
  p_diagnosis_id uuid,
  p_action text,
  p_record_id uuid default null,
  p_note text default ''
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  d public.diagnoses;
begin
  select * into d from public.diagnoses
  where id = p_diagnosis_id and company_id = private.company_id();
  if not found then
    raise exception 'diagnosis not found';
  end if;
  if d.user_id is distinct from auth.uid()
     and not private.has_role(array['engineer', 'manager', 'admin']::public.app_role[]) then
    raise exception 'not allowed';
  end if;

  if p_action = 'start_fix' then
    update public.diagnoses set selected_record_id = p_record_id where id = d.id;
  elsif p_action = 'not_this' then
    update public.diagnoses
    set rejected_record_ids = array(select distinct unnest(rejected_record_ids || p_record_id))
    where id = d.id;
  elsif p_action = 'escalate' then
    update public.diagnoses
    set status = 'escalated', escalated_at = now(), escalation_note = left(coalesce(p_note, ''), 1000)
    where id = d.id;
  else
    raise exception 'unknown action %', p_action;
  end if;

  insert into public.audit_log (company_id, actor_id, action, target_type, target_id, details)
  values (d.company_id, auth.uid(), 'diagnosis.' || p_action, 'diagnosis', d.id,
          jsonb_build_object('record_id', p_record_id));
end $$;

revoke execute on function public.diagnosis_feedback(uuid, text, uuid, text) from public, anon;
grant execute on function public.diagnosis_feedback(uuid, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------- search

-- Candidate knowledge records for a diagnosis, scored three ways:
-- exact error code, keyword match and meaning (vector similarity).
-- Only approved records for this machine model (or for all models).
create function public.search_fault_records(
  p_company_id uuid,
  p_model_id uuid,
  p_codes text[],
  p_query text,
  p_embedding extensions.vector(1024),
  p_limit int default 8
)
returns table (id uuid, code_match boolean, text_rank real, similarity real)
language sql stable set search_path = ''
as $$
  with scope as (
    select r.* from public.fault_records r
    where r.company_id = p_company_id
      and r.status = 'approved'
      and (p_model_id is null or r.model_id is null or r.model_id = p_model_id)
  ),
  q as (
    select to_tsquery('simple', string_agg(quote_literal(w) || ':*', ' | ')) as query
    from (
      select distinct lower(w) as w
      from regexp_split_to_table(coalesce(p_query, ''), '[^[:alnum:]]+') as w
      where length(w) > 2
    ) words
  ),
  by_code as (
    select s.id from scope s where s.error_codes && coalesce(p_codes, '{}')
  ),
  by_text as (
    select s.id, ts_rank(s.fts, q.query) as rank
    from scope s, q
    where q.query is not null and s.fts @@ q.query
    order by rank desc limit 20
  ),
  by_vector as (
    select s.id, 1 - (s.embedding operator(extensions.<=>) p_embedding) as sim
    from scope s
    where p_embedding is not null and s.embedding is not null
    order by s.embedding operator(extensions.<=>) p_embedding
    limit 20
  ),
  ids as (
    select id from by_code union select id from by_text union select id from by_vector
  )
  select
    ids.id,
    exists (select 1 from by_code c where c.id = ids.id) as code_match,
    coalesce((select t.rank from by_text t where t.id = ids.id), 0)::real as text_rank,
    coalesce(
      (select v.sim from by_vector v where v.id = ids.id),
      (select 1 - (s.embedding operator(extensions.<=>) p_embedding) from scope s where s.id = ids.id and p_embedding is not null),
      0
    )::real as similarity
  from ids
  order by code_match desc, similarity desc
  limit greatest(p_limit * 2, 16)
$$;

-- Manual pages by meaning, for the same model (or manuals for all models).
create function public.match_manual_chunks(
  p_company_id uuid,
  p_embedding extensions.vector(1024),
  p_model_id uuid default null,
  p_limit int default 4
)
returns table (id bigint, document_id uuid, page int, content text, similarity real)
language sql stable set search_path = ''
as $$
  select c.id, c.document_id, c.page, c.content,
         (1 - (c.embedding operator(extensions.<=>) p_embedding))::real as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.company_id = p_company_id
    and d.kind = 'manual'
    and c.embedding is not null
    and (p_model_id is null or cardinality(d.model_ids) = 0 or p_model_id = any (d.model_ids))
  order by c.embedding operator(extensions.<=>) p_embedding
  limit p_limit
$$;

revoke execute on function public.search_fault_records(uuid, uuid, text[], text, extensions.vector, int) from public, anon, authenticated;
grant execute on function public.search_fault_records(uuid, uuid, text[], text, extensions.vector, int) to service_role;
revoke execute on function public.match_manual_chunks(uuid, extensions.vector, uuid, int) from public, anon, authenticated;
grant execute on function public.match_manual_chunks(uuid, extensions.vector, uuid, int) to service_role;

-- ---------------------------------------------------------------- photos

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

create policy "members read company photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select private.company_id())::text);
create policy "members upload company photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select private.company_id())::text);
