/**
 * /api/supervisor/companies — Manage supervisor-company associations
 * SECURITY: Admin-only for write operations.
 */
import { createServerClient } from '@/lib/supabase/client';
import { resolveTenant, requireAdmin } from '@/lib/supabase/resolve-tenant';

export async function GET(request: Request) {
  // ─── TENANT ISOLATION ───
  const tenant = await resolveTenant(request);
  if (!tenant) {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const supabase = createServerClient();
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');

  let query = supabase
    .from('supervisor_companies')
    .select(`
      id, user_id, company_id, created_at,
      company:companies(id, name, address, active),
      user:users(id, full_name, email, role)
    `);

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ associations: data });
}

export async function POST(request: Request) {
  // ─── ADMIN ONLY ───
  const tenant = await resolveTenant(request);
  const adminCheck = requireAdmin(tenant);
  if (adminCheck) return adminCheck;

  const supabase = createServerClient();
  const { user_id, company_id } = await request.json();

  if (!user_id || !company_id) {
    return Response.json(
      { error: 'user_id e company_id são obrigatórios' },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('supervisor_companies')
    .insert({ user_id, company_id })
    .select(`
      id, user_id, company_id,
      company:companies(id, name),
      user:users(id, full_name)
    `)
    .single();

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: 'Associação já existe' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ association: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  // ─── ADMIN ONLY ───
  const tenant = await resolveTenant(request);
  const adminCheck = requireAdmin(tenant);
  if (adminCheck) return adminCheck;

  const supabase = createServerClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return Response.json({ error: 'id é obrigatório' }, { status: 400 });
  }

  const { error } = await supabase
    .from('supervisor_companies')
    .delete()
    .eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
