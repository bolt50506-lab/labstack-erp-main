/*
# Inventory Batch & Expiry Tracking

## Purpose
inventory_items.current_stock is a single aggregate number, and
goods_receipt_items already captures batch_number/expiry_date per
receipt — but nothing tracks remaining quantity per batch afterward, and
nothing alerts before a reagent expires. For a lab specifically (not a
generic warehouse), an expired reagent silently still counted as
available stock is a patient-safety issue, not just a stock nuisance.

## Changes
- inventory_batches: one row per batch received, quantity_remaining
  tracked separately from the item's aggregate current_stock so expiry
  can be reported on without changing how existing stock updates work.
*/

CREATE TABLE IF NOT EXISTS inventory_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  grn_id uuid REFERENCES goods_receipt_notes(id) ON DELETE SET NULL,
  batch_number text,
  expiry_date date,
  quantity_received numeric NOT NULL DEFAULT 0,
  quantity_remaining numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_item ON inventory_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_expiry ON inventory_batches(company_id, expiry_date) WHERE expiry_date IS NOT NULL;

ALTER TABLE inventory_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_inventory_batches" ON inventory_batches;
CREATE POLICY "auth_all_inventory_batches" ON inventory_batches FOR ALL TO authenticated
  USING (is_company_member(company_id)) WITH CHECK (is_company_member(company_id));
