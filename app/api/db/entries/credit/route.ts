/**
 * API Route: /api/db/entries/credit
 * Credit log CRUD — tracks Machine wallet credit operations
 */
import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { isSupabaseConfigured, resolveCompanyId, jsonError } from '../../_helpers';
import { resolveTenant, requireCompanyMatch } from '@/lib/supabase/resolve-tenant';

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const machineId = req.nextUrl.searchParams.get('company_id');
  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');

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

  let query = supabase
    .from('credit_log')
    .select('*')
    .eq('company_id', companyUUID)
    .order('created_at', { ascending: false });

  if (start) query = query.gte('entry_date', start);
  if (end) query = query.lte('entry_date', end);

  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);

  return Response.json(data || []);
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const body = await req.json();
  const machineId = body.companyId || body.company_id;
  if (!machineId) return jsonError('companyId is required');

  const companyUUID = await resolveCompanyId(machineId);
  if (!companyUUID) return jsonError('Company not found', 404);

  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('credit_log')
    .insert({
      company_id: companyUUID,
      driver_id: body.driverId,
      entry_date: body.date,
      amount: body.amount,
      breakdown: body.breakdown || {},
      status: body.status || 'success',
      machine_response: body.machineResponse,
      error: body.error,
      processed_by: body.processedBy || 'manual',
    })
    .select()
    .single();

  if (error) return jsonError(error.message, 500);

  // Also update the corresponding daily entry credit status
  if (body.driverId && body.date) {
    await supabase
      .from('manual_entries')
      .update({
        credit_status: body.status === 'success' ? 'credited' : 'failed',
        credited_at: body.status === 'success' ? new Date().toISOString() : null,
        credit_error: body.error || null,
        machine_transaction_id: body.machineTransactionId || null,
      })
      .eq('company_id', companyUUID)
      .eq('driver_id', body.driverId)
      .eq('entry_date', body.date)
      .eq('entry_type', 'daily_rate');
  }

  return Response.json(data);
}
