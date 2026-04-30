'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../components/Toast';
import { authFetch } from '@/app/lib/api-client';
import { toLocalDateISO } from '@/app/lib/date-utils';
import ConfirmModal from '../../components/ConfirmModal';
import Pagination, { usePagination } from '../../components/Pagination';
import { useRideCacheRealtime, type RideCacheEvent } from '../../hooks/useRideCacheRealtime';
import { STATUS_MAP, ACTIVE_STATUS_CODES } from '@/app/lib/status-map';

interface Parada {
  id: string | number;
  endereco: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  numero_pedido?: string;
  link_rastreio_pedido?: string | null;
}

interface Coleta {
  endereco: string;
  complemento?: string;
  referencia?: string | null;
  bairro?: string;
  cidade?: string;
  estado?: string;
  lat?: string;
  lng?: string;
}

interface RideData {
  id: string;
  data_hora_solicitacao: string;
  data_hora_aceite: string | null;
  data_hora_finalizacao: string | null;
  data_hora_cancelamento: string | null;
  data_hora_chegada_local: string | null;
  data_hora_pendencia: string | null;
  status_solicitacao: string;
  cliente_id: string;
  nome_passageiro: string;
  empresa_id: number | null;
  condutor_id: string;
  nome_condutor: string;
  telefone_condutor: string;
  telefone_condutor_internacional?: string;
  taxista_id: string;
  nome_taxista: string;
  telefone_taxista: string;
  veiculo: string;
  placa_veiculo: string;
  cor_veiculo: string | null;
  valor_corrida: string;
  distancia_percorrida_km: string;
  distancia_coleta_km: string | null;
  duracao_corrida: string;
  condutor_especificado: boolean;
  com_retorno: boolean;
  taxas_cancelamento: string | null;
  paradas: Parada[];
  coleta: Coleta;
  bandeira_chamada_id?: string;
  bandeira_configuracao_id?: string;
  estimativa_km?: number;
  estimativa_minutos?: number;
}

