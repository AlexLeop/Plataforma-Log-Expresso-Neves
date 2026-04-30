import { NextResponse } from 'next/server';
import { MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { cachedMachineGet, CACHE_TTL } from '@/lib/machine-cache';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * GET /api/machine/drivers
 * SECURITY: Requires authenticated tenant.
 */
export async function GET(request: Request) {
  const tenant = await resolveTenant(request);
  if (!tenant) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const result = await cachedMachineGet(MACHINE_ENDPOINTS.condutor, undefined, CACHE_TTL.DRIVERS);

  if (!result.ok) {
    return NextResponse.json({ error: result.error, details: result.details }, { status: result.status || 500 });
  }

  const data = result.data as Record<string, unknown>;
  const rawDrivers = ((data?.response as Record<string, unknown>[]) || []);

  // Pass through all fields from Machine, normalizing key names for frontend
  const drivers = rawDrivers.map(d => ({
    id: d.id,
    nome: d.nome,
    status: d.status,
    telefone: d.telefone || d.telefone_internacional || '',
    documento: d.documento || d.cpf || '',
    cpf: d.documento || d.cpf || '',
    chave_pix: d.chave_pix || '',
    email: d.email || '',
    data_hora_situacao_cadastral: d.data_hora_situacao_cadastral || '',
    data_hora_ultima_corrida: d.data_hora_ultima_corrida || null,
  }));

  return NextResponse.json({ drivers, total: drivers.length });
}
