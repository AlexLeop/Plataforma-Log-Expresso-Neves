'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../components/Toast';
import { authFetch } from '@/app/lib/api-client';
import { toLocalDateISO } from '@/app/lib/date-utils';
import { getCompanyConfig } from '../services/company-config';
import { STATUS_MAP, ACTIVE_STATUS_CODES } from '@/app/lib/status-map';
import DeliveryMap from '../components/DeliveryMap';
import NewDeliveryModal from '../components/NewDeliveryModal';
import ConfirmModal from '../components/ConfirmModal';
import Pagination, { usePagination } from '../components/Pagination';
import { useRideCacheRealtime, type RideCacheEvent } from '../hooks/useRideCacheRealtime';

interface RideData {
  id?: string;
  condutor_id: number;
  nome_condutor: string;
  valor_corrida: string | number;
  status_solicitacao: string;
  paradas: Array<{ id: string | number; endereco?: string; lat?: string; lng?: string }>;
  data_hora_solicitacao?: string;
  coleta?: { lat?: string; lng?: string; endereco?: string };
  partida?: { lat?: string; lng?: string; endereco?: string; bairro?: string; cidade?: string };
  distancia_percorrida_km?: string;
  duracao_corrida?: string;
  estimativa_km?: number;
  estimativa_minutos?: number;
}

