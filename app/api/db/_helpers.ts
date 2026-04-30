/**
 * DB API Helpers — shared utilities for /api/db/* routes
 */
import { createServerClient } from '@/lib/supabase/client';

/**
 * Check if Supabase is configured (env vars present)
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Resolve a machine_empresa_id to a companies UUID.
 * If the company doesn't exist, auto-creates it.
 */
export async function resolveCompanyId(machineEmpresaId: string | number, companyName?: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = createServerClient();
  const mid = String(machineEmpresaId);

  // Try to find existing
  const { data: existing, error: lookupError } = await supabase
    .from('companies')
    .select('id, name')
    .eq('machine_empresa_id', mid)
    .single();

  if (existing) {
    // Update name if it's still generic and we have a real name
    if (companyName && existing.name.startsWith('Empresa ')) {
      await supabase.from('companies').update({ name: companyName }).eq('id', existing.id);
    }
    return existing.id;
  }

  if (lookupError && lookupError.code !== 'PGRST116') {
    console.error('[resolveCompanyId] Lookup error:', lookupError.message, lookupError.code);
  }

  // Auto-create with real name if available
  const { data: created, error } = await supabase
    .from('companies')
    .insert({ name: companyName || `Empresa ${mid}`, machine_empresa_id: mid })
    .select('id')
    .single();

  if (error) {
    console.error('[resolveCompanyId] Failed to create company:', error.message, error.code, error.details);
    return null;
  }

  return created?.id ?? null;
}

/**
 * Resolve a machine_condutor_id to a drivers UUID.
 * If the driver doesn't exist, auto-creates it.
 */
export async function resolveDriverId(
  machineCondutorId: string | number,
  driverName?: string
): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = createServerClient();
  const mid = String(machineCondutorId);

  // Try to find existing
  const { data: existing, error: lookupError } = await supabase
    .from('drivers')
    .select('id')
    .eq('machine_condutor_id', mid)
    .single();

  if (existing) return existing.id;

  if (lookupError && lookupError.code !== 'PGRST116') {
    console.error('[resolveDriverId] Lookup error:', lookupError.message);
  }

  // Auto-create minimal driver record
  const { data: created, error } = await supabase
    .from('drivers')
    .insert({
      name: driverName || `Condutor ${mid}`,
      machine_condutor_id: mid,
      status: 'active',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[resolveDriverId] Failed to create driver:', error.message, error.code);
    return null;
  }

  return created?.id ?? null;
}

/**
 * Standard JSON error response
 */
export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
