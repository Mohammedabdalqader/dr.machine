-- Import pipeline support: a processing lock and keyword search over manual pages.

-- ingest-step runs in short, resumable steps; the lock stops two calls from
-- processing the same document at the same time.
alter table public.documents add column locked_until timestamptz;

-- Keyword search over manual chunks (any word may match), best matches first.
-- Called by Edge Functions with the service role, so company_id is explicit.
create function public.search_manual_chunks(
  p_company_id uuid,
  p_query text,
  p_model_id uuid default null,
  p_limit int default 3
)
returns table (id bigint, document_id uuid, page int, content text, rank real)
language sql stable set search_path = ''
as $$
  with q as (
    select to_tsquery('simple', string_agg(quote_literal(w) || ':*', ' | ')) as query
    from (
      select distinct lower(w) as w
      from regexp_split_to_table(p_query, '[^[:alnum:]؀-ۿ]+') as w
      where length(w) > 2
    ) words
  )
  select c.id, c.document_id, c.page, c.content, ts_rank(c.fts, q.query) as rank
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  cross join q
  where c.company_id = p_company_id
    and d.kind = 'manual'
    and q.query is not null
    and c.fts @@ q.query
    and (p_model_id is null or cardinality(d.model_ids) = 0 or p_model_id = any (d.model_ids))
  order by rank desc
  limit p_limit
$$;

revoke execute on function public.search_manual_chunks(uuid, text, uuid, int) from public, anon, authenticated;
grant execute on function public.search_manual_chunks(uuid, text, uuid, int) to service_role;
