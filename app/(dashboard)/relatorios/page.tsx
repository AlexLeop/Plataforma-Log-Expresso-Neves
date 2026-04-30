'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../components/Toast';
import { authFetch } from '@/app/lib/api-client';
import { getDriverDayAggregation, getDailyEntriesForWeek, getManualEntriesForWeek, pullEntriesFromSupabase } from '../../services/entries-store';
import { exportToCSV } from '../../services/export-csv';
import { getCompanyConfig } from '../../services/company-config';

// ============================================================
// Tipos
// ============================================================

interface MachineRide {
  id: number;
  condutor_id: number;
  nome_condutor: string;
  data_hora_solicitacao: string;
  data_hora_finalizacao: string | null;
  status_solicitacao: string;
  valor_corrida: number | string;
  paradas: Array<{ id: string | number }>;
}

interface DriverDay {
  producaoReal: number;   // soma dos valor_corrida
  entregas: number;       // total de corridas finalizadas
  diaria: number;         // vem dos lançamentos manuais
  extras: number;         // extras + missões lançados para o dia
  taxa: number;           // excedente (total_corridas - diaria)
  valorPago: number;      // max(producaoReal, diaria) — modo garantida
}

interface MotoboyRow {
  nome: string;
  condutorId: number;
  dias: Record<string, DriverDay>;
  totalProducaoReal: number;
  totalEntregas: number;
  totalDiaria: number;
  totalTaxa: number;        // excedente total (modo produção)
  taxaCorridas: number;     // entregas × R$1,60
  adiantamentos: number;
  payoutTotal: number;      // soma dos max(prod, diaria) por dia
  producaoExibida: number;  // depende do modo
  totalLiquido: number;
}

// ============================================================
// Config da loja (será configurável por empresa)
// Config da loja (dinâmico, carregado de company-config)
// Será definido dentro do componente com base na empresa selecionada

// ============================================================
// Helpers
// ============================================================

function formatBRL(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function getDatesOfWeek(startISO: string): { iso: string; label: string; dayName: string }[] {
  const start = new Date(startISO + 'T12:00:00');
  const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const dates: { iso: string; label: string; dayName: string }[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dates.push({
      iso,
      label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      dayName: dayNames[i],
    });
  }
  return dates;
}

// ============================================================
// Componente
// ============================================================

function TogglePill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '5px 12px',
        borderRadius: '6px',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: active ? 'rgba(229, 92, 0, 0.08)' : 'transparent',
        color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
        fontSize: '0.7rem',
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: active ? 'var(--color-accent)' : 'var(--color-border)',
        transition: 'background 0.15s',
      }} />
      {label}
    </button>
  );
}

