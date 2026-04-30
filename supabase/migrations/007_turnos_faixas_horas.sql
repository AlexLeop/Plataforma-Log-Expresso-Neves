-- ============================================================
-- MIGRAÇÃO 007: Turnos JSONB + Faixas de Horas + pg_cron URL
-- ============================================================
--
-- 1. Adiciona coluna turnos_config (JSONB) para persistir turnos
-- 2. Adiciona coluna faixas_horas_config (JSONB) para garantido por horas
-- 3. Expande o CHECK de report_type para incluir 'garantida_horas'
-- 4. Atualiza a função pg_cron com a URL real de produção
-- ============================================================

-- ============================================================
-- 1. TURNOS (JSONB) — persistir configuração de turnos fracionados
-- ============================================================
-- Estrutura esperada:
-- [
--   {
--     "id": "t1",
--     "nome": "Turno 1",
--     "startTime": "10:00",
--     "endTime": "16:00",
--     "diaria": { "weekday": 60, "saturday": 70, "sunday": 80, "holiday": 80 }
--   }
-- ]
ALTER TABLE company_configs
  ADD COLUMN IF NOT EXISTS turnos_config JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN company_configs.turnos_config IS 'Array JSON de turnos fracionados com horários e diárias por turno';

-- ============================================================
-- 2. FAIXAS DE HORAS — garantido escalonado por tempo trabalhado
-- ============================================================
-- Estrutura esperada:
-- [
--   { "id": "faixa_4h", "label": "4 horas", "horasMinimas": 0, "horasMaximas": 4, "valor": 110 },
--   { "id": "faixa_6h", "label": "6 horas", "horasMinimas": 4, "horasMaximas": 6, "valor": 130 },
--   { "id": "faixa_10h", "label": "Madrugada", "horasMinimas": 6, "horasMaximas": 24, "valor": 150 }
-- ]
ALTER TABLE company_configs
  ADD COLUMN IF NOT EXISTS faixas_horas_config JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN company_configs.faixas_horas_config IS 'Array JSON de faixas de garantido mínimo por horas trabalhadas (modo garantida_horas)';

-- ============================================================
-- 3. Expandir CHECK de report_type para incluir 'garantida_horas'
-- ============================================================

-- Remover constraint antigo (se existir)
DO $$
BEGIN
  ALTER TABLE company_configs DROP CONSTRAINT IF EXISTS company_configs_report_type_check;
EXCEPTION WHEN OTHERS THEN
  NULL; -- ignora se não existe
END;
$$;

-- Criar novo constraint incluindo 'garantida_horas'
ALTER TABLE company_configs
  ADD CONSTRAINT company_configs_report_type_check
  CHECK (report_type IN ('producao', 'garantida', 'garantida_horas'));

-- ============================================================
-- 4. Atualizar pg_cron: URL real da produção
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_auto_credit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  app_url TEXT := 'https://meupainel.expressoneves.com';
  cron_secret TEXT := 'cron_neves_2026_f8a3b91e7d4c';
BEGIN
  PERFORM net.http_get(
    url := app_url || '/api/cron/auto-credit',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'Content-Type', 'application/json'
    )
  );
END;
$$;

-- Garantir que o job existe (caso a migration 005 não tenha sido executada)
-- Se já existir, este SELECT vai falhar silenciosamente
DO $$
BEGIN
  PERFORM cron.schedule(
    'auto-credit-hourly',
    '0 * * * *',
    'SELECT trigger_auto_credit()'
  );
EXCEPTION WHEN OTHERS THEN
  -- Job já existe, atualizar apenas
  UPDATE cron.job
    SET command = 'SELECT trigger_auto_credit()'
    WHERE jobname = 'auto-credit-hourly';
END;
$$;
