/**
 * /api/company-drivers/[id] — Manage driver-company relationship
 * DELETE: Unlink (soft delete) a driver from a company
 * SECURITY: Requires authenticated tenant + company ownership
 */
import { createServerClient } from '@/lib/supabase/client';
import { toLocalDateISO } from '@/app/lib/date-utils';
import { resolveTenant, requireCompanyMatch } from '@/lib/supabase/resolve-tenant';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: Request, context: RouteContext) {
  // ─── TENANT ISOLATION ───
  const tenant = await resolveTenant(request);
  if (!tenant) {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const { id: companyDriverId } = await context.params;
  const supabase = createServerClient();

  // Get the company_driver record
  const { data: cd, error: cdError } = await supabase
    .from('company_drivers')
    .select('id, company_id, driver_id, driver:drivers(name)')
    .eq('id', companyDriverId)
    .single();

  if (cdError || !cd) {
    return Response.json({ error: 'Vínculo não encontrado' }, { status: 404 });
  }

  // Verify tenant owns this company
  const companyCheck = requireCompanyMatch(tenant, cd.company_id);
  if (companyCheck) return companyCheck;

  // Soft delete: set active = false
  const { error: updateError } = await supabase
    .from('company_drivers')
    .update({ active: false })
    .eq('id', companyDriverId);

  if (updateError) {
    console.error('[Unlink] Failed to deactivate:', updateError.message);
    return Response.json({ error: 'Erro ao desvincular' }, { status: 500 });
  }

  // Cancel future schedule entries for this driver in this company
  const todayStr = toLocalDateISO(new Date());
  const { data: cancelledEntries, error: cancelError } = await supabase
    .from('schedule_entries')
    .update({ status: 'cancelled' })
    .eq('company_id', cd.company_id)
    .eq('driver_id', cd.driver_id)
    .gte('entry_date', todayStr)
    .in('status', ['pending', 'sent'])
    .select('id');

  if (cancelError) {
    console.error('[Unlink] Failed to cancel entries:', cancelError.message);
    // Don't fail the whole operation - the unlink already happened
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driverRaw = cd.driver as any;
  const driverName = Array.isArray(driverRaw) ? driverRaw[0]?.name : driverRaw?.name;

  console.log(`[Unlink] Driver ${driverName} (${cd.driver_id}) unlinked from company ${cd.company_id}. Cancelled ${cancelledEntries?.length || 0} future entries.`);

  return Response.json({
    success: true,
    driverName,
    cancelledEntries: cancelledEntries?.length || 0,
  });
}
