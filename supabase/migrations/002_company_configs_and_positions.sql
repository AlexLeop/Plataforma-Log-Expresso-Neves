-- ============================================================
-- MIGRAÇÃO 002: Expandir company_configs + tabela driver_positions
-- Adiciona campos para diárias diferenciadas, extras por km,
-- auto-crédito e webhook de posicionamento.
-- ============================================================

-- ============================================================
-- 1. EXPANDIR company_configs
--    Campos existentes: ride_fee_per_delivery, minimum_rides_fee_floor,
--    guaranteed_mode_enabled, notes
--    Novos: diarias, extras km, piso percentual, auto-crédito, webhook
-- ============================================================

-- Diárias por dia da semana (valores em R$)
ALTER TABLE company_configs
  ADD COLUMN IF NOT EXISTS daily_rate_weekday NUMERIC(10,2) NOT NULL DEFAULT 60.00,
  ADD COLUMN IF NOT EXISTS daily_rate_saturday NUMERIC(10,2) NOT NULL DEFAULT 70.00,
  ADD COLUMN IF NOT EXISTS daily_rate_sunday NUMERIC(10,2) NOT NULL DEFAULT 80.00,
  ADD COLUMN IF NOT EXISTS daily_rate_holiday NUMERIC(10,2) NOT NULL DEFAULT 80.00;

-- Piso percentual (% sobre total de logística, 0 = desativado)
ALTER TABLE company_configs
  ADD COLUMN IF NOT EXISTS minimum_floor_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

-- Extras por km excedente
ALTER TABLE company_configs
  ADD COLUMN IF NOT EXISTS extra_km_mode TEXT NOT NULL DEFAULT 'disabled'
    CHECK (extra_km_mode IN ('disabled', 'fixed', 'delivery_fee')),
  ADD COLUMN IF NOT EXISTS extra_km_min_distance NUMERIC(6,2) NOT NULL DEFAULT 6.00,
  ADD COLUMN IF NOT EXISTS extra_km_fixed_amount NUMERIC(10,2) NOT NULL DEFAULT 3.00;

-- Crédito automático de diárias
ALTER TABLE company_configs
  ADD COLUMN IF NOT EXISTS auto_credit_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_credit_cutoff_hour INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS auto_credit_cutoff_minute INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_credit_description TEXT NOT NULL DEFAULT 'Diária {date} - {company}';

-- Webhook URL para posicionamento
ALTER TABLE company_configs
  ADD COLUMN IF NOT EXISTS webhook_url TEXT;

-- Comentários explicativos
COMMENT ON COLUMN company_configs.daily_rate_weekday IS 'Valor padrão da diária Seg-Sex (R$)';
COMMENT ON COLUMN company_configs.daily_rate_saturday IS 'Valor padrão da diária Sábado (R$)';
COMMENT ON COLUMN company_configs.daily_rate_sunday IS 'Valor padrão da diária Domingo (R$)';
COMMENT ON COLUMN company_configs.daily_rate_holiday IS 'Valor padrão da diária Feriados (R$)';
COMMENT ON COLUMN company_configs.minimum_floor_percent IS 'Piso percentual sobre logística. 0 = desativado. Piso efetivo = max(fixo, percentual)';
COMMENT ON COLUMN company_configs.extra_km_mode IS 'disabled=sem extra, fixed=valor fixo por km excedente, delivery_fee=cobra taxa de entrega como extra';
COMMENT ON COLUMN company_configs.extra_km_min_distance IS 'Km mínimo para gerar extra (padrão: 6km)';
COMMENT ON COLUMN company_configs.extra_km_fixed_amount IS 'Valor fixo do extra (modo fixed, padrão: R$3)';
COMMENT ON COLUMN company_configs.auto_credit_enabled IS 'Ativa/desativa crédito automático na carteira Machine';
COMMENT ON COLUMN company_configs.auto_credit_cutoff_hour IS 'Hora de corte para processar auto-crédito (padrão: 6h)';
COMMENT ON COLUMN company_configs.auto_credit_cutoff_minute IS 'Minuto de corte (padrão: 0)';
COMMENT ON COLUMN company_configs.auto_credit_description IS 'Template da descrição do crédito. Variáveis: {date}, {company}';
COMMENT ON COLUMN company_configs.webhook_url IS 'URL pública para webhook de posição da Machine API';


-- ============================================================
-- 2. TABELA driver_positions (posições de motoboys via webhook)
-- ============================================================
CREATE TABLE IF NOT EXISTS driver_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  machine_condutor_id TEXT NOT NULL,
  machine_ride_id TEXT,
  latitude NUMERIC(10,7) NOT NULL,
  longitude NUMERIC(10,7) NOT NULL,
  speed NUMERIC(6,2),
  heading NUMERIC(5,2),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Índice para busca rápida: última posição por motorista
  CONSTRAINT uq_driver_latest_position UNIQUE (machine_condutor_id)
);

-- Sobrescreve a posição anterior a cada update (UPSERT ON CONFLICT)
COMMENT ON TABLE driver_positions IS 'Última posição conhecida de cada motoboy via webhook Machine (upsert)';

-- Índice para buscar posições por empresa
CREATE INDEX IF NOT EXISTS idx_driver_positions_company
  ON driver_positions (company_id);

-- Índice para buscar posições recentes (limpeza/TTL)
CREATE INDEX IF NOT EXISTS idx_driver_positions_received
  ON driver_positions (received_at DESC);


-- ============================================================
-- 3. TABELA driver_position_history (histórico de posições)
--    Descomentar se precisar rastrear rotas/trajetórias
-- ============================================================
-- CREATE TABLE IF NOT EXISTS driver_position_history (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
--   machine_condutor_id TEXT NOT NULL,
--   machine_ride_id TEXT,
--   latitude NUMERIC(10,7) NOT NULL,
--   longitude NUMERIC(10,7) NOT NULL,
--   speed NUMERIC(6,2),
--   heading NUMERIC(5,2),
--   received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- );
-- CREATE INDEX idx_position_history_driver_time
--   ON driver_position_history (machine_condutor_id, received_at DESC);


-- ============================================================
-- 4. RLS para driver_positions
-- ============================================================
ALTER TABLE driver_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all" ON driver_positions FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "company_read" ON driver_positions FOR SELECT
  USING (company_id = get_user_company_id());

-- Service role (cron/webhook) já tem bypass por ser service_role key


-- ============================================================
-- 5. Trigger updated_at para company_configs (já existe para a
--    tabela, mas garante que funciona com os novos campos)
-- ============================================================
-- O trigger trg_company_configs_updated_at já foi criado na 001_schema.sql
-- Não precisa recriar.


-- ============================================================
-- 6. Função para limpar posições antigas (> 5 min)
--    Pode ser chamada pelo cron ou por uma edge function
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_old_positions(max_age_minutes INTEGER DEFAULT 5)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM driver_positions
  WHERE received_at < NOW() - (max_age_minutes || ' minutes')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION cleanup_old_positions IS 'Remove posições mais antigas que N minutos. Padrão: 5 min.';
