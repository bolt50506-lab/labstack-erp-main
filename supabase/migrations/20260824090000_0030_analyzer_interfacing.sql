/*
# Analyzer / HL7 Interfacing

## Purpose
Lets a lab machine (or, in practice, a small on-site bridge / Mirth
Connect instance forwarding from the machine's native MLLP/serial
output) push results in via HTTPS instead of manual entry. This app is
deployed serverless (Netlify), which cannot hold an always-on raw
TCP/MLLP socket open — that's a platform constraint, not a choice — so
the ingestion boundary here is deliberately HTTP, with the raw
MLLP-to-HTTP bridging expected to happen on a small on-site relay.

## Design
- analyzers: one row per registered machine, with a hashed API key used
  to authenticate POSTs to /api/hl7/ingest (machine-to-machine, not a
  user session — a user JWT wouldn't make sense here).
- services.analyzer_code / test_parameters.analyzer_code: lets an
  incoming OBX-3 identifier resolve to the right test/parameter.
- analyzer_result_logs: every ingestion attempt (success or failure) is
  recorded with the raw message, so a failed match can be diagnosed
  without re-triggering the analyzer.
- Results land in lab_results/lab_result_parameters — the SAME tables
  manual entry already writes to — with status left at 'processing'
  rather than auto-submitted, so a human still reviews before it goes
  to verification (same maker-checker principle as manual entry).
*/

CREATE TABLE IF NOT EXISTS analyzers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  code text NOT NULL,
  manufacturer text,
  api_key_hash text NOT NULL,
  api_key_prefix text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS analyzer_result_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analyzer_id uuid REFERENCES analyzers(id) ON DELETE SET NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  raw_message text NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'matched', 'unmatched', 'error')),
  matched_lab_order_item_id uuid REFERENCES lab_order_items(id) ON DELETE SET NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE services ADD COLUMN IF NOT EXISTS analyzer_code text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE test_parameters ADD COLUMN IF NOT EXISTS analyzer_code text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_analyzer_logs_company ON analyzer_result_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_services_analyzer_code ON services(company_id, analyzer_code);
CREATE INDEX IF NOT EXISTS idx_test_parameters_analyzer_code ON test_parameters(company_id, analyzer_code);

ALTER TABLE analyzers ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyzer_result_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_analyzers" ON analyzers;
CREATE POLICY "auth_all_analyzers" ON analyzers FOR ALL TO authenticated
  USING (is_company_member(company_id)) WITH CHECK (is_company_member(company_id));
DROP POLICY IF EXISTS "auth_select_analyzer_logs" ON analyzer_result_logs;
CREATE POLICY "auth_select_analyzer_logs" ON analyzer_result_logs FOR SELECT TO authenticated
  USING (is_company_member(company_id));
