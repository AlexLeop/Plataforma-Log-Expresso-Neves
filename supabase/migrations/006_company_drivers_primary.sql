-- ============================================================
-- MIGRAÇÃO 006: Adicionar flag is_primary em company_drivers
-- Permite marcar qual é a loja prioritária de cada motoboy
-- ============================================================

ALTER TABLE company_drivers
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN company_drivers.is_primary IS 'Se true, esta é a loja prioritária/principal do motoboy';

-- Índice para buscar a loja prioritária de um motoboy rapidamente
CREATE INDEX IF NOT EXISTS idx_company_drivers_primary
  ON company_drivers (driver_id) WHERE is_primary = true;

-- Policy: Permitir que operadores/managers da loja façam INSERT/UPDATE/DELETE
-- (preparado para quando lojista puder gerenciar associações)
CREATE POLICY "company_drivers_company_insert" ON company_drivers FOR INSERT
  WITH CHECK (
    company_id = get_user_company_id()
    AND get_user_role() IN ('admin', 'operator', 'manager')
  );

CREATE POLICY "company_drivers_company_update" ON company_drivers FOR UPDATE
  USING (
    company_id = get_user_company_id()
    AND get_user_role() IN ('admin', 'operator', 'manager')
  );

CREATE POLICY "company_drivers_company_delete" ON company_drivers FOR DELETE
  USING (
    company_id = get_user_company_id()
    AND get_user_role() IN ('admin', 'operator', 'manager')
  );
