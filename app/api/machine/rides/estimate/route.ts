import { NextResponse } from 'next/server';
import { machineGet, MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const tenant = await resolveTenant(request);
  if (!tenant) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);

  // Build query params for Machine API
  const params: Record<string, string> = {};
  const fields = [
    'endereco_partida', 'bairro_partida', 'cidade_partida', 'estado_partida',
    'lat_partida', 'lng_partida',
    'endereco_desejado', 'bairro_desejado', 'cidade_desejado', 'estado_desejado',
    'lat_desejado', 'lng_desejado',
    'id_categoria',
  ];

  fields.forEach(f => {
    const val = searchParams.get(f);
    if (val) params[f] = val;
  });

  const result = await machineGet(MACHINE_ENDPOINTS.estimarSolicitacao, params);

  if (!result.ok) {
    return NextResponse.json({ error: result.error, details: result.details }, { status: result.status || 500 });
  }

  return NextResponse.json(result.data);
}
