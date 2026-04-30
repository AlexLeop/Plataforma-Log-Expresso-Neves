/**
 * API Route: /api/db/snapshots
 * CRUD for financial_snapshots + snapshot_drivers
 */
import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { isSupabaseConfigured, resolveCompanyId, jsonError } from '../_helpers';
import { resolveTenant, requireCompanyMatch } from '@/lib/supabase/resolve-tenant';

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const machineId = req.nextUrl.searchParams.get('company_id');
  if (!machineId) return jsonError('company_id is required');

  const companyUUID = await resolveCompanyId(machineId);
  if (!companyUUID) return jsonError('Company not found', 404);

  // TENANT ISOLATION
  const tenant = await resolveTenant(req);
  if (tenant && !tenant.isAdmin) {
    const check = requireCompanyMatch(tenant, companyUUID);
    if (check) return check;
  }

  const supabase = createServerClient();

  const { data: snapshots, error } = await supabase
    .from('financial_snapshots')
    .select('*, snapshot_drivers(*)')
    .eq('company_id', companyUUID)
    .order('period_start', { ascending: false });

  if (error) return jsonError(error.message, 500);

  // Map DB → frontend format
  const result = (snapshots || []).map(snap => ({
    id: snap.id,
    companyId: Number(machineId),
    companyName: snap.company_name || '',
    weekStart: snap.period_start,
    weekEnd: snap.period_end,
    weekLabel: snap.week_label || '',
    status: snap.status === 'finalized' ? 'finalizado' : snap.status === 'locked' ? 'bloqueado' : snap.status,
    totalGeral: Number(snap.total_net_producao) || 0,
    drivers: (snap.snapshot_drivers || []).map((d: Record<string, unknown>) => ({
      driverId: d.driver_id,
      driverName: d.driver_name,
      totalDiaria: Number(d.total_diaria),
      totalExtras: Number(d.total_extras),
      totalTaxaCorridas: Number(d.total_taxa_corridas),
      totalAdiantamentos: Number(d.total_adiantamentos),
      totalLiquido: Number(d.total_liquido),
      entregas: Number(d.entregas),
      corridas: Number(d.corridas),
    })),
    createdAt: snap.created_at,
    finalizedAt: snap.finalized_at,
    lockedAt: snap.locked_at,
    notes: snap.notes,
  }));

  return Response.json(result);
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const body = await req.json();
  const machineId = body.companyId || body.company_id;
  if (!machineId) return jsonError('companyId is required');

  const companyUUID = await resolveCompanyId(machineId);
  if (!companyUUID) return jsonError('Company not found', 404);

  const supabase = createServerClient();

  // Check if snapshot exists for this week
  const { data: existing } = await supabase
    .from('financial_snapshots')
    .select('id, status')
    .eq('company_id', companyUUID)
    .eq('period_start', body.weekStart)
    .single();

  if (existing) {
    if (existing.status !== 'draft') {
      return Response.json({ id: existing.id, message: 'Snapshot already finalized' });
    }

    // Update existing draft
    await supabase
      .from('financial_snapshots')
      .update({
        total_net_producao: body.totalGeral,
        company_name: body.companyName,
        week_label: body.weekLabel,
        notes: body.notes,
      })
      .eq('id', existing.id);

    // Replace drivers
    await supabase
      .from('snapshot_drivers')
      .delete()
      .eq('snapshot_id', existing.id);

    if (body.drivers?.length) {
      await supabase
        .from('snapshot_drivers')
        .insert(body.drivers.map((d: Record<string, unknown>) => ({
          snapshot_id: existing.id,
          driver_id: String(d.driverId),
          driver_name: String(d.driverName),
          total_diaria: Number(d.totalDiaria) || 0,
          total_extras: Number(d.totalExtras) || 0,
          total_taxa_corridas: Number(d.totalTaxaCorridas) || 0,
          total_adiantamentos: Number(d.totalAdiantamentos) || 0,
          total_liquido: Number(d.totalLiquido) || 0,
          entregas: Number(d.entregas) || 0,
          corridas: Number(d.corridas) || 0,
        })));
    }

    return Response.json({ id: existing.id, updated: true });
  }

  // Create new snapshot
  const { data: snap, error } = await supabase
    .from('financial_snapshots')
    .insert({
      company_id: companyUUID,
      period_start: body.weekStart,
      period_end: body.weekEnd,
      status: 'draft',
      total_net_producao: body.totalGeral || 0,
      company_name: body.companyName,
      week_label: body.weekLabel,
      notes: body.notes,
    })
    .select('id')
    .single();

  if (error) return jsonError(error.message, 500);

  // Insert drivers
  if (body.drivers?.length && snap) {
    await supabase
      .from('snapshot_drivers')
      .insert(body.drivers.map((d: Record<string, unknown>) => ({
        snapshot_id: snap.id,
        driver_id: String(d.driverId),
        driver_name: String(d.driverName),
        total_diaria: Number(d.totalDiaria) || 0,
        total_extras: Number(d.totalExtras) || 0,
        total_taxa_corridas: Number(d.totalTaxaCorridas) || 0,
        total_adiantamentos: Number(d.totalAdiantamentos) || 0,
        total_liquido: Number(d.totalLiquido) || 0,
        entregas: Number(d.entregas) || 0,
        corridas: Number(d.corridas) || 0,
      })));
  }

  return Response.json({ id: snap?.id, created: true });
}

