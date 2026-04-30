import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/client';
import { toLocalDateISO } from '@/app/lib/date-utils';
import { resolveTenant, requireMachineCompanyMatch } from '@/lib/supabase/resolve-tenant';

export const maxDuration = 55; // Vercel Pro: max 60s
export const dynamic = 'force-dynamic';

/**
 * AUTO-CREDIT ENDPOINT — ENQUEUE MODE
 *
 * This endpoint NO LONGER processes payments directly.
 * Instead, it:
 *   1. Finds eligible manual_entries (pending, D-1 or older)
 *   2. Groups them by driver
 *   3. Inserts them into the `credit_queue` table
 *
 * The actual Machine API calls are made by the Supabase Edge Function
 * `process-credit-queue`, triggered every 5 minutes by pg_cron.
 *
 * GET  /api/cron/auto-credit — Called hourly by pg_cron + pg_net.
 *      Filters companies whose cutoff_hour matches current BRT hour.
 *
 * POST /api/cron/auto-credit — Manual trigger from Financeiro page.
 *      Body: { company_id: number }  (Machine empresa ID)
 *      SECURITY: Requires tenant authentication + company match.
 */

interface EnqueueResult {
  company: string;
  driver: string;
  amount: number;
  status: 'enqueued' | 'skipped' | 'error';
  reason?: string;
}

/**
 * Get current hour in BRT (UTC-3)
 */
function getCurrentBRTHour(): number {
  const now = new Date();
  const brtOffset = -3;
  const utcHour = now.getUTCHours();
  let brtHour = utcHour + brtOffset;
  if (brtHour < 0) brtHour += 24;
  return brtHour;
}

// ─── Hourly CRON (triggered by Supabase pg_cron) ─────────────

