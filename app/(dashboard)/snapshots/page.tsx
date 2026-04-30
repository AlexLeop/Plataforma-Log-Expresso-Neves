'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../components/Toast';
import { authFetch } from '@/app/lib/api-client';
import {
  getSnapshots, createSnapshot, finalizeSnapshot, lockSnapshot,
  reopenSnapshot, deleteSnapshot, findSnapshot, pullSnapshotsFromSupabase,
  type WeeklySnapshot, type SnapshotStatus, type SnapshotDriverRow,
} from '../../services/snapshot-store';
import { getDailyEntriesForWeek, getManualEntriesForWeek } from '../../services/entries-store';
import { getCompanyConfig } from '../../services/company-config';

function formatBRL(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

const STATUS_CONFIG: Record<SnapshotStatus, { label: string; badge: string; icon: string }> = {
  draft: { label: 'Rascunho', badge: 'badge-warning', icon: '' },
  finalizado: { label: 'Finalizado', badge: 'badge-success', icon: '' },
  bloqueado: { label: 'Bloqueado', badge: 'badge-danger', icon: '' },
};

export default function SnapshotsPage() {
  const { selectedCompany, companies, weekPeriod } = useAppContext();
  const { showToast } = useToast();
  const [snapshots, setSnapshots] = useState<WeeklySnapshot[]>([]);
  const [selectedSnap, setSelectedSnap] = useState<WeeklySnapshot | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ id: string; action: string } | null>(null);

  const companyId = selectedCompany?.id || 0;

  // Load snapshots (pull from Supabase first)
  const loadSnapshots = useCallback(async () => {
    if (companyId) {
      await pullSnapshotsFromSupabase(companyId);
    }
    const all = getSnapshots();
    // Sort: most recent first
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setSnapshots(all);
  }, [companyId]);

  useEffect(() => { loadSnapshots(); }, [loadSnapshots]);

  // Check if current week already has a snapshot for this company
  const currentWeekSnap = useMemo(() => {
    if (!companyId) return null;
    return findSnapshot(companyId, weekPeriod.start);
  }, [companyId, weekPeriod.start, snapshots]);

  // Generate snapshot from current data
  const handleGenerate = async () => {
    if (!selectedCompany) return;
    setGenerating(true);

    try {
      const config = getCompanyConfig(selectedCompany.id, selectedCompany.nome);
      const dailies = getDailyEntriesForWeek(selectedCompany.id, weekPeriod.start, weekPeriod.end);
      const manuals = getManualEntriesForWeek(selectedCompany.id, weekPeriod.start, weekPeriod.end);

      // Group by driver
      const driverMap: Record<string, SnapshotDriverRow> = {};

      for (const d of dailies) {
        if (!driverMap[d.driverId]) {
          driverMap[d.driverId] = {
            driverId: d.driverId,
            driverName: d.driverName,
            totalDiaria: 0, totalExtras: 0, totalTaxaCorridas: 0,
            totalAdiantamentos: 0, totalLiquido: 0, entregas: 0, corridas: 0,
          };
        }
        driverMap[d.driverId].totalDiaria += d.amount;
      }

      for (const m of manuals) {
        if (!driverMap[m.driverId]) {
          driverMap[m.driverId] = {
            driverId: m.driverId,
            driverName: m.driverName,
            totalDiaria: 0, totalExtras: 0, totalTaxaCorridas: 0,
            totalAdiantamentos: 0, totalLiquido: 0, entregas: 0, corridas: 0,
          };
        }
        if (m.type === 'extra' || m.type === 'missao') {
          driverMap[m.driverId].totalExtras += m.amount;
        } else if (m.type === 'adiantamento') {
          driverMap[m.driverId].totalAdiantamentos += m.amount;
        }
      }

      // Fetch rides data for entregas/corridas from API
      try {
        const res = await authFetch(`/api/machine/rides?empresa_id=${selectedCompany.id}&limite=500`);
        if (res.ok) {
          const data = await res.json();
          const rides = (data.rides || []).filter((r: Record<string, unknown>) => {
            const rideDate = String(r.data_hora_solicitacao || '').split(' ')[0].split('T')[0];
            return rideDate >= weekPeriod.start && rideDate <= weekPeriod.end;
          });

          for (const r of rides) {
            const status = String(r.status_solicitacao).toUpperCase();
            if (status !== 'F' && status !== 'FINALIZADA' && status !== 'FINALIZADO') continue;

            const condId = String(r.condutor_id);
            if (!driverMap[condId]) {
              driverMap[condId] = {
                driverId: condId,
                driverName: (r as Record<string, unknown>).nome_condutor as string || `Condutor ${condId}`,
                totalDiaria: 0, totalExtras: 0, totalTaxaCorridas: 0,
                totalAdiantamentos: 0, totalLiquido: 0, entregas: 0, corridas: 0,
              };
            }
            driverMap[condId].corridas++;
            const paradas = (r as Record<string, unknown>).paradas as Array<unknown>;
            driverMap[condId].entregas += paradas ? paradas.length : 1;
          }
        }
      } catch { /* continue without ride data */ }

      // Calculate totals
      const driverRows = Object.values(driverMap);
      for (const row of driverRows) {
        row.totalTaxaCorridas = row.entregas * config.taxaCorridaPerEntrega;
        row.totalLiquido = row.totalDiaria + row.totalExtras + row.totalTaxaCorridas - row.totalAdiantamentos;
      }
      driverRows.sort((a, b) => a.driverName.localeCompare(b.driverName));

      const totalGeral = driverRows.reduce((s, r) => s + r.totalLiquido, 0);

      const snap = createSnapshot({
        companyId: selectedCompany.id,
        companyName: selectedCompany.nome,
        weekStart: weekPeriod.start,
        weekEnd: weekPeriod.end,
        weekLabel: weekPeriod.label,
        totalGeral,
        drivers: driverRows,
      });

      loadSnapshots();
      setSelectedSnap(snap);
      showToast('Snapshot gerado com sucesso', 'success');
    } finally {
      setGenerating(false);
    }
  };

  // Action handlers
  const handleAction = (id: string, action: string) => {
    setConfirmAction({ id, action });
  };

  const confirmActionHandler = () => {
    if (!confirmAction) return;
    const { id, action } = confirmAction;

    switch (action) {
      case 'finalize':
        finalizeSnapshot(id);
        break;
      case 'lock':
        lockSnapshot(id);
        break;
      case 'reopen':
        reopenSnapshot(id);
        break;
      case 'delete':
        deleteSnapshot(id);
        if (selectedSnap?.id === id) setSelectedSnap(null);
        break;
    }

    loadSnapshots();
    setConfirmAction(null);

    const toastMessages: Record<string, { msg: string; type: 'success' | 'info' | 'warning' }> = {
      finalize: { msg: 'Snapshot finalizado', type: 'success' },
      lock: { msg: 'Snapshot bloqueado', type: 'warning' },
      reopen: { msg: 'Snapshot reaberto', type: 'info' },
      delete: { msg: 'Snapshot excluído', type: 'info' },
    };
    const tm = toastMessages[action];
    if (tm) showToast(tm.msg, tm.type);

    // Refresh selected if it was affected
    if (selectedSnap?.id === id && action !== 'delete') {
      const updated = getSnapshots().find(s => s.id === id);
      if (updated) setSelectedSnap(updated);
    }
  };

  const actionLabels: Record<string, { label: string; desc: string }> = {
    finalize: { label: 'Finalizar', desc: 'Confirmar valores e marcar como finalizado? Os dados serão congelados.' },
    lock: { label: 'Bloquear', desc: 'Bloquear permanentemente? Esta ação não pode ser desfeita.' },
    reopen: { label: 'Reabrir', desc: 'Voltar para rascunho? Os dados poderão ser alterados.' },
    delete: { label: 'Excluir', desc: 'Excluir este snapshot? Esta ação não pode ser desfeita.' },
  };

  // Company snapshots filtered
  const companySnapshots = useMemo(() => {
    if (!companyId) return snapshots;
    return snapshots.filter(s => s.companyId === companyId);
  }, [snapshots, companyId]);

  return (
    <>
      <header className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Snapshots Semanais</h1>
            <p className="page-subtitle">
              {selectedCompany?.nome || 'Todas as empresas'} • Ciclo: Draft → Finalizado → Bloqueado
            </p>
          </div>
          <div className="flex gap-sm">
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={!selectedCompany || generating}
            >
              {generating ? '↻ Gerando...' : currentWeekSnap ? '↻ Atualizar Snapshot' : ' Gerar Snapshot'}
            </button>
          </div>
        </div>
      </header>

      <div className="page-body">
        {/* Info card for current week */}
        {selectedCompany && (
          <div className="card" style={{
            background: currentWeekSnap
              ? (currentWeekSnap.status === 'bloqueado' ? 'rgba(229, 92, 0, 0.04)' : currentWeekSnap.status === 'finalizado' ? 'rgba(34, 197, 94, 0.04)' : 'rgba(245, 158, 11, 0.04)')
              : 'rgba(37, 99, 235, 0.04)',
            borderLeft: `4px solid ${currentWeekSnap
              ? (currentWeekSnap.status === 'bloqueado' ? '#E55C00' : currentWeekSnap.status === 'finalizado' ? '#22c55e' : '#f59e0b')
              : 'var(--color-primary)'}`,
          }}>
            <div className="flex items-center justify-between">
              <div>
                <p style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                  Semana atual: {weekPeriod.label}
                </p>
                {currentWeekSnap ? (
                  <p className="text-muted" style={{ fontSize: '0.75rem' }}>
                    {STATUS_CONFIG[currentWeekSnap.status].icon} Status: <strong>{STATUS_CONFIG[currentWeekSnap.status].label}</strong> • 
                    Total: <strong style={{ color: 'var(--color-primary)' }}>{formatBRL(currentWeekSnap.totalGeral)}</strong> •
                    {currentWeekSnap.drivers.length} motoboys
                  </p>
                ) : (
                  <p className="text-muted" style={{ fontSize: '0.75rem' }}>
                     Nenhum snapshot gerado para esta semana. Clique em &quot;Gerar Snapshot&quot; para consolidar.
                  </p>
                )}
              </div>
              {currentWeekSnap && (
                <span className={`badge ${STATUS_CONFIG[currentWeekSnap.status].badge}`}>
                  {STATUS_CONFIG[currentWeekSnap.status].label}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Snapshots list */}
        <div className="card mt-md">
          <div className="card-header">
            <h2 className="card-title">Histórico de Snapshots</h2>
            <span className="badge badge-info">{companySnapshots.length} registros</span>
          </div>

          {companySnapshots.length === 0 ? (
            <p className="text-muted text-center" style={{ padding: 'var(--space-xl)', fontSize: '0.8rem' }}>
              Nenhum snapshot encontrado. Gere o primeiro snapshot da semana acima.
            </p>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Semana</th>
                    <th>Status</th>
                    <th className="text-center">Motoboys</th>
                    <th className="text-right">Total</th>
                    <th>Criado em</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {companySnapshots.map(snap => {
                    const sc = STATUS_CONFIG[snap.status];
                    return (
                      <tr
                        key={snap.id}
                        style={{
                          cursor: 'pointer',
                          background: selectedSnap?.id === snap.id ? 'rgba(37,99,235,0.06)' : undefined,
                        }}
                        onClick={() => setSelectedSnap(snap)}
                      >
                        <td style={{ fontWeight: 600 }}>{snap.companyName}</td>
                        <td className="text-mono">{snap.weekLabel}</td>
                        <td>
                          <span className={`badge ${sc.badge}`}>{sc.icon} {sc.label}</span>
                        </td>
                        <td className="text-center text-mono">{snap.drivers.length}</td>
                        <td className="text-right text-mono" style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                          {formatBRL(snap.totalGeral)}
                        </td>
                        <td className="text-muted" style={{ fontSize: '0.75rem' }}>
                          {new Date(snap.createdAt).toLocaleDateString('pt-BR')}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div className="flex gap-sm">
                            {snap.status === 'draft' && (
                              <>
                                <button className="btn btn-sm" style={{ fontSize: '0.65rem', padding: '2px 8px', background: '#22c55e', color: 'white', border: 'none' }}
                                  onClick={() => handleAction(snap.id, 'finalize')} title="Finalizar">
                                  ✓ Finalizar
                                </button>
                                <button className="btn btn-sm" style={{ fontSize: '0.65rem', padding: '2px 8px', color: 'var(--color-danger)', background: 'none', border: 'none' }}
                                  onClick={() => handleAction(snap.id, 'delete')} title="Excluir">
                                  ✕
                                </button>
                              </>
                            )}
                            {snap.status === 'finalizado' && (
                              <>
                                <button className="btn btn-sm" style={{ fontSize: '0.65rem', padding: '2px 8px', background: '#E55C00', color: 'white', border: 'none' }}
                                  onClick={() => handleAction(snap.id, 'lock')} title="Bloquear">
                                   Bloquear
                                </button>
                                <button className="btn btn-sm" style={{ fontSize: '0.65rem', padding: '2px 8px', color: 'var(--color-text-muted)', background: 'none', border: 'none' }}
                                  onClick={() => handleAction(snap.id, 'reopen')} title="Reabrir">
                                  ↩ Reabrir
                                </button>
                              </>
                            )}
                            {snap.status === 'bloqueado' && (
                              <span className="text-muted" style={{ fontSize: '0.65rem', fontStyle: 'italic' }}>Imutável</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail view */}
        {selectedSnap && (
          <div className="card mt-md">
            <div className="card-header">
              <h2 className="card-title">
                {selectedSnap.companyName} — {selectedSnap.weekLabel}
              </h2>
              <span className={`badge ${STATUS_CONFIG[selectedSnap.status].badge}`}>
                {STATUS_CONFIG[selectedSnap.status].icon} {STATUS_CONFIG[selectedSnap.status].label}
              </span>
            </div>

            <div className="table-container">
              <table style={{ fontSize: '0.75rem' }}>
                <thead>
                  <tr>
                    <th>Motoboy</th>
                    <th className="text-right">Diária</th>
                    <th className="text-right">Extras</th>
                    <th className="text-right">Tx Corridas</th>
                    <th className="text-right">Adiantamentos</th>
                    <th className="text-center">Entregas</th>
                    <th className="text-right" style={{ background: 'var(--color-primary)', color: 'white', padding: '6px 8px' }}>Total Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSnap.drivers.map(d => (
                    <tr key={d.driverId}>
                      <td style={{ fontWeight: 600 }}>{d.driverName}</td>
                      <td className="text-right text-mono">{formatBRL(d.totalDiaria)}</td>
                      <td className="text-right text-mono" style={{ color: d.totalExtras > 0 ? 'var(--color-secondary)' : 'var(--color-text-muted)' }}>
                        {d.totalExtras > 0 ? formatBRL(d.totalExtras) : '—'}
                      </td>
                      <td className="text-right text-mono text-muted" style={{ fontStyle: 'italic' }}>
                        {formatBRL(d.totalTaxaCorridas)}
                      </td>
                      <td className="text-right text-mono" style={{ color: d.totalAdiantamentos > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                        {d.totalAdiantamentos > 0 ? `-${formatBRL(d.totalAdiantamentos)}` : '—'}
                      </td>
                      <td className="text-center text-mono">{d.entregas}</td>
                      <td className="text-right text-mono" style={{ fontWeight: 700, color: 'var(--color-primary)', background: 'rgba(37,99,235,0.05)' }}>
                        {formatBRL(d.totalLiquido)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--color-primary)', color: 'white' }}>
                    <td style={{ fontWeight: 700 }}>TOTAL</td>
                    <td className="text-right" style={{ fontWeight: 700 }}>
                      {formatBRL(selectedSnap.drivers.reduce((s, d) => s + d.totalDiaria, 0))}
                    </td>
                    <td className="text-right" style={{ fontWeight: 700 }}>
                      {formatBRL(selectedSnap.drivers.reduce((s, d) => s + d.totalExtras, 0))}
                    </td>
                    <td className="text-right" style={{ fontWeight: 700 }}>
                      {formatBRL(selectedSnap.drivers.reduce((s, d) => s + d.totalTaxaCorridas, 0))}
                    </td>
                    <td className="text-right" style={{ fontWeight: 700 }}>
                      -{formatBRL(selectedSnap.drivers.reduce((s, d) => s + d.totalAdiantamentos, 0))}
                    </td>
                    <td className="text-center" style={{ fontWeight: 700 }}>
                      {selectedSnap.drivers.reduce((s, d) => s + d.entregas, 0)}
                    </td>
                    <td className="text-right" style={{ fontWeight: 900, fontSize: '0.9rem' }}>
                      {formatBRL(selectedSnap.totalGeral)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Metadata footer */}
            <div className="flex items-center justify-between" style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-sm)', borderTop: '1px solid var(--color-border)' }}>
              <div className="text-muted" style={{ fontSize: '0.65rem' }}>
                Criado: {new Date(selectedSnap.createdAt).toLocaleString('pt-BR')}
                {selectedSnap.finalizedAt && <> • Finalizado: {new Date(selectedSnap.finalizedAt).toLocaleString('pt-BR')}</>}
                {selectedSnap.lockedAt && <> • Bloqueado: {new Date(selectedSnap.lockedAt).toLocaleString('pt-BR')}</>}
              </div>
              <span className="text-mono" style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>
                ID: {selectedSnap.id}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Confirm Modal */}
      {confirmAction && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card" style={{ width: 400, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div className="card-header">
              <h2 className="card-title">Confirmar Ação</h2>
            </div>
            <p style={{ fontSize: '0.85rem', marginBottom: 'var(--space-md)' }}>
              {actionLabels[confirmAction.action]?.desc}
            </p>
            <div className="flex justify-between">
              <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>Cancelar</button>
              <button
                className="btn"
                style={{
                  background: confirmAction.action === 'delete' || confirmAction.action === 'lock' ? '#E55C00' : '#22c55e',
                  color: 'white', border: 'none',
                }}
                onClick={confirmActionHandler}
              >
                {actionLabels[confirmAction.action]?.label || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
