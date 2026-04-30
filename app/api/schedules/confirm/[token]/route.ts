/**
 * /api/schedules/confirm/[token] — Public confirmation endpoint (no auth)
 * GET: Returns entry data for the confirmation page
 * POST: Confirms attendance and creates manual_entry
 *
 * Deadline rules:
 *   - First send: driver must confirm up to 2h AFTER shift_start (grace period)
 *   - Resend: driver has confirmation_limit_hours from sent_at
 */
import { createServerClient } from '@/lib/supabase/client';

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * Calculate the confirmation deadline.
 * - If the entry was resent (sent_at is significantly after created_at),
 *   deadline = sent_at + limit_hours
 * - Otherwise (first send), deadline = entry_date+shift_start + limit_hours
 */
function calculateDeadline(
  entryDate: string,
  shiftStart: string,
  sentAt: string | null,
  createdAt: string,
  limitHours: number,
): Date {
  const limitMs = limitHours * 60 * 60 * 1000;

  if (sentAt) {
    const sentTime = new Date(sentAt).getTime();
    const createdTime = new Date(createdAt).getTime();
    // If resent (sent_at is >5 min after created_at), use sent_at as anchor
    const isResend = sentTime - createdTime > 5 * 60 * 1000;
    if (isResend) {
      return new Date(sentTime + limitMs);
    }
  }

  // First send: deadline = shift_start + limit_hours
  const shiftDateTime = new Date(`${entryDate}T${shiftStart}`);
  return new Date(shiftDateTime.getTime() + limitMs);
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const supabase = createServerClient();

  const { data: entry, error } = await supabase
    .from('schedule_entries')
    .select(`
      id, entry_date, shift_label, shift_start, shift_end, daily_rate,
      status, confirmed_at, created_at, sent_at,
      schedule:schedules(id, confirmation_limit_hours, company_id,
        company:companies(id, name, address)
      ),
      driver:drivers(id, name)
    `)
    .eq('confirmation_token', token)
    .single();

  if (error || !entry) {
    return Response.json({ error: 'Link inválido ou expirado' }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scheduleRaw = entry.schedule as any;
  const schedule = (Array.isArray(scheduleRaw) ? scheduleRaw[0] : scheduleRaw) as {
    id: string;
    confirmation_limit_hours: number;
    company_id: string;
    company: { id: string; name: string; address: string | null } | Array<{ id: string; name: string; address: string | null }>;
  };
  const company = Array.isArray(schedule.company) ? schedule.company[0] : schedule.company;

  const deadline = calculateDeadline(
    entry.entry_date,
    entry.shift_start,
    entry.sent_at,
    entry.created_at,
    schedule.confirmation_limit_hours,
  );
  const now = new Date();
  const expired = now > deadline && entry.status !== 'confirmed';

  return Response.json({
    entry: {
      id: entry.id,
      date: entry.entry_date,
      shiftLabel: entry.shift_label,
      shiftStart: entry.shift_start,
      shiftEnd: entry.shift_end,
      dailyRate: Number(entry.daily_rate),
      status: expired ? 'expired' : entry.status,
      confirmedAt: entry.confirmed_at,
    },
    driver: entry.driver,
    company,
    deadline: deadline.toISOString(),
    expired,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const supabase = createServerClient();

  const { data: entry, error } = await supabase
    .from('schedule_entries')
    .select(`
      id, driver_id, company_id, entry_date, shift_label, shift_start, shift_end,
      daily_rate, status, manual_entry_id, created_at, sent_at,
      schedule:schedules(id, confirmation_limit_hours),
      driver:drivers(id, name)
    `)
    .eq('confirmation_token', token)
    .single();

  if (error || !entry) {
    return Response.json({ error: 'Link inválido ou expirado' }, { status: 404 });
  }

  // Already confirmed
  if (entry.status === 'confirmed') {
    return Response.json({ error: 'Presença já confirmada', status: 'confirmed' }, { status: 400 });
  }

  // Check if cancelled
  if (entry.status === 'cancelled') {
    return Response.json({ error: 'Esta escala foi cancelada', status: 'cancelled' }, { status: 400 });
  }

  // Check expiration with dynamic deadline
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scheduleRaw2 = entry.schedule as any;
  const schedule = (Array.isArray(scheduleRaw2) ? scheduleRaw2[0] : scheduleRaw2) as { id: string; confirmation_limit_hours: number };

  const deadline = calculateDeadline(
    entry.entry_date,
    entry.shift_start,
    entry.sent_at,
    entry.created_at,
    schedule.confirmation_limit_hours,
  );

  if (new Date() > deadline) {
    return Response.json({ error: 'Período de confirmação encerrado', status: 'expired' }, { status: 400 });
  }

  // Get driver name for metadata
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driverRaw = entry.driver as any;
  const driver = Array.isArray(driverRaw) ? driverRaw[0] : driverRaw;
  const driverName = driver?.name || '';

  // Build description with metadata compatible with entries-store parsing
  const description = `Diária|driver_name:${driverName}`;

  // Create the manual_entry (automatic daily rate)
  const { data: manualEntry, error: meError } = await supabase
    .from('manual_entries')
    .insert({
      company_id: entry.company_id,
      driver_id: entry.driver_id,
      entry_date: entry.entry_date,
      entry_type: 'daily_rate',
      amount: entry.daily_rate,
      source: 'schedule',
      description,
      credit_status: 'pending',
    })
    .select('id')
    .single();

  if (meError) {
    console.error('[Confirm] Failed to create manual_entry:', meError.message);
    return Response.json({ error: 'Erro ao registrar confirmação' }, { status: 500 });
  }

  // Update schedule_entry
  const now = new Date().toISOString();
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  await supabase
    .from('schedule_entries')
    .update({
      status: 'confirmed',
      confirmed_at: now,
      confirmed_ip: ip,
      manual_entry_id: manualEntry.id,
    })
    .eq('id', entry.id);

  return Response.json({
    success: true,
    status: 'confirmed',
    confirmedAt: now,
    manualEntryId: manualEntry.id,
  });
}
