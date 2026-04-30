import type {
  Ride,
  ManualEntry,
  CompanyConfig,
  Driver,
  LineItemCalculation,
  SnapshotCalculation,
} from '@/lib/types';
import { format, eachDayOfInterval, isWeekend } from 'date-fns';

// ============================================================
// RULES ENGINE — Motor de Cálculo Financeiro Semanal
//
// Dois modos calculados simultaneamente:
//   1. Produção Padrão: Diária + Excedente + Taxa - Adiant.
//   2. Garantida Mínima: max(Produção, Diária) + Taxa - Adiant.
//
// O valor da corrida (fare_value) vem direto da Machine API.
// Não existe classificação em faixas fixas — valores variam
// de R$5 a R$15 e são configuráveis na Machine.
// ============================================================

export class WeeklyRulesEngine {

  async calculateWeek(
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
    rides: Ride[],
    manualEntries: ManualEntry[],
    drivers: Driver[],
    config: CompanyConfig
  ): Promise<SnapshotCalculation> {

    // 1. Agrupar corridas por motorista + dia
    const ridesByDriverDay = this.groupRidesByDriverDay(rides);

    // 2. Para cada motorista + dia, calcular line item
    const lineItems: LineItemCalculation[] = [];

    for (const driver of drivers) {
      const driverEntries = manualEntries.filter(
        e => e.driver_id === driver.id
      );

      // Apenas dias úteis (seg-sex)
      const workDays = eachDayOfInterval({
        start: periodStart,
        end: periodEnd,
      }).filter(d => !isWeekend(d));

      for (const date of workDays) {
        const dateStr = format(date, 'yyyy-MM-dd');
        const dayRides = ridesByDriverDay[driver.id]?.[dateStr] || [];
        const dayEntries = driverEntries.filter(e => e.entry_date === dateStr);

        // Pular dias sem atividade
        if (dayRides.length === 0 && dayEntries.length === 0) continue;

        const lineItem = this.calculateDay(
          driver,
          dateStr,
          dayRides,
          dayEntries,
          config
        );
        lineItems.push(lineItem);
      }
    }

    // 3. Construir snapshot com totais
    return this.buildSnapshot(
      companyId,
      periodStart,
      periodEnd,
      lineItems,
      config
    );
  }

  // ============================================================
  // Cálculo de um dia para um motorista
  // ============================================================

  private calculateDay(
    driver: Driver,
    dateStr: string,
    rides: Ride[],
    entries: ManualEntry[],
    config: CompanyConfig
  ): LineItemCalculation {

    const totalRides = rides.length;

    // --- Produção real: soma dos fare_value de cada corrida ---
    const fareValues = rides.map(r => Number(r.fare_value));
    const productionValue = fareValues.reduce((sum, v) => sum + v, 0);

    // --- Breakdown por valor de corrida (ex: { "5": 3, "7": 2, "10": 1 }) ---
    const ridesBreakdown: Record<string, number> = {};
    for (const ride of rides) {
      const key = String(Number(ride.fare_value));
      ridesBreakdown[key] = (ridesBreakdown[key] || 0) + 1;
    }

    // --- Diária (lançada manualmente pelo gestor) ---
    const dailyRate = entries
      .filter(e => e.entry_type === 'daily_rate')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    // --- Extras + Missões (lançados manualmente) ---
    const extras = entries
      .filter(e => e.entry_type === 'extra' || e.entry_type === 'mission')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    // --- Produção total (corridas + extras) ---
    const totalProduction = productionValue + extras;

    // --- Garantia: max(produção total, diária) ---
    const guaranteedPayout = Math.max(totalProduction, dailyRate);

    // --- Excedente: produção - diária (se produção > diária) ---
    const excessValue = Math.max(0, productionValue - dailyRate);

    // --- Taxa de corridas (CONFIGURÁVEL por empresa) ---
    const ridesFee = totalRides * Number(config.ride_fee_per_delivery);

    // --- Adiantamentos (manual + machine) ---
    const advances = entries
      .filter(e => e.entry_type === 'advance')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    // --- Net total: DOIS MODOS ---
    // Modo Produção: Diária + Excedente + Taxa - Adiantamentos
    const netTotalProducao = dailyRate + excessValue + ridesFee - advances;

    // Modo Garantida: max(Produção, Diária) + Taxa - Adiantamentos
    const netTotalGarantida = guaranteedPayout + ridesFee - advances;

    return {
      driver_id: driver.id,
      work_date: dateStr,
      total_rides: totalRides,
      production_value: productionValue,
      rides_breakdown: ridesBreakdown,
      daily_rate: dailyRate,
      extras,
      guaranteed_payout: guaranteedPayout,
      excess_value: excessValue,
      rides_fee: ridesFee,
      advances,
      net_total_producao: netTotalProducao,
      net_total_garantida: netTotalGarantida,
      calculation_details: {
        fare_values: fareValues,
        extras,
      },
    };
  }