function formatBRL(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

export default function DashboardPage() {
  const { selectedCompany, weekPeriod, isAdmin } = useAppContext();
  const { showToast } = useToast();
  const [rides, setRides] = useState<RideData[]>([]);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; os: string } | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [hoveredRideId, setHoveredRideId] = useState<string | null>(null);

  // ─── Filters (same as Corridas page) ─────────────────────────
  const [dateRange, setDateRange] = useState<'week' | 'today' | 'all'>('week');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [driverFilter, setDriverFilter] = useState<string>('');

  const storeConfig = useMemo(() => {
    if (!selectedCompany) return { taxaCorridaPerEntrega: 1.60 };
    return getCompanyConfig(selectedCompany.id, selectedCompany.nome);
  }, [selectedCompany]);
  const [drivers, setDrivers] = useState<Array<{ id: string; nome: string; status: string }>>([]);
  const [loading, setLoading] = useState(true);

  const loadDashboardData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [ridesRes, driversRes] = await Promise.all([
        selectedCompany
          ? authFetch(`/api/machine/rides?empresa_id=${selectedCompany.id}&limite=500`)
          : authFetch('/api/machine/rides?limite=500'),
        authFetch('/api/machine/drivers'),
      ]);

      if (ridesRes?.ok) {
        const d = await ridesRes.json();
        setRides(d.rides || []);
      }
      if (driversRes.ok) {
        const d = await driversRes.json();
        setDrivers(d.drivers || []);
      }
    } catch {
      console.error('Failed to load dashboard data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedCompany]);

  // Initial load
  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // ─── Silent auto-refresh (30s) ───
  // Machine API does NOT support status webhooks (only position).
  // Without this, ride statuses (A Caminho → Finalizada) would never update.
  // Only runs when the browser tab is visible to save resources.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function startPolling() {
      if (intervalId) return;
      intervalId = setInterval(() => {
        loadDashboardData(true); // silent = true → no loading spinner
      }, 30_000);
    }

    function stopPolling() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function handleVisibility() {
      if (document.hidden) {
        stopPolling();
      } else {
        loadDashboardData(true); // Refresh immediately when tab becomes visible
        startPolling();
      }
    }

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadDashboardData]);

  // ─── Realtime: Subscribe to ride_cache changes via Supabase Realtime ───
  // Position webhook populates ride_cache → Realtime triggers instant UI updates  
  // for driver locations. Status changes come from the 30s refresh above.
  useRideCacheRealtime({
    empresaId: selectedCompany?.id,
    enabled: true,
    onStatusChange: useCallback((event: RideCacheEvent, eventType: 'INSERT' | 'UPDATE') => {
      setRides(prev => {
        const rideId = event.machine_ride_id;
        const existingIdx = prev.findIndex(r => String(r.id) === String(rideId));

        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            status_solicitacao: event.status_code,
            ...(event.driver_name ? {
              nome_condutor: event.driver_name,
              condutor_id: Number(event.machine_condutor_id) || updated[existingIdx].condutor_id,
            } : {}),
          };
          return updated;
        } else if (eventType === 'INSERT') {
          loadDashboardData(true);
          return prev;
        }
        return prev;
      });
    }, [loadDashboardData]),
  });

  // ─── Filtered rides (by date, status, driver) ────────────────
  const filteredRides = useMemo(() => {
    let filtered = rides;

    // Date filter
    if (dateRange === 'week') {
      filtered = filtered.filter(r => {
        const d = String(r.data_hora_solicitacao || '').split(' ')[0].split('T')[0];
        return d >= weekPeriod.start && d <= weekPeriod.end;
      });
    } else if (dateRange === 'today') {
      const today = toLocalDateISO(new Date());
      filtered = filtered.filter(r => {
        const d = String(r.data_hora_solicitacao || '').split(' ')[0].split('T')[0];
        return d === today;
      });
    }

    // Status filter
    if (statusFilter) {
      filtered = filtered.filter(r => String(r.status_solicitacao).toUpperCase().charAt(0) === statusFilter);
    }

    // Driver filter
    if (driverFilter) {
      filtered = filtered.filter(r =>
        (r.nome_condutor || '').toLowerCase().includes(driverFilter.toLowerCase())
      );
    }

    return filtered;
  }, [rides, dateRange, statusFilter, driverFilter, weekPeriod]);

  const stats = useMemo(() => {
    const finalized = filteredRides.filter(r => {
      const s = String(r.status_solicitacao).toUpperCase();
      return s === 'F' || s === 'FINALIZADA' || s === 'FINALIZADO';
    });

    const totalProducao = finalized.reduce((sum, r) => {
      const v = typeof r.valor_corrida === 'string' ? parseFloat(r.valor_corrida) : (r.valor_corrida || 0);
      return sum + v;
    }, 0);

    const totalEntregas = finalized.reduce((sum, r) => sum + (r.paradas?.length || 1), 0);

    const byDriver: Record<string, { nome: string; rides: number; producao: number; entregas: number }> = {};
    for (const r of finalized) {
      const id = String(r.condutor_id);
      const fare = typeof r.valor_corrida === 'string' ? parseFloat(r.valor_corrida) : (r.valor_corrida || 0);
      const deliveries = r.paradas?.length || 1;
      if (!byDriver[id]) {
        byDriver[id] = { nome: r.nome_condutor || `Condutor ${id}`, rides: 0, producao: 0, entregas: 0 };
      }
      byDriver[id].rides++;
      byDriver[id].producao += fare;
      byDriver[id].entregas += deliveries;
    }

    const topDrivers = Object.values(byDriver)
      .sort((a, b) => b.producao - a.producao)
      .slice(0, 5);

    const ativas = filteredRides.filter(r => ['D', 'G', 'P', 'A', 'E', 'S'].includes(String(r.status_solicitacao).toUpperCase().charAt(0))).length;
    const canceladas = filteredRides.filter(r => ['C', 'N'].includes(String(r.status_solicitacao).toUpperCase().charAt(0))).length;

    return {
      activeDrivers: drivers.filter(d => d.status === 'A').length,
      totalRides: finalized.length,
      totalProducao,
      totalEntregas,
      topDrivers,
      ativas,
      canceladas,
    };
  }, [filteredRides, drivers]);



  const dateRangeLabel = dateRange === 'today' ? 'Hoje' : dateRange === 'week' ? 'Semana' : 'Geral';

  const sortedRides = useMemo(() => {
    return [...filteredRides]
      .sort((a, b) => {
        const da = a.data_hora_solicitacao || '';
        const db = b.data_hora_solicitacao || '';
        return db.localeCompare(da);
      });
  }, [filteredRides]);

  const {
    paginatedItems: recentRides,
    currentPage: recentPage,
    setCurrentPage: setRecentPage,
    itemsPerPage: recentPerPage,
    setItemsPerPage: setRecentPerPage,
  } = usePagination(sortedRides, 10);

  // Active rides for map (non-finalized, non-cancelled)
  const activeRides = useMemo(() => {
    return rides.filter(r => {
      const s = String(r.status_solicitacao).toUpperCase();
      return s === 'A' || s === 'E' || s === 'G' || s === 'P';
    });
  }, [rides]);

  // ─── Filter Bar Component ──────────────────────────────────
  const FilterBar = (
    <div className="card mt-md">
      <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Date range */}
        <div className="flex gap-sm">
          {[
            { key: 'today' as const, label: 'Hoje' },
            { key: 'week' as const, label: `Semana (${weekPeriod.label})` },
            { key: 'all' as const, label: 'Tudo' },
          ].map(d => (
            <button
              key={d.key}
              className={`btn btn-sm ${dateRange === d.key ? '' : 'btn-secondary'}`}
              style={dateRange === d.key ? { background: 'var(--color-accent)', color: 'white', border: 'none' } : { fontSize: '0.7rem' }}
              onClick={() => setDateRange(d.key)}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 24, background: 'var(--color-border)', margin: '0 var(--space-xs)' }} />

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'white' }}
        >
          <option value="">Todos os status</option>
          {Object.entries(STATUS_MAP).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>

        {/* Driver filter */}
        <input
          type="text"
          placeholder="Buscar por motoboy..."
          value={driverFilter}
          onChange={e => setDriverFilter(e.target.value)}
          style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--color-border)', width: 180 }}
        />

        <button
          className="btn btn-sm btn-secondary"
          onClick={() => loadDashboardData(true)}
          style={{ fontSize: '0.7rem', padding: '4px 10px', marginLeft: 'auto' }}
          title="Atualizar dados"
        >
          ⟳ Atualizar
        </button>

        <span className="text-muted" style={{ fontSize: '0.7rem' }}>
          {filteredRides.length} corrida{filteredRides.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );

  // ─── Shared Components ─────────────────────────────────────

  const KPIGrid = (
    <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
      <div className="stat-card">
        <div className="stat-value">{loading ? '—' : filteredRides.length}</div>
        <div className="stat-label">TOTAL {dateRangeLabel.toUpperCase()}</div>
      </div>
      <div className="stat-card">
        <div className="stat-value" style={{ color: 'var(--color-accent)' }}>{loading ? '—' : stats.ativas}</div>
        <div className="stat-label">ATIVAS AGORA</div>
      </div>
      <div className="stat-card">
        <div className="stat-value text-success">{loading ? '—' : stats.totalRides}</div>
        <div className="stat-label">FINALIZADAS</div>
      </div>
      <div className="stat-card">
        <div className="stat-value" style={{ color: '#E55C00' }}>
          {loading ? '—' : stats.canceladas}
        </div>
        <div className="stat-label">CANCELADAS/NÃO ATENDIDAS</div>
      </div>
      <div className="stat-card stat-card-highlight">
        <div className="stat-value">{loading ? '—' : formatBRL(stats.totalProducao)}</div>
        <div className="stat-label">FATURAMENTO</div>
      </div>
    </div>
  );

  const MotoboysColumn = (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Motoboys Produzindo</h2>
        {isAdmin && (
          <a href="/motoboys" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-accent)' }}>
            Ver Todos
          </a>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 0' }}>
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </div>
      ) : stats.topDrivers.length === 0 ? (
        <div className="text-center text-muted" style={{ padding: '40px 0', fontSize: '0.82rem' }}>
          Nenhuma corrida no período
        </div>
      ) : (
        <div>
          {stats.topDrivers.map((d, i) => {
            const activeRideIdForDriver = activeRides.find(r => r.nome_condutor === d.nome)?.id || null;
            return (
            <div 
              key={i} 
              className="driver-row"
              onMouseEnter={() => { if (activeRideIdForDriver) setHoveredRideId(activeRideIdForDriver) }}
              onMouseLeave={() => setHoveredRideId(null)}
              style={{ cursor: 'pointer' }}
            >
              <div className="driver-avatar">
                {d.nome.charAt(0).toUpperCase()}
                <span className="status-dot"></span>
              </div>
              <div className="driver-info">
                <div className="driver-name">{d.nome}</div>
                <div className="driver-meta">
                  {d.rides} corridas • {d.entregas} entregas
                </div>
              </div>
              <div className="driver-value">
                <div className="driver-value-amount">{formatBRL(d.producao)}</div>
                <div className={`driver-value-label ${d.producao > 0 ? 'active' : 'empty'}`}>
                  {d.producao > 0 ? 'PRODUZINDO' : 'SEM CORRIDAS'}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {isAdmin && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--color-border-light)' }}>
          <a
            href="/motoboys"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '6px', padding: '10px',
              border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-muted)', fontSize: '0.78rem', fontWeight: 500,
              textDecoration: 'none', transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-accent)';
              e.currentTarget.style.color = 'var(--color-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.color = 'var(--color-text-muted)';
            }}
          >
            + Gerenciar Motoboys
          </a>
        </div>
      )}
    </div>
  );

  const RecentRidesTable = (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Corridas Recentes</h2>
        <div className="flex items-center gap-sm">
          <span className="badge badge-accent">{weekPeriod.label}</span>
          <a href="/relatorios" className="btn btn-primary btn-sm" style={{ fontSize: '0.68rem' }}>
            Exportar PDF
          </a>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Corrida</th>
              <th>Motoboy</th>
              <th>Entregas</th>
              <th>Status</th>
              <th className="text-right">Km</th>
              <th className="text-right">Tempo</th>
              <th className="text-right">Valor</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center text-muted" style={{ padding: '40px 0' }}>
                  Carregando corridas...
                </td>
              </tr>
            ) : recentRides.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-muted" style={{ padding: '40px 0' }}>
                  Nenhuma corrida no período
                </td>
              </tr>
            ) : recentRides.map((ride, i) => {
              const fare = typeof ride.valor_corrida === 'string'
                ? parseFloat(ride.valor_corrida) : (ride.valor_corrida || 0);
              const deliveries = ride.paradas?.length || 1;
              const km = parseFloat(ride.distancia_percorrida_km || '0') || ride.estimativa_km || 0;
              const tempo = (ride.duracao_corrida ? parseInt(ride.duracao_corrida) : 0) || ride.estimativa_minutos || 0;
              const dateStr = String(ride.data_hora_solicitacao || '').split(' ');
              const time = dateStr[1] ? dateStr[1].slice(0, 5) : '';
              const statusCode = String(ride.status_solicitacao).toUpperCase().charAt(0);
              const st = STATUS_MAP[statusCode] || { label: statusCode, color: '#6b7280', bg: '#f3f4f6', icon: '●', badgeClass: 'badge-secondary' };
              const isActive = ACTIVE_STATUS_CODES.includes(statusCode);

              return (
                <tr 
                  key={i}
                  onMouseEnter={() => { if (ride.id) setHoveredRideId(ride.id) }}
                  onMouseLeave={() => setHoveredRideId(null)}
                  style={{ 
                    cursor: 'pointer',
                    background: hoveredRideId === ride.id ? 'var(--color-bg-hover, rgba(0,0,0,0.02))' : undefined
                  }}
                >
                  <td>
                    <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                      OS #{ride.id || String(ride.condutor_id).slice(-4)}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.68rem' }}>{time}</div>
                  </td>
                  <td>
                    <div className="flex items-center gap-sm">
                      <div style={{
                        width: '28px', height: '28px', borderRadius: 'var(--radius-sm)',
                        background: 'linear-gradient(135deg, #E8E4DF, #D5CEC8)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-secondary)',
                      }}>
                        {(ride.nome_condutor || '?').charAt(0)}
                      </div>
                      <span style={{ fontWeight: 500 }}>
                        {ride.nome_condutor
                          ? ride.nome_condutor.split(' ').slice(0, 2).map((w, j) =>
                            j === 0 ? w.charAt(0) + '.' : w
                          ).join(' ')
                          : '—'}
                      </span>
                    </div>
                  </td>
                  <td className="text-mono" style={{ fontSize: '0.78rem' }}>{deliveries}</td>
                  <td>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '2px 8px', borderRadius: 12, fontSize: '0.65rem', fontWeight: 600,
                      color: st.color, background: st.bg,
                    }}>
                      {st.icon} {st.label}
                    </span>
                  </td>
                  <td className="text-right text-mono text-muted" style={{ fontSize: '0.75rem' }}>
                    {km > 0 ? `${km.toFixed(1)} km` : '—'}
                  </td>
                  <td className="text-right text-mono text-muted" style={{ fontSize: '0.75rem' }}>
                    {tempo > 0 ? `${tempo} min` : '—'}
                  </td>
                  <td className="text-right">
                    <span className="text-mono" style={{ fontWeight: 700, color: 'var(--color-accent)' }}>
                      {formatBRL(fare)}
                    </span>
                  </td>
                  <td>
                    {isActive && ride.id && (
                      <button
                        className="btn btn-sm"
                        style={{
                          fontSize: '0.65rem', padding: '3px 8px',
                          background: 'transparent', border: '1px solid var(--color-danger)',
                          color: 'var(--color-danger)', borderRadius: '4px', cursor: 'pointer',
                        }}
                        onClick={() => setCancelTarget({
                          id: ride.id!,
                          os: `OS #${ride.id || String(ride.condutor_id).slice(-4)}`,
                        })}
                      >
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Total footer + Pagination */}
      <Pagination
        currentPage={recentPage}
        totalItems={sortedRides.length}
        itemsPerPage={recentPerPage}
        onPageChange={setRecentPage}
        onItemsPerPageChange={setRecentPerPage}
        perPageOptions={[10, 25, 50]}
      />

      <div style={{
        marginTop: '16px', paddingTop: '16px',
        borderTop: '1px solid var(--color-border-light)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div className="text-muted" style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Total a Liquidar ({dateRangeLabel})
          </div>
          <div className="text-muted" style={{ fontSize: '0.7rem', marginTop: '2px' }}>
            Montante consolidado para pagamento
          </div>
        </div>
        <div className="text-mono" style={{
          fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-accent)',
          letterSpacing: '-0.02em',
        }}>
          {loading ? '—' : formatBRL(stats.totalProducao)}
        </div>
      </div>
    </div>
  );

  // ─── Admin Dashboard ───────────────────────────────────────
  if (isAdmin) {
    return (
      <>
        <div className="page-header">
          <div className="flex items-center justify-between">
            <div>
              <p className="page-subtitle">
                {selectedCompany?.nome || 'Todas as empresas'}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="badge badge-success" style={{ gap: '6px' }}>
                <span className="sync-dot ok"></span>
                Sistema Online
              </span>
            </div>
          </div>
        </div>

        <div className="page-body">
          {KPIGrid}
          {FilterBar}

          {/* Two Column Layout */}
          <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', marginTop: '16px' }}>
            {MotoboysColumn}
            {RecentRidesTable}
          </div>

          {/* Sync Status */}
          <div className="card mt-md">
            <div className="card-header">
              <h2 className="card-title">Status de Sincronização</h2>
              <span className="badge badge-success" style={{ gap: '6px' }}>
                <span className="sync-dot ok"></span>
                Online
              </span>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Machine ID</th>
                    <th>Semana</th>
                    <th>Status</th>
                    <th className="text-right">Corridas</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ fontWeight: 600 }}>{selectedCompany?.nome || 'Todas'}</td>
                    <td className="text-mono text-muted">{selectedCompany?.id || 'Consolidado'}</td>
                    <td className="text-muted">{weekPeriod.label}</td>
                    <td><span className="badge badge-success">OK</span></td>
                    <td className="text-right text-mono" style={{ fontWeight: 600 }}>{stats.totalRides}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ─── Lojista Dashboard ─────────────────────────────────────
  return (
    <>
      <NewDeliveryModal
        open={showDeliveryModal}
        onClose={() => setShowDeliveryModal(false)}
        onSuccess={() => loadDashboardData()}
      />

      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <p className="page-subtitle">
              {selectedCompany?.nome || '—'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={() => setShowDeliveryModal(true)}
              className="btn-nova-entrega"
            >
              Nova Entrega
            </button>
            <span className="badge badge-success" style={{ gap: '6px' }}>
              <span className="sync-dot ok"></span>
              Online
            </span>
          </div>
        </div>
      </div>

      <div className="page-body">
        {KPIGrid}
        {FilterBar}

        {/* Two Column Layout — Lojista: Motoboys + MAP */}
        <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', marginTop: '16px' }}>
          {MotoboysColumn}

          {/* Map Card */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative', zIndex: 1 }}>
            <div className="card-header" style={{ padding: '12px 16px' }}>
              <h2 className="card-title">Rastreamento em Tempo Real</h2>
              <span className="badge badge-info" style={{ gap: '5px' }}>
                Webhook a cada 15s
              </span>
            </div>
            <div style={{ height: '400px' }}>
              <DeliveryMap
                rides={activeRides}
                hoveredRideId={hoveredRideId}
                storeLocation={selectedCompany ? {
                  lat: selectedCompany.lat || '',
                  lng: selectedCompany.lng || '',
                  nome: selectedCompany.nome || 'Loja',
                  endereco: selectedCompany.endereco || '',
                } : undefined}
              />
            </div>
          </div>
        </div>

        {/* Recent Rides (where Sync was for admin) */}
        <div className="mt-md">
          {RecentRidesTable}
        </div>
      </div>

      {/* Cancel Confirm Modal */}
      <ConfirmModal
        open={!!cancelTarget}
        title="Cancelar Corrida"
        message={`Tem certeza que deseja cancelar a corrida ${cancelTarget?.os || ''}? Esta ação não pode ser desfeita.`}
        confirmLabel="Sim, Cancelar"
        cancelLabel="Manter"
        variant="danger"
        loading={cancelLoading}
        onCancel={() => setCancelTarget(null)}
        onConfirm={async () => {
          if (!cancelTarget) return;
          setCancelLoading(true);
          try {
            const resp = await authFetch('/api/machine/rides/cancel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ solicitacao_id: Number(cancelTarget.id) }),
            });
            const result = await resp.json();
            if (resp.ok) {
              showToast('Corrida cancelada com sucesso', 'success');
              setCancelTarget(null);
              window.location.reload();
            } else {
              showToast(result.details || result.error || 'Falha ao cancelar', 'error');
            }
          } catch {
            showToast('Erro de conexão ao cancelar', 'error');
          } finally {
            setCancelLoading(false);
          }
        }}
      />
    </>
  );
}
