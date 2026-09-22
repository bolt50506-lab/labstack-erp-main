/*
# Merged Patient Entry Support

## Purpose
Support a single combined patient registration + test ordering + billing
screen: per-line-item consultant/performing doctor and report time,
order-level referral/remarks/patient-type fields, and atomic (race-free)
code generation for patient and order codes to replace the client-side
Date.now()/count-based codes currently used in app/patients/new,
app/reception/register, and app/reception/billing.

## Changes
1. lab_order_items: add consultant_doctor_id, performing_doctor_id,
   report_due_at, discount_amount, is_urgent
2. lab_orders: add ref_no, internal_remarks, patient_comments,
   restrict_final_report, patient_type
3. code_sequences table + next_code() SECURITY DEFINER function for
   atomic per-company/branch sequential codes (patient, order)

## Security
- next_code() checks is_company_member(p_company_id) before issuing a
  code, same pattern as existing helper functions; EXECUTE is not
  granted broadly to anon.
*/

-- ============================================================
-- 1. lab_order_items: per-line doctor roles + report time
-- ============================================================

DO $$ BEGIN
  ALTER TABLE lab_order_items ADD COLUMN IF NOT EXISTS consultant_doctor_id uuid REFERENCES doctors(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE lab_order_items ADD COLUMN IF NOT EXISTS performing_doctor_id uuid REFERENCES doctors(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE lab_order_items ADD COLUMN IF NOT EXISTS report_due_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE lab_order_items ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE lab_order_items ADD COLUMN IF NOT EXISTS is_urgent boolean NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_lab_order_items_consultant ON lab_order_items(consultant_doctor_id);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_performing ON lab_order_items(performing_doctor_id);

-- ============================================================
-- 2. lab_orders: order-level fields from the merged screen
-- ============================================================

DO $$ BEGIN
  ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS ref_no text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS internal_remarks text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS patient_comments text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS restrict_final_report boolean NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS patient_type text NOT NULL DEFAULT 'regular';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================================
-- 3. Atomic code generation (fixes client-side race condition
--    in patients/new, reception/register, reception/billing)
-- ============================================================

CREATE TABLE IF NOT EXISTS code_sequences (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  seq_type text NOT NULL,
  current_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, branch_id, seq_type)
);

ALTER TABLE code_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "no_direct_access_code_sequences" ON code_sequences;
CREATE POLICY "no_direct_access_code_sequences" ON code_sequences
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION next_code(
  p_company_id uuid,
  p_branch_id uuid,
  p_seq_type text,
  p_prefix text,
  p_pad integer DEFAULT 6
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_val integer;
BEGIN
  IF NOT is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'not a member of this company';
  END IF;

  INSERT INTO code_sequences (company_id, branch_id, seq_type, current_value)
  VALUES (p_company_id, COALESCE(p_branch_id, '00000000-0000-0000-0000-000000000000'), p_seq_type, 1)
  ON CONFLICT (company_id, branch_id, seq_type)
  DO UPDATE SET current_value = code_sequences.current_value + 1
  RETURNING current_value INTO v_val;

  RETURN p_prefix || LPAD(v_val::text, p_pad, '0');
END;
$$;

REVOKE ALL ON FUNCTION next_code(uuid, uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_code(uuid, uuid, text, text, integer) TO authenticated;
