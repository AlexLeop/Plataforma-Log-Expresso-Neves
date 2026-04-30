-- ============================================================
-- MIGRAÇÃO 003: Alinhar schema com a aplicação atual
-- Corrige: campos faltantes, status de rides, policies RLS
-- ============================================================

-- ============================================================
-- 1. CAMPOS FALTANTES EM company_configs
-- ============================================================

-- Taxa de supervisão (% sobre logística, definida pela central)
ALTER TABLE company_configs
  ADD COLUMN IF NOT EXISTS taxa_supervisao NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Débito pendente lançado pela central (R$)
ALTER TABLE company_configs
  ADD COLUMN IF NOT EXISTS debito_pendente NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Configurações do relatório (definidas pela central por loja)
ALTER TABLE company_configs
  ADD COLUMN IF NOT EXISTS report_type TEXT NOT NULL DEFAULT 'producao'
    CHECK (report_type IN ('producao', 'garantida')),
  ADD COLUMN IF NOT EXISTS include_taxa_corridas BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_diaria BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_tx_corridas BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_entregas BOOLEAN NOT NULL DEFAULT true;

-- Comentários
COMMENT ON COLUMN company_configs.taxa_supervisao IS 'Valor fixo (R$) da taxa de supervisão definida pela central';
COMMENT ON COLUMN company_configs.debito_pendente IS 'Valor de débito pendente lançado pela central para a loja (R$)';
COMMENT ON COLUMN company_configs.report_type IS 'Modo do relatório: producao (Padrão) ou garantida (Mínima)';
COMMENT ON COLUMN company_configs.include_taxa_corridas IS 'Incluir taxa de corridas no relatório';
COMMENT ON COLUMN company_configs.show_diaria IS 'Mostrar coluna diária no relatório (modo garantida)';
COMMENT ON COLUMN company_configs.show_tx_corridas IS 'Mostrar coluna TX corridas no relatório (modo garantida)';
COMMENT ON COLUMN company_configs.show_entregas IS 'Mostrar entregas por dia no relatório (modo garantida)';


-- ============================================================
-- 2. EXPANDIR STATUS EM rides
-- Remove o CHECK antigo e adiciona todos os status da Machine API
-- ============================================================

ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_status_check;
ALTER TABLE rides ADD CONSTRAINT rides_status_check
  CHECK (status IN (
    'D', -- Distribuindo
    'G', -- Aguardando Aceite
    'P', -- Buscando Condutor (Pendente)
    'N', -- Não Atendida
    'A', -- Aceita
    'E', -- Em Andamento
    'F', -- Finalizada
    'C', -- Cancelada
    'S', -- Em Espera
    'U', -- Agrupada
    'I', -- Iniciada (legado)
    'X'  -- Expirada (legado)
  ));


-- ============================================================
-- 3. CORRIGIR POLICIES RLS COM NOMES ÚNICOS
-- PostgreSQL exige nomes de policy únicos por tabela,
-- mas é boa prática usar nomes descritivos e únicos globais
-- ============================================================

-- 3.1 companies
DROP POLICY IF EXISTS "admin_all" ON companies;
DROP POLICY IF EXISTS "company_read" ON companies;
CREATE POLICY "companies_admin_all" ON companies FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "companies_own_read" ON companies FOR SELECT
  USING (id = get_user_company_id());

-- 3.2 company_configs
DROP POLICY IF EXISTS "admin_all" ON company_configs;
DROP POLICY IF EXISTS "company_read" ON company_configs;
CREATE POLICY "configs_admin_all" ON company_configs FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "configs_own_read" ON company_configs FOR SELECT
  USING (company_id = get_user_company_id());

-- 3.3 drivers
DROP POLICY IF EXISTS "admin_all" ON drivers;
DROP POLICY IF EXISTS "company_drivers_read" ON drivers;
CREATE POLICY "drivers_admin_all" ON drivers FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "drivers_company_read" ON drivers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_drivers cd
      WHERE cd.driver_id = drivers.id
      AND cd.company_id = get_user_company_id()
    )
  );

-- 3.4 company_drivers
DROP POLICY IF EXISTS "admin_all" ON company_drivers;
DROP POLICY IF EXISTS "company_read" ON company_drivers;
CREATE POLICY "company_drivers_admin_all" ON company_drivers FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "company_drivers_own_read" ON company_drivers FOR SELECT
  USING (company_id = get_user_company_id());

