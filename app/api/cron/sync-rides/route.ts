import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/client';
import { fetchAllRidesForCompany, fetchDrivers, sleep, THROTTLE_MS } from '@/lib/machine/client';
import { normalizeRide, normalizeDriver } from '@/lib/machine/normalizer';
import { subHours, formatISO } from 'date-fns';

export const maxDuration = 55; // Vercel Pro: max 60s
export const dynamic = 'force-dynamic';

const MAX_EXECUTION_MS = 50_000; // 50s safety margin
const BATCH_SIZE = 5;

// ============================================================
// CRON: GET /api/cron/sync-rides
// Disparado pelo Vercel Cron a cada 5 minutos
// Processa BATCH_SIZE empresas por invocação
// ============================================================

export async function GET(request: Request) {
  const startTime = Date.now();

  // Validar que a chamada vem do Vercel Cron
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const results: SyncResult[] = [];

  try {
    // 1. Buscar próximas empresas a sincronizar (ordenadas pela mais antiga)
    const { data: companies, error } = await supabase
      .from('companies')
      .select('id, name, machine_empresa_id, last_sync_at')
      .eq('active', true)
      .order('last_sync_at', { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!companies || companies.length === 0) {
      return NextResponse.json({ message: 'No companies to sync', results: [] });
    }

    // 2. Processar cada empresa
    for (const company of companies) {
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        results.push({ company: company.name, status: 'skipped', reason: 'timeout' });
        break;
      }

      try {
        const result = await syncCompany(supabase, company, startTime);
        results.push(result);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        results.push({ company: company.name, status: 'error', reason: errorMsg });

        // Se rate limited, parar totalmente
        if (errorMsg === 'RATE_LIMITED') {
          results.push({ company: 'GLOBAL', status: 'error', reason: 'Rate limited. Parando ciclo.' });
          break;
        }

        await logSyncError(supabase, company.id, errorMsg);
      }

      await sleep(THROTTLE_MS);
    }

    return NextResponse.json({
      duration_ms: Date.now() - startTime,
      companies_processed: results.length,
      results,
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: errorMsg, duration_ms: Date.now() - startTime },
      { status: 500 }
    );
  }
}

// ============================================================
// Sync de uma empresa individual
// ============================================================

interface CompanyRow {
  id: string;
  name: string;
  machine_empresa_id: string;
  last_sync_at: string | null;
}

interface SyncResult {
  company: string;
  status: string;
  reason?: string;
  drivers_synced?: number;
  rides_fetched?: number;
  rides_upserted?: number;
}

async function syncCompany(
  supabase: ReturnType<typeof createAdminClient>,
  company: CompanyRow,
  globalStartTime: number
): Promise<SyncResult> {

  // Marcar como sincronizando
  await supabase
    .from('companies')
    .update({ sync_status: 'syncing' })
    .eq('id', company.id);

  const syncLog = await createSyncLog(supabase, company.id);

  // PASSO 1: Sync drivers PRIMEIRO
  let driversSynced = 0;
  try {
    driversSynced = await syncDriversForCompany(supabase);
  } catch (err) {
    console.warn(`[Sync] Driver sync failed for ${company.name}:`, err);
  }

  // PASSO 2: Sync rides
  // Janela deslizante: últimas 4 horas (overlap para pegar atualizações)
  const lastSync = company.last_sync_at
    ? new Date(company.last_sync_at)
    : subHours(new Date(), 168); // 7 dias se nunca sincronizou

  const windowStart = subHours(lastSync, 4); // 4h de overlap
  const windowEnd = new Date();

  const machineRides = await fetchAllRidesForCompany(
    company.machine_empresa_id,
    formatISO(windowStart),
    formatISO(windowEnd),
    3 // max 3 páginas = 300 corridas por ciclo
  );

  // Normalizar
  const normalized = machineRides.map(normalizeRide);

  // Resolver driver_id para cada corrida
  let upsertedCount = 0;
  for (const ride of normalized) {
    if (Date.now() - globalStartTime > MAX_EXECUTION_MS) break;

    const upserted = await upsertRide(supabase, ride, company.id);
    if (upserted) upsertedCount++;
  }

  // Atualizar timestamps
  const now = new Date().toISOString();
  await supabase
    .from('companies')
    .update({ last_sync_at: now, sync_status: 'ok' })
    .eq('id', company.id);

  // Completar sync log
  await completeSyncLog(supabase, syncLog.id, machineRides.length, upsertedCount);

  return {
    company: company.name,
    status: 'success',
    drivers_synced: driversSynced,
    rides_fetched: machineRides.length,
    rides_upserted: upsertedCount,
  };
}

