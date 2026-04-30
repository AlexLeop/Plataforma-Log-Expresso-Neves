/**
 * Entries Store — Supabase-primary pattern
 * Primary: Supabase via /api/db/entries (source of truth)
 * Cache: localStorage (for instant reads + offline fallback)
 * 
 * All writes go to Supabase first, then update local cache.
 * Reads use local cache when available, with background refresh from Supabase.
 */

import { authFetch } from '@/app/lib/api-client';

// ============================================================
// Types
// ============================================================

export interface DailyEntry {
  driverId: string;
  driverName: string;
  date: string;           // YYYY-MM-DD
  turnoId?: string;       // ID do turno (ex: 't1', 't2') para garantir mínimo fatiado
  faixaId?: string;       // ID da faixa de horas (modo 'garantida_horas')
  amount: number;         // valor efetivo da diária
  diariaOverride: boolean; // true = gestor alterou manualmente
  companyId: number;
  // Credit tracking
  creditStatus?: 'pending' | 'credited' | 'failed' | 'skipped';
  creditedAt?: string;
  creditError?: string;
  machineTransactionId?: string;
}

export interface ManualEntry {
  id: string;
  driverId: string;
  driverName: string;
  date: string;
  type: 'diaria' | 'extra' | 'missao' | 'adiantamento';
  amount: number;
  description: string;
  companyId: number;
  createdAt: string;
}

// ============================================================
// Local Cache Keys
// ============================================================

const DAILY_KEY = 'logipay:dailies';
const MANUAL_KEY = 'logipay:manual_entries';

// ============================================================
// Local Cache Layer (instant reads)
// ============================================================

function getDailiesCache(): DailyEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (!raw) return [];
    const entries: DailyEntry[] = JSON.parse(raw);
    return entries.map(e => ({
      ...e,
      diariaOverride: e.diariaOverride ?? false,
    }));
  } catch { return []; }
}

function saveDailiesCache(entries: DailyEntry[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DAILY_KEY, JSON.stringify(entries));
}

function getManualEntriesCache(): ManualEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MANUAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveManualEntriesCache(entries: ManualEntry[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MANUAL_KEY, JSON.stringify(entries));
}

// ============================================================
// Daily Entries (checkbox grid)
// ============================================================

