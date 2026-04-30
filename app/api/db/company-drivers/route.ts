/**
 * API Route: /api/db/company-drivers
 * CRUD for company_drivers (associação motoboy ↔ loja)
 * 
 * GET    ?company_id=X           → Lista motoboys associados à loja
 * GET    ?driver_id=X            → Lista lojas associadas ao motoboy
 * POST   { companyId, driverId, isPrimary }  → Associa motoboy à loja
 * PATCH  { companyId, driverId, isPrimary }  → Atualiza flag de loja prioritária
 * DELETE ?company_id=X&driver_id=Y           → Remove associação
 */
import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { isSupabaseConfigured, resolveCompanyId, resolveDriverId, jsonError } from '../_helpers';
import { resolveTenant, requireCompanyMatch } from '@/lib/supabase/resolve-tenant';

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const machineCompanyId = req.nextUrl.searchParams.get('company_id');
  const machineDriverId = req.nextUrl.searchParams.get('driver_id');

  const supabase = createServerClient();

  // List drivers for a company
  if (machineCompanyId) {
    const companyUUID = await resolveCompanyId(machineCompanyId);
    if (!companyUUID) return jsonError('Company not found', 404);

    // TENANT ISOLATION
    const tenant = await resolveTenant(req);
    if (tenant && !tenant.isAdmin) {
      const check = requireCompanyMatch(tenant, companyUUID);
      if (check) return check;
    }

    const { data, error } = await supabase
      .from('company_drivers')
      .select(`
        id,
        active,
        is_primary,
        created_at,
        drivers!inner ( id, machine_condutor_id, name, cpf, phone, status )
      `)
      .eq('company_id', companyUUID)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[CompanyDrivers GET] Error:', error.message);
      return jsonError(error.message, 500);
    }

    const result = (data || []).map((row: Record<string, unknown>) => {
      const driver = row.drivers as { id: string; machine_condutor_id: string; name: string; cpf: string; phone: string; status: string } | null;
      return {
        linkId: row.id,
        active: row.active,
        isPrimary: row.is_primary,
        createdAt: row.created_at,
        driverId: driver?.machine_condutor_id || '',
        driverUUID: driver?.id || '',
        driverName: driver?.name || '',
        driverCpf: driver?.cpf || '',
        driverPhone: driver?.phone || '',
        driverStatus: driver?.status || '',
      };
    });

    return Response.json(result);
  }

  // List companies for a driver
  if (machineDriverId) {
    const driverUUID = await resolveDriverId(machineDriverId);
    if (!driverUUID) return jsonError('Driver not found', 404);

    const { data, error } = await supabase
      .from('company_drivers')
      .select(`
        id,
        active,
        is_primary,
        created_at,
        companies!inner ( id, machine_empresa_id, name )
      `)
      .eq('driver_id', driverUUID)
      .order('is_primary', { ascending: false });

    if (error) {
      console.error('[CompanyDrivers GET] Error:', error.message);
      return jsonError(error.message, 500);
    }

    const result = (data || []).map((row: Record<string, unknown>) => {
      const company = row.companies as { id: string; machine_empresa_id: string; name: string } | null;
      return {
        linkId: row.id,
        active: row.active,
        isPrimary: row.is_primary,
        createdAt: row.created_at,
        companyId: company?.machine_empresa_id || '',
        companyName: company?.name || '',
      };
    });

    return Response.json(result);
  }

  return jsonError('company_id or driver_id is required');
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const body = await req.json();
  const { companyId, driverId, driverName, isPrimary } = body;

  if (!companyId || !driverId) {
    return jsonError('companyId and driverId are required');
  }

  const companyUUID = await resolveCompanyId(companyId);
  if (!companyUUID) return jsonError('Company not found', 404);

  // TENANT ISOLATION
  const tenant = await resolveTenant(req);
  if (tenant && !tenant.isAdmin) {
    const check = requireCompanyMatch(tenant, companyUUID);
    if (check) return check;
  }

  const driverUUID = await resolveDriverId(driverId, driverName);
  if (!driverUUID) return jsonError('Driver not found', 404);

  const supabase = createServerClient();

  // If marking as primary, unset other primaries for this driver first
  if (isPrimary) {
    await supabase
      .from('company_drivers')
      .update({ is_primary: false })
      .eq('driver_id', driverUUID)
      .eq('is_primary', true);
  }

  const { data, error } = await supabase
    .from('company_drivers')
    .upsert({
      company_id: companyUUID,
      driver_id: driverUUID,
      active: true,
      is_primary: isPrimary || false,
    }, { onConflict: 'company_id,driver_id' })
    .select()
    .single();

  if (error) {
    console.error('[CompanyDrivers POST] Error:', error.message);
    return jsonError(error.message, 500);
  }

  return Response.json(data);
}

export async function PATCH(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const body = await req.json();
  const { companyId, driverId, isPrimary, active } = body;

  if (!companyId || !driverId) {
    return jsonError('companyId and driverId are required');
  }

  const companyUUID = await resolveCompanyId(companyId);
  if (!companyUUID) return jsonError('Company not found', 404);

  // TENANT ISOLATION
  const tenant = await resolveTenant(req);
  if (tenant && !tenant.isAdmin) {
    const check = requireCompanyMatch(tenant, companyUUID);
    if (check) return check;
  }

  const driverUUID = await resolveDriverId(driverId);
  if (!driverUUID) return jsonError('Driver not found', 404);

  const supabase = createServerClient();

  // If marking as primary, unset other primaries for this driver first
  if (isPrimary) {
    await supabase
      .from('company_drivers')
      .update({ is_primary: false })
      .eq('driver_id', driverUUID)
      .eq('is_primary', true);
  }

  const updateData: Record<string, unknown> = {};
  if (isPrimary !== undefined) updateData.is_primary = isPrimary;
  if (active !== undefined) updateData.active = active;

  const { data, error } = await supabase
    .from('company_drivers')
    .update(updateData)
    .eq('company_id', companyUUID)
    .eq('driver_id', driverUUID)
    .select()
    .single();

  if (error) {
    console.error('[CompanyDrivers PATCH] Error:', error.message);
    return jsonError(error.message, 500);
  }

  return Response.json(data);
}

export async function DELETE(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const machineCompanyId = req.nextUrl.searchParams.get('company_id');
  const machineDriverId = req.nextUrl.searchParams.get('driver_id');

  if (!machineCompanyId || !machineDriverId) {
    return jsonError('company_id and driver_id are required');
  }

  const companyUUID = await resolveCompanyId(machineCompanyId);
  if (!companyUUID) return jsonError('Company not found', 404);

  // TENANT ISOLATION
  const tenant = await resolveTenant(req);
  if (tenant && !tenant.isAdmin) {
    const check = requireCompanyMatch(tenant, companyUUID);
    if (check) return check;
  }

  const driverUUID = await resolveDriverId(machineDriverId);
  if (!driverUUID) return jsonError('Driver not found', 404);

  const supabase = createServerClient();

  const { error } = await supabase
    .from('company_drivers')
    .delete()
    .eq('company_id', companyUUID)
    .eq('driver_id', driverUUID);

  if (error) {
    console.error('[CompanyDrivers DELETE] Error:', error.message);
    return jsonError(error.message, 500);
  }

  return Response.json({ ok: true });
}
