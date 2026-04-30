import { NextResponse } from 'next/server';
import { machinePost, MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { invalidateCache } from '@/lib/machine-cache';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * POST /api/machine/rides/cancel
 * Body: { id_mch: string, motivo_id?: number }
 */
export async function POST(request: Request) {
  try {
    const tenant = await resolveTenant(request);
    if (!tenant) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    const body = await request.json();
    const idMch = body.id_mch || body.solicitacao_id;

    if (!idMch) {
      return NextResponse.json({ error: 'id_mch is required' }, { status: 400 });
    }

    const result = await machinePost(MACHINE_ENDPOINTS.cancelar, {
      id_mch: String(idMch),
      motivo_id: body.motivo_id ?? 7,
    });

    if (!result.ok) {
      return NextResponse.json({
        error: result.error,
        details: result.details,
      }, { status: result.status || 500 });
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
