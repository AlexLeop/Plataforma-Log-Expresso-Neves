-- ============================================================
-- MIGRAÇÃO 008: Fix credit_status CHECK constraint
-- ============================================================
-- O auto-credit endpoint usa 'processing' como status intermediário
-- para evitar processamento duplicado, mas o CHECK constraint
-- não incluía esse valor.
-- ============================================================

ALTER TABLE manual_entries DROP CONSTRAINT IF EXISTS manual_entries_credit_status_check;
ALTER TABLE manual_entries ADD CONSTRAINT manual_entries_credit_status_check 
  CHECK (credit_status = ANY (ARRAY['pending', 'processing', 'credited', 'failed', 'skipped']));
