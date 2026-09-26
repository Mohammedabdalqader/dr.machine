export type Role = 'technician' | 'engineer' | 'manager' | 'admin';
export type RecordStatus = 'draft' | 'approved' | 'rejected';

export const REVIEWER_ROLES: Role[] = ['engineer', 'manager', 'admin'];
export const MANAGER_ROLES: Role[] = ['manager', 'admin'];

export type Profile = {
  id: string;
  company_id: string;
  full_name: string;
  role: Role;
  language: 'ar' | 'en';
  company: { name: string; is_sample: boolean } | null;
};

export type MachineModel = { id: string; code: string; name: string };
export type Line = { id: string; name: string; site: { name: string } | null };

export type Machine = {
  id: string;
  tag: string;
  serial_number: string;
  installed_on: string | null;
  notes: string;
  model_id: string | null;
  line_id: string | null;
  model: MachineModel | null;
  line: Line | null;
};

export type FaultRecord = {
  id: string;
  model_id: string | null;
  title: string;
  component: string;
  symptoms: string;
  error_codes: string[];
  root_cause: string;
  fix_steps: string[];
  parts: string[];
  tools: string[];
  estimated_minutes: number | null;
  safety_notes: string[];
  requires_qualified: boolean;
  status: RecordStatus;
  version: number;
  manual_refs: { document_id: string; page: number }[];
  approved_at: string | null;
  updated_at: string;
};

export type FaultCase = {
  id: string;
  source_ref: string;
  occurred_on: string | null;
  machine_label: string;
  problem: string;
  action_taken: string;
  hours: number | null;
  technician_name: string;
  fault_record_id?: string | null;
};

export type DocumentKind = 'fault_log' | 'manual';
export type DocumentRow = {
  id: string;
  kind: DocumentKind;
  title: string;
  file_name: string;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  stage: string;
  progress: Record<string, number>;
  stats: Record<string, unknown>;
  error: string | null;
  created_at: string;
};

export type Confidence = 'high' | 'medium' | 'low';

export type DiagnosisCause = {
  record_id: string;
  title: string;
  record_title: string;
  reason: string;
  confidence: Confidence;
  past_cases: number;
  past_cases_total: number;
  manual_pages: { document_id: string; page: number; title: string }[];
  component: string;
  root_cause: string;
  fix_steps: string[];
  parts: string[];
  tools: string[];
  estimated_minutes: number | null;
  requires_qualified: boolean;
  safety_notes: string[];
};

export type DiagnosisRow = {
  id: string;
  status: 'answered' | 'not_enough_data' | 'escalated';
  confidence: Confidence | null;
  language: 'ar' | 'en';
  input_text: string;
  input_error_code: string;
  photo_paths: string[];
  safety_notes: string[];
  causes: DiagnosisCause[];
  understanding: { follow_up_question?: string };
  evidence: { weak_leads?: DiagnosisCause[] };
  rejected_record_ids: string[];
  selected_record_id: string | null;
  escalated_at: string | null;
  escalation_note: string;
  latency_ms: number | null;
  created_at: string;
  machine: { id: string; tag: string; model: { code: string } | null; line: { name: string } | null } | null;
};
