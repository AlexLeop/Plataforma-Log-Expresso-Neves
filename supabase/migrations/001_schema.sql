-- ============================================================
-- SCHEMA COMPLETO: Plataforma SaaS de Gestão Financeira Logística
-- Versão: 1.0 (Fase 1)
-- ============================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. COMPANIES (Empresas/Lojas — entidade principal)
-- ============================================================
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  machine_empresa_id TEXT NOT NULL UNIQUE,
  address TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'syncing', 'ok', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. COMPANY_CONFIGS (Configurações financeiras por empresa)
-- ============================================================
CREATE TABLE company_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ride_fee_per_delivery NUMERIC(10,2) NOT NULL DEFAULT 1.00,
  minimum_rides_fee_floor NUMERIC(10,2) NOT NULL DEFAULT 350.00,
  guaranteed_mode_enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(company_id)
);

-- ============================================================
-- 3. DRIVERS (Motoboys — sincronizados da Machine)
-- ============================================================
CREATE TABLE drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_condutor_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  cpf TEXT,
  phone TEXT,
  pix_key TEXT,
  bank_info TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'blocked')),
  raw_data JSONB,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. COMPANY_DRIVERS (Vínculo empresa ↔ motorista)
-- ============================================================
CREATE TABLE company_drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(company_id, driver_id)
);

-- ============================================================
-- 5. USERS (Usuários do painel — autenticação via Supabase Auth)
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('admin', 'operator', 'manager', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 6. RIDES (Corridas/Entregas — sincronizadas da Machine)
-- ============================================================
CREATE TABLE rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  machine_ride_id TEXT NOT NULL UNIQUE,
  machine_condutor_id TEXT,
  status TEXT NOT NULL DEFAULT 'P'
    CHECK (status IN ('P', 'A', 'I', 'C', 'F', 'X')),
  payment_type TEXT,
  fare_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  stop_count INTEGER NOT NULL DEFAULT 1,
  requested_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  ride_date DATE NOT NULL,
  raw_data JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Status: P=Pendente, A=Aceita, I=Iniciada, C=Cancelada, F=Finalizada, X=Expirada

-- ============================================================
-- 7. MANUAL_ENTRIES (Lançamentos manuais — diárias, extras, etc.)
-- ============================================================
CREATE TABLE manual_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('daily_rate', 'extra', 'mission', 'advance')),
  amount NUMERIC(10,2) NOT NULL,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'machine')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 8. DRIVER_DEFAULT_RATES (Diárias pré-configuráveis)
-- ============================================================
CREATE TABLE driver_default_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  day_of_week TEXT NOT NULL
    CHECK (day_of_week IN ('seg', 'ter', 'qua', 'qui', 'sex')),
  default_daily_rate NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(driver_id, company_id, day_of_week)
);

-- ============================================================
-- 9. FINANCIAL_SNAPSHOTS (Relatórios semanais)
-- ============================================================
CREATE TABLE financial_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'processing', 'finalized', 'locked')),

  -- Totais modo Produção
  total_net_producao NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_logistics_producao NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Totais modo Garantida
  total_net_garantida NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_logistics_garantida NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Totais compartilhados
  total_daily_rates NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_production NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_excess NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_extras NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_rides_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_rides_fee_applied NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_floor_complement NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_advances NUMERIC(10,2) NOT NULL DEFAULT 0,

  summary_data JSONB,
  calculated_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(company_id, period_start, period_end)
);

-- ============================================================
-- 10. FINANCIAL_LINE_ITEMS (Detalhamento por motorista/dia)
-- ============================================================
CREATE TABLE financial_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,

  total_rides INTEGER NOT NULL DEFAULT 0,
  production_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  rides_breakdown JSONB NOT NULL DEFAULT '{}',

  daily_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  extras NUMERIC(10,2) NOT NULL DEFAULT 0,
  guaranteed_payout NUMERIC(10,2) NOT NULL DEFAULT 0,
  excess_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  rides_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  advances NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Dois modos de cálculo
  net_total_producao NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_total_garantida NUMERIC(10,2) NOT NULL DEFAULT 0,

  calculation_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(snapshot_id, driver_id, work_date)
);

-- ============================================================
-- 11. SYSTEM_CONFIG (Configurações globais)
-- ============================================================
CREATE TABLE system_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT NOT NULL UNIQUE,
  config_value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed das configs iniciais
INSERT INTO system_config (config_key, config_value, description) VALUES
  ('week_start_day', '"seg"', 'Dia de início da semana financeira'),
  ('week_end_day', '"sex"', 'Dia de fim da semana financeira'),
  ('grace_period_hours', '24', 'Horas de carência após fim da semana para corridas atrasadas'),
  ('sync_batch_size', '5', 'Qtd de empresas por ciclo de polling'),
  ('sync_interval_minutes', '5', 'Intervalo entre ciclos de polling');

-- ============================================================
-- 12. SYNC_LOGS (Logs de sincronização)
-- ============================================================
CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL
    CHECK (sync_type IN ('polling', 'webhook', 'backfill', 'manual', 'drivers')),
  status TEXT NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'success', 'partial', 'failed')),
  records_fetched INTEGER NOT NULL DEFAULT 0,
  records_upserted INTEGER NOT NULL DEFAULT 0,
  records_skipped INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

