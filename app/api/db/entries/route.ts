/**
 * API Route: /api/db/entries
 * CRUD for manual_entries (dailies + extras + missoes + adiantamentos)
 * 
 * All driver/company IDs from the frontend are Machine IDs (numeric).
 * This route resolves them to Supabase UUIDs before DB operations.
 */
import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { isSupabaseConfigured, resolveCompanyId, resolveDriverId, jsonError } from '../_helpers';
import { resolveTenant, requireCompanyMatch } from '@/lib/supabase/resolve-tenant';

// Map frontend types to DB types
const TYPE_MAP: Record<string, string> = {
  diaria: 'daily_rate',
  extra: 'extra',
  missao: 'mission',
  adiantamento: 'advance',
};
const REVERSE_TYPE_MAP: Record<string, string> = {
  daily_rate: 'diaria',
  extra: 'extra',
  mission: 'missao',
  advance: 'adiantamento',
};

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const machineId = req.nextUrl.searchParams.get('company_id');
  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');

  if (!machineId) return jsonError('company_id is required');

  // TENANT ISOLATION: verify the requested company belongs to this user
  const tenant = await resolveTenant(req);
  if (tenant && !tenant.isAdmin) {
    const companyCheck = requireCompanyMatch(tenant, await resolveCompanyId(machineId) || undefined);
    if (companyCheck) return companyCheck;
  }

  const companyUUID = await resolveCompanyId(machineId);
  if (!companyUUID) return jsonError('Company not found', 404);

  const supabase = createServerClient();

  let query = supabase
    .from('manual_entries')
    .select(`
      id,
      company_id,
      driver_id,
      entry_date,
      entry_type,
      amount,
      description,
      source,
      credit_status,
      credited_at,
      credit_error,
      created_at,
      updated_at,
      drivers!inner ( machine_condutor_id, name )
    `)
    .eq('company_id', companyUUID)
    .order('entry_date', { ascending: false });

  if (start) query = query.gte('entry_date', start);
  if (end) query = query.lte('entry_date', end);

  const { data, error } = await query;
  if (error) {
    console.error('[Entries GET] Error:', error.message);
    // Fallback: try without join if drivers table join fails
    const fallbackQuery = supabase
      .from('manual_entries')
      .select('*')
      .eq('company_id', companyUUID)
      .order('entry_date', { ascending: false });

    if (start) fallbackQuery.gte('entry_date', start);
    if (end) fallbackQuery.lte('entry_date', end);

    const { data: fallbackData, error: fallbackError } = await fallbackQuery;
    if (fallbackError) return jsonError(fallbackError.message, 500);

    const entries = (fallbackData || []).map(row => ({
      id: row.id,
      driverId: row.driver_id,
      driverName: row.description?.split('|driver_name:')[1] || '',
      date: row.entry_date,
      type: REVERSE_TYPE_MAP[row.entry_type] || row.entry_type,
      amount: Number(row.amount),
      description: row.description?.split('|driver_name:')[0] || row.description || '',
      companyId: Number(machineId),
      createdAt: row.created_at,
    }));
    return Response.json(entries);
  }

  // Map DB → frontend format (with driver info from join)
  const entries = (data || []).map((row: Record<string, unknown>) => {
    const driver = row.drivers as { machine_condutor_id: string; name: string } | null;
    const desc = String(row.description || '');
    const descParts = desc.split('|');
    let driverName = driver?.name || '';
    let cleanDesc = desc;
    let turnoId = undefined;

    if (desc.includes('|driver_name:') || desc.includes('|turno_id:')) {
      cleanDesc = descParts[0];
      const dnPart = descParts.find(p => p.startsWith('driver_name:'));
      if (dnPart && !driverName) driverName = dnPart.replace('driver_name:', '');
      const tPart = descParts.find(p => p.startsWith('turno_id:'));
      if (tPart) turnoId = tPart.replace('turno_id:', '');
    }

    return {
      id: row.id,
      driverId: driver?.machine_condutor_id || String(row.driver_id),
      driverName,
      date: row.entry_date,
      type: REVERSE_TYPE_MAP[String(row.entry_type)] || row.entry_type,
      amount: Number(row.amount),
      description: cleanDesc,
      companyId: Number(machineId),
      createdAt: row.created_at,
      creditStatus: row.credit_status || 'pending',
      creditedAt: row.credited_at || null,
      creditError: row.credit_error || null,
      ...(turnoId ? { turnoId } : {}),
    };
  });

  return Response.json(entries);
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const body = await req.json();
  const machineId = body.companyId || body.company_id;
  if (!machineId) return jsonError('companyId is required');

  const companyUUID = await resolveCompanyId(machineId);
  if (!companyUUID) return jsonError('Company not found', 404);

  // Resolve driver Machine ID → UUID (auto-creates if needed)
  const driverUUID = await resolveDriverId(body.driverId, body.driverName);
  if (!driverUUID) return jsonError('Driver could not be resolved', 500);

  const supabase = createServerClient();
  const entryType = TYPE_MAP[body.type] || body.type || 'daily_rate';

  // Store driver name and turnoId in description for easy retrieval mapping
  let description = `${body.description || (entryType === 'daily_rate' ? 'Diária' : '')}|driver_name:${body.driverName || ''}`;
  if (body.turnoId) {
    description += `|turno_id:${body.turnoId}`;
  }

  // For daily entries, use upsert (one per driver/date/company/turno)
  if (entryType === 'daily_rate') {
    // Check if entry exists for this fraction of the day
    const { data: existingRows } = await supabase
      .from('manual_entries')
      .select('id, description')
      .eq('company_id', companyUUID)
      .eq('driver_id', driverUUID)
      .eq('entry_date', body.date)
      .eq('entry_type', 'daily_rate');

    const existing = (existingRows || []).find(row => {
      return body.turnoId 
        ? row.description?.includes(`|turno_id:${body.turnoId}`)
        : !row.description?.includes('|turno_id:');
    });

    if (existing) {
      const { data, error } = await supabase
        .from('manual_entries')
        .update({
          amount: body.amount,
          description,
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        console.error('[Entries POST] Update error:', error.message);
        return jsonError(error.message, 500);
      }
      return Response.json(data);
    }

    const { data, error } = await supabase
      .from('manual_entries')
      .insert({
        company_id: companyUUID,
        driver_id: driverUUID,
        entry_date: body.date,
        entry_type: 'daily_rate',
        amount: body.amount,
        description,
        source: 'manual',
      })
      .select()
      .single();

    if (error) {
      console.error('[Entries POST] Insert error:', error.message);
      return jsonError(error.message, 500);
    }
    return Response.json(data);
  }

  // For other entry types (extra, mission, advance)
  const { data, error } = await supabase
    .from('manual_entries')
    .insert({
      company_id: companyUUID,
      driver_id: driverUUID,
      entry_date: body.date,
      entry_type: entryType,
      amount: body.amount,
      description,
      source: 'manual',
    })
    .select()
    .single();

  if (error) {
    console.error('[Entries POST] Insert error:', error.message);
    return jsonError(error.message, 500);
  }
  return Response.json(data);
}

