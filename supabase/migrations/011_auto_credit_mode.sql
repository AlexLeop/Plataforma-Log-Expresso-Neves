-- ============================================================
-- MIGRAÇÃO 011: Modo de Auto-Crédito (Garantida vs Produção)
-- ============================================================

ALTER TABLE company_configs
  ADD COLUMN IF NOT EXISTS auto_credit_mode TEXT DEFAULT 'garantida'
  CHECK (auto_credit_mode IN ('garantida', 'producao'));

COMMENT ON COLUMN company_configs.auto_credit_mode IS 'Define a regra do auto-crédito: garantida (abate a produção) ou producao (deposita integral)';
