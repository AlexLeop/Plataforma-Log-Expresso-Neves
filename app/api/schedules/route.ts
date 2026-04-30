/**
 * /api/schedules — List and create schedules
 */
import { createServerClient } from '@/lib/supabase/client';
import { resolveTenant, requireCompanyMatch } from '@/lib/supabase/resolve-tenant';

export async function GET(request: Request) {
  // ─── TENANT ISOLATION ───
  const tenant = await resolveTenant(request);
  if (!tenant) {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const supabase = createServerClient();
  const { searchParams } = new URL(request.url);

  const companyId = searchParams.get('company_id');
  const weekStart = searchParams.get('week_start');

  // Validate company access
  if (companyId) {
    const check = requireCompanyMatch(tenant, companyId);
    if (check) return check;
  }

  let query = supabase
    .from('schedules')
    .select(`
      *,
      company:companies(id, name),
      schedule_entries(
        id, driver_id, entry_date, shift_label, shift_start, shift_end,
        daily_rate, status, confirmation_token, confirmed_at, sent_at, notes,
        driver:drivers(id, name, phone)
      )
    `)
    .order('week_start', { ascending: false });

  if (companyId) query = query.eq('company_id', companyId);
  if (weekStart) query = query.eq('week_start', weekStart);

  // Force company filter for non-admin
  if (!tenant.isAdmin && tenant.allowedCompanyIds && tenant.allowedCompanyIds.length > 0) {
    query = query.in('company_id', tenant.allowedCompanyIds);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ schedules: data });
}

export async function POST(request: Request) {
  // ─── TENANT ISOLATION ───
  const tenant = await resolveTenant(request);
  if (!tenant) {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const supabase = createServerClient();
  const body = await request.json();

  const {
    company_id,
    week_start,
    week_end,
    created_by_name,
    confirmation_limit_hours = 2,
    notes,
    entries = [],
  } = body;

  if (!company_id || !week_start || !week_end) {
    return Response.json(
      { error: 'Campos obrigatórios: company_id, week_start, week_end' },
      { status: 400 }
    );
  }

  // Create schedule header
  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .insert({
      company_id,
      week_start,
      week_end,
      created_by_name: created_by_name || 'Sistema',
      confirmation_limit_hours,
      notes,
      status: 'draft',
    })
    .select()
    .single();


  if (scheduleError) {
    return Response.json({ error: scheduleError.message }, { status: 500 });
  }

  // Insert entries if provided
  if (entries.length > 0) {
    const entryRows = entries.map((e: {
      driver_id: string;
      entry_date: string;
      shift_label?: string;
      shift_start?: string;
      shift_end?: string;
      daily_rate?: number;
      notes?: string;
    }) => ({
      schedule_id: schedule.id,
      company_id,
      driver_id: e.driver_id,
      entry_date: e.entry_date,
      shift_label: e.shift_label || 'Integral',
      shift_start: e.shift_start || '08:00',
      shift_end: e.shift_end || '18:00',
      daily_rate: e.daily_rate ?? 60.0,
      status: 'pending',
      notes: e.notes,
    }));

    const { error: entriesError } = await supabase
      .from('schedule_entries')
      .insert(entryRows);

    if (entriesError) {
      // Rollback schedule
      await supabase.from('schedules').delete().eq('id', schedule.id);
      return Response.json({ error: entriesError.message }, { status: 500 });
    }
  }

  // Fetch complete schedule with entries
  const { data: full } = await supabase
    .from('schedules')
    .select(`
      *,
      schedule_entries(
        id, driver_id, entry_date, shift_label, shift_start, shift_end,
        daily_rate, status, notes,
        driver:drivers(id, name, phone)
      )
    `)
    .eq('id', schedule.id)
    .single();

  return Response.json({ schedule: full }, { status: 201 });
}
