import { NextResponse } from 'next/server';
import { MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { cachedMachineGet, CACHE_TTL } from '@/lib/machine-cache';
import { resolveTenant, requireMachineCompanyMatch } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // ─── TENANT ISOLATION ───
  const tenant = await resolveTenant(request);
  if (!tenant) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  // Forward supported params
  const params: Record<string, string> = {};
  const forwarded = [
    'empresa_id', 'data_hora_solicitacao_min', 'data_hora_solicitacao_max',
    'status_solicitacao', 'pagina', 'limite', 'condutor_id',
  ];
  forwarded.forEach(key => {
    const val = searchParams.get(key);
    if (val) params[key] = val;
  });

  // Validate empresa_id access
  const empresaId = params.empresa_id;
  const check = await requireMachineCompanyMatch(tenant, empresaId);
  if (check) return check;

  // Defaults
  if (!params.limite) params.limite = '100';
  if (!params.pagina) params.pagina = '1';

  const result = await cachedMachineGet(MACHINE_ENDPOINTS.solicitacao, params, CACHE_TTL.RIDES);

  if (!result.ok) {
    return NextResponse.json({ error: result.error, details: result.details }, { status: result.status || 500 });
  }

  const data = result.data as Record<string, unknown>;
  const rides = (data?.response as unknown[]) || [];

  return NextResponse.json({ rides, total: rides.length });
}
