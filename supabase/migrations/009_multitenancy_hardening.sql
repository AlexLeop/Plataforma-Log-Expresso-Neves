-- ============================================================
-- MIGRAÇÃO 009: Multi-Tenancy Hardening
-- Garante RLS + policies em todas as tabelas criadas fora das
-- migrations (ride_cache, system_settings, setup_tasks)
-- Adiciona policies para role 'manager' (lojistas onboarding)
-- ============================================================

-- ============================================================
-- 1. RLS COMPULSÓRIO em tabelas criadas via Dashboard/Edge
-- ============================================================

ALTER TABLE IF EXISTS ride_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS setup_tasks ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. POLICIES: ride_cache (status de corridas em tempo real)
-- ============================================================

-- Drop existing policies if any (idempotent)
DROP POLICY IF EXISTS "ride_cache_admin_all" ON ride_cache;
DROP POLICY IF EXISTS "ride_cache_company_read" ON ride_cache;

CREATE POLICY "ride_cache_admin_all" ON ride_cache FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "ride_cache_company_read" ON ride_cache FOR SELECT
  USING (company_id = get_user_company_id());

-- ============================================================
-- 3. POLICIES: system_settings (configurações globais)
--    Leitura: qualquer autenticado (configurações compartilhadas)
--    Escrita: apenas admin
-- ============================================================

DROP POLICY IF EXISTS "system_settings_read" ON system_settings;
DROP POLICY IF EXISTS "system_settings_admin_write" ON system_settings;

CREATE POLICY "system_settings_read" ON system_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "system_settings_admin_all" ON system_settings FOR ALL
  USING (get_user_role() = 'admin');

-- ============================================================
-- 4. POLICIES: setup_tasks (tarefas de onboarding)
--    Admin: CRUD completo
--    Manager/Lojista: leitura da própria empresa
-- ============================================================

DROP POLICY IF EXISTS "setup_tasks_admin_all" ON setup_tasks;
DROP POLICY IF EXISTS "setup_tasks_company_read" ON setup_tasks;

CREATE POLICY "setup_tasks_admin_all" ON setup_tasks FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "setup_tasks_company_read" ON setup_tasks FOR SELECT
  USING (company_id = get_user_company_id());

-- ============================================================
-- 5. POLICIES: manager role CAN update company_configs
-- ============================================================

DROP POLICY IF EXISTS "configs_manager_update" ON company_configs;

CREATE POLICY "configs_manager_update" ON company_configs FOR UPDATE
  USING (company_id = get_user_company_id() AND get_user_role() = 'manager')
  WITH CHECK (company_id = get_user_company_id());

-- ============================================================
-- 6. POLICIES: manager role CAN CRUD manual_entries (own company)
-- ============================================================

DROP POLICY IF EXISTS "entries_manager_insert" ON manual_entries;
DROP POLICY IF EXISTS "entries_manager_update" ON manual_entries;
DROP POLICY IF EXISTS "entries_manager_delete" ON manual_entries;
DROP POLICY IF EXISTS "entries_manager_read" ON manual_entries;

CREATE POLICY "entries_manager_read" ON manual_entries FOR SELECT
  USING (company_id = get_user_company_id() AND get_user_role() = 'manager');

CREATE POLICY "entries_manager_insert" ON manual_entries FOR INSERT
  WITH CHECK (company_id = get_user_company_id() AND get_user_role() = 'manager');

CREATE POLICY "entries_manager_update" ON manual_entries FOR UPDATE
  USING (company_id = get_user_company_id() AND get_user_role() = 'manager');

CREATE POLICY "entries_manager_delete" ON manual_entries FOR DELETE
  USING (company_id = get_user_company_id() AND get_user_role() = 'manager');

-- ============================================================
-- 7. POLICIES: manager role CAN read rides, drivers, snapshots
-- ============================================================

DROP POLICY IF EXISTS "rides_manager_read" ON rides;
CREATE POLICY "rides_manager_read" ON rides FOR SELECT
  USING (company_id = get_user_company_id() AND get_user_role() = 'manager');

DROP POLICY IF EXISTS "drivers_manager_read" ON drivers;
CREATE POLICY "drivers_manager_read" ON drivers FOR SELECT
  USING (
    get_user_role() = 'manager' AND
    EXISTS (
      SELECT 1 FROM company_drivers cd
      WHERE cd.driver_id = drivers.id
      AND cd.company_id = get_user_company_id()
    )
  );

DROP POLICY IF EXISTS "company_drivers_manager_read" ON company_drivers;
CREATE POLICY "company_drivers_manager_read" ON company_drivers FOR SELECT
  USING (company_id = get_user_company_id() AND get_user_role() = 'manager');

DROP POLICY IF EXISTS "snapshots_manager_read" ON financial_snapshots;
CREATE POLICY "snapshots_manager_read" ON financial_snapshots FOR SELECT
  USING (company_id = get_user_company_id() AND get_user_role() = 'manager');

DROP POLICY IF EXISTS "line_items_manager_read" ON financial_line_items;
CREATE POLICY "line_items_manager_read" ON financial_line_items FOR SELECT
  USING (company_id = get_user_company_id() AND get_user_role() = 'manager');

DROP POLICY IF EXISTS "credit_log_manager_read" ON credit_log;
CREATE POLICY "credit_log_manager_read" ON credit_log FOR SELECT
  USING (company_id = get_user_company_id() AND get_user_role() = 'manager');

DROP POLICY IF EXISTS "positions_manager_read" ON driver_positions;
CREATE POLICY "positions_manager_read" ON driver_positions FOR SELECT
  USING (company_id = get_user_company_id() AND get_user_role() = 'manager');

DROP POLICY IF EXISTS "rates_manager_read" ON driver_default_rates;
CREATE POLICY "rates_manager_read" ON driver_default_rates FOR SELECT
  USING (company_id = get_user_company_id() AND get_user_role() = 'manager');

DROP POLICY IF EXISTS "sync_logs_manager_read" ON sync_logs;
CREATE POLICY "sync_logs_manager_read" ON sync_logs FOR SELECT
  USING (company_id = get_user_company_id() AND get_user_role() = 'manager');

-- ============================================================
-- DONE: All tables hardened for multi-tenancy
-- ============================================================
