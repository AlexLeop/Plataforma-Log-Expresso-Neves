/**
 * /api/schedules/[id]/send-entry — Send WhatsApp notification for a SINGLE entry
 * 
 * This endpoint is simpler and more reliable than the bulk /send route.
 * It resets the entry to pending, sends the notification, and marks it sent.
 */
import { createServerClient } from '@/lib/supabase/client';
import { sendWhatsAppText, buildConsolidatedMessage } from '@/app/lib/evolution-go';
import { machineGet, MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { randomUUID } from 'crypto';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { id: scheduleId } = await context.params;
  const supabase = createServerClient();

  // Get entry_id from body
  let entryId: string | null = null;
  try {
    const body = await request.json();
    entryId = body?.entry_id || null;
  } catch {
    return Response.json({ error: 'entry_id é obrigatório' }, { status: 400 });
  }

  if (!entryId) {
    return Response.json({ error: 'entry_id é obrigatório' }, { status: 400 });
  }

  // Reset entry to pending + clear sent_at
  await supabase
    .from('schedule_entries')
    .update({ status: 'pending', sent_at: null })
    .eq('id', entryId)
    .eq('schedule_id', scheduleId);

  // Get entry with full details
  const { data: entry, error: entryError } = await supabase
    .from('schedule_entries')
    .select(`
      id, driver_id, entry_date, shift_label, shift_start, shift_end,
      daily_rate, status, confirmation_token,
      driver:drivers(id, name, phone, machine_condutor_id)
    `)
    .eq('id', entryId)
    .eq('schedule_id', scheduleId)
    .single();

  if (entryError || !entry) {
    return Response.json({ error: 'Entry não encontrada' }, { status: 404 });
  }

  // Get schedule with company
  const { data: schedule } = await supabase
    .from('schedules')
    .select('*, company:companies(id, name, address)')
    .eq('id', scheduleId)
    .single();

  if (!schedule) {
    return Response.json({ error: 'Escala não encontrada' }, { status: 404 });
  }

  const company = schedule.company as { id: string; name: string; address: string | null };
  const origin = request.headers.get('origin') || '';
  const baseUrl = origin.includes('localhost')
    ? 'https://meupainel.expressoneves.com'
    : (origin || 'https://meupainel.expressoneves.com');

  // Extract driver info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driverRaw = entry.driver as any;
  const driver = Array.isArray(driverRaw) ? driverRaw[0] : driverRaw;
  const driverName = driver?.name || 'Motoboy';
  let driverPhone = driver?.phone || null;
  const machineCondutorId = driver?.machine_condutor_id || null;

  // Try to get phone from Machine API if missing
  if (!driverPhone && machineCondutorId) {
    try {
      const result = await machineGet<{ response?: Array<Record<string, unknown>> }>(
        MACHINE_ENDPOINTS.condutor,
        { id: machineCondutorId }
      );
      if (result.ok) {
        const drivers = result.data.response || [];
        if (drivers.length > 0) {
          const md = drivers[0];
          driverPhone = (md.telefone || md.celular || md.phone) as string | undefined || null;
          if (driverPhone) {
            await supabase.from('drivers').update({ phone: driverPhone }).eq('id', driver.id);
          }
        }
      }
    } catch { /* silent */ }
  }

  if (!driverPhone) {
    return Response.json({
      sent: 0, failed: 1, total: 1,
      details: [{
        entryId,
        driverName,
        success: false,
        error: 'Motoboy sem telefone cadastrado',
      }],
    });
  }

  // Generate confirmation token if missing
  let token = entry.confirmation_token;
  if (!token) {
    token = randomUUID().replace(/-/g, '').slice(0, 12);
    await supabase
      .from('schedule_entries')
      .update({ confirmation_token: token })
      .eq('id', entryId);
  }

  // Build the message for this single entry
  const confirmUrl = `${baseUrl}/confirmar/${token}`;

  const entries = [{
    entryDate: entry.entry_date,
    shiftLabel: entry.shift_label,
    shiftStart: entry.shift_start,
    shiftEnd: entry.shift_end,
    dailyRate: Number(entry.daily_rate),
    confirmUrl,
  }];

  const message = buildConsolidatedMessage({ driverName, companyName: company.name, entries });

  // Send via Edge Function or direct
  console.log(`[SendEntry] Sending to ${driverName} (${driverPhone}) for ${entry.entry_date}`);
  const result = await sendWhatsAppText(driverPhone, message, 500);

  if (result.success) {
    // Mark entry as sent
    await supabase
      .from('schedule_entries')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', entryId);

    // Update schedule sent_at
    await supabase
      .from('schedules')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', scheduleId);
  }

  return Response.json({
    sent: result.success ? 1 : 0,
    failed: result.success ? 0 : 1,
    total: 1,
    details: [{
      entryId,
      driverName,
      success: result.success,
      error: result.error,
    }],
  });
}
