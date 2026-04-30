export type {
  Company,
  CompanyConfig,
  Driver,
  CompanyDriver,
  User,
  RideStatus,
  Ride,
  EntryType,
  ManualEntry,
  DriverDefaultRate,
  SnapshotStatus,
  FinancialSnapshot,
  FinancialLineItem,
  SystemConfig,
  SyncLog,
} from './database';

// ============================================================
// Tipos da API Machine (Entregas)
// ============================================================

export interface MachineRideResponse {
  id?: number;
  solicitacao_id?: number;
  condutor_id?: number;
  taxista_id?: number;
  status_solicitacao?: string;
  status?: string;
  tipo_pagamento?: string;
  valor_corrida?: string | number;
  valor?: string | number;
  data_hora_solicitacao?: string;
  data_hora_finalizacao?: string;
  paradas?: MachineStop[];
  empresa_id?: number;
  [key: string]: unknown;
}

export interface MachineStop {
  endereco?: string;
  latitude?: number;
  longitude?: number;
  nome_cliente?: string;
  telefone_cliente?: string;
  [key: string]: unknown;
}

export interface MachineDriverResponse {
  id?: number;
  nome?: string;
  cpf?: string;
  telefone?: string;
  status?: string;
  [key: string]: unknown;
}

export interface MachinePaginatedResponse<T> {
  data: T[];
  total?: number;
  pagina?: number;
  limite?: number;
}

// ============================================================
// Tipos normalizados (output do Normalizer)
// ============================================================

export interface NormalizedRide {
  machine_ride_id: string;
  machine_condutor_id: string;
  status: string;
  payment_type: string;
  fare_value: number;
  stop_count: number;
  requested_at: string | null;
  finished_at: string | null;
  ride_date: string; // YYYY-MM-DD
  raw_data: Record<string, unknown>;
}

export interface NormalizedDriver {
  machine_condutor_id: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  status: string;
  raw_data: Record<string, unknown>;
}

// ============================================================
// Tipos da Engine de Cálculo
// ============================================================

export interface CalculationContext {
  company_id: string;
  period_start: Date;
  period_end: Date;
}

export interface LineItemCalculation {
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
  calculation_details: {
    fare_values: number[];
    extras: number;
  };
}

export interface SnapshotCalculation {
  company_id: string;
  period_start: string;
  period_end: string;
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
  line_items: LineItemCalculation[];
}
