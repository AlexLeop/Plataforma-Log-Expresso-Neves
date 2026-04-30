import { NextResponse } from 'next/server';
import { machineGet, machinePost } from '@/lib/machine-api';
import { resolveTenant } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * POST /api/proxy
 * Generic proxy to Machine API.
 * Body: { endpoint: string, method?: string, body?: object }
 * 
 * SECURITY:
 *   - Requires authenticated tenant
 *   - Only /api/integracao/* endpoints allowed
 *   - Uses central admin credentials (by design)
 */
export async function POST(request: Request) {
  try {
    // ─── TENANT ISOLATION ───
    const tenant = await resolveTenant(request);
    if (!tenant) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const { endpoint, method = 'POST', body } = await request.json();

    if (!endpoint) {
      return NextResponse.json({ error: 'endpoint is required' }, { status: 400 });
    }

    // Security: only allow /api/integracao/* endpoints
    if (!endpoint.startsWith('/api/integracao/')) {
      return NextResponse.json(
        { error: 'Only /api/integracao/* endpoints are allowed' },
        { status: 403 }
      );
    }

    const result = method === 'GET'
      ? await machineGet(endpoint)
      : await machinePost(endpoint, body || {});

    if (!result.ok) {
      return NextResponse.json({ error: result.error, details: result.details }, { status: result.status || 500 });
    }

    return NextResponse.json(result.data);
  } catch (err) {
    console.error('[proxy] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Proxy error' },
      { status: 500 }
    );
  }
}
