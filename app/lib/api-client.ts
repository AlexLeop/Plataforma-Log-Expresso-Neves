/**
 * Authenticated API Client — wraps fetch() with Basic Auth header.
 *
 * Reads the basicAuth token from the session stored in localStorage.
 * All dashboard pages should use this instead of raw fetch() for /api/* calls.
 *
 * Usage:
 *   import { authFetch } from '@/app/lib/api-client';
 *   const res = await authFetch('/api/machine/rides');
 */

function getBasicAuth(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('logipay:session');
    if (!raw) return null;
    const session = JSON.parse(raw);
    return session?.basicAuth || null;
  } catch {
    return null;
  }
}

/**
 * Extract tenant identity from session for server-side isolation.
 * Returns { machineEmpresaId, role, email } from the stored session.
 */
function getTenantInfo(): { machineEmpresaId?: string; role?: string; email?: string } {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('logipay:session');
    if (!raw) return {};
    const session = JSON.parse(raw);
    return {
      machineEmpresaId: session?.machine_empresa_id || session?.user?.machine_empresa_id,
      role: session?.role || session?.user?.role,
      email: session?.email || session?.user?.email,
    };
  } catch {
    return {};
  }
}

/**
 * Authenticated fetch wrapper.
 * Automatically injects Authorization: Basic header from the stored session.
 * Falls back to normal fetch if no session is available.
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const basicAuth = getBasicAuth();

  // If no session exists (e.g. during logout), return a synthetic 401
  // instead of making a real network request that will fail
  if (!basicAuth) {
    return new Response(JSON.stringify({ error: 'No session' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const tenantInfo = getTenantInfo();
  const headers = new Headers(options.headers || {});

  headers.set('Authorization', `Basic ${basicAuth}`);

  // Inject tenant identity for server-side isolation
  if (tenantInfo.machineEmpresaId) {
    headers.set('X-Tenant-Id', tenantInfo.machineEmpresaId);
  }
  if (tenantInfo.role) {
    headers.set('X-User-Role', tenantInfo.role);
  }
  if (tenantInfo.email) {
    headers.set('X-User-Email', tenantInfo.email);
  }

  // Ensure Content-Type for POST/PUT/PATCH if body is present
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, {
    ...options,
    headers,
  });
}
