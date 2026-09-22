/*
# Referring Doctor Portal

## Purpose
Gives a referring doctor a single bookmarkable link to see their own
patients' finalized reports and their own commission statement, instead
of calling reception for either. Reuses the same token + SECURITY
DEFINER pattern as get_public_report() (migration 0028) rather than
building a parallel login system: the function only ever returns data
scoped to the one doctor matching the token, and there is no table
policy that would let anon list or browse other doctors' data.

## Changes
- doctors.portal_token: persistent (not per-report), nullable, unique.
- get_doctor_portal_data(token): returns doctor info, their patients'
  finalized reports (auto-generating each report's own share token as
  needed, since the anon caller can't do that write itself under RLS),
  and their commission settlement summary.
*/

DO $$ BEGIN
  ALTER TABLE doctors ADD COLUMN IF NOT EXISTS portal_token uuid UNIQUE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE OR REPLACE FUNCTION get_doctor_portal_data(p_token uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor_id uuid;
  result json;
BEGIN
  SELECT id INTO v_doctor_id FROM doctors WHERE portal_token = p_token;
  IF v_doctor_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Backfill a share token for any of this doctor's reports that don't
  -- have one yet, so the portal can link straight to them.
  UPDATE lab_orders
  SET public_token = gen_random_uuid()
  WHERE doctor_id = v_doctor_id AND public_token IS NULL
    AND EXISTS (SELECT 1 FROM lab_order_items loi WHERE loi.lab_order_id = lab_orders.id AND loi.status IN ('approved', 'printed'));

  SELECT json_build_object(
    'doctor', json_build_object('full_name', d.full_name, 'specialization', d.specialization),
    'reports', (
      SELECT COALESCE(json_agg(json_build_object(
        'order_code', lo.order_code,
        'created_at', lo.created_at,
        'patient_name', p.full_name,
        'public_token', lo.public_token
      ) ORDER BY lo.created_at DESC), '[]'::json)
      FROM lab_orders lo
      JOIN patients p ON p.id = lo.patient_id
      WHERE lo.doctor_id = v_doctor_id AND lo.public_token IS NOT NULL
      LIMIT 100
    ),
    'commission', (
      SELECT json_build_object(
        'total', COALESCE(SUM(ds.share_amount), 0),
        'settled', COALESCE(SUM(ds.share_amount) FILTER (WHERE ds.settled), 0),
        'unsettled', COALESCE(SUM(ds.share_amount) FILTER (WHERE NOT ds.settled), 0),
        'recent', (
          SELECT COALESCE(json_agg(json_build_object(
            'service_name', ds2.service_name, 'share_amount', ds2.share_amount,
            'settled', ds2.settled, 'created_at', ds2.created_at, 'doctor_type', ds2.doctor_type
          ) ORDER BY ds2.created_at DESC), '[]'::json)
          FROM (SELECT * FROM doctor_settlements WHERE doctor_id = v_doctor_id ORDER BY created_at DESC LIMIT 20) ds2
        )
      )
      FROM doctor_settlements ds WHERE ds.doctor_id = v_doctor_id
    )
  ) INTO result
  FROM doctors d WHERE d.id = v_doctor_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION get_doctor_portal_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_doctor_portal_data(uuid) TO anon, authenticated;
