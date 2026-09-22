/*
# Quality Control (QC) Module

## Purpose
Tracks daily QC runs against known-value control materials, computes
standard-deviation-based flags using the common Westgard rules, and
feeds a Levy-Jennings chart — the standard tooling labs need for
CAP/ISO 15189 accreditation. Nothing like this existed before.

## Design
- qc_controls: one row per control material/lot for a given test
  parameter (or a whole service, for single-value tests), with the
  manufacturer's target mean/SD.
- qc_results: one row per daily run. z-score and Westgard flag are
  computed at write time by the app (not stored generated columns,
  since the flag logic looks at a short run of recent results, not
  just the current one) and stored for fast chart/list rendering.
*/

CREATE TABLE IF NOT EXISTS qc_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  service_id uuid REFERENCES services(id) ON DELETE CASCADE,
  test_parameter_id uuid REFERENCES test_parameters(id) ON DELETE CASCADE,
  name text NOT NULL,
  level text NOT NULL DEFAULT 'Level 1',
  lot_number text,
  unit text,
  target_mean numeric NOT NULL,
  target_sd numeric NOT NULL,
  expiry_date date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (service_id IS NOT NULL OR test_parameter_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS qc_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  qc_control_id uuid NOT NULL REFERENCES qc_controls(id) ON DELETE CASCADE,
  analyzer_id uuid REFERENCES analyzers(id) ON DELETE SET NULL,
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  measured_value numeric NOT NULL,
  z_score numeric NOT NULL,
  flag text NOT NULL DEFAULT 'pass' CHECK (flag IN ('pass', 'warning', 'fail')),
  westgard_rule text,
  performed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qc_results_control ON qc_results(qc_control_id, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_qc_controls_company ON qc_controls(company_id, is_active);

ALTER TABLE qc_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_qc_controls" ON qc_controls;
CREATE POLICY "auth_all_qc_controls" ON qc_controls FOR ALL TO authenticated
  USING (is_company_member(company_id)) WITH CHECK (is_company_member(company_id));
DROP POLICY IF EXISTS "auth_all_qc_results" ON qc_results;
CREATE POLICY "auth_all_qc_results" ON qc_results FOR ALL TO authenticated
  USING (is_company_member(company_id)) WITH CHECK (is_company_member(company_id));
