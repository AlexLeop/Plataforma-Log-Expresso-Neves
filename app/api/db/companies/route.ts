/**
 * API Route: /api/db/companies
 * Lists companies from Supabase (for admin dropdowns)
 * Automatically syncs with Machine API to ensure the list is complete.
 */
import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { isSupabaseConfigured, jsonError } from '../_helpers';
import { resolveTenant, requireAdmin } from '@/lib/supabase/resolve-tenant';
import { cachedMachineGet, CACHE_TTL } from '@/lib/machine-cache';
import { MACHINE_ENDPOINTS } from '@/lib/machine-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const tenant = await resolveTenant(req);
  const adminCheck = requireAdmin(tenant);
  if (adminCheck) return adminCheck;

  const supabase = createServerClient();

  // 1. Fetch current local companies
  const { data: localData, error: localError } = await supabase
    .from('companies')
    .select('id, name, machine_empresa_id, active')
    .order('name', { ascending: true });

  if (localError) {
    console.error('[Companies GET] Local fetch error:', localError.message);
    return jsonError(localError.message, 500);
  }

  let companies = (localData || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    machineEmpresaId: row.machine_empresa_id,
    active: row.active,
  }));

  // 2. Sync with Machine API
  const machineRes = await cachedMachineGet(MACHINE_ENDPOINTS.empresa, undefined, CACHE_TTL.COMPANIES);
  if (machineRes.ok && machineRes.data) {
    const dataObj = machineRes.data as Record<string, any>;
    const machineCompanies = Array.isArray(dataObj.response) ? dataObj.response : 
                            (Array.isArray(dataObj) ? dataObj : []);

    const existingIds = new Map(companies.map(c => [c.machineEmpresaId, c]));
    const toInsert = [];
    const promises = [];

    for (const mc of machineCompanies) {
      if (!mc.id) continue;
      const machineIdStr = String(mc.id);
      const machineName = mc.nome || 'Empresa Desconhecida';
      const machineActive = String(mc.status_empresa).toUpperCase() === 'S';
      
      const existing = existingIds.get(machineIdStr);

      if (!existing) {
        // Doesn't exist locally, prepare to insert
        toInsert.push({
          machine_empresa_id: machineIdStr,
          name: machineName,
          address: mc.endereco || null,
          active: machineActive,
          metadata: mc
        });
      } else {
        // Exists locally, check if name or status needs updating
        // Some were created with fallback "Empresa XXXX"
        if (existing.name !== machineName || existing.active !== machineActive) {
          promises.push(
            supabase.from('companies').update({
              name: machineName,
              address: mc.endereco || null,
              active: machineActive,
              metadata: mc
            }).eq('id', existing.id)
          );
          
          // Update local memory list directly so response is up-to-date
          existing.name = machineName;
          existing.active = machineActive;
        }
      }
    }

    // 3. Execute updates in parallel (if any)
    if (promises.length > 0) {
      // Do not block intensely if there are many, but usually it's just a few
      await Promise.allSettled(promises);
    }

    // 4. Insert new companies if any
    if (toInsert.length > 0) {
      const { data: insertedData, error: insertError } = await supabase
        .from('companies')
        .insert(toInsert)
        .select('id, name, machine_empresa_id, active');

      if (insertError) {
        console.error('[Companies GET] Sync insert error:', insertError.message);
      } else if (insertedData) {
        // Append newly inserted companies to our list
        for (const row of insertedData) {
          companies.push({
            id: row.id,
            name: row.name,
            machineEmpresaId: row.machine_empresa_id,
            active: row.active,
          });
        }
      }
    }
    
    // Ensure final list is sorted
    companies.sort((a, b) => a.name.localeCompare(b.name));
  }

  return Response.json(companies);
}
