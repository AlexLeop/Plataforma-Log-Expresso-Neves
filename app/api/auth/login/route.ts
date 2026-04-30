import { NextResponse } from 'next/server';
import { MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { createAdminClient } from '@/lib/supabase/client';
import { loginLimiter, getClientIp } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * Mask email for safe logging: "user@example.com" → "u***r@example.com"
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain || local.length <= 2) return `***@${domain || '***'}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

/**
 * Map well-known Machine API error codes to user-friendly messages.
 */
const MACHINE_ERROR_MESSAGES: Record<number, string> = {
  68: 'Credenciais válidas, porém sem permissão neste endpoint. Contate o administrador.',
};

function extractMachineErrorMessage(text: string): string | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed?.errors && Array.isArray(parsed.errors)) {
      for (const err of parsed.errors) {
        if (MACHINE_ERROR_MESSAGES[err.code]) {
          return MACHINE_ERROR_MESSAGES[err.code];
        }
        if (err.message) return err.message;
      }
    }
  } catch { /* not JSON */ }
  return null;
}

/**
 * Supabase Auth fallback for lojistas created via the new onboarding flow.
 * These users exist in Supabase Auth but NOT in Machine (until the admin
 * completes the shadow registration setup task).
 *
 * Flow:
 *   1. signInWithPassword on Supabase Auth
 *   2. Lookup the user's company via the `users` table
 *   3. Build a basicAuth token from admin credentials (for Machine API proxy calls)
 *   4. Return session with company data
 */
async function trySupabaseLogin(email: string, password: string) {
  try {
    const supabase = createAdminClient();

    // Verify credentials via Supabase Auth
    // Use the admin client to call signInWithPassword via RPC
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL) return null;

    // Use the REST API to verify the password (admin client can't signIn directly)
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY || '',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!authResponse.ok) {
      console.log(`[Login/Supabase] Auth failed: ${authResponse.status}`);
      return null;
    }

    const authData = await authResponse.json();
    const userId = authData?.user?.id;
    if (!userId) {
      console.log('[Login/Supabase] No user ID in response');
      return null;
    }
    console.log(`[Login/Supabase] Auth OK, user_id: ${userId}`);

    // Fetch user record + company from our DB
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, full_name, role, company_id')
      .eq('id', userId)
      .single();

    if (!userData) {
      console.log(`[Login/Supabase] No user row found for ${userId}. Error:`, userError?.message);
      return null;
    }
    console.log(`[Login/Supabase] User row found: role=${userData.role}, company_id=${userData.company_id}`);

    // ── Fetch ALL assigned companies (user_companies junction table) ──
    const machineEmpresaIds: string[] = [];
    let primaryCompanyName = '';

    const { data: ucRows } = await supabase
      .from('user_companies')
      .select('company_id, companies ( id, name, machine_empresa_id, active )')
      .eq('user_id', userId);

    if (ucRows && ucRows.length > 0) {
      for (const row of ucRows) {
        const comp = row.companies as unknown as { id: string; name: string; machine_empresa_id: string; active: boolean } | null;
        if (comp?.machine_empresa_id && comp.machine_empresa_id !== 'pending') {
          machineEmpresaIds.push(comp.machine_empresa_id);
          if (!primaryCompanyName) primaryCompanyName = comp.name || '';
        }
      }
      console.log(`[Login/Supabase] Found ${machineEmpresaIds.length} assigned companies via user_companies`);
    }

    // ── Fallback: legacy company_id on users table ──
    if (machineEmpresaIds.length === 0 && userData.company_id) {
      const { data: companyData } = await supabase
        .from('companies')
        .select('id, name, machine_empresa_id, active')
        .eq('id', userData.company_id)
        .single();

      if (companyData?.machine_empresa_id && companyData.machine_empresa_id !== 'pending') {
        machineEmpresaIds.push(companyData.machine_empresa_id);
        primaryCompanyName = companyData.name || '';
      }
    }

    // Build a basicAuth from admin credentials so Machine API proxy calls work
    const CENTRAL_USERNAME = process.env.MACHINE_USERNAME;
    const CENTRAL_PASSWORD = process.env.MACHINE_PASSWORD;
    const proxyBasicAuth = CENTRAL_USERNAME && CENTRAL_PASSWORD
      ? Buffer.from(`${CENTRAL_USERNAME}:${CENTRAL_PASSWORD}`).toString('base64')
      : '';

    return {
      success: true,
      user: {
        email,
        name: userData.full_name || primaryCompanyName || email.split('@')[0],
        role: userData.role === 'manager' ? 'lojista' : (userData.role || 'lojista'),
        companies: [],
        // Array of ALL assigned machine empresa IDs
        machine_empresa_ids: machineEmpresaIds,
        // Keep single ID for backward compat (first assigned)
        machine_empresa_id: machineEmpresaIds[0] || undefined,
        supabase_user_id: userId,
      },
      basicAuth: proxyBasicAuth,
    };

  } catch (err) {
    console.error('[Login] Supabase fallback error:', err);
    return null;
  }
}

export async function POST(request: Request) {
  const API_KEY = process.env.MACHINE_API_KEY;
  const BASE_URL = process.env.MACHINE_API_BASE_URL;
  const CENTRAL_USERNAME = process.env.MACHINE_USERNAME; // Login da central (admin)
  const CENTRAL_PASSWORD = process.env.MACHINE_PASSWORD;

  if (!API_KEY || !BASE_URL) {
    return NextResponse.json(
      { error: 'Configuração do servidor incompleta. Contate o suporte.' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { email, password } = body;

    // ─── RATE LIMITING ───
    const clientIp = getClientIp(request);
    const rateCheck = loginLimiter.check(clientIp);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas de login. Tente novamente em 1 minuto.' },
        {
          status: 429,
          headers: {
            'Retry-After': '60',
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email e senha são obrigatórios' },
        { status: 400 }
      );
    }

    const basicAuth = Buffer.from(`${email}:${password}`).toString('base64');

    // ── Step 1: Try Supabase Auth FIRST for onboarding users ──────
    // Users created via the onboarding flow exist in Supabase Auth + users table.
    // We MUST check Supabase first because Machine API may return 200 OK with
    // invalid HTML/empty data for emails it doesn't recognize, causing misrouting.
    console.log(`[Login] Attempting Supabase Auth first for ${maskEmail(email)}...`);
    const supabaseResult = await trySupabaseLogin(email, password);
    if (supabaseResult) {
      console.log(`[Login] Supabase Auth succeeded for ${maskEmail(email)}, machine_empresa_id: ${supabaseResult.user.machine_empresa_id}`);
      return NextResponse.json(supabaseResult);
    }
    console.log(`[Login] Supabase Auth failed for ${maskEmail(email)}. Trying Machine API...`);

    // ── Step 2: Try Machine API for native users ──────────────────
    const response = await fetch(`${BASE_URL}${MACHINE_ENDPOINTS.empresa}`, {
      headers: {
        'api-key': API_KEY,
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
    });

    // ── Step 3: Handle different auth outcomes ────────────────────
    if (response.ok) {
      // Verify the response is valid JSON (Machine may return HTML for unknown users)
      const contentType = response.headers.get('content-type') || '';
      const responseText = await response.text();

      let data: Record<string, unknown> | null = null;
      try { data = JSON.parse(responseText); } catch { data = null; }

      if (!data || (contentType.includes('text/html') && !contentType.includes('application/json'))) {
        console.log(`[Login] Machine returned 200 but non-JSON response for ${maskEmail(email)}.`);
        return NextResponse.json(
          { error: 'Usuário e/ou senhas inválidos.' },
          { status: 401 }
        );
      }

      // Standard flow: admin or Machine-native lojista
      const companies = data?.response || data?.companies || [];

      const emailNormalized = email.trim().toLowerCase();
      const centralNormalized = (CENTRAL_USERNAME || '').trim().toLowerCase();
      const isAdmin = !!centralNormalized && emailNormalized === centralNormalized;

      let userName = email.split('@')[0];
      if (Array.isArray(companies) && companies.length > 0) {
        const firstCompany = companies[0] as Record<string, unknown>;
        const admins = firstCompany?.admins as Array<Record<string, string>> | undefined;
        if (admins?.length && admins.length > 0) {
          userName = admins[0].nome || userName;
        } else if (firstCompany?.nome && !isAdmin) {
          userName = firstCompany.nome as string;
        }
      }

      // ─── Enrich: Check if this email exists in Supabase users table ───
      // This ensures lojistas who exist in BOTH Machine and Supabase
      // get their machine_empresa_id for tenant isolation.
      let enrichedMachineEmpresaId: string | undefined;
      let enrichedRole: string | undefined;
      if (!isAdmin) {
        try {
          const supabase = createAdminClient();
          const { data: dbUser } = await supabase
            .from('users')
            .select('role, company_id')
            .eq('email', emailNormalized)
            .single();
          
          if (dbUser?.company_id) {
            const { data: dbCompany } = await supabase
              .from('companies')
              .select('machine_empresa_id')
              .eq('id', dbUser.company_id)
              .single();
            
            if (dbCompany?.machine_empresa_id) {
              enrichedMachineEmpresaId = dbCompany.machine_empresa_id;
              enrichedRole = dbUser.role === 'manager' ? 'lojista' : dbUser.role;
              console.log(`[Login/Machine] Enriched with Supabase data: machine_empresa_id=${enrichedMachineEmpresaId}`);
            }
          }
        } catch {
          // Supabase lookup is best-effort, don't block login
        }
      }

      return NextResponse.json({
        success: true,
        user: {
          email,
          name: isAdmin ? 'Administrador' : userName,
          role: isAdmin ? 'admin' : (enrichedRole || 'lojista'),
          companies: Array.isArray(companies) ? companies.map((c: Record<string, unknown>) => ({
            id: c.id,
            nome: c.nome,
          })) : [],
          machine_empresa_id: enrichedMachineEmpresaId,
        },
        basicAuth,
      });
    }

    const errorText = await response.text();

    // ── 401/403 — Machine rejected credentials ─────────────────
    // BEFORE returning error, try Supabase Auth fallback.
    // This handles lojistas created via the new onboarding flow who
    // exist in Supabase Auth but not yet in Machine as a user.
    if (response.status === 401 || response.status === 403) {
      console.log(`[Login] Machine rejected ${maskEmail(email)}, trying Supabase Auth fallback...`);
      const supabaseResult = await trySupabaseLogin(email, password);

      if (supabaseResult) {
        console.log(`[Login] Supabase Auth fallback succeeded for ${maskEmail(email)}`);
        return NextResponse.json(supabaseResult);
      }

      return NextResponse.json(
        { error: 'Usuário e/ou senhas inválidos.' },
        { status: 401 }
      );
    }

    // ── 400 — could be a permission issue (supervisor/coordinator) ──
    // Machine API returns code 68 = "user doesn't have permission for this operation"
    // This means the credentials ARE valid, just not authorized for the empresas endpoint.
    // For supervisor/coordinator users, we validate differently.
    if (response.status === 400) {
      const machineMsg = extractMachineErrorMessage(errorText);
      const isPermissionError = errorText.includes('"code":68') || errorText.includes('"code": 68');

      if (isPermissionError && CENTRAL_USERNAME && CENTRAL_PASSWORD) {
        // Credentials are valid but user lacks permission to list companies.
        // This happens for supervisors/coordinators.
        // Use admin credentials to fetch companies assigned to this user.
        const adminBasicAuth = Buffer.from(`${CENTRAL_USERNAME}:${CENTRAL_PASSWORD}`).toString('base64');

        const adminRes = await fetch(`${BASE_URL}${MACHINE_ENDPOINTS.empresa}`, {
          headers: {
            'api-key': API_KEY,
            'Authorization': `Basic ${adminBasicAuth}`,
            'Content-Type': 'application/json',
          },
        });

        let companies: Array<Record<string, unknown>> = [];
        if (adminRes.ok) {
          const adminData = await adminRes.json();
          companies = adminData?.response || adminData?.companies || [];
        }

        return NextResponse.json({
          success: true,
          user: {
            email,
            name: email.split('@')[0],
            role: 'supervisor' as const,
            companies: Array.isArray(companies) ? companies.map((c: Record<string, unknown>) => ({
              id: c.id,
              nome: c.nome,
            })) : [],
          },
          basicAuth: Buffer.from(`${CENTRAL_USERNAME}:${CENTRAL_PASSWORD}`).toString('base64'),
        });
      }

      // Not a permission error — try Supabase fallback before giving up
      const supabaseResult = await trySupabaseLogin(email, password);
      if (supabaseResult) {
        return NextResponse.json(supabaseResult);
      }

      return NextResponse.json(
        { error: machineMsg || 'Acesso negado. Verifique suas credenciais ou contate o administrador.' },
        { status: 400 }
      );
    }

    // ── Other errors — generic but still user-friendly ─────────
    const machineMsg = extractMachineErrorMessage(errorText);
    return NextResponse.json(
      { error: machineMsg || 'Serviço temporariamente indisponível. Tente novamente em instantes.' },
      { status: response.status >= 500 ? 503 : response.status }
    );

  } catch (err) {
    console.error('[Login] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Erro de conexão com o servidor. Verifique sua internet.' },
      { status: 500 }
    );
  }
}

