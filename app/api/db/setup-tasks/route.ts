import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/client';
import { resolveTenant, requireAdmin } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * GET /api/db/setup-tasks — List all setup tasks (with company name)
 * PATCH /api/db/setup-tasks — Mark a task as completed/failed
 * RESTRICTED: Admin only
 */

export async function GET(request: Request) {
  try {
    // TENANT ISOLATION: admin-only
    const tenant = await resolveTenant(request);
    const adminCheck = requireAdmin(tenant);
    if (adminCheck) return adminCheck;

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('setup_tasks')
      .select(`
        id,
        company_id,
        machine_empresa_id,
        generated_alias_email,
        status,
        notes,
        completed_at,
        created_at,
        companies!inner(name)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Flatten company name
    const tasks = (data || []).map(t => ({
      ...t,
      company_name: (t.companies as unknown as { name: string })?.name || 'N/A',
      companies: undefined,
    }));

    return NextResponse.json({ tasks });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    // TENANT ISOLATION: admin-only
    const tenant = await resolveTenant(request);
    const adminCheck = requireAdmin(tenant);
    if (adminCheck) return adminCheck;

    const body = await request.json();
    const { id, status, notes } = body;

    if (!id || !status) {
      return NextResponse.json({ error: 'id e status são obrigatórios' }, { status: 400 });
    }

    if (!['completed', 'failed', 'pending'].includes(status)) {
      return NextResponse.json({ error: 'Status inválido' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const updateData: Record<string, unknown> = { status };
    if (status === 'completed') {
      updateData.completed_at = new Date().toISOString();
    }
    if (notes !== undefined) {
      updateData.notes = notes;
    }

    // If completing, also activate the company
    const { data: taskData } = await supabase
      .from('setup_tasks')
      .select('company_id')
      .eq('id', id)
      .single();

    const { error } = await supabase
      .from('setup_tasks')
      .update(updateData)
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Auto-activate the company when setup is completed
    if (status === 'completed' && taskData?.company_id) {
      await supabase
        .from('companies')
        .update({ active: true })
        .eq('id', taskData.company_id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
