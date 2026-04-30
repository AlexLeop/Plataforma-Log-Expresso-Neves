-- ============================================================
-- MIGRAÇÃO 004: Tabelas para credit_log e snapshot_drivers
-- Colunas de crédito em manual_entries
-- ============================================================

-- ============================================================
-- 1. COLUNAS DE CRÉDITO EM manual_entries
-- Rastrear status de crédito automático na carteira Machine
-- ============================================================

ALTER TABLE manual_entries
  ADD COLUMN IF NOT EXISTS credit_status TEXT DEFAULT 'pending'
    CHECK (credit_status IN ('pending', 'credited', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS credited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS credit_error TEXT,
  ADD COLUMN IF NOT EXISTS machine_transaction_id TEXT;

COMMENT ON COLUMN manual_entries.credit_status IS 'Status do crédito automático: pending, credited, failed, skipped';
COMMENT ON COLUMN manual_entries.credited_at IS 'Timestamp de quando o crédito foi processado';
COMMENT ON COLUMN manual_entries.credit_error IS 'Mensagem de erro se o crédito falhou';
COMMENT ON COLUMN manual_entries.machine_transaction_id IS 'ID da transação na Machine API';


-- ============================================================
-- 2. TABELA credit_log (histórico de créditos processados)
-- ============================================================

CREATE TABLE IF NOT EXISTS credit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  breakdown JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'failed', 'retry')),
  machine_response TEXT,
  error TEXT,
  processed_by TEXT NOT NULL DEFAULT 'manual'
    CHECK (processed_by IN ('cron', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_credit_log_company_date
  ON credit_log (company_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_credit_log_driver
  ON credit_log (driver_id, entry_date DESC);

-- RLS
ALTER TABLE credit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_log_admin_all" ON credit_log FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "credit_log_company_read" ON credit_log FOR SELECT
  USING (company_id = get_user_company_id());


-- ============================================================
-- 3. TABELA snapshot_drivers (detalhe por motoboy no snapshot)
-- ============================================================

CREATE TABLE IF NOT EXISTS snapshot_drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  driver_id TEXT NOT NULL,          -- machine_condutor_id
  driver_name TEXT NOT NULL,
  total_diaria NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_extras NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_taxa_corridas NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_adiantamentos NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_liquido NUMERIC(10,2) NOT NULL DEFAULT 0,
  entregas INTEGER NOT NULL DEFAULT 0,
  corridas INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice
CREATE INDEX IF NOT EXISTS idx_snapshot_drivers_snapshot
  ON snapshot_drivers (snapshot_id);

-- RLS
ALTER TABLE snapshot_drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshot_drivers_admin_all" ON snapshot_drivers FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "snapshot_drivers_company_read" ON snapshot_drivers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM financial_snapshots fs
      WHERE fs.id = snapshot_drivers.snapshot_id
      AND fs.company_id = get_user_company_id()
    )
  );


-- ============================================================
-- 4. AJUSTAR financial_snapshots para o modelo da aplicação
-- ============================================================

ALTER TABLE financial_snapshots
  ADD COLUMN IF NOT EXISTS week_label TEXT,
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN financial_snapshots.week_label IS 'Label formatado da semana: "24/03 – 30/03"';
COMMENT ON COLUMN financial_snapshots.company_name IS 'Nome da empresa no momento do snapshot';
COMMENT ON COLUMN financial_snapshots.notes IS 'Observações livres do gestor';


-- ============================================================
-- 5. ÍNDICE para manual_entries com credit_status
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_manual_entries_credit_pending
  ON manual_entries (company_id, entry_date)
  WHERE credit_status IN ('pending', 'failed');
