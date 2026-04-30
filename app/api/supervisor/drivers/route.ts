/**
 * /api/supervisor/drivers — Associate/disassociate drivers to companies
 * SECURITY: Requires authentication + company match
 */
import { createServerClient } from '@/lib/supabase/client';
import { resolveTenant, requireCompanyMatch } from '@/lib/supabase/resolve-tenant';

export async function POST(request: Request) {
  // ─── TENANT ISOLATION ───
  const tenant = await resolveTenant(request);
  if (!tenant) {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const supabase = createServerClient();
  const { company_id, driver_id, is_primary = false } = await request.json();

  if (!company_id || !driver_id) {
    return Response.json(
      { error: 'company_id e driver_id são obrigatórios' },
      { status: 400 }
    );
  }

  // Validate company access
  const check = requireCompanyMatch(tenant, company_id);
  if (check) return check;

  const { data, error } = await supabase
    .from('company_drivers')
    .insert({ company_id, driver_id, active: true, is_primary })
    .select(`
      id, company_id, driver_id, active, is_primary,
      driver:drivers(id, name, phone),
      company:companies(id, name)
    `)
    .single();

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: 'Motoboy já associado a esta loja' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ association: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  // ─── TENANT ISOLATION ───
  const tenant = await resolveTenant(request);
  if (!tenant) {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const supabase = createServerClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return Response.json({ error: 'id é obrigatório' }, { status: 400 });
  }

  // For non-admin: verify the association belongs to their company
  if (!tenant.isAdmin) {
    const { data: assoc } = await supabase
      .from('company_drivers')
      .select('company_id')
      .eq('id', id)
      .single();

    if (assoc) {
      const check = requireCompanyMatch(tenant, assoc.company_id);
      if (check) return check;
    }
  }

  const { error } = await supabase
    .from('company_drivers')
    .delete()
    .eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
