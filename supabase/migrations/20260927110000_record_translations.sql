-- Knowledge is structured in English; technicians often work in Arabic.
-- A translation is generated when a record is approved (and when an approved
-- record is edited), so diagnosis can answer in the technician's language
-- without an extra AI call.
--   translations = { "ar": { "version": 3, "title": ..., "symptoms": ..., "root_cause": ...,
--                            "fix_steps": [...], "safety_notes": [...], "parts": [...], "tools": [...] } }
alter table public.fault_records add column translations jsonb not null default '{}';
