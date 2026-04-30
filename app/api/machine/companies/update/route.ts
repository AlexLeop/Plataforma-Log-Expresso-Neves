import { NextResponse } from 'next/server';
import { machinePut, MACHINE_ENDPOINTS } from '@/lib/machine-api';
import { invalidateCache } from '@/lib/machine-cache';
import { resolveTenant, requireAdmin } from '@/lib/supabase/resolve-tenant';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/machine/companies/update
 * Used by admin to activate/deactivate companies.
 * SECURITY: Admin-only.
 */
export async function PUT(request: Request) {
  try {
    const tenant = await resolveTenant(request);
    const adminCheck = requireAdmin(tenant);
    if (adminCheck) return adminCheck;

    const body = await request.json();

    const { id, status_empresa } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'ID da empresa é obrigatório' },
        { status: 400 }
      );
    }

    if (!status_empresa || !['A', 'I'].includes(status_empresa)) {
      return NextResponse.json(
        { error: 'Status deve ser "A" (Ativa) ou "I" (Inativa)' },
        { status: 400 }
      );
    }

    // Map our UI status to Machine API status_empresa
    // Our UI: A = Ativa, I = Inativa
    // Machine API: A = Ativo, S = Suspenso, G = Aguardando ativação
    const machineStatus = status_empresa === 'A' ? 'A' : 'S';

    // Machine API expects: { empresas: [id], status_empresa: "A" }
    const companyId = typeof id === 'string' ? parseInt(id, 10) : id;
    
    const result = await machinePut(
      MACHINE_ENDPOINTS.atualizarEmpresas,
      {
        empresas: [companyId],
        status_empresa: machineStatus,
      }
    );

    if (!result.ok) {
      console.error('[Update Company] Machine API error:', JSON.stringify(result.details));

      let errorMsg = result.error;
      if (typeof result.details === 'object' && result.details !== null) {
        const details = result.details as Record<string, unknown>;
        if (Array.isArray(details.errors) && details.errors.length > 0) {
          errorMsg = String(details.errors[0]);
        } else if (details.message) {
          errorMsg = String(details.message);
        }
      } else if (typeof result.details === 'string' && result.details.includes('<!DOCTYPE')) {
        errorMsg = 'Requisição inválida pela Machine API. Verifique o ID da empresa.';
      }

      return NextResponse.json(
        { error: errorMsg, details: typeof result.details === 'string' && result.details.length > 500 ? 'HTML error page' : result.details },
        { status: result.status || 500 }
      );
    }

    invalidateCache('/empresa');
    return NextResponse.json({ success: true, data: result.data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
