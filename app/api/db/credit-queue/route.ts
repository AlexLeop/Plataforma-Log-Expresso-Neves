import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/client';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * GET /api/db/credit-queue — List queue items with optional filters
 * Query params: company_id, status (comma-separated)
 */
export async function GET(request: Request) {
  const supabase = createAdminClient();
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  const statusFilter = searchParams.get('status');

  // TENANT ISOLATION
  const tenant = await resolveTenant(request);

  let query = supabase
    .from('credit_queue')
    .select(`
      *,
      drivers ( name ),
      companies ( name )
    `)
    .order('created_at', { ascending: false })
    .limit(100);

  if (companyId) {
    query = query.eq('company_id', companyId);
  }

  // Force company filter for non-admin users
  if (tenant && !tenant.isAdmin) {
    if (tenant.allowedCompanyIds && tenant.allowedCompanyIds.length > 0) {
      query = query.in('company_id', tenant.allowedCompanyIds);
    } else if (tenant.companyId !== '__admin__') {
      query = query.eq('company_id', tenant.companyId);
    }
  }

  if (statusFilter) {
    const statuses = statusFilter.split(',').map(s => s.trim());
    query = query.in('status', statuses);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Map to frontend format
  const items = (data || []).map((item: Record<string, unknown>) => ({
    ...item,
    driver_name: (item.drivers as Record<string, unknown>)?.name || null,
    company_name: (item.companies as Record<string, unknown>)?.name || null,
    drivers: undefined,
    companies: undefined,
  }));

  return NextResponse.json({ items });
}