// ============================================================
// Sync de drivers (global, não por empresa)
// ============================================================

async function syncDriversForCompany(
  supabase: ReturnType<typeof createAdminClient>
): Promise<number> {
  const machineDrivers = await fetchDrivers('ativo');
  let synced = 0;

  for (const md of machineDrivers) {
    const normalized = normalizeDriver(md);

    const { error } = await supabase
      .from('drivers')
      .upsert(
        {
          machine_condutor_id: normalized.machine_condutor_id,
          name: normalized.name,
          cpf: normalized.cpf,
          phone: normalized.phone,
          status: 'active',
          raw_data: normalized.raw_data,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'machine_condutor_id' }
      );

    if (!error) synced++;
  }

  return synced;
}

// ============================================================
// Upsert de uma ride individual
// ============================================================

async function upsertRide(
  supabase: ReturnType<typeof createAdminClient>,
  ride: ReturnType<typeof normalizeRide>,
  companyId: string
): Promise<boolean> {

  // Resolver driver_id a partir do machine_condutor_id
  let driverId: string | null = null;
  if (ride.machine_condutor_id) {
    const { data: driver } = await supabase
      .from('drivers')
      .select('id')
      .eq('machine_condutor_id', ride.machine_condutor_id)
      .single();

    driverId = driver?.id || null;
  }

  const { error } = await supabase
    .from('rides')
    .upsert(
      {
        company_id: companyId,
        driver_id: driverId,
        machine_ride_id: ride.machine_ride_id,
        machine_condutor_id: ride.machine_condutor_id,
        status: ride.status,
        payment_type: ride.payment_type,
        fare_value: ride.fare_value,
        stop_count: ride.stop_count,
        requested_at: ride.requested_at,
        finished_at: ride.finished_at,
        ride_date: ride.ride_date,
        raw_data: ride.raw_data,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'machine_ride_id' }
    );

  return !error;
}

// ============================================================
// Helpers de Sync Log
// ============================================================

async function createSyncLog(
  supabase: ReturnType<typeof createAdminClient>,
  companyId: string
) {
  const { data } = await supabase
    .from('sync_logs')
    .insert({
      company_id: companyId,
      sync_type: 'polling',
      status: 'started',
    })
    .select('id')
    .single();

  return data || { id: '' };
}

async function completeSyncLog(
  supabase: ReturnType<typeof createAdminClient>,
  logId: string,
  fetched: number,
  upserted: number
) {
  if (!logId) return;

  await supabase
    .from('sync_logs')
    .update({
      status: 'success',
      records_fetched: fetched,
      records_upserted: upserted,
      finished_at: new Date().toISOString(),
    })
    .eq('id', logId);
}

async function logSyncError(
  supabase: ReturnType<typeof createAdminClient>,
  companyId: string,
  errorMessage: string
) {
  await supabase
    .from('companies')
    .update({ sync_status: 'error' })
    .eq('id', companyId);

  await supabase
    .from('sync_logs')
    .insert({
      company_id: companyId,
      sync_type: 'polling',
      status: 'failed',
      error_message: errorMessage,
      finished_at: new Date().toISOString(),
    });
}
