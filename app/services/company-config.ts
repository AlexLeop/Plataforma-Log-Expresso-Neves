/**
 * Company Config Store — Supabase-primary pattern
 * Primary: Supabase via /api/db/configs (source of truth)
 * Cache: localStorage (for instant reads + offline fallback)
 *
 * Reads use local cache. Writes go to Supabase + update cache.
 * pullConfigFromSupabase() syncs Supabase → local cache on mount.
 */

import { authFetch } from '@/app/lib/api-client';

export interface DiariaConfig {
  weekday: number;   // Seg-Sex (padrão)
  saturday: number;  // Sábado
  sunday: number;    // Domingo
  holiday: number;   // Feriados
}

export interface TurnoConfig {
  id: string;        // ID único (ex: 'almoco', 'jantar', 't1')
  nome: string;      // Nome visível (ex: 'Turno 1')
  startTime: string; // Hora início (ex: '10:00')
  endTime: string;   // Hora fim (ex: '16:59')
  diaria: DiariaConfig; // Valores da garantia MÍNIMA específicos deste turno
}

export interface ExtraKmConfig {
  mode: 'disabled' | 'fixed' | 'delivery_fee';
  minKm: number;        // km mínimo para extra (padrão: 6)
  fixedAmount: number;   // valor fixo do extra (modo 'fixed', padrão: 3)
}

export interface FaixaHorasConfig {
  id: string;            // Ex: 'faixa_4h'
  label: string;         // Ex: '4 horas'
  horasMinimas: number;  // Ex: 0
  horasMaximas: number;  // Ex: 4
  valor: number;         // Ex: 110
}

export interface AutoCreditConfig {
  enabled: boolean;          // ativar/desativar auto-crédito por loja
  cutoffHour: number;        // hora de corte (padrão: 6)
  cutoffMinute: number;      // minuto de corte (padrão: 0)
  creditDescription: string; // template: "Diária {date} - {company}"
  mode: 'garantida' | 'producao'; // Modo do Auto-crédito
}

export interface ReportConfig {
  reportType: 'producao' | 'garantida' | 'garantida_horas';  // Produção, Garantida Mínima, ou Garantida por Horas
  includeTaxaCorridas: boolean;
  showDiaria: boolean;
  showTxCorridas: boolean;
  showEntregas: boolean;
}

export interface CompanyConfig {
  companyId: number;
  companyName: string;
  taxaCorridaPerEntrega: number; // R$ por entrega (padrão: 1.60)
  pisoFixo: number;              // Piso mínimo fixo (padrão: 350)
  pisoPercentual: number;        // % sobre logística (0 = desativado)
  taxaSupervisao: number;        // R$ taxa de supervisão fixa (definida pela central)
  debitoPendente: number;        // R$ débito pendente (lançado pela central)
  diaria: DiariaConfig;
  turnos?: TurnoConfig[];        // Opcional: Turnos fracionados no dia
  faixasHoras?: FaixaHorasConfig[]; // Opcional: Faixas de garantido por horas (modo 'garantida_horas')
  extraKm: ExtraKmConfig;
  autoCredit: AutoCreditConfig;
  report: ReportConfig;
  dailyValue?: number;
}

const STORAGE_KEY = 'logipay:company_configs';

const DEFAULT_DIARIA: DiariaConfig = {
  weekday: 60,
  saturday: 70,
  sunday: 80,
  holiday: 80,
};

const DEFAULT_EXTRA_KM: ExtraKmConfig = {
  mode: 'disabled',
  minKm: 6,
  fixedAmount: 3,
};

const DEFAULT_AUTO_CREDIT: AutoCreditConfig = {
  enabled: false,
  cutoffHour: 6,
  cutoffMinute: 0,
  creditDescription: 'Diária {date} - {company}',
  mode: 'garantida',
};

const DEFAULT_REPORT: ReportConfig = {
  reportType: 'producao',
  includeTaxaCorridas: true,
  showDiaria: true,
  showTxCorridas: true,
  showEntregas: true,
};

const DEFAULTS: Omit<CompanyConfig, 'companyId' | 'companyName'> = {
  taxaCorridaPerEntrega: 1.60,
  pisoFixo: 350,
  pisoPercentual: 0,
  taxaSupervisao: 0,
  debitoPendente: 0,
  diaria: { ...DEFAULT_DIARIA },
  turnos: [], // Por padrão, loja não possui múltiplos turnos
  extraKm: { ...DEFAULT_EXTRA_KM },
  autoCredit: { ...DEFAULT_AUTO_CREDIT },
  report: { ...DEFAULT_REPORT },
};

// ============================================================
// Local Cache Layer
// ============================================================

function getAllConfigs(): CompanyConfig[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const configs: CompanyConfig[] = JSON.parse(raw);
    return configs.map(migrateConfig);
  } catch { return []; }
}

