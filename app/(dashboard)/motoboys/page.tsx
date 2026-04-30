'use client';

import { useState, useEffect, Fragment } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../components/Toast';
import { authFetch } from '@/app/lib/api-client';
import Pagination, { usePagination } from '../../components/Pagination';

interface DriverData {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  status: string;
  cpf: string;
  chave_pix: string;
  data_hora_situacao_cadastral: string;
  data_hora_ultima_corrida: string | null;
}

interface DriverAssociation {
  linkId: string;
  active: boolean;
  isPrimary: boolean;
  companyId: string;
  companyName: string;
}

export default function MotoboysPage() {
  const { companies, selectedCompany, isAdmin } = useAppContext();
  const { showToast } = useToast();

  const [drivers, setDrivers] = useState<DriverData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Associações motoboy ↔ loja
  const [associations, setAssociations] = useState<Record<string, DriverAssociation[]>>({});
  const [loadingAssociations, setLoadingAssociations] = useState<Record<string, boolean>>({});

  // Modal de associação
  const [showAssocModal, setShowAssocModal] = useState(false);
  const [assocDriver, setAssocDriver] = useState<DriverData | null>(null);
  const [assocCompanyId, setAssocCompanyId] = useState<number | null>(null);
  const [assocAsPrimary, setAssocAsPrimary] = useState(false);
  const [assocSaving, setAssocSaving] = useState(false);

  // Expandir detalhes de um motoboy
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);

  const filteredDrivers = drivers.filter(d => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      d.nome?.toLowerCase().includes(term) ||
      d.cpf?.includes(term) ||
      d.id?.includes(term) ||
      d.telefone?.includes(term)
    );
  });

  const {
    paginatedItems: paginatedDrivers,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
  } = usePagination(filteredDrivers, 25);

  useEffect(() => {
    fetchDrivers();
  }, []);

  async function fetchDrivers() {
    try {
      const res = await authFetch('/api/machine/drivers');
      if (!res.ok) throw new Error('Falha ao buscar motoboys');
      const data = await res.json();
      setDrivers(data.drivers || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }

  async function fetchDriverAssociations(driverId: string) {
    setLoadingAssociations(prev => ({ ...prev, [driverId]: true }));
    try {
      const res = await authFetch(`/api/db/company-drivers?driver_id=${driverId}`);
      if (res.ok) {
        const data = await res.json();
        setAssociations(prev => ({ ...prev, [driverId]: data }));
      }
    } catch (err) {
      console.warn('[Motoboys] Failed to load associations:', err);
    } finally {
      setLoadingAssociations(prev => ({ ...prev, [driverId]: false }));
    }
  }

  function handleExpandDriver(driverId: string) {
    if (expandedDriver === driverId) {
      setExpandedDriver(null);
    } else {
      setExpandedDriver(driverId);
      if (!associations[driverId]) {
        fetchDriverAssociations(driverId);
      }
    }
  }

  function openAssocModal(driver: DriverData) {
    setAssocDriver(driver);
    setAssocCompanyId(null);
    setAssocAsPrimary(false);
    setShowAssocModal(true);
  }

  async function handleAssociate() {
    if (!assocDriver || !assocCompanyId) return;
    setAssocSaving(true);
    try {
      const res = await authFetch('/api/db/company-drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: assocCompanyId,
          driverId: assocDriver.id,
          driverName: assocDriver.nome,
          isPrimary: assocAsPrimary,
        }),
      });
      if (res.ok) {
        showToast(`${assocDriver.nome} associado à loja com sucesso`, 'success');
        setShowAssocModal(false);
        // Refresh associations for this driver
        fetchDriverAssociations(assocDriver.id);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Erro ao associar', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setAssocSaving(false);
    }
  }

  async function handleSetPrimary(driverId: string, companyId: string) {
    try {
      const res = await authFetch('/api/db/company-drivers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          driverId,
          isPrimary: true,
        }),
      });
      if (res.ok) {
        showToast('Loja prioritária definida', 'success');
        fetchDriverAssociations(driverId);
      }
    } catch {
      showToast('Erro ao definir loja prioritária', 'error');
    }
  }

  async function handleRemoveAssociation(driverId: string, companyId: string) {
    if (!confirm('Remover associação deste motoboy com a loja?')) return;
    try {
      const res = await authFetch(`/api/db/company-drivers?company_id=${companyId}&driver_id=${driverId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        showToast('Associação removida', 'success');
        fetchDriverAssociations(driverId);
      }
    } catch {
      showToast('Erro ao remover associação', 'error');
    }
  }

  const statusMap: Record<string, { label: string; badge: string }> = {
    A: { label: 'Ativo', badge: 'badge-success' },
    I: { label: 'Inativo', badge: 'badge-warning' },
    B: { label: 'Bloqueado', badge: 'badge-danger' },
  };

  return (
    <>
      <header className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Motoboys</h1>
            <p className="page-subtitle">
              Entregadores cadastrados na Machine • Sincronizado automaticamente
            </p>
          </div>
          <button className="btn btn-secondary" onClick={fetchDrivers}>
            Atualizar
          </button>
        </div>
      </header>

      <div className="page-body">
        {loading && (
          <div className="card text-center" style={{ padding: 'var(--space-2xl)' }}>
            <div style={{ fontSize: '1.2rem', marginBottom: 'var(--space-md)', opacity: 0.5 }}>Carregando</div>
            <p className="text-muted">Carregando motoboys da Machine...</p>
          </div>
        )}

        {error && (
          <div className="card" style={{ borderColor: 'var(--color-danger)' }}>
            <p className="text-danger">{error}</p>
            <button className="btn btn-secondary mt-md" onClick={fetchDrivers}>
              Tentar novamente
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="stats-grid mb-md" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="stat-card">
                <div className="stat-value">{drivers.length}</div>
                <div className="stat-label">Total cadastrados</div>
              </div>
              <div className="stat-card">
                <div className="stat-value text-success">
                  {drivers.filter(d => d.status === 'A').length}
                </div>
                <div className="stat-label">Ativos</div>
              </div>
              <div className="stat-card">
                <div className="stat-value text-warning">
                  {drivers.filter(d => d.status !== 'A').length}
                </div>
                <div className="stat-label">Inativos/Bloqueados</div>
              </div>
            </div>

            {/* Barra de busca */}
            <div className="card" style={{ padding: '12px 16px', marginBottom: 'var(--space-md)' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <input
                  className="form-input"
                  placeholder="Buscar por nome, CPF, ID ou telefone..."
                  value={searchTerm}
                  onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                  style={{ flex: 1 }}
                />
                {searchTerm && (
                  <span className="text-muted" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                    {filteredDrivers.length} resultado(s)
                  </span>
                )}
              </div>
            </div>

            <div className="card">
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Nome</th>
                      <th>Telefone</th>
                      <th>CPF</th>
                      <th>PIX</th>
                      <th>Status</th>
                      <th>Cadastro</th>
                      {isAdmin && <th style={{ width: 120 }}>Ações</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDrivers.map((driver) => {
                      const st = statusMap[driver.status] || { label: driver.status, badge: 'badge-info' };
                      const isExpanded = expandedDriver === driver.id;
                      const driverAssocs = associations[driver.id] || [];
                      const primaryAssoc = driverAssocs.find(a => a.isPrimary);
                      const isLoadingAssoc = loadingAssociations[driver.id];

                      return (
                        <Fragment key={driver.id}>
                          <tr style={{ cursor: isAdmin ? 'pointer' : undefined }} onClick={() => isAdmin && handleExpandDriver(driver.id)}>
                            <td className="text-mono text-muted">{driver.id}</td>
                            <td style={{ fontWeight: 550 }}>
                              {driver.nome}
                              {primaryAssoc && (
                                <span style={{
                                  marginLeft: 8, fontSize: '0.55rem', padding: '2px 6px',
                                  borderRadius: 4, background: '#eff6ff', color: '#2563eb',
                                  fontWeight: 700, verticalAlign: 'middle',
                                  border: '1px solid #bfdbfe',
                                }}>
                                  ★ {primaryAssoc.companyName}
                                </span>
                              )}
                            </td>
                            <td className="text-mono">{driver.telefone || '—'}</td>
                            <td className="text-mono text-muted">{driver.cpf || '—'}</td>
                            <td className="text-mono" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {driver.chave_pix || '—'}
                            </td>
                            <td>
                              <span className={`badge ${st.badge}`}>{st.label}</span>
                            </td>
                            <td className="text-muted" style={{ fontSize: '0.8rem' }}>
                              {driver.data_hora_situacao_cadastral
                                ? new Date(driver.data_hora_situacao_cadastral.replace(' ', 'T')).toLocaleDateString('pt-BR')
                                : '—'}
                            </td>
                            {isAdmin && (
                              <td>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button
                                    className="btn btn-secondary"
                                    style={{ fontSize: '0.65rem', padding: '3px 8px' }}
                                    onClick={e => { e.stopPropagation(); openAssocModal(driver); }}
                                    title="Associar a uma loja"
                                  >
                                    + Loja
                                  </button>
                                  <button
                                    className="btn btn-secondary"
                                    style={{ fontSize: '0.65rem', padding: '3px 8px', color: isExpanded ? 'var(--color-primary)' : undefined }}
                                    onClick={e => { e.stopPropagation(); handleExpandDriver(driver.id); }}
                                  >
                                    {isExpanded ? '▲' : '▼'}
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>

                          {/* Painel expandido — Associações do motoboy */}
                          {isExpanded && isAdmin && (
                            <tr key={`${driver.id}_detail`}>
                              <td colSpan={isAdmin ? 8 : 7} style={{ padding: 0, background: '#f8fafc', borderTop: 'none' }}>
                                <div style={{ padding: '12px 20px' }}>
                                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#475569', marginBottom: 8 }}>
                                    Lojas associadas a {driver.nome}:
                                  </div>

                                  {isLoadingAssoc ? (
                                    <p className="text-muted" style={{ fontSize: '0.75rem' }}>Carregando...</p>
                                  ) : driverAssocs.length === 0 ? (
                                    <p className="text-muted" style={{ fontSize: '0.75rem' }}>
                                      Nenhuma loja associada. Clique em &quot;+ Loja&quot; para vincular.
                                    </p>
                                  ) : (
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      {driverAssocs.map(assoc => (
                                        <div key={assoc.linkId} style={{
                                          display: 'flex', alignItems: 'center', gap: 8,
                                          padding: '6px 12px', borderRadius: 8,
                                          background: assoc.isPrimary ? '#eff6ff' : 'white',
                                          border: `1px solid ${assoc.isPrimary ? '#2563eb' : '#e2e8f0'}`,
                                        }}>
                                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: assoc.isPrimary ? '#2563eb' : '#334155' }}>
                                            {assoc.isPrimary && '★ '}{assoc.companyName}
                                          </span>
                                          {!assoc.isPrimary && (
                                            <button
                                              className="btn btn-secondary"
                                              style={{ fontSize: '0.55rem', padding: '1px 6px', color: '#2563eb' }}
                                              onClick={() => handleSetPrimary(driver.id, assoc.companyId)}
                                              title="Definir como loja prioritária"
                                            >
                                              ★ Prioritária
                                            </button>
                                          )}
                                          <button
                                            className="btn btn-secondary"
                                            style={{ fontSize: '0.55rem', padding: '1px 6px', color: '#CC5200' }}
                                            onClick={() => handleRemoveAssociation(driver.id, assoc.companyId)}
                                            title="Remover associação"
                                          >
                                            ✕
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Pagination
                currentPage={currentPage}
                totalItems={filteredDrivers.length}
                itemsPerPage={itemsPerPage}
                onPageChange={setCurrentPage}
                onItemsPerPageChange={setItemsPerPage}
              />
            </div>
          </>
        )}
      </div>

      {/* Modal de Associação */}
      {showAssocModal && assocDriver && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }} onClick={() => setShowAssocModal(false)}>
          <div className="card" style={{ width: 420, maxWidth: '95vw', margin: 0 }} onClick={e => e.stopPropagation()}>
            <div className="card-header">
              <h2 className="card-title" style={{ fontSize: '0.9rem' }}>Associar Motoboy à Loja</h2>
            </div>

            <div style={{ padding: 'var(--space-md)' }}>
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 'var(--space-md)',
                background: '#f8fafc', border: '1px solid #e2e8f0',
              }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{assocDriver.nome}</div>
                <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                  ID: {assocDriver.id} • CPF: {assocDriver.cpf || 'N/A'}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Selecionar Loja</label>
                <select
                  className="form-input"
                  value={assocCompanyId || ''}
                  onChange={e => setAssocCompanyId(Number(e.target.value))}
                  style={{ width: '100%' }}
                >
                  <option value="">— Escolher loja —</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                background: assocAsPrimary ? '#eff6ff' : '#f8fafc',
                border: `1px solid ${assocAsPrimary ? '#2563eb' : '#e2e8f0'}`,
                marginBottom: 'var(--space-md)',
                transition: 'all 0.2s',
              }} onClick={() => setAssocAsPrimary(!assocAsPrimary)}>
                <input
                  type="checkbox"
                  checked={assocAsPrimary}
                  onChange={e => setAssocAsPrimary(e.target.checked)}
                  style={{ accentColor: '#2563eb' }}
                />
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: assocAsPrimary ? '#2563eb' : '#334155' }}>
                    ★ Definir como Loja Prioritária
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#64748b' }}>
                    A loja prioritária é onde este motoboy atua preferencialmente
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setShowAssocModal(false)}>
                  Cancelar
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!assocCompanyId || assocSaving}
                  onClick={handleAssociate}
                >
                  {assocSaving ? 'Salvando...' : 'Associar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
