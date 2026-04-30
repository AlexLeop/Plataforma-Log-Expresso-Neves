import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/client';
import { resolveTenant, requireAdmin } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * GET /api/db/system-settings — Read system settings (any authenticated)
 * PUT /api/db/system-settings — Update support_email (admin-only)
 */

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('system_settings')
      .select('support_email, updated_at')
      .eq('id', 1)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    // TENANT ISOLATION: admin-only for writes
    const tenant = await resolveTenant(request);
    const adminCheck = requireAdmin(tenant);
    if (adminCheck) return adminCheck;

    const body = await request.json();
    const { support_email } = body;

    if (!support_email || !support_email.includes('@')) {
      return NextResponse.json({ error: 'E-mail inválido' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('system_settings')
      .update({ support_email: support_email.toLowerCase().trim() })
      .eq('id', 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