export default function RelatoriosPage() {
  const { selectedCompany, weekPeriod, isAdmin } = useAppContext();
  const { showToast } = useToast();

  // Dados
  const [rides, setRides] = useState<MachineRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Controles — carregados da config por empresa
  const [reportType, setReportType] = useState<'producao' | 'garantida' | 'garantida_horas'>('producao');
  const [includeTaxaCorridas, setIncludeTaxaCorridas] = useState(true);
  const [showDiaria, setShowDiaria] = useState(true);
  const [showTxCorridas, setShowTxCorridas] = useState(true);
  const [showEntregas, setShowEntregas] = useState(true);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Datas da semana
  const weekDates = useMemo(() => getDatesOfWeek(weekPeriod.start), [weekPeriod.start]);

  // Load report config from company settings
  useEffect(() => {
    if (!selectedCompany) return;
    const cfg = getCompanyConfig(selectedCompany.id, selectedCompany.nome);
    if (cfg.report) {
      setReportType(cfg.report.reportType);
      setIncludeTaxaCorridas(cfg.report.includeTaxaCorridas);
      setShowDiaria(cfg.report.showDiaria);
      setShowTxCorridas(cfg.report.showTxCorridas);
      setShowEntregas(cfg.report.showEntregas);
    }
    setConfigLoaded(true);
  }, [selectedCompany]);

  // Config dinâmico por empresa
  const storeConfig = useMemo(() => {
    if (!selectedCompany) return {
      companyId: 0, companyName: '',
      taxaCorridaPerEntrega: 1.60, pisoFixo: 350, pisoPercentual: 0,
      taxaSupervisao: 0, debitoPendente: 0,
      diaria: { weekday: 60, saturday: 70, sunday: 80, holiday: 80 },
      extraKm: { mode: 'disabled' as const, minKm: 6, fixedAmount: 3 },
      autoCredit: { enabled: false, cutoffHour: 6, cutoffMinute: 0, creditDescription: '', mode: 'garantida' as const },
      report: { reportType: 'producao' as const, includeTaxaCorridas: true, showDiaria: true, showTxCorridas: true, showEntregas: true },
      turnos: [],
      faixasHoras: [],
    };
    return getCompanyConfig(selectedCompany.id, selectedCompany.nome);
  }, [selectedCompany]);

  // Buscar corridas reais da Machine + entries do Supabase
  useEffect(() => {
    async function fetchRides() {
      if (!selectedCompany) return;
      setLoading(true);
      setError(null);

      try {
        // Pull entries from Supabase into localStorage cache
        await pullEntriesFromSupabase(
          selectedCompany.id,
          weekPeriod.start,
          weekPeriod.end
        );

        // Buscar corridas finalizadas no período
        const params = new URLSearchParams({
          empresa_id: String(selectedCompany.id),
          limite: '500',
          status_solicitacao: 'F',
        });
        const res = await authFetch(`/api/machine/rides?${params}`);
        if (!res.ok) throw new Error(`Erro ${res.status}`);
        const data = await res.json();

        // Filtrar corridas pelo período da semana no cliente
        const allRides: MachineRide[] = data.rides || [];
        const weekStart = weekPeriod.start;
        const weekEnd = weekPeriod.end;

        const filtered = allRides.filter(ride => {
          const rideDate = String(ride.data_hora_solicitacao).split(' ')[0].split('T')[0];
          return rideDate >= weekStart && rideDate <= weekEnd;
        });

        setRides(filtered);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao buscar corridas');
      } finally {
        setLoading(false);
      }
    }
    fetchRides();
  }, [selectedCompany, weekPeriod]);

  // Processar corridas em linhas da tabela
  const companyId = selectedCompany?.id || 0;
  const { rows, totals } = useMemo(() => {
    const driverMap: Record<number, {
      nome: string;
      condutorId: number;
      dias: Record<string, { entregas: number; turnos: Record<string, number> }>;
      totalProd: number;
      totalEntregas: number;
      adiantamentos: number;
    }> = {};

    // Agrupar corridas por condutor/dia
    let rideCount = 0;
    let skippedStatus = 0;
    let skippedNoId = 0;
    for (const ride of rides) {
      const condId = typeof ride.condutor_id === 'string' ? parseInt(ride.condutor_id, 10) : ride.condutor_id;
      if (!condId) { skippedNoId++; continue; }

      // Filtra somente finalizadas (Machine API returns 'F', 'Finalizada', etc)
      const status = String(ride.status_solicitacao).toUpperCase().trim();
      if (status !== 'F' && !status.startsWith('FINALIZ')) { skippedStatus++; continue; }

      const dateRaw = String(ride.data_hora_solicitacao);
      const dateKey = dateRaw.split(' ')[0].split('T')[0];
      let timeStr = '00:00:00';
      if (dateRaw.includes('T')) {
        timeStr = dateRaw.split('T')[1].substring(0, 8);
      } else if (dateRaw.includes(' ')) {
        timeStr = dateRaw.split(' ')[1].substring(0, 8);
      }

      const fareValue = typeof ride.valor_corrida === 'string' ? parseFloat(ride.valor_corrida) : (ride.valor_corrida || 0);
      const numDeliveries = ride.paradas ? ride.paradas.length : 1;

      rideCount++;

      if (!driverMap[condId]) {
        driverMap[condId] = {
          nome: ride.nome_condutor || `Condutor ${condId}`,
          condutorId: condId,
          dias: {},
          totalProd: 0,
          totalEntregas: 0,
          adiantamentos: 0,
        };
      }

      const driver = driverMap[condId];
      if (!driver.dias[dateKey]) {
        driver.dias[dateKey] = { entregas: 0, turnos: {} };
      }

      // Descobrir em qual turno a corrida se encaixa
      let foundTurno = 'dia_completo';
      if (storeConfig.turnos && storeConfig.turnos.length > 0) {
        for (const t of storeConfig.turnos) {
          if (timeStr >= t.startTime && timeStr <= t.endTime) {
            foundTurno = t.id;
            break;
          }
        }
      }

      driver.dias[dateKey].turnos[foundTurno] = (driver.dias[dateKey].turnos[foundTurno] || 0) + fareValue;
      driver.dias[dateKey].entregas += numDeliveries;
      driver.totalProd += fareValue;
      driver.totalEntregas += numDeliveries;
    }


    // Incluir motoboys que têm lançamentos manuais (diárias, extras, adiantamentos)
    // mas NÃO apareceram nas corridas da Machine
    if (companyId) {
      const weekStart = weekDates[0]?.iso || '';
      const weekEnd = weekDates[weekDates.length - 1]?.iso || '';
      const dailies = getDailyEntriesForWeek(companyId, weekStart, weekEnd);
      const manuals = getManualEntriesForWeek(companyId, weekStart, weekEnd);

      // Merge unique drivers from manual entries
      const manualDrivers = new Map<string, string>(); // driverId -> driverName
      dailies.forEach(d => manualDrivers.set(d.driverId, d.driverName));
      manuals.forEach(m => manualDrivers.set(m.driverId, m.driverName));

      manualDrivers.forEach((name, driverId) => {
        const numId = parseInt(driverId, 10);
        if (!numId || driverMap[numId]) return; // already in map from rides
        driverMap[numId] = {
          nome: name || `Condutor ${numId}`,
          condutorId: numId,
          dias: {},
          totalProd: 0,
          totalEntregas: 0,
          adiantamentos: 0,
        };
      });
    }

    // Construir linhas da tabela
    const computedRows: MotoboyRow[] = Object.values(driverMap).map(driver => {
      const dias: Record<string, DriverDay> = {};
      let totalDiaria = 0;
      let totalProducao = 0; // total de corridas na semana
      let payoutTotal = 0;
      let driverAdiantamentos = 0;

      for (const wd of weekDates) {
        const dayData = driver.dias[wd.iso];
        const entregas = dayData?.entregas || 0;

        let totalProducaoReal = 0;
        let payoutTotalDay = 0;
        let totalDiariaDay = 0;

        // Puxa extras e adiantamentos que são gerais para o dia (passando undefined se as entries nativas não tiverem turno especificado)
        const dayGlobalEntries = companyId ? getDriverDayAggregation(companyId, String(driver.condutorId), wd.iso, undefined) : { diaria: 0, extras: 0, adiantamentos: 0 };
        driverAdiantamentos += dayGlobalEntries.adiantamentos;

        if (storeConfig.turnos && storeConfig.turnos.length > 0) {
          // Lógica Fatiada
          for (const t of storeConfig.turnos) {
            const producaoTurno = dayData?.turnos[t.id] || 0;
            const turnoEntries = companyId ? getDriverDayAggregation(companyId, String(driver.condutorId), wd.iso, t.id) : { diaria: 0, extras: 0, adiantamentos: 0 };
            const diariaTurno = turnoEntries.diaria;
            
            payoutTotalDay += Math.max(producaoTurno, diariaTurno);
            totalProducaoReal += producaoTurno;
            totalDiariaDay += diariaTurno;
          }

          const producaoForaTurno = dayData?.turnos['dia_completo'] || 0;
          totalProducaoReal += producaoForaTurno;
          payoutTotalDay += producaoForaTurno;
          
          totalDiariaDay += dayGlobalEntries.extras;
          payoutTotalDay += dayGlobalEntries.extras; // Bônus aplicam sobre o payout fatiado
        } else {
          // Lógica Monolítica (Retrocompatibilidade)
          totalProducaoReal = dayData?.turnos['dia_completo'] || 0;
          totalDiariaDay = dayGlobalEntries.diaria + dayGlobalEntries.extras;
          payoutTotalDay = Math.max(totalProducaoReal, dayGlobalEntries.diaria) + dayGlobalEntries.extras;
        }

        const taxa = totalProducaoReal; // taxa sempre foi a produção real
        const valorPago = payoutTotalDay;

        dias[wd.iso] = { producaoReal: totalProducaoReal, entregas, diaria: totalDiariaDay, extras: dayGlobalEntries.extras, taxa, valorPago };
        totalDiaria += totalDiariaDay;
        totalProducao += totalProducaoReal;
        payoutTotal += valorPago;
      }

      const taxaCorridas = driver.totalEntregas * storeConfig.taxaCorridaPerEntrega;

      const producaoExibida = reportType === 'garantida' ? payoutTotal : driver.totalProd;

      // Total líquido depende do modo
      const txCorridasVal = (reportType === 'producao' ? includeTaxaCorridas : (includeTaxaCorridas && showTxCorridas)) ? taxaCorridas : 0;

      const totalLiquido = reportType === 'producao'
        ? (totalDiaria + totalProducao + txCorridasVal - driverAdiantamentos)
        : (payoutTotal + txCorridasVal - driverAdiantamentos);

      return {
        nome: driver.nome,
        condutorId: driver.condutorId,
        dias,
        totalProducaoReal: driver.totalProd,
        totalEntregas: driver.totalEntregas,
        totalDiaria,
        totalTaxa: totalProducao,
        taxaCorridas,
        adiantamentos: driverAdiantamentos,
        payoutTotal,
        producaoExibida,
        totalLiquido,
      };
    });

    // Ordenar alfabeticamente
    computedRows.sort((a, b) => a.nome.localeCompare(b.nome));

    // Totais (soma da tabela — sem piso)
    const totalDiarias = computedRows.reduce((s, r) => s + r.totalDiaria, 0);
    const totalTaxas = computedRows.reduce((s, r) => s + r.totalTaxa, 0);
    const totalProducao = computedRows.reduce((s, r) => s + r.totalProducaoReal, 0);
    const sumTaxaCorridas = computedRows.reduce((s, r) => s + r.taxaCorridas, 0);
    const totalAdiantamentos = computedRows.reduce((s, r) => s + r.adiantamentos, 0);
    const totalProducaoExibida = computedRows.reduce((s, r) => s + r.producaoExibida, 0);
    const totalTabela = computedRows.reduce((s, r) => s + r.totalLiquido, 0);

    // TX ADM = piso mínimo: max(pisoFixo, totalTabela * pisoPercentual/100)
    const pisoByPerc = storeConfig.pisoPercentual > 0 ? totalTabela * (storeConfig.pisoPercentual / 100) : 0;
    const pisoEfetivo = Math.max(storeConfig.pisoFixo || 0, pisoByPerc);
    const txAdm = pisoEfetivo > sumTaxaCorridas ? pisoEfetivo - sumTaxaCorridas : 0;
    // Taxa de supervisão (valor fixo R$)
    const txSupervisao = storeConfig.taxaSupervisao || 0;
    // Débito pendente da loja
    const debitoPendente = storeConfig.debitoPendente || 0;
    // Total a liquidar = tabela + txAdm + txSupervisao + debitoPendente
    const totalALiquidar = totalTabela + txAdm + txSupervisao + debitoPendente;

    return {
      rows: computedRows,
      totals: {
        diarias: totalDiarias,
        taxas: totalTaxas,
        producao: totalProducao,
        producaoExibida: totalProducaoExibida,
        sumTaxaCorridas,
        totalAdiantamentos,
        totalTabela,
        txAdm,
        txSupervisao,
        debitoPendente,
        totalALiquidar,
      },
    };
  }, [rides, weekDates, reportType, includeTaxaCorridas, showTxCorridas, companyId, storeConfig]);

  // Determinar se coluna TX CORRIDAS é visível
  const showTxCol = reportType === 'producao' ? includeTaxaCorridas : (includeTaxaCorridas && showTxCorridas);

  // Renderizar valor do dia
  const renderDayCell = (row: MotoboyRow, dateISO: string) => {
    const day = row.dias[dateISO];
    if (!day || (day.producaoReal === 0 && day.entregas === 0 && day.diaria === 0 && day.extras === 0)) {
      return <td key={dateISO} className="text-center text-muted" style={{ padding: '4px 2px' }}>—</td>;
    }

    if (reportType === 'producao') {
      // Modo Produção: mostra produção real + extras/missões daquele dia
      const dayTotal = day.producaoReal + day.extras;
      const displayVal = dayTotal > 0 ? dayTotal : (day.diaria > 0 ? day.diaria : 0);
      return (
        <td key={dateISO} className="text-center" style={{ padding: '4px 2px', color: dayTotal > 0 ? 'var(--color-secondary)' : 'var(--color-text-muted)', fontWeight: 500, fontSize: '0.7rem' }}>
          {formatBRL(displayVal)}
          {showEntregas && day.entregas > 0 && (
            <div style={{ fontSize: '0.55rem', color: 'var(--color-primary)', fontWeight: 500 }}>
              {day.entregas} {day.entregas === 1 ? 'ent.' : 'ents.'}
            </div>
          )}
        </td>
      );
    }

    // Modo Garantida: mostra valor pago + entregas
    return (
      <td key={dateISO} className="text-center" style={{ padding: '4px 2px' }}>
        <div style={{ lineHeight: 1.2 }}>
          <span style={{ fontWeight: 600, color: 'var(--color-secondary)', fontSize: '0.7rem' }}>
            {formatBRL(day.valorPago)}
          </span>
          {showEntregas && day.entregas > 0 && (
            <div style={{ fontSize: '0.6rem', color: 'var(--color-primary)', fontWeight: 500 }}>
              {day.entregas} {day.entregas === 1 ? 'ent.' : 'ents.'}
            </div>
          )}
        </div>
      </td>
    );
  };

  const periodString = weekPeriod.label;

  return (
    <>
      <header className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">
              Relatório Consolidado de Motoboys <span style={{ fontSize: '0.65rem', fontWeight: 400, opacity: 0.7 }}>v2.0</span>
            </h1>
            <p className="page-subtitle">
              {selectedCompany?.nome || '—'} • Período: {periodString}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.7 }}>Status do Relatório</p>
            <p style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
              {reportType === 'producao' ? 'Produção Padrão' : reportType === 'garantida_horas' ? 'Garantida por Horas' : 'Garantida Mínima'}
            </p>
          </div>
        </div>
      </header>

      <div className="page-body">
        {/* Controles — only visible for admin */}
        {isAdmin && (
        <div className="card" style={{ padding: '16px 20px', marginBottom: 'var(--space-md)' }}>
          {/* Row 1: Report Mode + Export Actions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '12px' }}>
            {/* Report Mode Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>Modo</span>
              <div style={{ display: 'flex', background: 'var(--color-bg-subtle)', borderRadius: '8px', padding: '3px', gap: '2px' }}>
                {[
                  { key: 'producao' as const, label: 'Produção Padrão' },
                  { key: 'garantida' as const, label: 'Garantida Mínima' },
                ].map(m => (
                  <button
                    key={m.key}
                    onClick={() => setReportType(m.key)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '0.72rem',
                      fontWeight: reportType === m.key ? 700 : 500,
                      color: reportType === m.key ? 'white' : 'var(--color-text-secondary)',
                      background: reportType === m.key ? 'var(--color-accent)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Export Actions */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn"
                style={{
                  fontSize: '0.72rem', fontWeight: 600, padding: '7px 16px',
                  background: '#16A34A', color: 'white', border: 'none', borderRadius: '8px',
                  cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: rows.length === 0 ? 0.5 : 1,
                }}
                onClick={() => {
                  exportToCSV({
                    rows, weekDates, reportType, includeTaxaCorridas,
                    companyName: selectedCompany?.nome || 'Empresa',
                    periodLabel: periodString,
                    totalGeral: totals.totalTabela,
                    txAdm: totals.txAdm,
                    txSupervisao: totals.txSupervisao,
                    debitoPendente: totals.debitoPendente,
                    totalALiquidar: totals.totalALiquidar,
                  });
                  showToast('Planilha exportada com sucesso', 'success');
                }}
                disabled={rows.length === 0}
              >
                Baixar Planilha
              </button>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '0.72rem', fontWeight: 600, padding: '7px 16px' }}
                onClick={() => window.print()}
              >
                Imprimir
              </button>
            </div>
          </div>

          {/* Row 2: Column Toggles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', paddingTop: '12px', borderTop: '1px solid var(--color-border-light)' }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>Colunas</span>

            {/* Tax Toggle */}
            <TogglePill
              label="Taxa Corridas"
              active={includeTaxaCorridas}
              onClick={() => setIncludeTaxaCorridas(!includeTaxaCorridas)}
            />

            {/* Garantida-only toggles */}
            {reportType === 'garantida' && (
              <>
                <div style={{ width: '1px', height: '20px', background: 'var(--color-border)' }} />
                <TogglePill
                  label="Diária"
                  active={showDiaria}
                  onClick={() => setShowDiaria(!showDiaria)}
                />
                <TogglePill
                  label="TX Corridas"
                  active={showTxCorridas}
                  onClick={() => setShowTxCorridas(!showTxCorridas)}
                />
                <TogglePill
                  label="Entregas"
                  active={showEntregas}
                  onClick={() => setShowEntregas(!showEntregas)}
                />
              </>
            )}
          </div>
        </div>
        )}

        {/* Export buttons for lojista (no toggle controls) */}
        {!isAdmin && (
          <div style={{ marginBottom: 'var(--space-md)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              className="btn"
              style={{
                fontSize: '0.72rem', fontWeight: 600, padding: '7px 16px',
                background: '#16A34A', color: 'white', border: 'none', borderRadius: '8px',
                cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
                opacity: rows.length === 0 ? 0.5 : 1,
              }}
              onClick={() => {
                exportToCSV({
                  rows, weekDates, reportType, includeTaxaCorridas,
                  companyName: selectedCompany?.nome || 'Empresa',
                  periodLabel: periodString,
                  totalGeral: totals.totalTabela,
                  txAdm: totals.txAdm,
                  txSupervisao: totals.txSupervisao,
                  debitoPendente: totals.debitoPendente,
                  totalALiquidar: totals.totalALiquidar,
                });
                showToast('Planilha exportada com sucesso', 'success');
              }}
              disabled={rows.length === 0}
            >
              Baixar Planilha
            </button>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.72rem', fontWeight: 600, padding: '7px 16px' }}
              onClick={() => window.print()}
            >
              Imprimir
            </button>
          </div>
        )}
        {/* loading / error states */}
        {loading && (
          <div className="card text-center" style={{ padding: 'var(--space-2xl)' }}>
            <p className="text-muted">Carregando corridas da Machine para {selectedCompany?.nome}...</p>
          </div>
        )}

        {error && (
          <div className="card" style={{ borderColor: 'var(--color-danger)', padding: 'var(--space-md)' }}>
            <p className="text-danger">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* KPIs — Clean top-border style */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '12px',
            }}>
              {[
                { label: 'LOGÍSTICA TOTAL', value: totals.totalTabela, borderColor: 'linear-gradient(90deg, #7C3AED, #3B82F6)', textColor: '#333' },
                { label: 'TAXA ADM (CORRIDAS)', value: totals.txAdm, borderColor: 'linear-gradient(90deg, #16A34A, #22D3EE)', sub: 'Piso mínimo', textColor: '#16A34A' },
                { label: 'TOTAL CORRIDAS', value: totals.sumTaxaCorridas, borderColor: 'linear-gradient(90deg, #3B82F6, #60A5FA)', sub: `R$ ${storeConfig.taxaCorridaPerEntrega.toFixed(2)}/entrega`, textColor: '#3B82F6' },
                { label: 'TX SUPERVISÃO', value: totals.txSupervisao, borderColor: 'linear-gradient(90deg, #E55C00, #F59E0B)', textColor: '#E55C00' },
                { label: 'DÉBITO PENDENTE', value: totals.debitoPendente, borderColor: 'linear-gradient(90deg, #EC4899, #F43F5E)', textColor: totals.debitoPendente > 0 ? '#DC2626' : '#999' },
              ].map((kpi, i) => (
                <div key={i} style={{
                  background: 'white',
                  borderRadius: '10px',
                  padding: '18px 20px',
                  border: '1px solid #EAEAEA',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {/* Top gradient border */}
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '3px',
                    background: kpi.borderColor,
                    borderRadius: '10px 10px 0 0',
                  }} />
                  <div style={{
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: '#999',
                    marginBottom: '8px',
                  }}>
                    {kpi.label}
                  </div>
                  <div style={{
                    fontSize: '1.35rem',
                    fontWeight: 800,
                    color: kpi.textColor,
                    letterSpacing: '-0.02em',
                    lineHeight: 1,
                  }}>
                    {formatBRL(kpi.value)}
                  </div>
                  {kpi.sub && (
                    <div style={{ fontSize: '0.6rem', color: '#BBB', marginTop: '6px' }}>
                      {kpi.sub}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Tabela */}
            <div className="card mt-md" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ fontSize: '0.7rem', whiteSpace: 'nowrap', tableLayout: 'fixed', width: '100%', minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', left: 0, background: '#f9fafb', zIndex: 10, width: 170, padding: '6px 12px' }}>MOTOBOY</th>
                      {weekDates.map(d => (
                        <th key={d.iso} className="text-center" style={{ width: 60, padding: '6px 2px' }}>
                          {d.dayName}
                        </th>
                      ))}
                      {reportType === 'producao' ? (
                        <>
                          <th className="text-center" style={{ width: 80, padding: '6px 4px' }}>DIÁRIA</th>
                          <th className="text-center" style={{ width: 80, padding: '6px 4px' }}>TAXA</th>
                        </>
                      ) : (
                        <>
                          <th className="text-center" style={{ width: 80, padding: '6px 4px' }}>PRODUÇÃO</th>
                          {showDiaria && <th className="text-center" style={{ width: 80, padding: '6px 4px' }}>GARANTIDO</th>}
                        </>
                      )}
                      {showTxCol && <th className="text-center" style={{ width: 90, padding: '6px 4px' }}>TX CORRIDAS</th>}
                      <th className="text-center" style={{ width: 60, padding: '6px 4px' }}>ADTO.</th>
                      <th className="text-center" style={{ width: 100, padding: '6px 8px', background: 'var(--color-primary)', color: 'white' }}>
                        TOTAL LÍQUIDO
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={99} className="text-center text-muted" style={{ padding: 'var(--space-xl)' }}>
                          Nenhuma corrida encontrada para o período selecionado.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, idx) => (
                        <tr key={idx}>
                          <td style={{
                            position: 'sticky', left: 0, background: 'white', zIndex: 10,
                            fontWeight: 600, borderRight: '1px solid var(--color-border)', padding: '4px 12px',
                          }}>
                            {row.nome}
                          </td>
                          {weekDates.map(d => renderDayCell(row, d.iso))}
                          {reportType === 'producao' ? (
                            <>
                              <td className="text-center text-mono" style={{ fontWeight: 500, padding: '4px' }}>{formatBRL(row.totalDiaria)}</td>
                              <td className="text-center text-mono" style={{ fontWeight: 500, padding: '4px', color: 'var(--color-primary)' }}>{formatBRL(row.totalTaxa)}</td>
                            </>
                          ) : (
                            <>
                              <td className="text-center text-mono" style={{ fontWeight: 500, padding: '4px' }}>{formatBRL(row.totalProducaoReal)}</td>
                              {showDiaria && (
                                <td className="text-center text-mono" style={{ fontWeight: 500, padding: '4px', color: 'var(--color-orange)' }}>{formatBRL(row.totalDiaria)}</td>
                              )}
                            </>
                          )}
                          {showTxCol && (
                            <td className="text-center text-mono" style={{ fontStyle: 'italic', color: 'var(--color-text-muted)', padding: '4px' }}>
                              {formatBRL(row.taxaCorridas)}
                            </td>
                          )}
                          <td className="text-center text-mono" style={{ color: 'var(--color-danger)', fontWeight: 500, padding: '4px' }}>
                            {row.adiantamentos > 0 ? `-${formatBRL(row.adiantamentos)}` : '—'}
                          </td>
                          <td className="text-center text-mono" style={{
                            fontWeight: 700, color: 'var(--color-primary)', padding: '4px 8px',
                            background: 'rgba(37,99,235,0.05)',
                          }}>
                            {formatBRL(row.totalLiquido)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {rows.length > 0 && (
                    <tfoot>
                      <tr style={{ background: 'var(--color-primary)', color: 'white' }}>
                        <td style={{ position: 'sticky', left: 0, background: 'var(--color-primary)', zIndex: 10, fontWeight: 700, padding: '8px 12px' }}>
                          TOTAL ACUMULADO
                        </td>
                        {weekDates.map(d => (
                          <td key={d.iso} className="text-center" style={{ padding: '8px 2px' }}>—</td>
                        ))}
                        {reportType === 'producao' ? (
                          <>
                            <td className="text-center" style={{ fontWeight: 700, padding: '8px 4px' }}>{formatBRL(totals.diarias)}</td>
                            <td className="text-center" style={{ fontWeight: 700, padding: '8px 4px' }}>{formatBRL(totals.taxas)}</td>
                          </>
                        ) : (
                          <>
                            <td className="text-center" style={{ fontWeight: 700, padding: '8px 4px' }}>{formatBRL(totals.producao)}</td>
                            {showDiaria && <td className="text-center" style={{ fontWeight: 700, padding: '8px 4px' }}>{formatBRL(totals.diarias)}</td>}
                          </>
                        )}
                        {showTxCol && (
                          <td className="text-center" style={{ fontWeight: 700, padding: '8px 4px' }}>{formatBRL(totals.sumTaxaCorridas)}</td>
                        )}
                        <td className="text-center" style={{ fontWeight: 700, padding: '8px 4px', color: '#FFD6B3' }}>-{formatBRL(totals.totalAdiantamentos)}</td>
                        <td className="text-center" style={{ fontWeight: 700, padding: '8px 4px', fontSize: '0.95rem' }}>{formatBRL(totals.totalTabela)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Total a Liquidar */}
            <div className="card mt-md flex items-center justify-between">
              <div>
                <h3 className="card-title">Total a Liquidar (Loja)</h3>
                <p className="text-muted" style={{ fontSize: '0.65rem', fontStyle: 'italic' }}>
                  Tabela + TX Adm + TX Supervisão + Débito Pendente
                </p>
                <div style={{ fontSize: '0.65rem', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>Tabela: <strong>{formatBRL(totals.totalTabela)}</strong></span>
                  {totals.txAdm > 0 && (
                    <span>+ TX Adm (Piso): <strong>{formatBRL(totals.txAdm)}</strong></span>
                  )}
                  {totals.txSupervisao > 0 && (
                    <span style={{ color: 'var(--color-accent)' }}>
                      + Supervisão: <strong>{formatBRL(totals.txSupervisao)}</strong>
                    </span>
                  )}
                  {totals.debitoPendente > 0 && (
                    <span style={{ color: 'var(--color-danger)' }}>
                      + Débito: <strong>{formatBRL(totals.debitoPendente)}</strong>
                    </span>
                  )}
                </div>
              </div>
              <span className="text-mono" style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--color-primary)' }}>
                {formatBRL(totals.totalALiquidar)}
              </span>
            </div>

            <footer style={{ marginTop: 'var(--space-xl)', textAlign: 'center', fontSize: '0.6rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Relatório Gerencial • Carregamento Dinâmico • © 2026
            </footer>
          </>
        )}
      </div>
    </>
  );
}
