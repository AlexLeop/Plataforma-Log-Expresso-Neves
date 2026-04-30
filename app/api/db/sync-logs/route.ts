/**
 * API Route: /api/db/sync-logs
 * GET: List recent sync logs (for the Sync dashboard page)
 */
import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { isSupabaseConfigured, jsonError } from '../_helpers';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const limit = Number(req.nextUrl.searchParams.get('limit') || '50');
  const companyId = req.nextUrl.searchParams.get('company_id');

  // TENANT ISOLATION: non-admin users can only see their own logs
  const tenant = await resolveTenant(req);

  const supabase = createServerClient();

  let query = supabase
    .from('sync_logs')
    .select(`
      id,
      company_id,
      sync_type,
      status,
      records_fetched,
      records_upserted,
      error_message,
      created_at,
      finished_at,
      companies!inner(name, machine_empresa_id)
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (companyId) {
    query = query.eq('companies.machine_empresa_id', companyId);
  }

  // TENANT ISOLATION: force company filter for non-admin
  if (tenant && !tenant.isAdmin) {
    if (tenant.allowedCompanyIds && tenant.allowedCompanyIds.length > 0) {
      query = query.in('company_id', tenant.allowedCompanyIds);
    } else if (tenant.companyId !== '__admin__') {
      query = query.eq('company_id', tenant.companyId);
    }
  }

  const { data, error } = await query;
  if (error) {
    // Fallback: try without join if companies table has issues
    console.warn('[SyncLogs] Join query failed, trying without join:', error.message);
    const { data: fallback, error: fallbackErr } = await supabase
      .from('sync_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (fallbackErr) return jsonError(fallbackErr.message, 500);
    return Response.json(fallback || []);
  }

  // Map to frontend format
  const logs = (data || []).map(log => {
    const company = log.companies as unknown as { name: string; machine_empresa_id: string } | null;
    const createdAt = new Date(log.created_at);
    const finishedAt = log.finished_at ? new Date(log.finished_at) : null;
    const durationMs = finishedAt ? finishedAt.getTime() - createdAt.getTime() : null;

    return {
      id: log.id,
      companyName: company?.name || '—',
      companyMachineId: company?.machine_empresa_id || '—',
      syncType: log.sync_type,
      status: log.status,
      recordsFetched: log.records_fetched,
      recordsUpserted: log.records_upserted,
      errorMessage: log.error_message,
      createdAt: log.created_at,
      finishedAt: log.finished_at,
      durationMs,
    };
  });

  return Response.json(logs);
}
