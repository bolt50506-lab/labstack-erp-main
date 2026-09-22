/*
# Daily Sales Closing

## Purpose
Lets a receptionist close out a day's sales for a branch. Closing computes
totals from lab_orders + lab_order_payments for that date/branch and posts
one balanced journal entry against the Chart of Accounts (Cash / Card /
Online / Accounts Receivable debited, Sales Revenue credited), so daily
sales are properly reflected in accounting instead of only living in the
reception tables.

## New Tables
- day_closings: one row per company/branch/date, locked once closed,
  referencing the journal entry it produced.
*/

CREATE TABLE IF NOT EXISTS day_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  closing_date date NOT NULL,
  invoice_count integer NOT NULL DEFAULT 0,
  total_gross numeric NOT NULL DEFAULT 0,
  total_discount numeric NOT NULL DEFAULT 0,
  total_net numeric NOT NULL DEFAULT 0,
  total_cash numeric NOT NULL DEFAULT 0,
  total_card numeric NOT NULL DEFAULT 0,
  total_online numeric NOT NULL DEFAULT 0,
  total_receivable numeric NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  closed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_day_closings_unique ON day_closings(company_id, branch_id, closing_date);
CREATE INDEX IF NOT EXISTS idx_day_closings_date ON day_closings(closing_date);

ALTER TABLE day_closings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_day_closings" ON day_closings;
CREATE POLICY "auth_select_day_closings" ON day_closings FOR SELECT
  TO authenticated USING (is_company_member(company_id));
DROP POLICY IF EXISTS "auth_insert_day_closings" ON day_closings;
CREATE POLICY "auth_insert_day_closings" ON day_closings FOR INSERT
  TO authenticated WITH CHECK (is_company_member(company_id));