function formatBRL(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function formatDateTime(str: string | null): string {
  if (!str) return '—';
  try {
    const d = new Date(str.replace(' ', 'T'));
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return str; }
}

function formatDate(str: string | null): string {
  if (!str) return '—';
  try {
    const d = new Date(str.replace(' ', 'T'));
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  } catch { return str; }
}

function formatTime(str: string | null): string {
  if (!str) return '—';
  try {
    const d = new Date(str.replace(' ', 'T'));
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return str; }
}

// STATUS_MAP imported from @/app/lib/status-map (centralized)

type TabType = 'todas' | 'ativas' | 'finalizadas' | 'programadas';

export default function CorridasPage() {
  const { selectedCompany, weekPeriod } = useAppContext();
  const { showToast } = useToast();
  const [rides, setRides] = useState<RideData[]>([]);
  const [scheduled, setScheduled] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('todas');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [driverFilter, setDriverFilter] = useState<string>('');
  const [dateRange, setDateRange] = useState<'week' | 'today' | 'all'>('week');
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [trackingLinks, setTrackingLinks] = useState<Record<string, Array<{ parada_id: string; link_rastreio: string; codigo_confirmacao: number }>>>({});
  const [loadingTracking, setLoadingTracking] = useState<string | null>(null);

  // Fetch rides
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ limite: '500' });
      if (selectedCompany) params.set('empresa_id', String(selectedCompany.id));

      const [ridesRes, scheduledRes] = await Promise.all([
        authFetch(`/api/machine/rides?${params.toString()}`),
        authFetch('/api/machine/rides/scheduled'),
      ]);

      if (ridesRes.ok) {
        const d = await ridesRes.json();
        setRides(d.rides || []);
      }
      if (scheduledRes.ok) {
        const d = await scheduledRes.json();
        const s = d.scheduled ?? d.response ?? [];
        setScheduled(Array.isArray(s) ? s : []);
      }
    } catch {
      console.error('Failed to load rides');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedCompany]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // ─── Silent auto-refresh (30s) ───
  // Machine API has no status webhook — must re-query for status changes.
  // Pauses when tab is hidden to save resources.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function startPolling() {
      if (intervalId) return;
      intervalId = setInterval(() => {
        loadData(true);
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
        loadData(true);
        startPolling();
      }
    }

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadData]);

  // ─── Realtime: Subscribe to ride_cache changes via webhook ───
  // When Machine sends a status update → ride_cache → Realtime → here
  // Updates local state INSTANTLY without hitting the Machine API again.
  // ⚠ FINANCIAL INTEGRITY: This is READ-ONLY. Does NOT touch manual_entries.
  useRideCacheRealtime({
    empresaId: selectedCompany?.id,
    enabled: true,
    onStatusChange: useCallback((event: RideCacheEvent, eventType: 'INSERT' | 'UPDATE') => {
      // Update the matching ride in local state (by machine_ride_id = ride.id)
      setRides(prev => {
        const rideId = event.machine_ride_id;
        const existingIdx = prev.findIndex(r => r.id === rideId);

        if (existingIdx >= 0) {
          // Update existing ride status
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            status_solicitacao: event.status_code,
            // If accepted, show driver name
            ...(event.driver_name && event.status_code === 'A' ? {
              nome_condutor: event.driver_name,
              condutor_id: event.machine_condutor_id || updated[existingIdx].condutor_id,
            } : {}),
            // If finished, set finalization time
            ...(event.status_code === 'F' ? {
              data_hora_finalizacao: event.received_at,
            } : {}),
            // If cancelled, set cancellation time
            ...(event.status_code === 'C' ? {
              data_hora_cancelamento: event.received_at,
            } : {}),
          };
          return updated;
        } else if (eventType === 'INSERT') {
          // New ride that we didn't have — add a minimal entry
          // (will be fully populated on next manual refresh)
          return [{
            id: rideId,
            data_hora_solicitacao: event.received_at,
            data_hora_aceite: event.status_code === 'A' ? event.received_at : null,
            data_hora_finalizacao: event.status_code === 'F' ? event.received_at : null,
            data_hora_cancelamento: event.status_code === 'C' ? event.received_at : null,
            data_hora_chegada_local: null,
            data_hora_pendencia: null,
            status_solicitacao: event.status_code,
            cliente_id: '',
            nome_passageiro: event.empresa_name || '',
            empresa_id: event.machine_empresa_id ? Number(event.machine_empresa_id) : null,
            condutor_id: event.machine_condutor_id || '',
            nome_condutor: event.driver_name || '',
            telefone_condutor: '',
            taxista_id: '',
            nome_taxista: '',
            telefone_taxista: '',
            veiculo: '',
            placa_veiculo: '',
            cor_veiculo: null,
            valor_corrida: '0',
            distancia_percorrida_km: '0',
            distancia_coleta_km: null,
            duracao_corrida: '0',
            condutor_especificado: false,
            com_retorno: false,
            taxas_cancelamento: null,
            paradas: [],
            coleta: { endereco: '' },
          }, ...prev];
        }

        return prev;
      });
    }, []),
  });

  // Cancel ride
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const handleCancelRide = useCallback(async (idMch: string) => {
    setCancelingId(idMch);
    try {
      const res = await authFetch('/api/machine/rides/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_mch: idMch }),
      });
      if (res.ok) {
        showToast('Corrida cancelada com sucesso', 'success');
        loadData();
      } else {
        const err = await res.json();
        showToast(err.details || err.error || 'Falha ao cancelar', 'error');
      }
    } catch {
      showToast('Erro de conexão ao cancelar', 'error');
    } finally {
      setCancelingId(null);
      setConfirmCancelId(null);
    }
  }, [showToast, loadData]);

  // Fetch tracking links (only works for active rides: A=Aceita, S=A caminho, E=Em andamento)
  const fetchTrackingLinks = useCallback(async (idMch: string) => {
    if (trackingLinks[idMch]) return; // already loaded
    setLoadingTracking(idMch);
    try {
      const res = await authFetch(`/api/machine/rides/tracking?id_mch=${idMch}`);
      const data = await res.json();
      if (res.ok) {
        const links = data.response || data.links || [];
        setTrackingLinks(prev => ({ ...prev, [idMch]: links }));
        if (links.length === 0) {
          showToast('Nenhum link de rastreio disponível', 'info');
        } else {
          showToast(`${links.length} link(s) de rastreio carregado(s)`, 'success');
        }
      } else {
        const errorMsg = data?.details?.errors?.[0]?.message
          || data?.error
          || `Erro ${res.status}`;
        showToast(`Rastreio: ${errorMsg}`, 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setLoadingTracking(null);
    }
  }, [trackingLinks, showToast]);


  // Filter rides
  const filteredRides = useMemo(() => {
    let filtered = rides;

    // Date filter
    if (dateRange === 'week') {
      filtered = filtered.filter(r => {
        const d = r.data_hora_solicitacao.split(' ')[0].split('T')[0];
        return d >= weekPeriod.start && d <= weekPeriod.end;
      });
    } else if (dateRange === 'today') {
      const today = toLocalDateISO(new Date());
      filtered = filtered.filter(r => {
        const d = r.data_hora_solicitacao.split(' ')[0].split('T')[0];
        return d === today;
      });
    }

    // Status filter
    if (statusFilter) {
      filtered = filtered.filter(r => r.status_solicitacao === statusFilter);
    }

    // Driver filter
    if (driverFilter) {
      filtered = filtered.filter(r =>
        (r.nome_condutor || r.nome_taxista || '').toLowerCase().includes(driverFilter.toLowerCase())
      );
    }

    // Tab-based filter
    if (activeTab === 'ativas') {
      filtered = filtered.filter(r => ['D', 'G', 'P', 'A', 'E', 'S'].includes(r.status_solicitacao));
    } else if (activeTab === 'finalizadas') {
      filtered = filtered.filter(r => r.status_solicitacao === 'F');
    }

    // Sort by date desc
    return [...filtered].sort((a, b) =>
      new Date(b.data_hora_solicitacao.replace(' ', 'T')).getTime() -
      new Date(a.data_hora_solicitacao.replace(' ', 'T')).getTime()
    );
  }, [rides, dateRange, statusFilter, driverFilter, activeTab, weekPeriod]);

  // Pagination
  const {
    paginatedItems: paginatedRides,
    currentPage: ridesCurrentPage,
    setCurrentPage: setRidesCurrentPage,
    itemsPerPage: ridesPerPage,
    setItemsPerPage: setRidesPerPage,
  } = usePagination(filteredRides, 25);

  // Stats — computed based on dateRange filter (same as table)
  const stats = useMemo(() => {
    let baseRides = rides;

    if (dateRange === 'week') {
      baseRides = rides.filter(r => {
        const d = r.data_hora_solicitacao.split(' ')[0].split('T')[0];
        return d >= weekPeriod.start && d <= weekPeriod.end;
      });
    } else if (dateRange === 'today') {
      const today = toLocalDateISO(new Date());
      baseRides = rides.filter(r => {
        const d = r.data_hora_solicitacao.split(' ')[0].split('T')[0];
        return d === today;
      });
    }

    return {
      total: baseRides.length,
      ativas: baseRides.filter(r => ['D', 'G', 'P', 'A', 'E', 'S'].includes(r.status_solicitacao)).length,
      finalizadas: baseRides.filter(r => r.status_solicitacao === 'F').length,
      canceladas: baseRides.filter(r => r.status_solicitacao === 'C').length,
      naoAtendidas: baseRides.filter(r => r.status_solicitacao === 'N').length,
      faturamento: baseRides.filter(r => r.status_solicitacao === 'F').reduce((s, r) => s + parseFloat(r.valor_corrida || '0'), 0),
      entregas: baseRides.filter(r => r.status_solicitacao === 'F').reduce((s, r) => s + Math.max(r.paradas?.length || 0, 1), 0),
    };
  }, [rides, weekPeriod, dateRange]);

  // Unique drivers for filter
  const uniqueDrivers = useMemo(() => {
    const map = new Map<string, string>();
    rides.forEach(r => {
      const name = r.nome_condutor || r.nome_taxista;
      const id = r.condutor_id || r.taxista_id;
      if (name && id) map.set(id, name);
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rides]);

  const tabs: { key: TabType; label: string; count: number }[] = [
    { key: 'todas', label: 'Todas', count: filteredRides.length },
    { key: 'ativas', label: 'Ativas', count: stats.ativas },
    { key: 'finalizadas', label: 'Finalizadas', count: stats.finalizadas },
    { key: 'programadas', label: 'Programadas', count: scheduled.length },
  ];

  return (
    <>
      <header className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Corridas</h1>
            <p className="page-subtitle">
              {selectedCompany?.nome || 'Todas as empresas'} • Dados em tempo real da Machine
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Live indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: '#16a34a',
                boxShadow: '0 0 6px rgba(22, 163, 74, 0.5)',
                animation: 'pulse 2s infinite',
              }} />
              <span style={{ fontSize: '0.68rem', color: '#16a34a', fontWeight: 600, letterSpacing: '0.5px' }}>LIVE</span>
            </div>
            <button className="btn btn-secondary" onClick={() => loadData()} disabled={loading}>
              {loading ? '↻' : '↻'} Atualizar
            </button>
          </div>
        </div>
      </header>

      <div className="page-body">
        {/* Stats */}
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          <div className="stat-card">
            <div className="stat-value">{loading ? '—' : stats.total}</div>
            <div className="stat-label">Total {dateRange === 'today' ? 'Hoje' : dateRange === 'week' ? 'Semana' : 'Geral'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--color-accent)' }}>{loading ? '—' : stats.ativas}</div>
            <div className="stat-label">Ativas Agora</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-success">{loading ? '—' : stats.finalizadas}</div>
            <div className="stat-label">Finalizadas</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: '#E55C00' }}>
              {loading ? '—' : (stats.canceladas + stats.naoAtendidas)}
            </div>
            <div className="stat-label">Canceladas/Não atendidas</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--color-primary)' }}>
              {loading ? '—' : formatBRL(stats.faturamento)}
            </div>
            <div className="stat-label">Faturamento</div>
          </div>
        </div>

        {/* Filters */}
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
                <option key={key} value={key}>{val.icon} {val.label}</option>
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

            <span className="text-muted" style={{ fontSize: '0.7rem', marginLeft: 'auto' }}>
              {filteredRides.length} corrida{filteredRides.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--color-border)', marginTop: 'var(--space-md)' }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: '8px 16px',
                fontSize: '0.75rem',
                fontWeight: activeTab === t.key ? 700 : 500,
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === t.key ? '2px solid var(--color-accent)' : '2px solid transparent',
                color: activeTab === t.key ? 'var(--color-accent)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                marginBottom: -2,
                transition: 'all 0.15s',
              }}
            >
              {t.label}
              <span style={{
                marginLeft: 6, fontSize: '0.6rem', padding: '1px 6px', borderRadius: 10,
                background: activeTab === t.key ? 'var(--color-accent)' : 'var(--color-border)',
                color: activeTab === t.key ? 'white' : 'var(--color-text-muted)',
              }}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* Rides Table */}
        {activeTab !== 'programadas' ? (
          <div className="card" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, marginTop: 0 }}>
            {loading ? (
              <p className="text-muted text-center" style={{ padding: 'var(--space-xl)' }}>Carregando corridas...</p>
            ) : filteredRides.length === 0 ? (
              <p className="text-muted text-center" style={{ padding: 'var(--space-xl)' }}>Nenhuma corrida encontrada com os filtros selecionados.</p>
            ) : (
              <>
              <div className="table-container">
                <table style={{ fontSize: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}></th>
                      <th>ID</th>
                      <th>Data/Hora</th>
                      <th>Status</th>
                      <th>Motoboy</th>
                      <th>Origem</th>
                      <th className="text-center">Entregas</th>
                      <th className="text-right">Km</th>
                      <th className="text-right">Tempo</th>
                      <th className="text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRides.map(ride => {
                      const st = STATUS_MAP[ride.status_solicitacao] || { label: ride.status_solicitacao, color: '#6b7280', bg: '#f3f4f6', icon: '?' };
                      const isExpanded = expandedId === ride.id;
                      const driverName = ride.nome_condutor || ride.nome_taxista || '—';
                      const valor = parseFloat(ride.valor_corrida || '0');
                      const km = parseFloat(ride.distancia_percorrida_km || '0') || ride.estimativa_km || 0;
                      const tempo = (ride.duracao_corrida ? parseInt(ride.duracao_corrida) : 0) || ride.estimativa_minutos || 0;

                      return (
                        <React.Fragment key={ride.id}>
                        <tr
                          onClick={() => setExpandedId(isExpanded ? null : ride.id)}
                          style={{ cursor: 'pointer', background: isExpanded ? 'var(--color-accent-bg)' : undefined, transition: 'background 0.15s' }}
                        >
                          <td style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                            {isExpanded ? '▼' : '▶'}
                          </td>
                          <td className="text-mono text-muted" style={{ fontSize: '0.65rem' }}>
                            {ride.id.slice(-6)}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{formatDate(ride.data_hora_solicitacao)}</div>
                            <div className="text-muted" style={{ fontSize: '0.65rem' }}>{formatTime(ride.data_hora_solicitacao)}</div>
                          </td>
                          <td>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '2px 8px', borderRadius: 12, fontSize: '0.65rem', fontWeight: 600,
                              color: st.color, background: st.bg,
                            }}>
                              {st.icon} {st.label}
                            </span>
                          </td>
                          <td style={{ fontWeight: 550 }}>
                            {driverName !== '—' ? driverName : <span className="text-muted">Sem condutor</span>}
                          </td>
                          <td className="text-muted" style={{ fontSize: '0.7rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ride.coleta?.endereco || '—'}
                          </td>
                          <td className="text-center">
                            <span style={{ fontWeight: 700, color: 'var(--color-secondary)' }}>
                              {ride.paradas?.length || 0}
                            </span>
                          </td>
                          <td className="text-right text-mono text-muted">
                            {km > 0 ? `${km.toFixed(1)} km` : '—'}
                          </td>
                          <td className="text-right text-mono text-muted">
                            {tempo > 0 ? `${tempo} min` : '—'}
                          </td>
                          <td className="text-right text-mono" style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                            {formatBRL(valor)}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={10} style={{ padding: 0 }}>
                              <div style={{
                                padding: 'var(--space-md) var(--space-lg)',
                                background: 'rgba(37,99,235,0.02)',
                                borderTop: '1px dashed var(--color-border)',
                              }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-md)' }}>
                                  {/* Timeline */}
                                  <div>
                                    <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>Timeline</p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <TimelineItem label="Solicitada" time={ride.data_hora_solicitacao} />
                                      <TimelineItem label="Aceita" time={ride.data_hora_aceite} />
                                      <TimelineItem label="Chegou local" time={ride.data_hora_chegada_local} />
                                      <TimelineItem label="Finalizada" time={ride.data_hora_finalizacao} active={ride.status_solicitacao === 'F'} />
                                      {ride.data_hora_cancelamento && (
                                        <TimelineItem label="Cancelada" time={ride.data_hora_cancelamento} error />
                                      )}
                                    </div>
                                  </div>

                                  {/* Coleta */}
                                  <div>
                                    <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}> Coleta</p>
                                    <p style={{ fontSize: '0.8rem', fontWeight: 600 }}>{ride.coleta?.endereco}</p>
                                    {ride.coleta?.complemento && <p className="text-muted" style={{ fontSize: '0.7rem' }}>{ride.coleta.complemento}</p>}
                                    <p className="text-muted" style={{ fontSize: '0.7rem' }}>
                                      {[ride.coleta?.bairro, ride.coleta?.cidade, ride.coleta?.estado].filter(Boolean).join(', ')}
                                    </p>
                                    {ride.coleta?.lat && ride.coleta?.lng && (
                                      <a
                                        href={`https://maps.google.com/?q=${ride.coleta.lat},${ride.coleta.lng}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ fontSize: '0.65rem', color: 'var(--color-primary)' }}
                                      >
                                         Ver no mapa
                                      </a>
                                    )}
                                  </div>

                                  <div>
                                    <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                                       Entregas ({ride.paradas?.length || 0})
                                    </p>
                                    {ride.paradas && ride.paradas.length > 0 ? (
                                      ride.paradas.map((p, i) => {
                                        const tLinks = trackingLinks[ride.id];
                                        const tLink = tLinks?.find(t => String(t.parada_id) === String(p.id));
                                        const link = tLink?.link_rastreio || p.link_rastreio_pedido;
                                        return (
                                          <div key={p.id} style={{ marginBottom: 8, paddingLeft: 8, borderLeft: '2px solid var(--color-primary)', fontSize: '0.75rem' }}>
                                            <p style={{ fontWeight: 600 }}>
                                              {p.numero_pedido ? `#${p.numero_pedido} — ` : `Entrega ${i + 1} — `}
                                              {p.endereco}
                                            </p>
                                            <p className="text-muted" style={{ fontSize: '0.65rem' }}>
                                              {[p.bairro, p.cidade, p.uf].filter(Boolean).join(', ')}
                                            </p>
                                            {link ? (
                                              <a
                                                href={link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{ fontSize: '0.65rem', color: '#0891b2', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}
                                              >
                                                 Rastrear entrega{tLink?.codigo_confirmacao ? ` (Cód: ${tLink.codigo_confirmacao})` : ''}
                                              </a>
                                            ) : (
                                              <span style={{ fontSize: '0.6rem', color: '#9CA3AF', fontStyle: 'italic' }}>
                                                Rastreio não disponível
                                              </span>
                                            )}
                                          </div>
                                        );
                                      })
                                    ) : (
                                      <p className="text-muted" style={{ fontSize: '0.7rem', fontStyle: 'italic' }}>Sem paradas registradas</p>
                                    )}
                                  </div>

                                  {/* Action Buttons */}
                                  <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-sm)', flexWrap: 'wrap' }}>
                                    {!['F', 'C', 'N'].includes(ride.status_solicitacao) && (
                                      <>
                                        <button
                                          className="btn"
                                          onClick={() => setConfirmCancelId(ride.id)}
                                          disabled={cancelingId === ride.id}
                                          style={{
                                            fontSize: '0.7rem', padding: '4px 12px',
                                            background: '#FFF7F0', color: '#E55C00', border: '1px solid #FFD6B3',
                                            cursor: cancelingId === ride.id ? 'wait' : 'pointer',
                                          }}
                                        >
                                          {cancelingId === ride.id ? '↻ Cancelando...' : '✕ Cancelar Corrida'}
                                        </button>
                                        <button
                                          className="btn"
                                          onClick={() => fetchTrackingLinks(ride.id)}
                                          disabled={loadingTracking === ride.id || !!trackingLinks[ride.id]}
                                          style={{
                                            fontSize: '0.7rem', padding: '4px 12px',
                                            background: trackingLinks[ride.id] ? '#f0fdf4' : '#ecfeff',
                                            color: trackingLinks[ride.id] ? '#16a34a' : '#0891b2',
                                            border: `1px solid ${trackingLinks[ride.id] ? '#bbf7d0' : '#a5f3fc'}`,
                                            cursor: (loadingTracking === ride.id || trackingLinks[ride.id]) ? 'default' : 'pointer',
                                          }}
                                        >
                                          {loadingTracking === ride.id ? '↻ Carregando...' : trackingLinks[ride.id] ? '✓ Links carregados' : '⊕ Obter Link de Rastreio'}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>

                                {/* Meta info */}
                                <div style={{
                                  display: 'flex', gap: 'var(--space-lg)', marginTop: 'var(--space-md)',
                                  paddingTop: 'var(--space-sm)', borderTop: '1px solid var(--color-border)',
                                  fontSize: '0.65rem', color: 'var(--color-text-muted)',
                                }}>
                                  <span>ID: {ride.id}</span>
                                  <span>Cliente: {ride.nome_passageiro || '—'}</span>
                                  {ride.veiculo && <span>{ride.veiculo} — {ride.placa_veiculo}</span>}
                                  <span>Tel: {ride.telefone_condutor || ride.telefone_taxista || '—'}</span>
                                  {ride.duracao_corrida !== '0' && <span>{ride.duracao_corrida} min</span>}
                                  {ride.taxas_cancelamento && <span>Taxa cancelamento: {ride.taxas_cancelamento}</span>}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Pagination
                currentPage={ridesCurrentPage}
                totalItems={filteredRides.length}
                itemsPerPage={ridesPerPage}
                onPageChange={setRidesCurrentPage}
                onItemsPerPageChange={setRidesPerPage}
              />
              </>
            )}
          </div>
        ) : (
          /* Programadas tab */
          <div className="card" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, marginTop: 0 }}>
            {scheduled.length === 0 ? (
              <p className="text-muted text-center" style={{ padding: 'var(--space-xl)' }}>
                Nenhuma corrida programada no momento.
              </p>
            ) : (
              <div className="table-container">
                <table style={{ fontSize: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th>Agendamento</th>
                      <th>Detalhes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduled.map((s, i) => (
                      <tr key={i}>
                        <td colSpan={2}>
                          <pre style={{ fontSize: '0.7rem', whiteSpace: 'pre-wrap', margin: 0 }}>
                            {JSON.stringify(s, null, 2)}
                          </pre>
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
      {/* Cancel Confirm Modal */}
      <ConfirmModal
        open={!!confirmCancelId}
        title="Cancelar Corrida"
        message={`Tem certeza que deseja cancelar a corrida #${confirmCancelId?.slice(-6) || ''}? Esta ação não pode ser desfeita.`}
        confirmLabel="Sim, Cancelar"
        cancelLabel="Manter"
        variant="danger"
        loading={!!cancelingId}
        onCancel={() => setConfirmCancelId(null)}
        onConfirm={() => { if (confirmCancelId) handleCancelRide(confirmCancelId); }}
      />
    </>
  );
}

// Timeline item component
function TimelineItem({ label, time, active, error }: { label: string; time: string | null; active?: boolean; error?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.7rem' }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: error ? '#E55C00' : time ? (active ? '#16a34a' : 'var(--color-primary)') : '#d1d5db',
      }} />
      <span style={{ fontWeight: 500, color: time ? 'var(--color-text)' : 'var(--color-text-muted)', minWidth: 90 }}>{label}</span>
      <span className="text-mono" style={{ color: error ? '#E55C00' : 'var(--color-text-muted)' }}>
        {formatDateTime(time)}
      </span>
    </div>
  );
}
