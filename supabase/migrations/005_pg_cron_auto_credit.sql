-- ============================================================
-- MIGRAÇÃO 005: pg_cron + pg_net para Auto-Crédito Horário
-- ============================================================
-- 
-- Problema: Vercel Hobby não suporta cron a cada hora.
-- Solução: Supabase pg_cron agenda job a cada hora que chama
--          o endpoint /api/cron/auto-credit via pg_net (HTTP).
--          O endpoint filtra empresas pelo cutoff_hour de cada loja.
--
-- COMO FUNCIONA:
--   1. pg_cron dispara a cada hora (minuto 0)
--   2. pg_net faz GET para a URL da aplicação com o CRON_SECRET
--   3. O endpoint filtra empresas cujo cutoff_hour = hora atual BRT
--   4. Processa créditos via Machine API
--
-- IMPORTANTE: Substitua as variáveis abaixo antes de executar!
-- ============================================================

-- 1. Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Permissões
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- ============================================================
-- 2. Criar função que faz a chamada HTTP
-- ============================================================
-- 
-- ⚠️  SUBSTITUA os valores abaixo:
--     - URL: A URL da sua aplicação (ex: https://seu-app.vercel.app)
--     - CRON_SECRET: O mesmo valor de process.env.CRON_SECRET
-- 

CREATE OR REPLACE FUNCTION trigger_auto_credit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  app_url TEXT := 'https://SEU-APP.vercel.app';  -- ⚠️ SUBSTITUIR
  cron_secret TEXT := 'cron_neves_2026_f8a3b91e7d4c';  -- ⚠️ SUBSTITUIR se diferente
BEGIN
  -- Faz GET assíncrono para o endpoint de auto-crédito
  PERFORM net.http_get(
    url := app_url || '/api/cron/auto-credit',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'Content-Type', 'application/json'
    )
  );
END;
$$;

-- ============================================================
-- 3. Agendar job a cada hora (minuto 0)
-- ============================================================

SELECT cron.schedule(
  'auto-credit-hourly',        -- nome do job
  '0 * * * *',                 -- a cada hora, no minuto 0
  'SELECT trigger_auto_credit()'
);

-- ============================================================
-- 4. Verificar que foi criado
-- ============================================================
-- Rode estas queries para confirmar:
--
--   SELECT * FROM cron.job;
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--
-- Para remover o job se precisar:
--   SELECT cron.unschedule('auto-credit-hourly');
--
-- Para alterar o schedule:
--   SELECT cron.alter_job(
--     job_id := (SELECT jobid FROM cron.job WHERE jobname = 'auto-credit-hourly'),
--     new_schedule := '30 * * * *'  -- ex: minuto 30 de cada hora
--   );
-- ============================================================
