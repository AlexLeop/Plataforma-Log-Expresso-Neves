-- ============================================================
-- MIGRAÇÃO 010: Índices B-Tree para Performance sob RLS
--
-- PROBLEMA: Todas as RLS policies filtram por company_id.
-- Sem índices dedicados, o PostgreSQL faz Seq Scan em cada query.
-- Com 100K+ rows, isso causa degradação exponencial.
--
-- SOLUÇÃO: Índices B-Tree compostos nas colunas usadas por RLS.
-- Usa CONCURRENTLY para não bloquear reads durante criação.
-- ============================================================

-- 1. rides: O partial index existente (idx_rides_company_date) 
--    filtra WHERE status='F', excluindo corridas ativas do índice.
--    Este índice cobre TODAS as corridas para RLS.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rides_company_id
  ON rides (company_id);

-- 2. financial_snapshots: Sem índice company_id → SeqScan
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_financial_snapshots_company
  ON financial_snapshots (company_id, period_start DESC);

-- 3. financial_line_items: Tabela que cresce exponencialmente
--    (drivers × days × companies). Crítico para performance.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_financial_line_items_company
  ON financial_line_items (company_id);

-- 4. credit_queue: Criada fora das migrations, sem índice nenhum.
--    Usado pela Drip Queue (pg_cron) e pelo painel admin.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_queue_company_status
  ON credit_queue (company_id, status);

-- 5. credit_queue: Índice para o pg_cron processor que busca por status + next_retry_at
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_queue_pending
  ON credit_queue (status, next_retry_at)
  WHERE status IN ('pending', 'failed');

-- 6. setup_tasks: Índice para consultas admin filtradas por status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_setup_tasks_status
  ON setup_tasks (status, created_at DESC);

-- 7. company_drivers: O UNIQUE(company_id, driver_id) já cria um índice,
--    mas a RLS policy de drivers faz EXISTS subquery com (driver_id, company_id) — 
--    ordem invertida. Este índice otimiza a subquery.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_company_drivers_driver_company
  ON company_drivers (driver_id, company_id);

-- 8. users: A função get_user_company_id() faz SELECT by id (PK).
--    PK já é indexado. Mas a função get_user_role() também consulta por id.
--    Nenhum índice adicional necessário (coberto pelo PK).

-- 9. ride_cache: Índice para queries no painel de corridas ativas
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ride_cache_empresa
  ON ride_cache (machine_empresa_id);
