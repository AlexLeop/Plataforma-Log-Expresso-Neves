import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/client';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * GET /api/db/positions
 * Returns latest driver positions from Supabase driver_positions table.
 * SECURITY: Requires authenticated tenant.
 */
export async function GET(request: Request) {
  try {
    const tenant = await resolveTenant(request);
    if (!tenant) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    const supabase = createAdminClient();
    
    // Get positions from the last 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('driver_positions')
      .select('machine_condutor_id, latitude, longitude, speed, heading, machine_ride_id, received_at')
      .gte('received_at', fiveMinAgo)
      .order('received_at', { ascending: false });

    if (error) {
      console.error('[DB Positions] Query error:', error.message);
      return NextResponse.json({ positions: [], error: error.message });
    }

    return NextResponse.json({ positions: data || [] });
  } catch (err) {
    console.error('[DB Positions] Unexpected error:', err);
    return NextResponse.json({ positions: [] });
  }
}
