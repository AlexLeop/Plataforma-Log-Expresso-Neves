import { NextResponse } from 'next/server';
import { machineGet, MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const tenant = await resolveTenant(request);
  if (!tenant) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const solicitacaoId = searchParams.get('solicitacao_id');

  if (!solicitacaoId) {
    return NextResponse.json({ error: 'solicitacao_id is required' }, { status: 400 });
  }

  const result = await machineGet(MACHINE_ENDPOINTS.solicitacaoStatus, {
    solicitacao_id: solicitacaoId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, details: result.details }, { status: result.status || 500 });
  }

  return NextResponse.json(result.data);
}