export async function GET(request: Request) {
  const startTime = Date.now();

  // Validate cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const results: EnqueueResult[] = [];
  const currentBRTHour = getCurrentBRTHour();

  try {
    // Find companies with auto-credit enabled AND cutoff_hour matching current BRT hour
    const { data: configs, error: cfgError } = await supabase
      .from('company_configs')
      .select(`
        company_id,
        auto_credit_enabled,
        auto_credit_cutoff_hour,
        auto_credit_description,
        auto_credit_mode,
        companies!inner ( id, name, machine_empresa_id, active )
      `)
      .eq('auto_credit_enabled', true)
      .eq('auto_credit_cutoff_hour', currentBRTHour);

    if (cfgError) {
      console.error('[AutoCredit] Config fetch error:', cfgError.message);
      return NextResponse.json({ error: cfgError.message }, { status: 500 });
    }

    if (!configs || configs.length === 0) {
      return NextResponse.json({
        message: `No companies with cutoff_hour = ${currentBRTHour} BRT`,
        current_brt_hour: currentBRTHour,
        duration_ms: Date.now() - startTime,
        results: [],
      });
    }

    // Enqueue each company's pending entries
    for (const cfg of configs) {
      const company = cfg.companies as unknown as { id: string; name: string; machine_empresa_id: string; active: boolean };
      if (!company?.active) continue;

      try {
        const companyResults = await enqueueCompanyCredits(
          supabase,
          { ...company, auto_credit_mode: cfg.auto_credit_mode || 'garantida' },
          cfg.auto_credit_description || 'Diária {date} - {company}'
        );
        results.push(...companyResults);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[AutoCredit] ${company.name} enqueue error:`, msg);
        results.push({ company: company.name, driver: '', amount: 0, status: 'error', reason: msg });
      }
    }

    return NextResponse.json({
      mode: 'enqueue_hourly',
      current_brt_hour: currentBRTHour,
      companies_matched: configs.length,
      duration_ms: Date.now() - startTime,
      enqueued: results.filter(r => r.status === 'enqueued').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: results.filter(r => r.status === 'error').length,
      results,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[AutoCredit] Fatal error:', msg);
    return NextResponse.json({ error: msg, duration_ms: Date.now() - startTime }, { status: 500 });
  }
}

// ─── Manual trigger (called by lojista) ──────────────────────

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    // ─── TENANT ISOLATION ───
    const tenant = await resolveTenant(request);
    if (!tenant) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const machineCompanyId = body.company_id;

    if (!machineCompanyId) {
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
    }

    // Validate company access
    const companyCheck = await requireMachineCompanyMatch(tenant, String(machineCompanyId));
    if (companyCheck) return companyCheck;

    const supabase = createAdminClient();

    // Resolve Machine ID → Supabase UUID
    const { data: companyRow } = await supabase
      .from('companies')
      .select('id, name, machine_empresa_id')
      .eq('machine_empresa_id', String(machineCompanyId))
      .single();

    if (!companyRow) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Get config for description template
    const { data: config } = await supabase
      .from('company_configs')
      .select('auto_credit_description, auto_credit_enabled, auto_credit_mode')
      .eq('company_id', companyRow.id)
      .single();

    if (!config?.auto_credit_enabled) {
      return NextResponse.json({ error: 'Auto-crédito não está habilitado para esta empresa' }, { status: 400 });
    }

    const results = await enqueueCompanyCredits(
      supabase,
      { ...companyRow, auto_credit_mode: config.auto_credit_mode || 'garantida' },
      config.auto_credit_description || 'Diária {date} - {company}'
    );

    return NextResponse.json({
      mode: 'manual_enqueue',
      company: companyRow.name,
      duration_ms: Date.now() - startTime,
      enqueued: results.filter(r => r.status === 'enqueued').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: results.filter(r => r.status === 'error').length,
      results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[AutoCredit Manual] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Enqueue credits for a single company into the credit_queue table.
 *
 * DEDUPLICATION:
 *   Before inserting, checks if there's already a pending/processing/failed
 *   queue entry for the same driver + same entry_ids to prevent duplicates.
 */
async function enqueueCompanyCredits(
  supabase: ReturnType<typeof createAdminClient>,
  company: { id: string; name: string; machine_empresa_id: string; auto_credit_mode?: string },
  descriptionTemplate: string
): Promise<EnqueueResult[]> {
  const results: EnqueueResult[] = [];

  // Only process entries with entry_date <= yesterday (D-1)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const maxDate = toLocalDateISO(yesterday);

  // Fetch eligible entries (pending or failed, not yet in queue)
  const { data: entries, error: fetchError } = await supabase
    .from('manual_entries')
    .select(`
      id, driver_id, entry_type, amount, description, entry_date,
      drivers!inner ( machine_condutor_id, name )
    `)
    .eq('company_id', company.id)
    .or('credit_status.is.null,credit_status.eq.pending,credit_status.eq.failed')
    .lte('entry_date', maxDate);

  if (fetchError) {
    console.error(`[AutoCredit] ${company.name} fetch error:`, fetchError.message);
    return [{ company: company.name, driver: '', amount: 0, status: 'error', reason: fetchError.message }];
  }

  if (!entries || entries.length === 0) {
    return [{ company: company.name, driver: '', amount: 0, status: 'skipped', reason: `No pending entries up to ${maxDate} (D-1)` }];
  }

  // Group entries by driver AND date
  const driverMap = new Map<string, {
    driverId: string;
    machineId: string;
    name: string;
    netAmount: number;
    entryIds: string[];
    dates: Set<string>;
    days: Record<string, { diaria: number; extras: number; adiantamentos: number }>;
  }>();

  const allDates = new Set<string>();

  for (const entry of entries) {
    const driver = entry.drivers as unknown as { machine_condutor_id: string; name: string };
    if (!driver?.machine_condutor_id) continue;

    const key = entry.driver_id;
    if (!driverMap.has(key)) {
      driverMap.set(key, {
        driverId: entry.driver_id,
        machineId: driver.machine_condutor_id,
        name: driver.name,
        netAmount: 0,
        entryIds: [],
        dates: new Set(),
        days: {}
      });
    }

    const driverData = driverMap.get(key)!;
    driverData.entryIds.push(entry.id);
    
    if (entry.entry_date) {
      driverData.dates.add(entry.entry_date);
      allDates.add(entry.entry_date);
      if (!driverData.days[entry.entry_date]) {
        driverData.days[entry.entry_date] = { diaria: 0, extras: 0, adiantamentos: 0 };
      }
      
      const val = Number(entry.amount);
      if (entry.entry_type === 'daily_rate') driverData.days[entry.entry_date].diaria += val;
      else if (entry.entry_type === 'advance') driverData.days[entry.entry_date].adiantamentos += val;
      else driverData.days[entry.entry_date].extras += val; // extra, mission
    }
  }

  // Pre-fetch production (rides) for Garantida mode
  const ridesByDriverDate: Record<string, number> = {};
  if (company.auto_credit_mode === 'garantida' && allDates.size > 0) {
    const { data: ridesData } = await supabase
      .from('rides')
      .select('driver_id, ride_date, fare_value')
      .eq('company_id', company.id)
      .eq('status', 'F')
      .in('ride_date', Array.from(allDates));
      
    if (ridesData) {
      for (const r of ridesData) {
        const key = `${r.driver_id}_${r.ride_date}`;
        ridesByDriverDate[key] = (ridesByDriverDate[key] || 0) + Number(r.fare_value);
      }
    }
  }

  // Calculate Net Amount per driver based on auto_credit_mode
  for (const [, driverData] of driverMap) {
    let totalNetAmount = 0;
    
    for (const date of driverData.dates) {
      const dData = driverData.days[date];
      const producao = ridesByDriverDate[`${driverData.driverId}_${date}`] || 0;
      
      let dayNet = 0;
      if (company.auto_credit_mode === 'producao') {
        dayNet = dData.diaria + dData.extras - dData.adiantamentos;
      } else {
        // Garantida Mínima
        dayNet = Math.max(producao + dData.extras, dData.diaria) - producao - dData.adiantamentos;
      }
      
      totalNetAmount += dayNet;
    }
    
    driverData.netAmount = totalNetAmount;
  }

  // Enqueue each driver
  for (const [, driverData] of driverMap) {
    if (driverData.netAmount <= 0) {
      // Mark entries as skipped (no credit needed)
      await supabase
        .from('manual_entries')
        .update({ credit_status: 'skipped', credit_error: null })
        .in('id', driverData.entryIds);

      results.push({
        company: company.name,
        driver: driverData.name,
        amount: driverData.netAmount,
        status: 'skipped',
        reason: 'Net amount <= 0',
      });
      continue;
    }

    // Check for existing queue entry to prevent duplicates
    const { data: existing } = await supabase
      .from('credit_queue')
      .select('id, status')
      .eq('company_id', company.id)
      .eq('driver_id', driverData.driverId)
      .in('status', ['pending', 'processing', 'failed'])
      .limit(1);

    if (existing && existing.length > 0) {
      results.push({
        company: company.name,
        driver: driverData.name,
        amount: driverData.netAmount,
        status: 'skipped',
        reason: `Already in queue (status: ${existing[0].status})`,
      });
      continue;
    }

    // Build description from template
    const dateLabel = [...driverData.dates].sort()[0] || toLocalDateISO(new Date());
    const description = descriptionTemplate
      .replace('{date}', dateLabel)
      .replace('{company}', company.name)
      .replace('{driver}', driverData.name);

    // Insert into credit_queue
    const { error: insertError } = await supabase
      .from('credit_queue')
      .insert({
        company_id: company.id,
        driver_id: driverData.driverId,
        machine_condutor_id: driverData.machineId,
        entry_ids: driverData.entryIds,
        net_amount: driverData.netAmount,
        description,
        status: 'pending',
        next_retry_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error(`[AutoCredit] ${company.name} enqueue error for ${driverData.name}:`, insertError.message);
      results.push({
        company: company.name,
        driver: driverData.name,
        amount: driverData.netAmount,
        status: 'error',
        reason: insertError.message,
      });
      continue;
    }

    // Mark entries as processing (they're now in the queue)
    await supabase
      .from('manual_entries')
      .update({ credit_status: 'processing', credit_error: null })
      .in('id', driverData.entryIds);

    results.push({
      company: company.name,
      driver: driverData.name,
      amount: driverData.netAmount,
      status: 'enqueued',
    });

    console.log(`[AutoCredit] Enqueued R$${driverData.netAmount} for ${driverData.name} (${company.name})`);
  }

  return results;
}