export async function setDailyEntry(entry: DailyEntry): Promise<boolean> {
  // 1. Update local cache immediately (optimistic)
  const all = getDailiesCache();
  const idx = all.findIndex(e =>
    e.driverId === entry.driverId &&
    e.date === entry.date &&
    e.companyId === entry.companyId &&
    e.turnoId === entry.turnoId
  );
  if (idx >= 0) {
    all[idx] = entry;
  } else {
    all.push(entry);
  }
  saveDailiesCache(all);

  // 2. Persist to Supabase (awaited)
  try {
    const res = await authFetch('/api/db/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: entry.companyId,
        driverId: entry.driverId,
        driverName: entry.driverName,
        date: entry.date,
        turnoId: entry.turnoId,
        type: 'diaria',
        amount: entry.amount,
        description: entry.diariaOverride ? 'Diária manual' : 'Diária',
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error('[EntriesStore] Daily write failed:', res.status, errData);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[EntriesStore] Daily write error:', err);
    return false;
  }
}

export function removeDailyEntry(driverId: string, date: string, companyId: number, turnoId?: string) {
  // 1. Remove from local cache
  const all = getDailiesCache().filter(e =>
    !(e.driverId === driverId && e.date === date && Number(e.companyId) === Number(companyId) && e.turnoId === turnoId)
  );
  saveDailiesCache(all);

  // 2. Delete from Supabase
  let url = `/api/db/entries?driver_id=${driverId}&date=${date}&company_id=${companyId}`;
  if (turnoId) url += `&turno_id=${turnoId}`;
  
  authFetch(url, {
    method: 'DELETE',
  }).catch(err => console.warn('[EntriesStore] Daily delete failed:', err));
}

export function getDailyEntriesForWeek(companyId: number | string, weekStart: string, weekEnd: string): DailyEntry[] {
  const cid = Number(companyId);
  return getDailiesCache().filter(e =>
    Number(e.companyId) === cid &&
    e.date >= weekStart &&
    e.date <= weekEnd
  );
}

export function getDailyEntryForDriver(driverId: string, date: string, companyId: number | string, turnoId?: string): DailyEntry | null {
  const cid = Number(companyId);
  const did = String(driverId);
  return getDailiesCache().find(e =>
    String(e.driverId) === did &&
    e.date === date &&
    Number(e.companyId) === cid &&
    e.turnoId === turnoId
  ) || null;
}

// ============================================================
// Manual Entries (modal — extras, missões, adiantamentos)
// ============================================================

export async function addManualEntry(entry: Omit<ManualEntry, 'id' | 'createdAt'>): Promise<ManualEntry> {
  const newEntry: ManualEntry = {
    ...entry,
    id: `me_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  };

  // 1. Add to local cache
  const all = getManualEntriesCache();
  all.unshift(newEntry);
  saveManualEntriesCache(all);

  // 2. Persist to Supabase (awaited)
  try {
    const res = await authFetch('/api/db/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: entry.companyId,
        driverId: entry.driverId,
        driverName: entry.driverName,
        date: entry.date,
        type: entry.type,
        amount: entry.amount,
        description: entry.description,
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error('[EntriesStore] Manual write failed:', res.status, errData);
    }
  } catch (err) {
    console.error('[EntriesStore] Manual write error:', err);
  }

  return newEntry;
}

export function deleteManualEntry(id: string) {
  // 1. Remove from cache
  const all = getManualEntriesCache().filter(e => e.id !== id);
  saveManualEntriesCache(all);

  // 2. Delete from Supabase
  authFetch(`/api/db/entries?id=${id}`, {
    method: 'DELETE',
  }).catch(err => console.warn('[EntriesStore] Manual delete failed:', err));
}

export function getManualEntriesForWeek(companyId: number | string, weekStart: string, weekEnd: string): ManualEntry[] {
  const cid = Number(companyId);
  return getManualEntriesCache().filter(e =>
    Number(e.companyId) === cid &&
    e.date >= weekStart &&
    e.date <= weekEnd
  );
}

// ============================================================
// Aggregation for Reports
// ============================================================

export interface DriverDayEntries {
  diaria: number;
  extras: number;
  adiantamentos: number;
}

export function getDriverDayAggregation(
  companyId: number,
  driverId: string,
  date: string,
  turnoId?: string
): DriverDayEntries {
  const cid = Number(companyId);
  const did = String(driverId);
  const daily = getDailyEntryForDriver(did, date, cid, turnoId);
  const manuals = getManualEntriesCache().filter(e =>
    Number(e.companyId) === cid &&
    String(e.driverId) === did &&
    e.date === date
  );

  const extras = manuals
    .filter(e => e.type === 'extra' || e.type === 'missao')
    .reduce((s, e) => s + Math.abs(e.amount), 0);

  const adiantamentos = manuals
    .filter(e => e.type === 'adiantamento')
    .reduce((s, e) => s + Math.abs(e.amount), 0);

  return {
    diaria: daily?.amount || 0,
    extras,
    adiantamentos,
  };
}

export function getDriverWeekAggregation(
  companyId: number,
  driverId: string,
  weekStart: string,
  weekEnd: string
): { totalDiaria: number; totalExtras: number; totalAdiantamentos: number } {
  const did = String(driverId);
  const dailies = getDailyEntriesForWeek(companyId, weekStart, weekEnd)
    .filter(e => String(e.driverId) === did);
  const manuals = getManualEntriesForWeek(companyId, weekStart, weekEnd)
    .filter(e => String(e.driverId) === did);

  return {
    totalDiaria: dailies.reduce((s, e) => s + e.amount, 0),
    totalExtras: manuals.filter(e => e.type === 'extra' || e.type === 'missao').reduce((s, e) => s + Math.abs(e.amount), 0),
    totalAdiantamentos: manuals.filter(e => e.type === 'adiantamento').reduce((s, e) => s + Math.abs(e.amount), 0),
  };
}

// ============================================================
// Credit Management (Auto-credit system)
// ============================================================

const CREDIT_LOG_KEY = 'logipay:credit_log';

export interface CreditLogEntry {
  id: string;
  date: string;
  driverId: string;
  driverName: string;
  companyId: number;
  companyName: string;
  amount: number;
  breakdown: {
    diaria: number;
    extras: number;
    adiantamentos: number;
  };
  status: 'success' | 'failed' | 'retry';
  machineResponse?: string;
  error?: string;
  createdAt: string;
  processedBy: 'cron' | 'manual';
}

function getCreditLogCache(): CreditLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CREDIT_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCreditLogCache(entries: CreditLogEntry[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CREDIT_LOG_KEY, JSON.stringify(entries));
}

export function getCreditLog(): CreditLogEntry[] {
  return getCreditLogCache();
}

export function addCreditLogEntry(entry: Omit<CreditLogEntry, 'id' | 'createdAt'>): CreditLogEntry {
  const newEntry: CreditLogEntry = {
    ...entry,
    id: `cl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  };

  // 1. Update cache
  const all = getCreditLogCache();
  all.unshift(newEntry);
  saveCreditLogCache(all);

  // 2. Persist to Supabase
  authFetch('/api/db/entries/credit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyId: entry.companyId,
      driverId: entry.driverId,
      date: entry.date,
      amount: entry.amount,
      breakdown: entry.breakdown,
      status: entry.status,
      machineResponse: entry.machineResponse,
      error: entry.error,
      processedBy: entry.processedBy,
    }),
  }).catch(err => console.warn('[EntriesStore] Credit log write failed:', err));

  return newEntry;
}

export function getCreditLogForWeek(companyId: number, weekStart: string, weekEnd: string): CreditLogEntry[] {
  return getCreditLogCache().filter(e =>
    e.companyId === companyId &&
    e.date >= weekStart &&
    e.date <= weekEnd
  );
}

