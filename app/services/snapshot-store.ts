/**
 * Snapshot Store — Supabase-primary pattern
 * Primary: Supabase via /api/db/snapshots (source of truth)
 * Cache: localStorage (for instant reads + offline fallback)
 * Lifecycle: Draft → Finalizado → Bloqueado
 *
 * All writes go to Supabase first, then update local cache.
 * Reads use local cache. pullSnapshotsFromSupabase() refreshes cache.
 */

import { authFetch } from '@/app/lib/api-client';

export type SnapshotStatus = 'draft' | 'finalizado' | 'bloqueado';

export interface SnapshotDriverRow {
  driverId: string;
  driverName: string;
  totalDiaria: number;
  totalExtras: number;
  totalTaxaCorridas: number;
  totalAdiantamentos: number;
  totalLiquido: number;
  entregas: number;
  corridas: number;
}

export interface WeeklySnapshot {
  id: string;
  companyId: number;
  companyName: string;
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  status: SnapshotStatus;
  totalGeral: number;
  drivers: SnapshotDriverRow[];
  createdAt: string;
  finalizedAt?: string;
  lockedAt?: string;
  notes?: string;
}

const STORAGE_KEY = 'logipay:snapshots';

// ============================================================
// Local Cache Layer
// ============================================================

function getAll(): WeeklySnapshot[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveAll(snapshots: WeeklySnapshot[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
}

// ============================================================
// Public API (sync reads from cache, write-through to Supabase)
// ============================================================

export function getSnapshots(companyId?: number): WeeklySnapshot[] {
  const all = getAll();
  if (companyId) return all.filter(s => s.companyId === companyId);
  return all;
}

export function getSnapshot(id: string): WeeklySnapshot | null {
  return getAll().find(s => s.id === id) || null;
}

export function findSnapshot(companyId: number, weekStart: string): WeeklySnapshot | null {
  return getAll().find(s =>
    s.companyId === companyId && s.weekStart === weekStart
  ) || null;
}

export function createSnapshot(data: Omit<WeeklySnapshot, 'id' | 'createdAt' | 'status'>): WeeklySnapshot {
  const all = getAll();

  const existing = all.find(s =>
    s.companyId === data.companyId && s.weekStart === data.weekStart
  );
  if (existing) {
    if (existing.status === 'draft') {
      existing.drivers = data.drivers;
      existing.totalGeral = data.totalGeral;
      existing.notes = data.notes;
      saveAll(all);
      syncSnapshotToSupabase(existing);
      return existing;
    }
    return existing;
  }

  const snapshot: WeeklySnapshot = {
    ...data,
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
  all.unshift(snapshot);
  saveAll(all);

  syncSnapshotToSupabase(snapshot);
  return snapshot;
}

export function finalizeSnapshot(id: string): WeeklySnapshot | null {
  const all = getAll();
  const snap = all.find(s => s.id === id);
  if (!snap || snap.status !== 'draft') return null;
  snap.status = 'finalizado';
  snap.finalizedAt = new Date().toISOString();
  saveAll(all);

  syncSnapshotStatusToSupabase(id, 'finalize');
  return snap;
}

export function lockSnapshot(id: string): WeeklySnapshot | null {
  const all = getAll();
  const snap = all.find(s => s.id === id);
  if (!snap || snap.status !== 'finalizado') return null;
  snap.status = 'bloqueado';
  snap.lockedAt = new Date().toISOString();
  saveAll(all);

  syncSnapshotStatusToSupabase(id, 'lock');
  return snap;
}

export function reopenSnapshot(id: string): WeeklySnapshot | null {
  const all = getAll();
  const snap = all.find(s => s.id === id);
  if (!snap || snap.status !== 'finalizado') return null;
  snap.status = 'draft';
  snap.finalizedAt = undefined;
  saveAll(all);

  syncSnapshotStatusToSupabase(id, 'reopen');
  return snap;
}

export function deleteSnapshot(id: string): boolean {
  const all = getAll();
  const snap = all.find(s => s.id === id);
  if (!snap || snap.status === 'bloqueado') return false;
  const filtered = all.filter(s => s.id !== id);
  saveAll(filtered);

  deleteSnapshotFromSupabase(id);
  return true;
}

export function updateSnapshotNotes(id: string, notes: string): WeeklySnapshot | null {
  const all = getAll();
  const snap = all.find(s => s.id === id);
  if (!snap) return null;
  snap.notes = notes;
  saveAll(all);

  syncSnapshotNotesToSupabase(id, notes);
  return snap;
}

// ============================================================
// Supabase Persistence (awaited writes)
// ============================================================

async function syncSnapshotToSupabase(snapshot: WeeklySnapshot) {
  try {
    const res = await authFetch('/api/db/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[SnapshotStore] Push failed:', res.status, err);
    }
  } catch (err) {
    console.error('[SnapshotStore] Push error:', err);
  }
}

async function syncSnapshotStatusToSupabase(id: string, action: string) {
  try {
    const res = await authFetch('/api/db/snapshots', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    if (!res.ok) console.error('[SnapshotStore] Status update failed:', res.status);
  } catch (err) {
    console.error('[SnapshotStore] Status update error:', err);
  }
}

async function syncSnapshotNotesToSupabase(id: string, notes: string) {
  try {
    const res = await authFetch('/api/db/snapshots', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, notes }),
    });
    if (!res.ok) console.error('[SnapshotStore] Notes update failed:', res.status);
  } catch (err) {
    console.error('[SnapshotStore] Notes update error:', err);
  }
}

async function deleteSnapshotFromSupabase(id: string) {
  try {
    const res = await authFetch(`/api/db/snapshots?id=${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) console.error('[SnapshotStore] Delete failed:', res.status);
  } catch (err) {
    console.error('[SnapshotStore] Delete error:', err);
  }
}

// ============================================================
// Pull from Supabase → Local Cache (additive merge)
// ============================================================

export async function pullSnapshotsFromSupabase(companyId: number): Promise<boolean> {
  try {
    const res = await authFetch(`/api/db/snapshots?company_id=${companyId}`);
    if (!res.ok) {
      console.warn('[SnapshotStore] Pull returned non-OK:', res.status);
      return false;
    }
    const snapshots: WeeklySnapshot[] = await res.json();

    // If Supabase returned nothing, keep local cache
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      return true;
    }

    // ADDITIVE MERGE: only add snapshots from Supabase that don't exist locally
    const local = getAll();
    for (const snap of snapshots) {
      const exists = local.some(s => s.id === snap.id || (s.companyId === snap.companyId && s.weekStart === snap.weekStart));
      if (!exists) {
        local.push(snap);
      } else {
        // Update existing with Supabase version (server wins for status/notes)
        const idx = local.findIndex(s => s.companyId === snap.companyId && s.weekStart === snap.weekStart);
        if (idx >= 0 && snap.status !== 'draft') {
          local[idx] = snap; // Server version wins if finalized/locked
        }
      }
    }
    saveAll(local);
    return true;
  } catch (err) {
    console.warn('[SnapshotStore] Pull failed:', err);
    return false;
  }
}
