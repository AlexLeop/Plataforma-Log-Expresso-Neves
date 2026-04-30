import { NextRequest, NextResponse } from 'next/server';
import { machinePost, MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/machine/credits/driver/balance
 * Proxies to Machine API: POST /api/integracao/saldoCreditosCondutor
 * SECURITY: Requires authenticated tenant.
 */

async function fetchBalance(driverId: string) {
  const result = await machinePost(MACHINE_ENDPOINTS.saldoCreditosCondutor, {
    condutor: {
      tipo_identificacao: 'I',
      identificacao: String(driverId),
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, details: result.details }, { status: result.status || 500 });
  }

  return NextResponse.json(result.data);
}

export async function GET(request: NextRequest) {
  try {
    const tenant = await resolveTenant(request);
    if (!tenant) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const condutorId = request.nextUrl.searchParams.get('condutor_id') || request.nextUrl.searchParams.get('driver_id');

    if (!condutorId) {
      return NextResponse.json({ error: 'condutor_id is required' }, { status: 400 });
    }

    return fetchBalance(condutorId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const tenant = await resolveTenant(request);
    if (!tenant) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const { driver_id, condutor_id } = await request.json();
    const driverId = driver_id || condutor_id;

    if (!driverId) {
      return NextResponse.json({ error: 'driver_id is required' }, { status: 400 });
    }

    return fetchBalance(driverId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