function migrateConfig(config: CompanyConfig): CompanyConfig {
  const migrated = { ...config };
  if (!migrated.diaria) {
    const legacyValue = migrated.dailyValue || 60;
    migrated.diaria = { weekday: legacyValue, saturday: legacyValue, sunday: legacyValue, holiday: legacyValue };
  }
  if (!migrated.extraKm) migrated.extraKm = { ...DEFAULT_EXTRA_KM };
  if (!migrated.autoCredit) migrated.autoCredit = { ...DEFAULT_AUTO_CREDIT };
  if (!migrated.report) migrated.report = { ...DEFAULT_REPORT };
  if (!migrated.faixasHoras) migrated.faixasHoras = [];
  if (!migrated.turnos) migrated.turnos = [];
  if (migrated.taxaSupervisao === undefined) migrated.taxaSupervisao = 0;
  if (migrated.debitoPendente === undefined) migrated.debitoPendente = 0;
  return migrated;
}

function saveAllConfigs(configs: CompanyConfig[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

// ============================================================
// Public API (sync reads from cache, write-through to Supabase)
// ============================================================

export function getCompanyConfig(companyId: number, companyName?: string): CompanyConfig {
  const all = getAllConfigs();
  const existing = all.find(c => c.companyId === companyId);
  if (existing) return existing;
  return {
    companyId,
    companyName: companyName || `Empresa ${companyId}`,
    ...DEFAULTS,
    diaria: { ...DEFAULT_DIARIA },
  };
}

export function saveCompanyConfig(config: CompanyConfig) {
  // 1. Update local cache
  const all = getAllConfigs();
  const idx = all.findIndex(c => c.companyId === config.companyId);
  if (idx >= 0) {
    all[idx] = config;
  } else {
    all.push(config);
  }
  saveAllConfigs(all);

  // 2. Persist to Supabase
  authFetch('/api/db/configs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }).catch(err => console.warn('[ConfigStore] Supabase write failed:', err));
}

export function getDefaultConfig(): Omit<CompanyConfig, 'companyId' | 'companyName'> {
  return { ...DEFAULTS, diaria: { ...DEFAULT_DIARIA } };
}

// ============================================================
// Pull from Supabase → Local Cache (on mount)
// ============================================================

export async function pullConfigFromSupabase(companyId: number, companyName?: string): Promise<CompanyConfig | null> {
  try {
    const res = await authFetch(`/api/db/configs?company_id=${companyId}`);
    if (!res.ok) return null;
    const data = await res.json();

    // Map DB → app format
    const config: CompanyConfig = {
      companyId,
      companyName: companyName || data.company_name || `Empresa ${companyId}`,
      taxaCorridaPerEntrega: Number(data.ride_fee_per_delivery) || 1.60,
      pisoFixo: Number(data.minimum_rides_fee_floor) || 350,
      pisoPercentual: Number(data.minimum_floor_percent) || 0,
      taxaSupervisao: Number(data.taxa_supervisao) || 0,
      debitoPendente: Number(data.debito_pendente) || 0,
      diaria: {
        weekday: Number(data.daily_rate_weekday) || 60,
        saturday: Number(data.daily_rate_saturday) || 70,
        sunday: Number(data.daily_rate_sunday) || 80,
        holiday: Number(data.daily_rate_holiday) || 80,
      },
      turnos: Array.isArray(data.turnos_config) ? data.turnos_config : [],
      faixasHoras: Array.isArray(data.faixas_horas_config) ? data.faixas_horas_config : [],
      extraKm: {
        mode: data.extra_km_mode || 'disabled',
        minKm: Number(data.extra_km_min_distance) || 6,
        fixedAmount: Number(data.extra_km_fixed_amount) || 3,
      },
      autoCredit: {
        enabled: data.auto_credit_enabled || false,
        cutoffHour: Number(data.auto_credit_cutoff_hour) || 6,
        cutoffMinute: Number(data.auto_credit_cutoff_minute) || 0,
        creditDescription: data.auto_credit_description || 'Diária {date} - {company}',
        mode: data.auto_credit_mode || 'garantida',
      },
      report: {
        reportType: data.report_type || 'producao',
        includeTaxaCorridas: data.include_taxa_corridas ?? true,
        showDiaria: data.show_diaria ?? true,
        showTxCorridas: data.show_tx_corridas ?? true,
        showEntregas: data.show_entregas ?? true,
      },
    };

    // Merge into local cache
    const all = getAllConfigs();
    const idx = all.findIndex(c => c.companyId === companyId);
    if (idx >= 0) all[idx] = config;
    else all.push(config);
    saveAllConfigs(all);

    return config;
  } catch (err) {
    console.warn('[ConfigStore] Pull from Supabase failed:', err);
    return null;
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Returns the default diária value for a given date based on the day of the week.
 */
export function getDiariaForDate(config: CompanyConfig, dateStr: string, isHoliday?: boolean): number {
  if (isHoliday) return config.diaria.holiday;
  const d = new Date(dateStr + 'T12:00:00');
  const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  if (dayOfWeek === 0) return config.diaria.sunday;
  if (dayOfWeek === 6) return config.diaria.saturday;
  return config.diaria.weekday;
}

export function getDefaultDiaria(): DiariaConfig {
  return { ...DEFAULT_DIARIA };
}
