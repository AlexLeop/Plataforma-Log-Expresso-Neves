'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../components/Toast';
import { authFetch } from '@/app/lib/api-client';
import { toLocalDateISO } from '@/app/lib/date-utils';
import { getCreditLog, getCreditStats, getCreditLogForWeek, getDailyEntriesForWeek, getDriverDayAggregation, getPendingCreditsForDate, addCreditLogEntry, markDailyEntryCredited, markDailyEntryFailed, pullEntriesFromSupabase, type CreditLogEntry } from '../../services/entries-store';
import { getCompanyConfig } from '../../services/company-config';
import CreditQueuePanel from '../../components/CreditQueuePanel';

interface DriverBalance {
  id: string;
  name: string;
  balance: number | null;
  loading: boolean;
  error?: string;
}

function formatBRL(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

export default function FinanceiroPage() {
  const { selectedCompany, weekPeriod, drivers, isAdmin } = useAppContext();
  const { showToast } = useToast();
  const companyId = selectedCompany?.id || 0;

  const [creditLog, setCreditLog] = useState<CreditLogEntry[]>([]);
  const [driverBalances, setDriverBalances] = useState<DriverBalance[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingResults, setProcessingResults] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'log' | 'balances' | 'queue'>('overview');

  // Sync counter — triggers re-computation of stats after Supabase pull
  const [syncVersion, setSyncVersion] = useState(0);

  // Load credit log + pull fresh data from Supabase
  const loadData = useCallback(async () => {
    if (!companyId) return;
    // Pull latest from Supabase (updates localStorage with credit_status)
    await pullEntriesFromSupabase(companyId, weekPeriod.start, weekPeriod.end);

    // Build credit log from credited entries (source of truth)
    const allDailies = getDailyEntriesForWeek(companyId, weekPeriod.start, weekPeriod.end);
    const creditedEntries = allDailies.filter(e => e.creditStatus === 'credited');

    // Group by driver + date
    const logMap = new Map<string, CreditLogEntry>();
    for (const entry of creditedEntries) {
      const key = `${entry.driverId}_${entry.date}`;
      if (!logMap.has(key)) {
        logMap.set(key, {
          id: `auto_${key}`,
          date: entry.date,
          driverId: entry.driverId,
          driverName: entry.driverName,
          companyId: entry.companyId,
          companyName: selectedCompany?.nome || '',
          amount: 0,
          breakdown: { diaria: 0, extras: 0, adiantamentos: 0 },
          status: 'success',
          createdAt: entry.creditedAt || new Date().toISOString(),
          processedBy: 'cron',
        });
      }
      const logEntry = logMap.get(key)!;
      logEntry.breakdown.diaria += entry.amount;
      logEntry.amount += entry.amount;
    }

    // Also include old manual credit log entries
    const oldLog = getCreditLogForWeek(companyId, weekPeriod.start, weekPeriod.end);
    for (const entry of oldLog) {
      const key = `manual_${entry.driverId}_${entry.date}`;
      if (!logMap.has(key)) logMap.set(key, entry);
    }

    const log = Array.from(logMap.values()).sort((a, b) => b.date.localeCompare(a.date));
    setCreditLog(log);
    setSyncVersion(v => v + 1);
  }, [companyId, weekPeriod, selectedCompany]);

  useEffect(() => { loadData(); }, [loadData]);

  // Credit stats (re-computed after sync)
  const stats = useMemo(() => {
    if (!companyId) return { total: 0, pending: 0, credited: 0, failed: 0 };
    return getCreditStats(companyId, weekPeriod.start, weekPeriod.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, weekPeriod, syncVersion]);

  // Log from all time
  const allLog = useMemo(() => getCreditLog().slice(0, 100), []);

  // Company config
  const config = useMemo(() => {
    if (!companyId || !selectedCompany) return null;
    return getCompanyConfig(companyId, selectedCompany.nome);
  }, [companyId, selectedCompany]);

  // Fetch driver balances
  const fetchBalances = useCallback(async () => {
    if (!drivers.length) return;
    setLoadingBalances(true);
    const balances: DriverBalance[] = [];

    for (const d of drivers) {
      try {
        const r = await authFetch('/api/machine/credits/driver/balance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driver_id: d.id }),
        });
        if (r.ok) {
          const data = await r.json();
          const saldo = data?.response?.saldo ?? data?.saldo ?? null;
          balances.push({ id: d.id, name: d.nome, balance: saldo !== null ? parseFloat(saldo) : null, loading: false });
        } else {
          balances.push({ id: d.id, name: d.nome, balance: null, loading: false, error: 'API error' });
        }
      } catch {
        balances.push({ id: d.id, name: d.nome, balance: null, loading: false, error: 'Network error' });
      }
    }

    setDriverBalances(balances);
    setLoadingBalances(false);
  }, [drivers]);

  // Process credit for a specific date (manual trigger)
  const processCreditsForDate = useCallback(async (date: string) => {
    if (!companyId || !selectedCompany || !config) return;
    setProcessing(true);
    setProcessingResults([]);
    const results: string[] = [];

    const pending = getPendingCreditsForDate(companyId, date);
    if (pending.length === 0) {
      results.push('Nenhuma diária pendente para esta data.');
      setProcessingResults(results);
      setProcessing(false);
      return;
    }

    for (const entry of pending) {
      const agg = getDriverDayAggregation(companyId, entry.driverId, date);
      const totalCredit = agg.diaria + agg.extras - agg.adiantamentos;

      if (totalCredit <= 0 && agg.adiantamentos > 0) {
        // Adiantamento/vale — usar sacar
        try {
          const debitAmount = Math.abs(totalCredit);
          const descricao = config.autoCredit.creditDescription
            .replace('{date}', date)
            .replace('{company}', selectedCompany.nome) + ` (Vale: -${formatBRL(debitAmount)})`;

          const r = await authFetch('/api/machine/credits/driver/withdraw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ condutor_id: entry.driverId, valor: debitAmount, descricao }),
          });

          if (r.ok) {
            markDailyEntryCredited(entry.driverId, date, companyId);
            addCreditLogEntry({
              date, driverId: entry.driverId, driverName: entry.driverName,
              companyId, companyName: selectedCompany.nome,
              amount: -debitAmount,
              breakdown: { diaria: agg.diaria, extras: agg.extras, adiantamentos: agg.adiantamentos },
              status: 'success', processedBy: 'manual',
            });
            results.push(`✓ ${entry.driverName}: ${formatBRL(-debitAmount)} (desconto)`);
          } else {
            const err = await r.text();
            markDailyEntryFailed(entry.driverId, date, companyId, err);
            addCreditLogEntry({
              date, driverId: entry.driverId, driverName: entry.driverName,
              companyId, companyName: selectedCompany.nome,
              amount: -debitAmount,
              breakdown: { diaria: agg.diaria, extras: agg.extras, adiantamentos: agg.adiantamentos },
              status: 'failed', error: err, processedBy: 'manual',
            });
            results.push(`✕ ${entry.driverName}: falhou — ${err.slice(0, 80)}`);
          }
        } catch (err) {
          results.push(`✕ ${entry.driverName}: erro de rede`);
        }
      } else if (totalCredit > 0) {
        // Crédito positivo — recarregar
        try {
          const descricao = config.autoCredit.creditDescription
            .replace('{date}', date)
            .replace('{company}', selectedCompany.nome);

          const r = await authFetch('/api/machine/credits/driver/recharge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ condutor_id: entry.driverId, valor: totalCredit, descricao }),
          });

          if (r.ok) {
            markDailyEntryCredited(entry.driverId, date, companyId);
            addCreditLogEntry({
              date, driverId: entry.driverId, driverName: entry.driverName,
              companyId, companyName: selectedCompany.nome,
              amount: totalCredit,
              breakdown: { diaria: agg.diaria, extras: agg.extras, adiantamentos: agg.adiantamentos },
              status: 'success', processedBy: 'manual',
            });
            results.push(`✓ ${entry.driverName}: +${formatBRL(totalCredit)}`);
          } else {
            const err = await r.text();
            markDailyEntryFailed(entry.driverId, date, companyId, err);
            addCreditLogEntry({
              date, driverId: entry.driverId, driverName: entry.driverName,
              companyId, companyName: selectedCompany.nome,
              amount: totalCredit,
              breakdown: { diaria: agg.diaria, extras: agg.extras, adiantamentos: agg.adiantamentos },
              status: 'failed', error: err, processedBy: 'manual',
            });
            results.push(`✕ ${entry.driverName}: falhou — ${err.slice(0, 80)}`);
          }
        } catch {
          results.push(`✕ ${entry.driverName}: erro de rede`);
        }
      } else {
        // Zero amount — skip
        results.push(`○ ${entry.driverName}: R$ 0,00 — ignorado`);
      }

      // Rate limit: 4 req/min for credit endpoints
      await new Promise(r => setTimeout(r, 16000));
    }

    setProcessingResults(results);
    setProcessing(false);
    loadData();

    const successCount = results.filter(r => r.startsWith('✓')).length;
    const failCount = results.filter(r => r.startsWith('✕')).length;
    if (successCount > 0 && failCount === 0) {
      showToast(`${successCount} crédito(s) processado(s) com sucesso`, 'success');
    } else if (failCount > 0) {
      showToast(`${failCount} crédito(s) falharam. Verifique o log.`, 'error');
    } else {
      showToast('Nenhum crédito processado', 'info');
    }
  }, [companyId, selectedCompany, config, loadData]);

  // Yesterday's date
  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toLocalDateISO(d);
  }, []);

  const tabs = [
    { key: 'overview' as const, label: 'Resumo' },
    { key: 'queue' as const, label: ' Fila de Créditos' },
    { key: 'log' as const, label: `Log de Créditos (${creditLog.length})` },
    ...(isAdmin ? [{ key: 'balances' as const, label: 'Saldos' }] : []),
  ];

  return (
    <>
      <header className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Financeiro</h1>
            <p className="page-subtitle">
              {selectedCompany?.nome || 'Todas'} • Gestão de créditos automáticos
            </p>
          </div>
        </div>
      </header>

      <div className="page-body">
        {/* Stats */}
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Diárias na semana</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: '#d97706' }}>{stats.pending}</div>
            <div className="stat-label">○ Pendentes</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-success">{stats.credited}</div>
            <div className="stat-label">● Creditadas</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: '#E55C00' }}>{stats.failed}</div>
            <div className="stat-label">● Falharam</div>
          </div>
        </div>

        {/* Auto-credit config summary */}
        <div className="card mt-md">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
            <div>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0 }}>Crédito Automático</h3>
              <p className="text-muted" style={{ fontSize: '0.7rem', margin: '4px 0 0' }}>
                {config?.autoCredit.enabled
                  ? `Ativo — Corte às ${String(config.autoCredit.cutoffHour).padStart(2, '0')}:${String(config.autoCredit.cutoffMinute).padStart(2, '0')}`
                  : 'Desativado — configure em Configurações'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                disabled={processing || stats.pending === 0}
                onClick={() => processCreditsForDate(yesterday)}
                style={{ fontSize: '0.7rem' }}
              >
                {processing ? 'Processando...' : `Creditar ontem (${yesterday})`}
              </button>
              <button
                className="btn btn-primary"
                disabled={processing || stats.pending === 0 || !config?.autoCredit.enabled}
                onClick={async () => {
                  if (!selectedCompany || !config?.autoCredit.enabled) return;
                  setProcessing(true);
                  setProcessingResults([]);
                  try {
                    const res = await authFetch('/api/cron/auto-credit', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ company_id: selectedCompany.id }),
                    });
                    const data = await res.json();
                    if (res.ok && data.results) {
                      const lines = (data.results as Array<{driver: string; status: string; amount: number; reason?: string}>).map((r) => {
                        if (r.status === 'credited') return `Creditado: ${r.driver}: +${formatBRL(r.amount)}`;
                        if (r.status === 'skipped') return `Ignorado: ${r.driver}: ${r.reason || 'sem pendência'}`;
                        return `Falhou: ${r.driver}: ${r.reason || 'erro'}`;
                      });
                      setProcessingResults(lines);
                      const credited = data.credits || 0;
                      const failed = data.failed || 0;
                      if (credited > 0 && failed === 0) showToast(`${credited} crédito(s) processado(s)`, 'success');
                      else if (failed > 0) showToast(`${failed} crédito(s) falharam`, 'error');
                      else showToast('Nenhum crédito pendente', 'info');
                    } else {
                      showToast(data.error || 'Erro ao processar', 'error');
                      setProcessingResults([data.error || 'Erro desconhecido']);
                    }
                  } catch (err) {
                    showToast('Erro de conexão', 'error');
                    setProcessingResults(['Erro de conexão com o servidor']);
                  } finally {
                    setProcessing(false);
                    loadData();
                  }
                }}
                style={{ fontSize: '0.7rem' }}
                title={!config?.autoCredit.enabled ? 'Habilite o auto-crédito nas Configurações' : ''}
              >
                {processing ? 'Processando...' : 'Processar Créditos'}
              </button>
            </div>
          </div>

          {/* Processing results */}
          {processingResults.length > 0 && (
            <div style={{
              marginTop: 'var(--space-sm)', padding: 'var(--space-sm)',
              background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)',
              fontSize: '0.7rem', maxHeight: 200, overflow: 'auto',
            }}>
              {processingResults.map((r, i) => (
                <p key={i} style={{ margin: '2px 0' }}>{r}</p>
              ))}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--color-border)', marginTop: 'var(--space-md)' }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => {
                setActiveTab(t.key);
                if (t.key === 'balances' && driverBalances.length === 0) fetchBalances();
              }}
              style={{
                padding: '8px 16px', fontSize: '0.75rem',
                fontWeight: activeTab === t.key ? 700 : 500,
                background: 'transparent', border: 'none',
                borderBottom: activeTab === t.key ? '2px solid var(--color-primary)' : '2px solid transparent',
                color: activeTab === t.key ? 'var(--color-primary)' : 'var(--color-text-muted)',
                cursor: 'pointer', marginBottom: -2, transition: 'all 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="card" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, marginTop: 0 }}>
          {activeTab === 'overview' && (
            <div>
              <h3 style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>Como funciona</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-md)' }}>
                <div style={{ padding: 'var(--space-md)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid #d97706' }}>
                  <p style={{ fontWeight: 700, fontSize: '0.8rem' }}>1. Lançamento</p>
                  <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
                    Gestor marca presença na tela de Lançamentos. Diária auto-preenchida pelo dia da semana.
                  </p>
                </div>
                <div style={{ padding: 'var(--space-md)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--color-primary)' }}>
                  <p style={{ fontWeight: 700, fontSize: '0.8rem' }}>2. Ajuste</p>
                  <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
                    Loja tem até o horário de corte para ajustar diárias (turno duplo, descontos, extras).
                  </p>
                </div>
                <div style={{ padding: 'var(--space-md)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid #16a34a' }}>
                  <p style={{ fontWeight: 700, fontSize: '0.8rem' }}>3. Crédito</p>
                  <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
                    Sistema credita automaticamente na carteira Machine do condutor.
                    Fórmula: <strong>Diária + Extras − Adiantamentos</strong>
                  </p>
                </div>
              </div>

              {/* Extra Km config summary */}
              {config && (
                <div style={{ marginTop: 'var(--space-lg)', padding: 'var(--space-md)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)' }}>
                  <h4 style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: 8 }}>Configuração de Extras por Km</h4>
                  <p className="text-muted" style={{ fontSize: '0.7rem' }}>
                    {config.extraKm.mode === 'disabled' && '○ Desativado — esta loja não paga extra por km excedente'}
                    {config.extraKm.mode === 'fixed' && ` Valor fixo: ${formatBRL(config.extraKm.fixedAmount)} extra para corridas acima de ${config.extraKm.minKm} km`}
                    {config.extraKm.mode === 'delivery_fee' && ` Taxa adicional de entrega (${formatBRL(config.taxaCorridaPerEntrega)}) para corridas acima de ${config.extraKm.minKm} km`}
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'queue' && (
            <div style={{ margin: '-16px' }}>
              <CreditQueuePanel companyId={selectedCompany?.id ? String(selectedCompany.id) : undefined} />
            </div>
          )}

          {activeTab === 'log' && (
            <div>
              {creditLog.length === 0 ? (
                <p className="text-muted text-center" style={{ padding: 'var(--space-xl)' }}>
                  Nenhum crédito processado nesta semana.
                </p>
              ) : (
                <div className="table-container">
                  <table style={{ fontSize: '0.75rem' }}>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Motoboy</th>
                        <th className="text-right">Diária</th>
                        <th className="text-right">Extras</th>
                        <th className="text-right">Adiant.</th>
                        <th className="text-right">Total</th>
                        <th>Status</th>
                        <th>Via</th>
                        <th>Processado em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeTab === 'log' ? creditLog : allLog).map(entry => (
                        <tr key={entry.id}>
                          <td style={{ fontWeight: 600 }}>{entry.date.split('-').reverse().join('/')}</td>
                          <td>{entry.driverName}</td>
                          <td className="text-right text-mono">{formatBRL(entry.breakdown.diaria)}</td>
                          <td className="text-right text-mono" style={{ color: entry.breakdown.extras > 0 ? '#16a34a' : undefined }}>
                            {entry.breakdown.extras > 0 ? `+${formatBRL(entry.breakdown.extras)}` : '—'}
                          </td>
                          <td className="text-right text-mono" style={{ color: entry.breakdown.adiantamentos > 0 ? '#E55C00' : undefined }}>
                            {entry.breakdown.adiantamentos > 0 ? `-${formatBRL(entry.breakdown.adiantamentos)}` : '—'}
                          </td>
                          <td className="text-right text-mono" style={{ fontWeight: 700, color: entry.amount >= 0 ? 'var(--color-primary)' : '#E55C00' }}>
                            {entry.amount >= 0 ? `+${formatBRL(entry.amount)}` : formatBRL(entry.amount)}
                          </td>
                          <td>
                            <span style={{
                              padding: '2px 8px', borderRadius: 12, fontSize: '0.6rem', fontWeight: 600,
                              color: entry.status === 'success' ? '#16a34a' : '#E55C00',
                              background: entry.status === 'success' ? '#f0fdf4' : '#FFF7F0',
                            }}>
                              {entry.status === 'success' ? '✓ OK' : '✕ Falha'}
                            </span>
                          </td>
                          <td className="text-muted" style={{ fontSize: '0.65rem' }}>
                            {entry.processedBy === 'cron' ? ' Auto' : ' Manual'}
                          </td>
                          <td className="text-muted" style={{ fontSize: '0.65rem' }}>
                            {new Date(entry.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'balances' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                <p className="text-muted" style={{ fontSize: '0.7rem' }}>
                  Saldo da carteira Machine de cada condutor
                </p>
                <button className="btn btn-secondary" onClick={fetchBalances} disabled={loadingBalances} style={{ fontSize: '0.7rem' }}>
                  {loadingBalances ? '↻ Consultando...' : '↻ Atualizar saldos'}
                </button>
              </div>

              {driverBalances.length === 0 ? (
                <p className="text-muted text-center" style={{ padding: 'var(--space-xl)' }}>
                  {loadingBalances ? 'Consultando saldos na Machine API...' : 'Clique em "Atualizar saldos" para consultar.'}
                </p>
              ) : (
                <div className="table-container">
                  <table style={{ fontSize: '0.75rem' }}>
                    <thead>
                      <tr>
                        <th>Condutor</th>
                        <th className="text-right">Saldo Machine</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {driverBalances.map(d => (
                        <tr key={d.id}>
                          <td style={{ fontWeight: 600 }}>{d.name}</td>
                          <td className="text-right text-mono" style={{
                            fontWeight: 700,
                            color: d.balance === null ? 'var(--color-text-muted)' : d.balance >= 0 ? '#16a34a' : '#E55C00',
                          }}>
                            {d.balance !== null ? formatBRL(d.balance) : '—'}
                          </td>
                          <td>
                            {d.error ? (
                              <span style={{ color: '#E55C00', fontSize: '0.65rem' }}>✕ {d.error}</span>
                            ) : d.balance !== null ? (
                              <span style={{ color: '#16a34a', fontSize: '0.65rem' }}>✓ Consultado</span>
                            ) : (
                              <span className="text-muted" style={{ fontSize: '0.65rem' }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
