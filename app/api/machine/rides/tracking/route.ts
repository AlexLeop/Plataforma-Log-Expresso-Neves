import { NextResponse } from 'next/server';
import { machineGet, MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * GET /api/machine/rides/tracking?id_mch=12345
 */
export async function GET(request: Request) {
  const tenant = await resolveTenant(request);
  if (!tenant) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const idMch = searchParams.get('id_mch');

  if (!idMch) {
    return NextResponse.json({ error: 'id_mch is required' }, { status: 400 });
  }

  const result = await machineGet(`${MACHINE_ENDPOINTS.obterLinkRastreio}/${idMch}`);

  if (!result.ok) {
    return NextResponse.json({
      error: result.error,
      details: result.details,
    }, { status: result.status || 500 });
  }

  return NextResponse.json(result.data);
}
