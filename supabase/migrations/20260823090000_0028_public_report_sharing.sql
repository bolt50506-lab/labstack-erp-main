/*
# Public Report Sharing

## Purpose
Lets staff generate a shareable link for a finalized report (for
WhatsApp/email/SMS) without requiring the recipient to log in.

## Design
- lab_orders.public_token: nullable, unique, only set when a staff member
  explicitly shares a report (existing RLS already lets authenticated
  staff update their own company's orders, so no new write policy needed).
- get_public_report(token): SECURITY DEFINER function, NOT a table RLS
  policy. Anon can only call this function with a specific token and get
  back that one order's data; there is no way to list or enumerate other
  orders through it, unlike an RLS policy on the table would allow.
  Only approved/printed items are included, matching the same rule the
  internal print view already enforces.
*/

DO $$ BEGIN
  ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS public_token uuid UNIQUE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE OR REPLACE FUNCTION get_public_report(p_token uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'order', json_build_object(
      'id', lo.id, 'order_code', lo.order_code, 'created_at', lo.created_at
    ),
    'company', (SELECT json_build_object('name', c.name, 'address', c.address, 'city', c.city, 'phone', c.phone, 'email', c.email) FROM companies c WHERE c.id = lo.company_id),
    'patient', (SELECT json_build_object('full_name', p.full_name, 'patient_code', p.patient_code, 'gender', p.gender, 'age', p.age, 'phone', p.phone) FROM patients p WHERE p.id = lo.patient_id),
    'doctor', (SELECT json_build_object('full_name', d.full_name) FROM doctors d WHERE d.id = lo.doctor_id),
    'items', (
      SELECT COALESCE(json_agg(json_build_object(
        'service_name', loi.service_name,
        'category', s.category,
        'result_value', lr.result_value,
        'unit', lr.unit,
        'normal_range', lr.normal_range,
        'flag', lr.flag,
        'remarks', lr.remarks,
        'verifying_doctor', (SELECT vd.full_name FROM doctors vd WHERE vd.id = loi.verified_by_doctor_id)
      )), '[]'::json)
      FROM lab_order_items loi
      LEFT JOIN services s ON s.id = loi.service_id
      LEFT JOIN lab_results lr ON lr.lab_order_item_id = loi.id
      WHERE loi.lab_order_id = lo.id AND loi.status IN ('approved', 'printed')
    )
  ) INTO result
  FROM lab_orders lo
  WHERE lo.public_token = p_token;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION get_public_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_report(uuid) TO anon, authenticated;
