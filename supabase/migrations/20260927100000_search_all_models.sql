-- Evaluation showed that filtering candidates by machine model hid correct
-- records: a record's model came from the few past cases it was built from,
-- while most faults apply to every model. Search now covers all approved
-- records and reports whether each one matches the model; the ranking step
-- decides with the model description in hand.

drop function public.search_fault_records(uuid, uuid, text[], text, extensions.vector, int);

create function public.search_fault_records(
  p_company_id uuid,
  p_model_id uuid,
  p_codes text[],
  p_query text,
  p_embedding extensions.vector(1024),
  p_limit int default 8
)
returns table (id uuid, code_match boolean, text_rank real, similarity real, model_match boolean)
language sql stable set search_path = ''
as $$
  with scope as (
    select r.* from public.fault_records r
    where r.company_id = p_company_id and r.status = 'approved'
  ),
  q as (
    select to_tsquery('simple', string_agg(quote_literal(w) || ':*', ' | ')) as query
    from (
      select distinct lower(w) as w
      from regexp_split_to_table(coalesce(p_query, ''), '[^[:alnum:]]+') as w
      where length(w) > 2
    ) words
  ),
  scored as (
    select
      s.id,
      s.error_codes && coalesce(p_codes, '{}') as code_match,
      coalesce(case when q.query is not null and s.fts @@ q.query then ts_rank(s.fts, q.query) end, 0)::real as text_rank,
      coalesce(case when p_embedding is not null and s.embedding is not null
        then 1 - (s.embedding operator(extensions.<=>) p_embedding) end, 0)::real as similarity,
      (p_model_id is null or s.model_id is null or s.model_id = p_model_id) as model_match
    from scope s cross join q
  )
  select id, code_match, text_rank, similarity, model_match
  from scored
  where code_match or text_rank > 0 or similarity > 0
  order by code_match desc, similarity desc
  limit p_limit
$$;

revoke execute on function public.search_fault_records(uuid, uuid, text[], text, extensions.vector, int) from public, anon, authenticated;
grant execute on function public.search_fault_records(uuid, uuid, text[], text, extensions.vector, int) to service_role;
