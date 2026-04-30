/**
 * API Route: /api/db/users
 * CRUD for user management (supervisors, coordinators, lojistas)
 * Admin-only: all operations require admin role.
 * 
 * Uses the `user_companies` junction table for N:N user↔company relationships.
 */
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/client';
import { isSupabaseConfigured, jsonError } from '../_helpers';
import { resolveTenant, requireAdmin } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

// GET — List all users with their assigned companies
export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const tenant = await resolveTenant(req);
  const adminCheck = requireAdmin(tenant);
  if (adminCheck) return adminCheck;

  const supabase = createAdminClient();

  // Fetch users
  const { data: usersData, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, company_id, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Users GET] Error:', error.message);
    return jsonError(error.message, 500);
  }

  // Fetch all user_companies assignments with company details
  const { data: ucData } = await supabase
    .from('user_companies')
    .select('user_id, company_id, companies ( id, name, machine_empresa_id, active )');

  // Build a map: userId -> companies[]
  const userCompaniesMap = new Map<string, Array<{ id: string; name: string; machineEmpresaId: string; active: boolean }>>();
  for (const row of (ucData || [])) {
    const comp = row.companies as unknown as { id: string; name: string; machine_empresa_id: string; active: boolean } | null;
    if (!comp) continue;
    const list = userCompaniesMap.get(row.user_id) || [];
    list.push({
      id: comp.id,
      name: comp.name,
      machineEmpresaId: comp.machine_empresa_id,
      active: comp.active,
    });
    userCompaniesMap.set(row.user_id, list);
  }

  // Also pre-fetch all companies for legacy fallback
  const companyIdsToLookup = new Set<string>();
  for (const row of (usersData || [])) {
    if (row.company_id && !userCompaniesMap.has(row.id)) {
      companyIdsToLookup.add(row.company_id);
    }
  }

  // Fetch legacy companies in one query
  const legacyCompanyMap = new Map<string, { id: string; name: string; machineEmpresaId: string; active: boolean }>();
  if (companyIdsToLookup.size > 0) {
    const { data: legacyData } = await supabase
      .from('companies')
      .select('id, name, machine_empresa_id, active')
      .in('id', Array.from(companyIdsToLookup));

    for (const c of (legacyData || [])) {
      legacyCompanyMap.set(c.id, {
        id: c.id,
        name: c.name,
        machineEmpresaId: c.machine_empresa_id,
        active: c.active,
      });
    }
  }

  const users = (usersData || []).map(row => {
    let assigned = userCompaniesMap.get(row.id) || [];

    // Fallback: if no user_companies rows, use legacy company_id
    if (assigned.length === 0 && row.company_id) {
      const legacy = legacyCompanyMap.get(row.company_id);
      if (legacy) {
        assigned = [legacy];
      }
    }

    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      companyId: row.company_id,
      companies: assigned,
      createdAt: row.created_at,
    };
  });

  return Response.json(users);
}

// POST — Create a new user (Supabase Auth + users table + user_companies)
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const tenant = await resolveTenant(req);
  const adminCheck = requireAdmin(tenant);
  if (adminCheck) return adminCheck;

  const body = await req.json();
  const { email, password, fullName, role, companyIds } = body;

  if (!email || !password || !fullName || !role) {
    return jsonError('email, password, fullName e role são obrigatórios');
  }

  const validRoles = ['supervisor', 'coordinator', 'manager', 'operator', 'viewer'];
  if (!validRoles.includes(role)) {
    return jsonError(`Role inválida. Valores permitidos: ${validRoles.join(', ')}`);
  }

  if (password.length < 6) {
    return jsonError('A senha deve ter no mínimo 6 caracteres');
  }

  const supabase = createAdminClient();

  // Step 1: Create user in Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role,
    },
  });

  if (authError || !authData.user) {
    const msg = authError?.message || 'Erro ao criar usuário';
    if (msg.includes('already') || msg.includes('duplicate') || msg.includes('exists')) {
      return jsonError('Este e-mail já está cadastrado.', 409);
    }
    return jsonError(msg, 400);
  }

  const userId = authData.user.id;

  // Step 2: Insert into users table (keep first company as legacy company_id)
  const ids: string[] = Array.isArray(companyIds) ? companyIds : [];
  const { error: userError } = await supabase
    .from('users')
    .upsert({
      id: userId,
      email: email.toLowerCase(),
      full_name: fullName,
      role,
      company_id: ids[0] || null,
    }, { onConflict: 'id' });

  if (userError) {
    console.error('[Users POST] users upsert error:', userError.message);
    await supabase.auth.admin.deleteUser(userId);
    return jsonError(`Erro ao salvar usuário: ${userError.message}`, 500);
  }

  // Step 3: Insert user_companies assignments
  if (ids.length > 0) {
    const rows = ids.map(cid => ({ user_id: userId, company_id: cid }));
    const { error: ucError } = await supabase.from('user_companies').insert(rows);
    if (ucError) {
      console.error('[Users POST] user_companies insert error:', ucError.message);
      // Non-fatal — user was created, companies just need manual fix
    }
  }

  return Response.json({
    success: true,
    user: { id: userId, email, fullName, role, companyIds: ids },
  });
}

// PUT — Update user role or assigned companies
export async function PUT(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const tenant = await resolveTenant(req);
  const adminCheck = requireAdmin(tenant);
  if (adminCheck) return adminCheck;

  const body = await req.json();
  const { id, role, companyIds, fullName } = body;

  if (!id) return jsonError('id é obrigatório');

  const supabase = createAdminClient();

  // Update users table
  const updateData: Record<string, unknown> = {};
  if (role) updateData.role = role;
  if (fullName) updateData.full_name = fullName;

  // Update company_id to first assigned company (legacy compat)
  if (Array.isArray(companyIds)) {
    updateData.company_id = companyIds[0] || null;
  }

  if (Object.keys(updateData).length > 0) {
    const { error } = await supabase.from('users').update(updateData).eq('id', id);
    if (error) {
      console.error('[Users PUT] Error:', error.message);
      return jsonError(error.message, 500);
    }
  }

  // Rewrite user_companies if companyIds were provided
  if (Array.isArray(companyIds)) {
    // Delete existing assignments
    await supabase.from('user_companies').delete().eq('user_id', id);

    // Insert new assignments
    if (companyIds.length > 0) {
      const rows = companyIds.map((cid: string) => ({ user_id: id, company_id: cid }));
      const { error: ucError } = await supabase.from('user_companies').insert(rows);
      if (ucError) {
        console.error('[Users PUT] user_companies insert error:', ucError.message);
      }
    }
  }

  // Update auth metadata if role changed
  if (role) {
    await supabase.auth.admin.updateUserById(id, {
      user_metadata: { role },
    });
  }

  return Response.json({ success: true });
}

// DELETE — Remove user (auth + users table + user_companies)
export async function DELETE(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const tenant = await resolveTenant(req);
  const adminCheck = requireAdmin(tenant);
  if (adminCheck) return adminCheck;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return jsonError('id é obrigatório');

  const supabase = createAdminClient();

  // Delete user_companies first (FK)
  await supabase.from('user_companies').delete().eq('user_id', id);

  // Delete from users table
  const { error: dbError } = await supabase.from('users').delete().eq('id', id);
  if (dbError) {
    console.error('[Users DELETE] DB error:', dbError.message);
    return jsonError(dbError.message, 500);
  }

  // Delete from Supabase Auth
  const { error: authError } = await supabase.auth.admin.deleteUser(id);
  if (authError) {
    console.error('[Users DELETE] Auth error:', authError.message);
  }

  return Response.json({ success: true });
}
