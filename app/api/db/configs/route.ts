/**
 * API Route: /api/db/configs
 * CRUD for company_configs using machine_empresa_id
 */
import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { isSupabaseConfigured, resolveCompanyId, jsonError } from '../_helpers';
import { resolveTenant, requireCompanyMatch } from '@/lib/supabase/resolve-tenant';

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const machineId = req.nextUrl.searchParams.get('company_id');
  const companyName = req.nextUrl.searchParams.get('company_name');
  if (!machineId) return jsonError('company_id is required');

  const companyUUID = await resolveCompanyId(machineId, companyName || undefined);
  if (!companyUUID) return jsonError('Company not found', 404);

  // TENANT ISOLATION
  const tenant = await resolveTenant(req);
  if (tenant && !tenant.isAdmin) {
    const check = requireCompanyMatch(tenant, companyUUID);
    if (check) return check;
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('company_configs')
    .select('*')
    .eq('company_id', companyUUID)
    .single();

  if (error && error.code !== 'PGRST116') {
    return jsonError(error.message, 500);
  }

  // If no config exists, return defaults
  if (!data) {
    return Response.json({
      company_id: companyUUID,
      machine_empresa_id: machineId,
      ride_fee_per_delivery: 1.60,
      minimum_rides_fee_floor: 350,
      guaranteed_mode_enabled: true,
      daily_rate_weekday: 60,
      daily_rate_saturday: 70,
      daily_rate_sunday: 80,
      daily_rate_holiday: 80,
      minimum_floor_percent: 0,
      extra_km_mode: 'disabled',
      extra_km_min_distance: 6,
      extra_km_fixed_amount: 3,
      auto_credit_enabled: false,
      auto_credit_cutoff_hour: 6,
      auto_credit_cutoff_minute: 0,
      auto_credit_description: 'Diária {date} - {company}',
      auto_credit_mode: 'garantida',
      taxa_supervisao: 0,
      debito_pendente: 0,
      report_type: 'producao',
      include_taxa_corridas: true,
      show_diaria: true,
      show_tx_corridas: true,
      show_entregas: true,
      turnos_config: [],
      faixas_horas_config: [],
    });
  }

  return Response.json({ ...data, machine_empresa_id: machineId });
}

export async function PUT(req: NextRequest) {
  if (!isSupabaseConfigured()) return jsonError('Supabase not configured', 503);

  const body = await req.json();
  const machineId = body.company_id || body.companyId;
  if (!machineId) return jsonError('company_id is required');

  const companyUUID = await resolveCompanyId(machineId);
  if (!companyUUID) return jsonError('Company not found', 404);

  // TENANT ISOLATION
  const tenant = await resolveTenant(req);
  if (tenant && !tenant.isAdmin) {
    const check = requireCompanyMatch(tenant, companyUUID);
    if (check) return check;
  }

  const supabase = createServerClient();

  // Map frontend field names to DB column names
  const dbData: Record<string, unknown> = {
    company_id: companyUUID,
    ride_fee_per_delivery: body.taxaCorridaPerEntrega ?? body.ride_fee_per_delivery,
    minimum_rides_fee_floor: body.pisoFixo ?? body.minimum_rides_fee_floor,
    guaranteed_mode_enabled: body.guaranteed_mode_enabled ?? true,
    daily_rate_weekday: body.diaria?.weekday ?? body.daily_rate_weekday,
    daily_rate_saturday: body.diaria?.saturday ?? body.daily_rate_saturday,
    daily_rate_sunday: body.diaria?.sunday ?? body.daily_rate_sunday,
    daily_rate_holiday: body.diaria?.holiday ?? body.daily_rate_holiday,
    minimum_floor_percent: body.pisoPercentual ?? body.minimum_floor_percent ?? 0,
    extra_km_mode: body.extraKm?.mode ?? body.extra_km_mode ?? 'disabled',
    extra_km_min_distance: body.extraKm?.minKm ?? body.extra_km_min_distance ?? 6,
    extra_km_fixed_amount: body.extraKm?.fixedAmount ?? body.extra_km_fixed_amount ?? 3,
    auto_credit_enabled: body.autoCredit?.enabled ?? body.auto_credit_enabled ?? false,
    auto_credit_cutoff_hour: body.autoCredit?.cutoffHour ?? body.auto_credit_cutoff_hour ?? 6,
    auto_credit_cutoff_minute: body.autoCredit?.cutoffMinute ?? body.auto_credit_cutoff_minute ?? 0,
    auto_credit_description: body.autoCredit?.creditDescription ?? body.auto_credit_description ?? 'Diária {date} - {company}',
    auto_credit_mode: body.autoCredit?.mode ?? body.auto_credit_mode ?? 'garantida',
    taxa_supervisao: body.taxaSupervisao ?? body.taxa_supervisao ?? 0,
    debito_pendente: body.debitoPendente ?? body.debito_pendente ?? 0,
    report_type: body.report?.reportType ?? body.report_type ?? 'producao',
    include_taxa_corridas: body.report?.includeTaxaCorridas ?? body.include_taxa_corridas ?? true,
    show_diaria: body.report?.showDiaria ?? body.show_diaria ?? true,
    show_tx_corridas: body.report?.showTxCorridas ?? body.show_tx_corridas ?? true,
    show_entregas: body.report?.showEntregas ?? body.show_entregas ?? true,
    turnos_config: body.turnos ?? body.turnos_config ?? [],
    faixas_horas_config: body.faixasHoras ?? body.faixas_horas_config ?? [],
  };

  const { data, error } = await supabase
    .from('company_configs')
    .upsert(dbData, { onConflict: 'company_id' })
    .select()
    .single();

  if (error) return jsonError(error.message, 500);

  return Response.json(data);
}
