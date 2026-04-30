import { NextResponse } from 'next/server';
import { MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { cachedMachineGet, CACHE_TTL } from '@/lib/machine-cache';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * GET /api/machine/credits/company/balance
 * SECURITY: Requires authenticated tenant.
 */
export async function GET(request: Request) {
  const tenant = await resolveTenant(request);
  if (!tenant) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const result = await cachedMachineGet(MACHINE_ENDPOINTS.saldoCreditosEmpresa, undefined, CACHE_TTL.COMPANY_BALANCE);

  if (!result.ok) {
    return NextResponse.json({ error: result.error, details: result.details }, { status: result.status || 500 });
  }

  return NextResponse.json(result.data);
}
