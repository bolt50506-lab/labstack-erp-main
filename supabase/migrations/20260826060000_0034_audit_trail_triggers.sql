/*
# Audit Trail — Actually Populate It

## Purpose
audit_logs (migration 0001) and its viewer page (Settings → Audit Logs)
already existed, but nothing anywhere in the application ever inserted
into it — the trail has been permanently empty. Rather than adding a
manual insert call to dozens of existing pages (error-prone, easy to
miss one, and exactly the kind of duplication to avoid), this adds one
generic trigger function and attaches it to the tables that matter most
for accountability: who changed a patient, an app_user, a role, a
result, a settlement, a journal entry, or an invoice — and when.

## Design
- audit_trigger_fn(): generic AFTER INSERT/UPDATE/DELETE trigger.
  Captures old/new row as jsonb, the acting user via auth.uid(), and
  skips columns that would bloat the log pointlessly (none excluded by
  default — full row is small for these tables).
- Attached only to sensitive tables, not every table in the schema —
  logging every minor read-heavy table would make audit_logs noisy and
  expensive without adding real accountability value.
*/

CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record_id text;
BEGIN
  v_record_id := COALESCE((CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END)::text, NULL);

  INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, user_id)
  VALUES (
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    auth.uid()
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patients', 'app_users', 'roles', 'lab_results', 'lab_order_items',
    'doctor_settlements', 'referral_settlements', 'journal_entries',
    'lab_orders', 'payroll', 'chart_of_accounts', 'services'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_trg ON %I', t);
    EXECUTE format('CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn()', t);
  END LOOP;
END $$;