  // ============================================================
  // Construir snapshot com totais agregados
  // ============================================================

  private buildSnapshot(
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
    lineItems: LineItemCalculation[],
    config: CompanyConfig
  ): SnapshotCalculation {

    const totalDailyRates = lineItems.reduce((s, l) => s + l.daily_rate, 0);
    const totalProduction = lineItems.reduce((s, l) => s + l.production_value, 0);
    const totalExcess = lineItems.reduce((s, l) => s + l.excess_value, 0);
    const totalExtras = lineItems.reduce((s, l) => s + l.extras, 0);
    const totalAdvances = lineItems.reduce((s, l) => s + l.advances, 0);

    // Soma nominal das taxas de corrida
    const sumRidesFee = lineItems.reduce((s, l) => s + l.rides_fee, 0);

    // PISO CONFIGURÁVEL por empresa: max(soma real, floor)
    const floor = Number(config.minimum_rides_fee_floor);
    const totalRidesFeeApplied = Math.max(sumRidesFee, floor);
    const floorComplement = Math.max(0, floor - sumRidesFee);

    // Totais por modo
    const totalNetProducao = lineItems.reduce((s, l) => s + l.net_total_producao, 0);
    const totalNetGarantida = lineItems.reduce((s, l) => s + l.net_total_garantida, 0);

    // Logística total = net + complemento do piso
    const totalLogisticsProducao = totalNetProducao + floorComplement;
    const totalLogisticsGarantida = totalNetGarantida + floorComplement;

    return {
      company_id: companyId,
      period_start: format(periodStart, 'yyyy-MM-dd'),
      period_end: format(periodEnd, 'yyyy-MM-dd'),
      total_net_producao: totalNetProducao,
      total_logistics_producao: totalLogisticsProducao,
      total_net_garantida: totalNetGarantida,
      total_logistics_garantida: totalLogisticsGarantida,
      total_daily_rates: totalDailyRates,
      total_production: totalProduction,
      total_excess: totalExcess,
      total_extras: totalExtras,
      total_rides_fee: sumRidesFee,
      total_rides_fee_applied: totalRidesFeeApplied,
      total_floor_complement: floorComplement,
      total_advances: totalAdvances,
      line_items: lineItems,
    };
  }

  // ============================================================
  // Helpers
  // ============================================================

  private groupRidesByDriverDay(
    rides: Ride[]
  ): Record<string, Record<string, Ride[]>> {
    const grouped: Record<string, Record<string, Ride[]>> = {};

    for (const ride of rides) {
      if (!ride.driver_id) continue;

      if (!grouped[ride.driver_id]) {
        grouped[ride.driver_id] = {};
      }
      if (!grouped[ride.driver_id][ride.ride_date]) {
        grouped[ride.driver_id][ride.ride_date] = [];
      }
      grouped[ride.driver_id][ride.ride_date].push(ride);
    }

    return grouped;
  }
}
