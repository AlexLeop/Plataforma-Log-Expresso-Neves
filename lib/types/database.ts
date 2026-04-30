// ============================================================
// Tipos do banco de dados (espelho do schema SQL)
// ============================================================

export interface Company {
  id: string;
  name: string;
  machine_empresa_id: string;
  address: string | null;
  active: boolean;
  last_sync_at: string | null;
  sync_status: 'pending' | 'syncing' | 'ok' | 'error';
  created_at: string;
  updated_at: string;
}

export interface CompanyConfig {
  id: string;
  company_id: string;
  ride_fee_per_delivery: number;
  minimum_rides_fee_floor: number;
  guaranteed_mode_enabled: boolean;
  notes: string | null;
  daily_rate_weekday?: number;
  daily_rate_saturday?: number;
  daily_rate_sunday?: number;
  daily_rate_holiday?: number;
  minimum_floor_percent?: number;
  extra_km_mode?: string;
  extra_km_min_distance?: number;
  extra_km_fixed_amount?: number;
  auto_credit_enabled?: boolean;
  auto_credit_cutoff_hour?: number;
  auto_credit_cutoff_minute?: number;
  auto_credit_description?: string;
  auto_credit_mode?: 'garantida' | 'producao';
  webhook_url?: string;
  updated_at: string;
}

export interface Driver {
  id: string;
  machine_condutor_id: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  pix_key: string | null;
  bank_info: string | null;
  status: 'active' | 'inactive' | 'blocked';
  raw_data: Record<string, unknown> | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyDriver {
  id: string;
  company_id: string;
  driver_id: string;
  active: boolean;
  created_at: string;
}

export interface User {
  id: string;
  company_id: string | null;
  email: string;
  full_name: string | null;
  role: 'admin' | 'operator' | 'manager' | 'viewer';
  created_at: string;
  updated_at: string;
}

export type RideStatus = 'P' | 'A' | 'I' | 'C' | 'F' | 'X';

export interface Ride {
  id: string;
  company_id: string;
  driver_id: string | null;
  machine_ride_id: string;
  machine_condutor_id: string | null;
  status: RideStatus;
  payment_type: string | null;
  fare_value: number;
  stop_count: number;
  requested_at: string | null;
  finished_at: string | null;
  ride_date: string;
  raw_data: Record<string, unknown> | null;
  synced_at: string;
  created_at: string;
}

export type EntryType = 'daily_rate' | 'extra' | 'mission' | 'advance';

export interface ManualEntry {
  id: string;
  company_id: string;
  driver_id: string;
  entry_date: string;
  entry_type: EntryType;
  amount: number;
  description: string | null;
  source: 'manual' | 'machine';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DriverDefaultRate {
  id: string;
  driver_id: string;
  company_id: string;
  day_of_week: 'seg' | 'ter' | 'qua' | 'qui' | 'sex';
  default_daily_rate: number;
  created_at: string;
  updated_at: string;
}

export type SnapshotStatus = 'draft' | 'processing' | 'finalized' | 'locked';

export interface FinancialSnapshot {
  id: string;
  company_id: string;
  period_start: string;
  period_end: string;
  status: SnapshotStatus;
  total_net_producao: number;
  total_logistics_producao: number;
  total_net_garantida: number;
  total_logistics_garantida: number;
  total_daily_rates: number;
  total_production: number;
  total_excess: number;
  total_extras: number;
  total_rides_fee: number;
  total_rides_fee_applied: number;
  total_floor_complement: number;
  total_advances: number;
  summary_data: Record<string, unknown> | null;
  calculated_at: string | null;
  finalized_at: string | null;
  locked_at: string | null;
  created_at: string;
}

export interface FinancialLineItem {
  id: string;
  snapshot_id: string;
  company_id: string;
  driver_id: string;
  work_date: string;
  total_rides: number;
  production_value: number;
  rides_breakdown: Record<string, number>;
  daily_rate: number;
  extras: number;
  guaranteed_payout: number;
  excess_value: number;
  rides_fee: number;
  advances: number;
  net_total_producao: number;
  net_total_garantida: number;
  calculation_details: Record<string, unknown> | null;
  created_at: string;
}

export interface SystemConfig {
  id: string;
  config_key: string;
  config_value: unknown;
  description: string | null;
  updated_at: string;
}

export interface SyncLog {
  id: string;
  company_id: string | null;
  sync_type: 'polling' | 'webhook' | 'backfill' | 'manual' | 'drivers';
  status: 'started' | 'success' | 'partial' | 'failed';
  records_fetched: number;
  records_upserted: number;
  records_skipped: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}
