import { NextResponse } from 'next/server';
import { MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { cachedMachineGet, CACHE_TTL } from '@/lib/machine-cache';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * GET /api/machine/companies
 * SECURITY: Requires authenticated tenant.
 */
export async function GET(request: Request) {
  const tenant = await resolveTenant(request);
  if (!tenant) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const result = await cachedMachineGet(MACHINE_ENDPOINTS.empresa, undefined, CACHE_TTL.COMPANIES);

  if (!result.ok) {
    return NextResponse.json({ error: result.error, details: result.details }, { status: result.status || 500 });
  }

  const data = result.data as Record<string, unknown>;
  const companies = (data?.response as unknown[]) || [];
  return NextResponse.json({ companies, total: companies.length });
}
