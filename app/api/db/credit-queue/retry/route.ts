import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/client';
import { resolveTenant, requireAdmin } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * POST /api/db/credit-queue/retry — Reprocess dead queue items
 * SECURITY: Admin-only.
 */
export async function POST(request: Request) {
  try {
    const tenant = await resolveTenant(request);
    const adminCheck = requireAdmin(tenant);
    if (adminCheck) return adminCheck;

    const body = await request.json();
    const supabase = createAdminClient();

    if (body.retry_all) {
      // Reprocess ALL dead items
      const { data, error } = await supabase.rpc('reprocess_dead_credits');

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, reprocessed: data || 0 });
    }

    if (body.queue_ids && Array.isArray(body.queue_ids)) {
      // Reprocess specific items
      const { data, error } = await supabase.rpc('reprocess_dead_credits', {
        p_queue_ids: body.queue_ids,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, reprocessed: data || 0 });
    }

    return NextResponse.json({ error: 'queue_ids or retry_all required' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