export async function PUT(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const body = await req.json();
  const { id, action, notes } = body;

  if (!id) return jsonError('id is required');

  const supabase = createServerClient();

  // TENANT ISOLATION: verify snapshot belongs to user's company
  const tenant = await resolveTenant(req);
  if (tenant && !tenant.isAdmin) {
    const { data: snap } = await supabase
      .from('financial_snapshots')
      .select('company_id')
      .eq('id', id)
      .single();
    if (snap) {
      const check = requireCompanyMatch(tenant, snap.company_id);
      if (check) return check;
    }
  }

  if (action === 'finalize') {
    const { error } = await supabase
      .from('financial_snapshots')
      .update({ status: 'finalized', finalized_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'draft');
    if (error) return jsonError(error.message, 500);
  } else if (action === 'lock') {
    const { error } = await supabase
      .from('financial_snapshots')
      .update({ status: 'locked', locked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'finalized');
    if (error) return jsonError(error.message, 500);
  } else if (action === 'reopen') {
    const { error } = await supabase
      .from('financial_snapshots')
      .update({ status: 'draft', finalized_at: null })
      .eq('id', id)
      .eq('status', 'finalized');
    if (error) return jsonError(error.message, 500);
  } else if (notes !== undefined) {
    const { error } = await supabase
      .from('financial_snapshots')
      .update({ notes })
      .eq('id', id);
    if (error) return jsonError(error.message, 500);
  }

  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return jsonError('id is required');

  const supabase = createServerClient();

  // TENANT ISOLATION: verify snapshot belongs to user's company
  const tenant = await resolveTenant(req);
  if (tenant && !tenant.isAdmin) {
    const { data: snapRow } = await supabase
      .from('financial_snapshots')
      .select('company_id, status')
      .eq('id', id)
      .single();
    if (snapRow) {
      const check = requireCompanyMatch(tenant, snapRow.company_id);
      if (check) return check;
      if (snapRow.status === 'locked') {
        return jsonError('Cannot delete locked snapshot', 403);
      }
    }
    // Cascade will delete snapshot_drivers
    const { error } = await supabase
      .from('financial_snapshots')
      .delete()
      .eq('id', id);
    if (error) return jsonError(error.message, 500);
    return Response.json({ ok: true });
  }

  // Admin path — original logic
  // Check if locked
  const { data: snap } = await supabase
    .from('financial_snapshots')
    .select('status')
    .eq('id', id)
    .single();

  if (snap?.status === 'locked') {
    return jsonError('Cannot delete locked snapshot', 403);
  }

  // Cascade will delete snapshot_drivers
  const { error } = await supabase
    .from('financial_snapshots')
    .delete()
    .eq('id', id);

  if (error) return jsonError(error.message, 500);
  return Response.json({ ok: true });
}
