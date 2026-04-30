/**
 * /api/schedules/[id]/send — Send WhatsApp notifications for schedule entries
 */
import { createServerClient } from '@/lib/supabase/client';
import { sendWhatsAppText, buildConsolidatedMessage } from '@/app/lib/evolution-go';
import { machineGet, MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { randomUUID } from 'crypto';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Try to fetch the driver phone from Machine API and update Supabase.
 * Returns the phone if found, or null.
 */
async function syncDriverPhone(driverUUID: string, machineCondutorId: string | null): Promise<string | null> {
  if (!machineCondutorId) return null;

  const supabase = createServerClient();

  try {
    // Machine API endpoint: GET /api/integracao/condutor?id=<machineCondutorId>
    const result = await machineGet<{ response?: Array<Record<string, unknown>>; success?: boolean }>(
      MACHINE_ENDPOINTS.condutor,
      { id: machineCondutorId }
    );

    if (!result.ok) {
      console.warn(`[SyncDriverPhone] Machine API error for ${machineCondutorId}:`, result.error);
      return null;
    }

    const drivers = result.data.response || [];
    if (drivers.length === 0) {
      console.warn(`[SyncDriverPhone] No driver found in Machine for ID ${machineCondutorId}`);
      return null;
    }

    const machineDriver = drivers[0];
    const phone = (machineDriver.telefone || machineDriver.celular || machineDriver.phone) as string | undefined;

    if (!phone) {
      console.warn(`[SyncDriverPhone] Driver ${machineCondutorId} has no phone in Machine either`);
      return null;
    }

    // Update Supabase with the phone (and name if available)
    const updateData: Record<string, unknown> = { phone, last_synced_at: new Date().toISOString() };
    if (machineDriver.nome) updateData.name = machineDriver.nome;
    if (machineDriver.cpf) updateData.cpf = machineDriver.cpf;
    if (machineDriver.chavePix) updateData.pix_key = machineDriver.chavePix;

    await supabase
      .from('drivers')
      .update(updateData)
      .eq('id', driverUUID);

    console.log(`[SyncDriverPhone] Updated driver ${machineCondutorId} phone to ${phone}`);
    return phone as string;
  } catch (err) {
    console.error('[SyncDriverPhone] Error:', err);
    return null;
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = createServerClient();

  // Parse optional entry_ids filter from body
  let entryIdsFilter: string[] | null = null;
  try {
    const body = await request.json();
    if (body?.entry_ids && Array.isArray(body.entry_ids)) {
      entryIdsFilter = body.entry_ids;
    }
  } catch {
    // No body or invalid JSON is fine — send all pending
  }

  // Get schedule with entries
  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select(`
      *,
      company:companies(id, name, address),
      schedule_entries(
        id, driver_id, entry_date, shift_label, shift_start, shift_end,
        daily_rate, status, confirmation_token,
        driver:drivers(id, name, phone, machine_condutor_id)
      )
    `)
    .eq('id', id)
    .single();

  if (scheduleError || !schedule) {
    return Response.json({ error: 'Escala não encontrada' }, { status: 404 });
  }

  // Get base URL for confirmation links (never use localhost)
  const origin = request.headers.get('origin') || '';
  const baseUrl = origin.includes('localhost') 
    ? 'https://meupainel.expressoneves.com' 
    : (origin || 'https://meupainel.expressoneves.com');

  // Filter entries: pending only, and optionally by specific IDs
  let pendingEntries = (schedule.schedule_entries || []).filter(
    (e: { status: string }) => e.status === 'pending'
  );

  if (entryIdsFilter && entryIdsFilter.length > 0) {
    pendingEntries = pendingEntries.filter(
      (e: { id: string }) => entryIdsFilter!.includes(e.id)
    );
  }

  if (pendingEntries.length === 0) {
    return Response.json({ error: 'Nenhum motoboy pendente para envio' }, { status: 400 });
  }

  const company = schedule.company as { id: string; name: string; address: string | null };

  // ── Group entries by driver ──────────────────────────────────────
  interface DriverEntry {
    entryId: string;
    driverId: string;
    driverUUID: string;
    driverName: string;
    driverPhone: string | null;
    machineCondutorId: string | null;
    entryDate: string;
    shiftLabel: string;
    shiftStart: string;
    shiftEnd: string;
    dailyRate: number;
    confirmToken: string;
  }

  const driverGroups = new Map<string, DriverEntry[]>();

  for (const entry of pendingEntries) {
    const driver = (entry as { driver: { id: string; name: string; phone: string | null; machine_condutor_id: string | null } }).driver;
    const driverId = driver?.id || entry.driver_id;
    const token = entry.confirmation_token || randomUUID().replace(/-/g, '').slice(0, 12);

    const de: DriverEntry = {
      entryId: entry.id,
      driverId,
      driverUUID: driver?.id || '',
      driverName: driver?.name || 'Desconhecido',
      driverPhone: driver?.phone || null,
      machineCondutorId: driver?.machine_condutor_id || null,
      entryDate: entry.entry_date,
      shiftLabel: entry.shift_label,
      shiftStart: entry.shift_start,
      shiftEnd: entry.shift_end,
      dailyRate: Number(entry.daily_rate),
      confirmToken: token,
    };

    if (!driverGroups.has(driverId)) {
      driverGroups.set(driverId, []);
    }
    driverGroups.get(driverId)!.push(de);
  }

  // ── Send one consolidated message per driver ─────────────────────
  const results: Array<{
    entryId: string;
    driverName: string;
    success: boolean;
    error?: string;
  }> = [];

  for (const [, driverEntries] of driverGroups) {
    const first = driverEntries[0];
    let driverPhone = first.driverPhone;

    // If phone is missing, try to sync from Machine API
    if (!driverPhone && first.driverUUID) {
      console.log(`[SendSchedule] Driver ${first.driverName} has no phone. Trying Machine API sync...`);
      driverPhone = await syncDriverPhone(first.driverUUID, first.machineCondutorId);
    }

    if (!driverPhone) {
      // Mark all entries for this driver as failed
      for (const de of driverEntries) {
        results.push({
          entryId: de.entryId,
          driverName: de.driverName,
          success: false,
          error: 'Telefone não cadastrado',
        });
      }
      continue;
    }

    // Build consolidated message with all days
    const scheduleEntries = driverEntries.map(de => ({
      entryDate: de.entryDate,
      shiftLabel: de.shiftLabel,
      shiftStart: de.shiftStart,
      shiftEnd: de.shiftEnd,
      dailyRate: de.dailyRate,
      confirmUrl: `${baseUrl}/confirmar/${de.confirmToken}`,
    }));

    const message = buildConsolidatedMessage({
      driverName: first.driverName,
      companyName: company.name,
      entries: scheduleEntries,
    });

    const sendResult = await sendWhatsAppText(driverPhone, message);

    // Update all entries for this driver
    for (const de of driverEntries) {
      await supabase
        .from('schedule_entries')
        .update({
          status: sendResult.success ? 'sent' : 'pending',
          confirmation_token: de.confirmToken,
          sent_at: sendResult.success ? new Date().toISOString() : null,
        })
        .eq('id', de.entryId);

      results.push({
        entryId: de.entryId,
        driverName: de.driverName,
        success: sendResult.success,
        error: sendResult.error,
      });
    }
  }

  // Update schedule status
  const sentCount = results.filter(r => r.success).length;
  if (sentCount > 0) {
    await supabase
      .from('schedules')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
  }

  return Response.json({
    sent: sentCount,
    failed: results.filter(r => !r.success).length,
    total: results.length,
    details: results,
  });
}