export async function DELETE(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const id = req.nextUrl.searchParams.get('id');
  const machineDriverId = req.nextUrl.searchParams.get('driver_id');
  const date = req.nextUrl.searchParams.get('date');
  const machineId = req.nextUrl.searchParams.get('company_id');

  const supabase = createServerClient();

  // Delete by ID — MUST verify ownership
  if (id) {
    // TENANT ISOLATION: verify the entry belongs to this user's company
    const tenant = await resolveTenant(req);
    if (tenant && !tenant.isAdmin) {
      const { data: entry } = await supabase
        .from('manual_entries')
        .select('company_id')
        .eq('id', id)
        .single();
      if (entry) {
        const ownerCheck = requireCompanyMatch(tenant, entry.company_id);
        if (ownerCheck) return ownerCheck;
      }
    }

    const { error } = await supabase
      .from('manual_entries')
      .delete()
      .eq('id', id);

    if (error) return jsonError(error.message, 500);
    return Response.json({ ok: true });
  }

  // Delete daily entry by driver+date+company
  if (machineDriverId && date && machineId) {
    const companyUUID = await resolveCompanyId(machineId);
    if (!companyUUID) return jsonError('Company not found', 404);

    // Resolve driver ID to UUID
    const driverUUID = await resolveDriverId(machineDriverId);
    if (!driverUUID) return jsonError('Driver not found', 404);

    const turnoId = req.nextUrl.searchParams.get('turno_id');

    // To cleanly delete using the parsed logic, fetch the IDs if we need substring match:
    const { data: existingRows } = await supabase
      .from('manual_entries')
      .select('id, description')
      .eq('company_id', companyUUID)
      .eq('driver_id', driverUUID)
      .eq('entry_date', date)
      .eq('entry_type', 'daily_rate');

    const target = (existingRows || []).find(row => {
      return turnoId 
        ? row.description?.includes(`|turno_id:${turnoId}`)
        : !row.description?.includes('|turno_id:');
    });

    if (target) {
      const { error } = await supabase
        .from('manual_entries')
        .delete()
        .eq('id', target.id);
      if (error) return jsonError(error.message, 500);
    }
    
    return Response.json({ ok: true });
  }

  return jsonError('id or (driver_id + date + company_id) required');
}
