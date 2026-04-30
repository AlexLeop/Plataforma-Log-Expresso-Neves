/**
 * Tenant Resolution — Multi-Tenancy Isolation Layer
 * 
 * SECURITY ARCHITECTURE:
 *   - Headers (X-User-Role, X-Tenant-Id) are treated as HINTS only
 *   - The ACTUAL role is ALWAYS validated from the database via BasicAuth credentials
 *   - This prevents privilege escalation via header spoofing
 * 
 * Multi-Company Support:
 *   Coordinators, supervisors, and managers can be assigned to multiple companies
 *   via the `user_companies` junction table. `requireCompanyMatch()` checks
 *   against ALL allowed companies, not just the primary one.
 */

import { createServerClient } from '@/lib/supabase/client';

// Mask email for safe logging: "user@example.com" → "u***r@example.com"
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain || local.length <= 2) return `***@${domain || '***'}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

// Cache: machineEmpresaId → companyUUID
const companyCache = new Map<string, { companyId: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cache: email → { role, companyIds }
const userInfoCache = new Map<string, { role: string; companyIds: string[]; expiresAt: number }>();
const USER_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

export interface TenantInfo {
  /** Supabase UUID of the primary company */
  companyId: string;
  /** Machine API empresa_id (numeric string) */
  machineEmpresaId: string;
  /** User role validated from the DATABASE (not from headers) */
  role: 'admin' | 'lojista' | 'supervisor' | 'coordinator' | 'manager';
  /** Whether this is an admin with full access */
  isAdmin: boolean;
  /** All company UUIDs this user is allowed to access */
  allowedCompanyIds?: string[];
}

/**
 * Extract email from BasicAuth header.
 */
function extractEmailFromAuth(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const [email] = decoded.split(':');
    return email || null;
  } catch {
    return null;
  }
}

/**
 * Resolve tenant from request context.
 * 
 * SECURITY: The role is ALWAYS resolved from the database via BasicAuth,
 * NEVER from the X-User-Role header. This prevents privilege escalation.
 * 
 * @returns TenantInfo or null if resolution fails
 */
export async function resolveTenant(request: Request): Promise<TenantInfo | null> {
  try {
    // ─── Step 1: Extract email from BasicAuth (the ONLY trusted source) ───
    const email = extractEmailFromAuth(request);
    if (!email) return null;

    // ─── Step 2: Check if this is the central admin ───
    const centralUsername = process.env.MACHINE_USERNAME;
    if (email === centralUsername) {
      return {
        companyId: '__admin__',
        machineEmpresaId: '__all__',
        role: 'admin',
        isAdmin: true,
      };
    }

    // ─── Step 3: Look up user info from DB (cached) ───
    const userInfo = await getUserInfo(email);
    if (!userInfo) {
      console.warn(`[resolveTenant] User not found: ${maskEmail(email)}`);
      return null;
    }

    // ─── Step 4: Resolve primary company ───
    // Use X-Tenant-Id hint for the primary company (validated via DB)
    const tenantHeader = request.headers.get('x-tenant-id');
    let primaryCompanyId: string | null = null;
    let primaryMachineId = tenantHeader || '';

    if (tenantHeader) {
      primaryCompanyId = await machineIdToCompanyId(tenantHeader);
    }

    // Fallback: use first allowed company
    if (!primaryCompanyId && userInfo.companyIds.length > 0) {
      primaryCompanyId = userInfo.companyIds[0];
    }

    if (!primaryCompanyId) {
      console.warn(`[resolveTenant] No company resolved for: ${maskEmail(email)}`);
      return null;
    }

    const dbRole = userInfo.role;
    const role = dbRole === 'manager' ? 'lojista' : dbRole as TenantInfo['role'];

    return {
      companyId: primaryCompanyId,
      machineEmpresaId: primaryMachineId,
      role,
      isAdmin: dbRole === 'admin',
      allowedCompanyIds: userInfo.companyIds,
    };
  } catch (err) {
    console.error('[resolveTenant] Error:', err);
    return null;
  }
}

/**
 * Resolve a machine_empresa_id to a company UUID.
 * Uses in-memory cache.
 */
export async function machineIdToCompanyId(machineEmpresaId: string): Promise<string | null> {
  const cached = companyCache.get(machineEmpresaId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.companyId;
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('companies')
    .select('id')
    .eq('machine_empresa_id', machineEmpresaId)
    .single();

  if (error || !data) return null;

  companyCache.set(machineEmpresaId, {
    companyId: data.id,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return data.id;
}

/**
 * Look up user info (role + allowed companies) from the database.
 * Uses in-memory cache to avoid repeated DB lookups.
 */
async function getUserInfo(email: string): Promise<{ role: string; companyIds: string[] } | null> {
  const normalizedEmail = email.toLowerCase();

  // Check cache
  const cached = userInfoCache.get(normalizedEmail);
  if (cached && cached.expiresAt > Date.now()) {
    return { role: cached.role, companyIds: cached.companyIds };
  }

  const supabase = createServerClient();

  // Look up user
  const { data: userData } = await supabase
    .from('users')
    .select('id, role, company_id')
    .eq('email', normalizedEmail)
    .single();

  if (!userData) return null;

  const companyIds: string[] = [];

  // Try user_companies junction table first (may not exist if migration hasn't run)
  try {
    const { data: ucRows } = await supabase
      .from('user_companies')
      .select('company_id')
      .eq('user_id', userData.id);

    if (ucRows && ucRows.length > 0) {
      for (const row of ucRows) {
        companyIds.push(row.company_id);
      }
    }
  } catch {
    // Table may not exist yet — fall through to legacy fallback
  }

  // Fallback: legacy company_id
  if (companyIds.length === 0 && userData.company_id) {
    companyIds.push(userData.company_id);
  }

  // Cache
  userInfoCache.set(normalizedEmail, {
    role: userData.role,
    companyIds,
    expiresAt: Date.now() + USER_CACHE_TTL_MS,
  });

  return { role: userData.role, companyIds };
}

/**
 * Guard: ensures the request is from an admin user.
 */
export function requireAdmin(tenant: TenantInfo | null): Response | null {
  if (!tenant) {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }
  if (!tenant.isAdmin) {
    return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
  }
  return null;
}

/**
 * Guard: ensures the Supabase company UUID matches the tenant's allowed companies.
 */
export function requireCompanyMatch(
  tenant: TenantInfo,
  requestCompanyId: string | undefined
): Response | null {
  if (tenant.isAdmin) return null;

  if (!requestCompanyId) {
    return Response.json({ error: 'company_id é obrigatório' }, { status: 400 });
  }

  // Check against ALL allowed companies
  if (tenant.allowedCompanyIds && tenant.allowedCompanyIds.includes(requestCompanyId)) {
    return null;
  }

  // Fallback: primary
  if (requestCompanyId === tenant.companyId) {
    return null;
  }

  console.warn(`[TENANT VIOLATION] Tried to access company ${requestCompanyId}, allowed: [${tenant.allowedCompanyIds?.join(', ') || tenant.companyId}]`);
  return Response.json({ error: 'Acesso negado: empresa não pertence ao seu perfil' }, { status: 403 });
}

/**
 * Guard: ensures a Machine empresa_id belongs to the tenant.
 * Resolves the machine ID to a Supabase UUID and checks against allowed companies.
 */
export async function requireMachineCompanyMatch(
  tenant: TenantInfo,
  machineEmpresaId: string | null | undefined
): Promise<Response | null> {
  if (tenant.isAdmin) return null;

  if (!machineEmpresaId) {
    // No empresa_id specified — this is OK for endpoints that return ALL
    // (the caller should filter results instead)
    return null;
  }

  // Resolve machine ID → Supabase UUID
  const companyId = await machineIdToCompanyId(machineEmpresaId);
  if (!companyId) {
    return Response.json({ error: 'Empresa não encontrada' }, { status: 404 });
  }

  return requireCompanyMatch(tenant, companyId);
}
