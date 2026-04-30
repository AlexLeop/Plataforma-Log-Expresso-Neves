import { NextResponse } from 'next/server';
import { machinePost, MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { invalidateCache } from '@/lib/machine-cache';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';
import { financialLimiter, getClientIp } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * POST /api/machine/credits/driver/recharge
 * SECURITY: Authenticated + rate limited (financial).
 */
export async function POST(request: Request) {
  try {
    // ─── TENANT ISOLATION ───
    const tenant = await resolveTenant(request);
    if (!tenant) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    // ─── RATE LIMITING (financial) ───
    const rateCheck = financialLimiter.check(getClientIp(request));
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Muitas operações financeiras. Aguarde 1 minuto.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    const { driver_id, valor, observacao } = await request.json();

    if (!driver_id || !valor) {
      return NextResponse.json({ error: 'driver_id and valor are required' }, { status: 400 });
    }

    const result = await machinePost(MACHINE_ENDPOINTS.recarregarCreditosCondutor, {
      valor: Number(valor),
      observacao: observacao || 'Recarga via NevesGo',
      condutor: {
        tipo_identificacao: 'I',
        identificacao: String(driver_id),
      },
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error, details: result.details }, { status: result.status || 500 });
    }

    invalidateCache('/saldoCreditos');
    return NextResponse.json(result.data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