-- ============================================================
-- ÍNDICES
-- ============================================================

-- Rides: busca por empresa + data (query mais frequente)
CREATE INDEX idx_rides_company_date ON rides (company_id, ride_date DESC)
  WHERE status = 'F';

-- Rides: busca por motorista + data
CREATE INDEX idx_rides_driver_date ON rides (driver_id, ride_date DESC);

-- Manual entries: busca por motorista + data + tipo
CREATE INDEX idx_manual_entries_driver_date
  ON manual_entries (driver_id, entry_date, entry_type);

-- Manual entries: busca por empresa + período
CREATE INDEX idx_manual_entries_company
  ON manual_entries (company_id, entry_date DESC);

-- Financial line items: busca por snapshot
CREATE INDEX idx_line_items_snapshot ON financial_line_items (snapshot_id);

-- Financial line items: busca por motorista + data
CREATE INDEX idx_line_items_driver_date
  ON financial_line_items (driver_id, work_date DESC);

-- Sync logs: último sync por empresa
CREATE INDEX idx_sync_logs_company ON sync_logs (company_id, started_at DESC);

-- Driver default rates: busca por motorista + empresa
CREATE INDEX idx_default_rates_driver
  ON driver_default_rates (driver_id, company_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_default_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- Helper function: get user role and company
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_company_id()
RETURNS UUID AS $$
  SELECT company_id FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- POLICY: Admin vê tudo, outros veem apenas sua empresa

-- Companies
CREATE POLICY "admin_all" ON companies FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "company_read" ON companies FOR SELECT
  USING (id = get_user_company_id());

-- Company configs
CREATE POLICY "admin_all" ON company_configs FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "company_read" ON company_configs FOR SELECT
  USING (company_id = get_user_company_id());

-- Drivers (via company_drivers join)
CREATE POLICY "admin_all" ON drivers FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "company_drivers_read" ON drivers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_drivers cd
      WHERE cd.driver_id = drivers.id
      AND cd.company_id = get_user_company_id()
    )
  );

-- Company drivers
CREATE POLICY "admin_all" ON company_drivers FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "company_read" ON company_drivers FOR SELECT
  USING (company_id = get_user_company_id());

-- Users
CREATE POLICY "admin_all" ON users FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "self_read" ON users FOR SELECT
  USING (id = auth.uid());

-- Rides
CREATE POLICY "admin_all" ON rides FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "company_read" ON rides FOR SELECT
  USING (company_id = get_user_company_id());

-- Manual entries
CREATE POLICY "admin_all" ON manual_entries FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "company_read" ON manual_entries FOR SELECT
  USING (company_id = get_user_company_id());
CREATE POLICY "company_insert" ON manual_entries FOR INSERT
  WITH CHECK (
    company_id = get_user_company_id()
    AND get_user_role() IN ('admin', 'operator', 'manager')
  );
CREATE POLICY "company_update" ON manual_entries FOR UPDATE
  USING (
    company_id = get_user_company_id()
    AND get_user_role() IN ('admin', 'operator', 'manager')
  );

-- Driver default rates
CREATE POLICY "admin_all" ON driver_default_rates FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "company_read" ON driver_default_rates FOR SELECT
  USING (company_id = get_user_company_id());

-- Financial snapshots
CREATE POLICY "admin_all" ON financial_snapshots FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "company_read" ON financial_snapshots FOR SELECT
  USING (company_id = get_user_company_id());

-- Financial line items
CREATE POLICY "admin_all" ON financial_line_items FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "company_read" ON financial_line_items FOR SELECT
  USING (company_id = get_user_company_id());

-- System config (read-only for all authenticated)
CREATE POLICY "authenticated_read" ON system_config FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin_write" ON system_config FOR ALL
  USING (get_user_role() = 'admin');

-- Sync logs
CREATE POLICY "admin_all" ON sync_logs FOR ALL
  USING (get_user_role() = 'admin');
CREATE POLICY "company_read" ON sync_logs FOR SELECT
  USING (company_id = get_user_company_id());

-- ============================================================
-- TRIGGER: Auto-vincular driver ↔ empresa ao inserir ride
-- ============================================================
CREATE OR REPLACE FUNCTION auto_link_driver_company()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.driver_id IS NOT NULL THEN
    INSERT INTO company_drivers (company_id, driver_id, active)
    VALUES (NEW.company_id, NEW.driver_id, true)
    ON CONFLICT (company_id, driver_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_link_driver
AFTER INSERT ON rides
FOR EACH ROW EXECUTE FUNCTION auto_link_driver_company();

-- ============================================================
-- TRIGGER: Atualizar updated_at automaticamente
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_drivers_updated_at BEFORE UPDATE ON drivers
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_manual_entries_updated_at BEFORE UPDATE ON manual_entries
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_company_configs_updated_at BEFORE UPDATE ON company_configs
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_default_rates_updated_at BEFORE UPDATE ON driver_default_rates
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
