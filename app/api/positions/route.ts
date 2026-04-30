import { NextResponse } from 'next/server';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * Returns latest driver positions from the in-memory store.
 * Only returns positions updated within the last 2 minutes.
 * SECURITY: Requires authenticated tenant.
 */

const positionStore = globalThis as unknown as {
  __driver_positions?: Map<string, {
    condutor_id: string;
    id_mch: string;
    lat: number;
    lng: number;
    updated_at: number;
  }>;
};

export async function GET(request: Request) {
  // ─── TENANT ISOLATION ───
  const tenant = await resolveTenant(request);
  if (!tenant) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const store = positionStore.__driver_positions;
  if (!store) {
    return NextResponse.json({ positions: [] });
  }

  const TWO_MINUTES = 2 * 60 * 1000;
  const now = Date.now();
  const active: Array<{
    condutor_id: string;
    id_mch: string;
    lat: number;
    lng: number;
    updated_at: number;
  }> = [];

  store.forEach((pos) => {
    if (now - pos.updated_at < TWO_MINUTES) {
      active.push(pos);
    }
  });

  return NextResponse.json({ positions: active });
}