-- 3.5 users
DROP POLICY IF EXISTS "admin_all" ON users;
DROP POLICY IF EXISTS "self_read" ON users;
CREATE POLICY "users_admin_all" ON users FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "users_self_read" ON users FOR SELECT
  USING (id = auth.uid());

-- 3.6 rides
DROP POLICY IF EXISTS "admin_all" ON rides;
DROP POLICY IF EXISTS "company_read" ON rides;
CREATE POLICY "rides_admin_all" ON rides FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "rides_company_read" ON rides FOR SELECT
  USING (company_id = get_user_company_id());

-- 3.7 manual_entries
DROP POLICY IF EXISTS "admin_all" ON manual_entries;
DROP POLICY IF EXISTS "company_read" ON manual_entries;
DROP POLICY IF EXISTS "company_insert" ON manual_entries;
DROP POLICY IF EXISTS "company_update" ON manual_entries;
CREATE POLICY "entries_admin_all" ON manual_entries FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "entries_company_read" ON manual_entries FOR SELECT
  USING (company_id = get_user_company_id());
CREATE POLICY "entries_company_insert" ON manual_entries FOR INSERT
  WITH CHECK (
    company_id = get_user_company_id()
    AND get_user_role() IN ('admin', 'operator', 'manager')
  );
CREATE POLICY "entries_company_update" ON manual_entries FOR UPDATE
  USING (
    company_id = get_user_company_id()
    AND get_user_role() IN ('admin', 'operator', 'manager')
  );
CREATE POLICY "entries_company_delete" ON manual_entries FOR DELETE
  USING (
    company_id = get_user_company_id()
    AND get_user_role() IN ('admin', 'operator', 'manager')
  );

-- 3.8 driver_default_rates
DROP POLICY IF EXISTS "admin_all" ON driver_default_rates;
DROP POLICY IF EXISTS "company_read" ON driver_default_rates;
CREATE POLICY "rates_admin_all" ON driver_default_rates FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "rates_company_read" ON driver_default_rates FOR SELECT
  USING (company_id = get_user_company_id());

-- 3.9 financial_snapshots
DROP POLICY IF EXISTS "admin_all" ON financial_snapshots;
DROP POLICY IF EXISTS "company_read" ON financial_snapshots;
CREATE POLICY "snapshots_admin_all" ON financial_snapshots FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "snapshots_company_read" ON financial_snapshots FOR SELECT
  USING (company_id = get_user_company_id());

-- 3.10 financial_line_items
DROP POLICY IF EXISTS "admin_all" ON financial_line_items;
DROP POLICY IF EXISTS "company_read" ON financial_line_items;
CREATE POLICY "line_items_admin_all" ON financial_line_items FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "line_items_company_read" ON financial_line_items FOR SELECT
  USING (company_id = get_user_company_id());

-- 3.11 system_config
DROP POLICY IF EXISTS "authenticated_read" ON system_config;
DROP POLICY IF EXISTS "admin_write" ON system_config;
CREATE POLICY "sysconfig_authenticated_read" ON system_config FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "sysconfig_admin_write" ON system_config FOR INSERT
  WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "sysconfig_admin_update" ON system_config FOR UPDATE
  USING (get_user_role() = 'admin');
CREATE POLICY "sysconfig_admin_delete" ON system_config FOR DELETE
  USING (get_user_role() = 'admin');

-- 3.12 sync_logs
DROP POLICY IF EXISTS "admin_all" ON sync_logs;
DROP POLICY IF EXISTS "company_read" ON sync_logs;
CREATE POLICY "sync_logs_admin_all" ON sync_logs FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "sync_logs_company_read" ON sync_logs FOR SELECT
  USING (company_id = get_user_company_id());

-- 3.13 driver_positions
DROP POLICY IF EXISTS "admin_all" ON driver_positions;
DROP POLICY IF EXISTS "company_read" ON driver_positions;
CREATE POLICY "positions_admin_all" ON driver_positions FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "positions_company_read" ON driver_positions FOR SELECT
  USING (company_id = get_user_company_id());


-- ============================================================
-- 4. ÍNDICE ADICIONAL para company_configs por company_id
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_company_configs_company
  ON company_configs (company_id);


-- ============================================================
-- 5. ÍNDICE para rides por machine_condutor_id + data (reports)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_rides_condutor_date
  ON rides (machine_condutor_id, ride_date DESC)
  WHERE status = 'F';
