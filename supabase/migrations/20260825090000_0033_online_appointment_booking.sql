/*
# Online Appointment Booking

## Purpose
The internal Appointments module (staff-facing, migration 0017) already
works well — what's missing is a way for a patient to actually request
an appointment without calling reception. This adds that, following the
same public-token-free, SECURITY-DEFINER-scoped pattern already used for
report sharing and the doctor portal, since appointment booking doesn't
need a persistent per-patient token — each submission is a one-time,
narrowly-scoped write.

## Changes
- appointments.source ('staff' | 'online'), appointments.confirmed:
  an online booking lands as unconfirmed until staff reviews it, so it
  can't silently double-book a slot or go unnoticed.
- book_appointment_public(): SECURITY DEFINER function. Finds an
  existing patient by phone within the given company, or creates a
  minimal one if none matches, then inserts the appointment. Returns
  only the confirmation details for THIS booking — never a list of
  other patients or appointments, so it can't be used to browse data.
*/

DO $$ BEGIN
  ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'online'));
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed boolean NOT NULL DEFAULT true;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE OR REPLACE FUNCTION book_appointment_public(
  p_company_id uuid,
  p_branch_id uuid,
  p_full_name text,
  p_phone text,
  p_doctor_id uuid,
  p_department_id uuid,
  p_appointment_date date,
  p_appointment_time time,
  p_reason text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patient_id uuid;
  v_patient_code text;
  v_appointment_id uuid;
  v_seq_val integer;
BEGIN
  IF p_full_name IS NULL OR trim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Name is required';
  END IF;
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RAISE EXCEPTION 'Phone number is required';
  END IF;
  IF p_appointment_date IS NULL OR p_appointment_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Please choose a valid, upcoming date';
  END IF;

  SELECT id, patient_code INTO v_patient_id, v_patient_code
  FROM patients
  WHERE company_id = p_company_id AND phone = p_phone
  LIMIT 1;

  IF v_patient_id IS NULL THEN
    INSERT INTO code_sequences (company_id, branch_id, seq_type, current_value)
    VALUES (p_company_id, COALESCE(p_branch_id, '00000000-0000-0000-0000-000000000000'), 'patient_online', 1)
    ON CONFLICT (company_id, branch_id, seq_type)
    DO UPDATE SET current_value = code_sequences.current_value + 1
    RETURNING current_value INTO v_seq_val;
    v_patient_code := 'OL-' || LPAD(v_seq_val::text, 6, '0');

    INSERT INTO patients (company_id, branch_id, patient_code, full_name, phone)
    VALUES (p_company_id, p_branch_id, v_patient_code, trim(p_full_name), p_phone)
    RETURNING id INTO v_patient_id;
  END IF;

  INSERT INTO appointments (company_id, branch_id, patient_id, doctor_id, department_id, appointment_date, appointment_time, status, type, reason, source, confirmed)
  VALUES (p_company_id, p_branch_id, v_patient_id, p_doctor_id, p_department_id, p_appointment_date, p_appointment_time, 'scheduled', 'new', p_reason, 'online', false)
  RETURNING id INTO v_appointment_id;

  RETURN json_build_object(
    'appointment_id', v_appointment_id,
    'patient_code', v_patient_code,
    'appointment_date', p_appointment_date,
    'appointment_time', p_appointment_time
  );
END;
$$;

REVOKE ALL ON FUNCTION book_appointment_public(uuid, uuid, text, text, uuid, uuid, date, time, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION book_appointment_public(uuid, uuid, text, text, uuid, uuid, date, time, text) TO anon, authenticated;