export function getPendingCreditsForDate(companyId: number, date: string): DailyEntry[] {
  return getDailiesCache().filter(e =>
    e.companyId === companyId &&
    e.date === date &&
    (!e.creditStatus || e.creditStatus === 'pending' || e.creditStatus === 'failed')
  );
}

export function markDailyEntryCredited(driverId: string, date: string, companyId: number, transactionId?: string) {
  const all = getDailiesCache();
  const idx = all.findIndex(e =>
    e.driverId === driverId && e.date === date && e.companyId === companyId
  );
  if (idx >= 0) {
    all[idx] = {
      ...all[idx],
      creditStatus: 'credited',
      creditedAt: new Date().toISOString(),
      machineTransactionId: transactionId,
    };
    saveDailiesCache(all);

    // Sync to Supabase
    authFetch('/api/db/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: all[idx].companyId,
        driverId: all[idx].driverId,
        driverName: all[idx].driverName,
        date: all[idx].date,
        type: 'diaria',
        amount: all[idx].amount,
        description: all[idx].diariaOverride ? 'Diária manual' : 'Diária',
        creditStatus: 'credited',
      }),
    }).catch(err => console.warn('[EntriesStore] Credit status sync failed:', err));
  }
}

export function markDailyEntryFailed(driverId: string, date: string, companyId: number, error: string) {
  const all = getDailiesCache();
  const idx = all.findIndex(e =>
    e.driverId === driverId && e.date === date && e.companyId === companyId
  );
  if (idx >= 0) {
    all[idx] = {
      ...all[idx],
      creditStatus: 'failed',
      creditError: error,
    };
    saveDailiesCache(all);

    authFetch('/api/db/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: all[idx].companyId,
        driverId: all[idx].driverId,
        driverName: all[idx].driverName,
        date: all[idx].date,
        type: 'diaria',
        amount: all[idx].amount,
        description: all[idx].diariaOverride ? 'Diária manual' : 'Diária',
        creditStatus: 'failed',
      }),
    }).catch(err => console.warn('[EntriesStore] Failed status sync failed:', err));
  }
}

export function getCreditStats(companyId: number, weekStart: string, weekEnd: string) {
  const dailies = getDailyEntriesForWeek(companyId, weekStart, weekEnd);
  return {
    total: dailies.length,
    pending: dailies.filter(e => !e.creditStatus || e.creditStatus === 'pending').length,
    credited: dailies.filter(e => e.creditStatus === 'credited').length,
    failed: dailies.filter(e => e.creditStatus === 'failed').length,
  };
}

// ============================================================
// Supabase → Local Cache Sync (pull on mount)
// ============================================================

export async function pullEntriesFromSupabase(companyId: number | string, weekStart: string, weekEnd: string): Promise<boolean> {
  try {
    const res = await authFetch(`/api/db/entries?company_id=${companyId}&start=${weekStart}&end=${weekEnd}`);
    if (!res.ok) {
      console.warn('[EntriesStore] Pull returned non-OK:', res.status);
      return false;
    }
    const entries = await res.json();
    const cid = Number(companyId);

    // ── Authoritative replace for this company+period ──
    // Remove all local entries for this company+period, then add server entries.
    // This ensures deletions on server (e.g. no_show) propagate to client.

    const localDailies = getDailiesCache();
    const localManuals = getManualEntriesCache();

    // Keep entries OUTSIDE this company+period range
    const otherDailies = localDailies.filter(e =>
      !(Number(e.companyId) === cid && e.date >= weekStart && e.date <= weekEnd)
    );
    const otherManuals = localManuals.filter(e =>
      !(Number(e.companyId) === cid && e.date >= weekStart && e.date <= weekEnd)
    );

    // Add server entries for this period
    const serverDailies: DailyEntry[] = [];
    const serverManuals: ManualEntry[] = [];

    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (entry.type === 'diaria') {
          serverDailies.push({
            driverId: entry.driverId,
            driverName: entry.driverName,
            date: entry.date,
            amount: entry.amount,
            diariaOverride: false,
            companyId: entry.companyId,
            creditStatus: entry.creditStatus,
            creditedAt: entry.creditedAt,
            creditError: entry.creditError,
            machineTransactionId: entry.machineTransactionId,
            ...(entry.turnoId ? { turnoId: entry.turnoId } : {})
          });
        } else {
          serverManuals.push({
            id: entry.id,
            driverId: entry.driverId,
            driverName: entry.driverName,
            date: entry.date,
            type: entry.type,
            amount: entry.amount,
            description: entry.description,
            companyId: entry.companyId,
            createdAt: entry.createdAt,
          });
        }
      }
    }

    saveDailiesCache([...otherDailies, ...serverDailies]);
    saveManualEntriesCache([...otherManuals, ...serverManuals]);
    return true;
  } catch (err) {
    console.warn('[EntriesStore] Pull failed:', err);
    return false;
  }
}
