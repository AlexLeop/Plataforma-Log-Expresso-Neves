import { NextResponse } from 'next/server';
import { machinePost, MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { invalidateCache } from '@/lib/machine-cache';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const tenant = await resolveTenant(request);
    if (!tenant) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    const body = await request.json();
    const result = await machinePost(MACHINE_ENDPOINTS.abrirSolicitacao, body);

    if (!result.ok) {
      return NextResponse.json({ error: result.error, details: result.details }, { status: result.status || 500 });
    }

    invalidateCache('/solicitacao');
    return NextResponse.json(result.data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
