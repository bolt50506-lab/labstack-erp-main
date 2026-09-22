/*
# Pathology Report Entry Improvements

## Purpose
Support proper pathology report entry: an explicit report format per
service (replacing name-keyword guessing), structured storage for
Culture/Sensitivity and Biopsy reports (the current text-flattening
loses data on reopen), and confirms test_parameters (already present
since migration 0015) is the place reference values/parameters are
defined per service.

## Changes
1. services: add report_format ('routine' | 'culture' | 'biopsy')
2. lab_results: add structured_data jsonb, for format-specific fields
   that don't fit the single result_value/remarks text columns
*/

DO $$ BEGIN
  ALTER TABLE services ADD COLUMN IF NOT EXISTS report_format text NOT NULL DEFAULT 'routine'
    CHECK (report_format IN ('routine', 'culture', 'biopsy'));
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS structured_data jsonb;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
