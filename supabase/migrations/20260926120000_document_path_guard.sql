-- A document may only point at a file inside its own company's storage folder.
-- Import runs with the service role, so without this an uploader could point
-- storage_path at another company's file and import it into their own company.
alter table public.documents
  add constraint documents_storage_path_in_company
  check (storage_path like company_id::text || '/%' and storage_path not like '%..%');
