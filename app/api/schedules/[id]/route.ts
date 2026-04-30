/**
 * /api/schedules/[id] — Get, update, delete a schedule
 */
import { createServerClient } from '@/lib/supabase/client';
import { resolveTenant, requireCompanyMatch } from '@/lib/supabase/resolve-tenant';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const tenant = await resolveTenant(request);
  if (!tenant) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await context.params;
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('schedules')
    .select(`
      *,
      company:companies(id, name, address),
      schedule_entries(
        id, driver_id, entry_date, shift_label, shift_start, shift_end,
        daily_rate, status, confirmation_token, confirmed_at, sent_at, notes,
        manual_entry_id,
        driver:drivers(id, name, phone)
      )
    `)
    .eq('id', id)
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: error.code === 'PGRST116' ? 404 : 500 });
  }

  // Validate tenant owns this schedule
  if (data && !tenant.isAdmin) {
    const check = requireCompanyMatch(tenant, data.company_id);
    if (check) return check;
  }

  return Response.json({ schedule: data });
}

export async function PUT(request: Request, context: RouteContext) {
  const tenant = await resolveTenant(request);
  if (!tenant) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await context.params;
  const supabase = createServerClient();
  const body = await request.json();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.status != null) updates.status = body.status;
  if (body.confirmation_limit_hours != null) updates.confirmation_limit_hours = body.confirmation_limit_hours;
  if (body.notes !== undefined) updates.notes = body.notes;

  const { data, error } = await supabase
    .from('schedules')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Handle entry updates if provided
  if (body.entries_to_add && Array.isArray(body.entries_to_add)) {
    const rows = body.entries_to_add.map((e: {
      driver_id: string;
      entry_date: string;
      shift_label?: string;
      shift_start?: string;
      shift_end?: string;
      daily_rate?: number;
      notes?: string;
    }) => ({
      schedule_id: id,
      company_id: data.company_id,
      driver_id: e.driver_id,
      entry_date: e.entry_date,
      shift_label: e.shift_label || 'Integral',
      shift_start: e.shift_start || '08:00',
      shift_end: e.shift_end || '18:00',
      daily_rate: e.daily_rate ?? 60.0,
      status: 'pending',
      notes: e.notes,
    }));

    await supabase.from('schedule_entries').insert(rows);
  }

  if (body.entries_to_remove && Array.isArray(body.entries_to_remove)) {
    await supabase
      .from('schedule_entries')
      .delete()
      .in('id', body.entries_to_remove)
      .eq('status', 'pending');
  }

  // Update individual entry status (e.g. no_show, cancelled)
  if (body.entry_status_updates && Array.isArray(body.entry_status_updates)) {
    for (const u of body.entry_status_updates) {
      const entryUpdates: Record<string, unknown> = { status: u.status };

      // If resetting back to pending, clear sent_at
      if (u.status === 'pending') {
        entryUpdates.sent_at = null;
      }

      // If marking as no_show, delete the associated manual_entry
      if (u.status === 'no_show') {
        const { data: entry } = await supabase
          .from('schedule_entries')
          .select('manual_entry_id')
          .eq('id', u.id)
          .single();

        if (entry?.manual_entry_id) {
          await supabase.from('manual_entries').delete().eq('id', entry.manual_entry_id);
          entryUpdates.manual_entry_id = null;
        }
      }

      await supabase
        .from('schedule_entries')
        .update(entryUpdates)
        .eq('id', u.id);
    }
  }

  // Reset individual entry sent_at (for per-entry resend)
  if (body.reset_entry_sent_at && Array.isArray(body.reset_entry_sent_at)) {
    await supabase
      .from('schedule_entries')
      .update({ sent_at: null })
      .in('id', body.reset_entry_sent_at);
  }

  // Reset sent entries back to pending (for resend)
  if (body.reset_sent_entries === true) {
    await supabase
      .from('schedule_entries')
      .update({ status: 'pending', sent_at: null })
      .eq('schedule_id', id)
      .eq('status', 'sent');

    // Reset schedule status back to draft
    await supabase
      .from('schedules')
      .update({ status: 'draft', sent_at: null, updated_at: new Date().toISOString() })
      .eq('id', id);
  }

  return Response.json({ schedule: data });
}

export async function DELETE(request: Request, context: RouteContext) {
  const tenant = await resolveTenant(request);
  if (!tenant) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await context.params;
  const supabase = createServerClient();

  // Only allow deleting draft schedules
  const { data: schedule } = await supabase
    .from('schedules')
    .select('status')
    .eq('id', id)
    .single();

  if (schedule?.status !== 'draft') {
    return Response.json(
      { error: 'Apenas escalas em rascunho podem ser excluídas' },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from('schedules')
    .delete()
    .eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
