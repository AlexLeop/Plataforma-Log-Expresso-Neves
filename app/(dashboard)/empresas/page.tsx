'use client';

import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '@/app/lib/api-client';
import Pagination, { usePagination } from '../../components/Pagination';

interface CompanyData {
  id: number;
  nome: string;
  numero_contrato: string | null;
  endereco: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  telefone: string | null;
  telefone_internacional: string | null;
  status_empresa: string;
  data_hora_cadastro: string | null;
  tipo_documento: string | null;
  documento: string | null;
  tipos_pagamento: string[] | null;
  categorias: Array<{ id: string; nome: string }> | null;
  admins: Array<{ id?: string; nome: string; email: string }> | null;
}

// ─── Toast Component ──────────────────────────────────────────
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error' | 'info'; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  const bg = type === 'success' ? '#10b981' : type === 'error' ? '#CC5200' : '#3b82f6';
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      padding: '14px 24px', background: bg, color: '#fff',
      borderRadius: 12, fontSize: 14, fontWeight: 600,
      boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      animation: 'fadeInUp 0.3s ease',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      {type === 'success' ? '✓' : type === 'error' ? '✕' : '•'} {message}
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', marginLeft: 8, fontSize: 16 }}>✕</button>
    </div>
  );
}

// ─── Confirmation Modal ──────────────────────────────────────
function ConfirmModal({ title, message, confirmLabel, confirmColor, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel: string; confirmColor: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'fadeInUp 0.2s ease',
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 16, padding: '28px 32px',
        maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>{title}</h3>
        <p style={{ margin: '12px 0 24px', color: '#64748b', fontSize: '0.9rem', lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '10px 20px', borderRadius: 10, border: '1px solid #e2e8f0',
            background: '#f8fafc', color: '#475569', fontSize: '0.85rem',
            fontWeight: 600, cursor: 'pointer',
          }}>Cancelar</button>
          <button onClick={onConfirm} style={{
            padding: '10px 20px', borderRadius: 10, border: 'none',
            background: confirmColor, color: '#fff', fontSize: '0.85rem',
            fontWeight: 600, cursor: 'pointer',
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export default function EmpresasPage() {
  const [companies, setCompanies] = useState<CompanyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CompanyData | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [filter, setFilter] = useState<'all' | 'A' | 'I'>('all');
  const [search, setSearch] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ companyId: string; newStatus: 'A' | 'I'; companyName: string } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
  }, []);

  const fetchCompanies = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authFetch('/api/machine/companies');
      if (!res.ok) throw new Error('Falha ao buscar empresas');
      const data = await res.json();
      setCompanies(data.companies || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  // Show confirmation modal for status change
  const requestStatusChange = useCallback((companyId: string, newStatus: 'A' | 'I', companyName: string) => {
    setConfirmAction({ companyId, newStatus, companyName });
  }, []);

  // Execute status change after modal confirmation
  const executeStatusChange = useCallback(async () => {
    if (!confirmAction) return;
    const { companyId, newStatus } = confirmAction;
    setConfirmAction(null);

    setUpdatingId(companyId);
    try {
      const res = await authFetch('/api/machine/companies/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: companyId,
          status_empresa: newStatus,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        showToast(
          newStatus === 'A' ? 'Empresa ativada com sucesso!' : 'Empresa desativada.',
          'success'
        );
        fetchCompanies();
      } else {
        const msg = data?.details?.errors?.[0] || data?.error || 'Erro ao atualizar';
        showToast(typeof msg === 'string' ? msg : JSON.stringify(msg), 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setUpdatingId(null);
    }
  }, [confirmAction, showToast, fetchCompanies]);

  // Filter & search
  const filteredCompanies = companies.filter(c => {
    if (filter !== 'all' && c.status_empresa !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.nome?.toLowerCase().includes(q) ||
        c.documento?.toLowerCase().includes(q) ||
        String(c.id).includes(q)
      );
    }
    return true;
  });

  const {
    paginatedItems: paginatedCompanies,
    currentPage: compPage,
    setCurrentPage: setCompPage,
    itemsPerPage: compPerPage,
    setItemsPerPage: setCompPerPage,
  } = usePagination(filteredCompanies, 25);

  const activeCount = companies.filter(c => c.status_empresa === 'A').length;
  const inactiveCount = companies.filter(c => c.status_empresa !== 'A').length;

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'A': return { label: 'Ativa', color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0' };
      case 'I': return { label: 'Inativa', color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' };
      default: return { label: status, color: '#6b7280', bg: '#f3f4f6', border: '#d1d5db' };
    }
  };

  return (
    <>
      <header className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Empresas</h1>
            <p className="page-subtitle">
              Gestão de empresas clientes • Ative ou desative cadastros
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a
              href="/cadastro"
              target="_blank"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 10,
                background: 'rgba(255,255,255,0.15)', color: '#fff',
                fontSize: 13, fontWeight: 600, textDecoration: 'none',
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              ↗ Link de Cadastro
            </a>
            <button className="btn" style={{ background: 'white', color: 'var(--color-primary)' }} onClick={fetchCompanies}>
              ↻ Sincronizar
            </button>
          </div>
        </div>
      </header>

      <div className="page-body">
        {loading && (
          <div className="card text-center" style={{ padding: 'var(--space-2xl)' }}>
            <p className="text-muted">Carregando empresas da Machine...</p>
          </div>
        )}

        {error && (
          <div className="card" style={{ borderColor: 'var(--color-danger)' }}>
            <p className="text-danger">✕ {error}</p>
            <button className="btn btn-secondary mt-md" onClick={fetchCompanies}>Tentar novamente</button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Stats */}
            <div className="stats-grid mb-md" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="stat-card" onClick={() => setFilter('all')} style={{ cursor: 'pointer', outline: filter === 'all' ? '2px solid var(--color-primary)' : 'none', borderRadius: 12 }}>
                <div className="stat-label">Total</div>
                <div className="stat-value">{companies.length}</div>
              </div>
              <div className="stat-card" onClick={() => setFilter('A')} style={{ cursor: 'pointer', outline: filter === 'A' ? '2px solid #10b981' : 'none', borderRadius: 12 }}>
                <div className="stat-label">● Ativas</div>
                <div className="stat-value" style={{ color: '#10b981' }}>{activeCount}</div>
              </div>
              <div className="stat-card" onClick={() => setFilter('I')} style={{ cursor: 'pointer', outline: filter === 'I' ? '2px solid #f59e0b' : 'none', borderRadius: 12 }}>
                <div className="stat-label">○ Inativas</div>
                <div className="stat-value" style={{ color: '#f59e0b' }}>{inactiveCount}</div>
              </div>
            </div>

            {/* Search */}
            <div className="card mb-md" style={{ padding: 'var(--space-sm) var(--space-md)' }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nome, CNPJ ou ID..."
                style={{
                  width: '100%', padding: '10px 14px',
                  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                  borderRadius: 10, fontSize: 14, color: 'var(--color-text)',
                  outline: 'none',
                }}
              />
            </div>

            {/* Table */}
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">
                  Empresas Cadastradas
                  {filter !== 'all' && (
                    <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 8 }}>
                      (filtro: {filter === 'A' ? 'Ativas' : 'Inativas'})
                    </span>
                  )}
                </h2>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {filteredCompanies.length} empresa(s)
                </span>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Nome</th>
                      <th>Documento</th>
                      <th>Cidade/UF</th>
                      <th>Telefone</th>
                      <th>Status</th>
                      <th>Cadastro</th>
                      <th style={{ textAlign: 'center' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCompanies.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-text-muted)' }}>
                          Nenhuma empresa encontrada
                        </td>
                      </tr>
                    ) : (
                      paginatedCompanies.map(company => {
                        const statusInfo = getStatusInfo(company.status_empresa);
                        const isUpdating = updatingId === String(company.id);

                        return (
                          <tr key={company.id}>
                            <td className="text-mono text-muted">{company.id}</td>
                            <td style={{ fontWeight: 600 }}>{company.nome}</td>
                            <td className="text-mono text-muted" style={{ fontSize: '0.8rem' }}>
                              {company.documento || '—'}
                            </td>
                            <td className="text-muted">
                              {company.cidade ? `${company.cidade}/${company.uf}` : '—'}
                            </td>
                            <td className="text-mono" style={{ fontSize: '0.85rem' }}>
                              {company.telefone || '—'}
                            </td>
                            <td>
                              <span style={{
                                display: 'inline-block', padding: '3px 10px',
                                borderRadius: 6, fontSize: '0.75rem', fontWeight: 700,
                                color: statusInfo.color, background: statusInfo.bg,
                                border: `1px solid ${statusInfo.border}`,
                              }}>
                                {statusInfo.label}
                              </span>
                            </td>
                            <td className="text-muted" style={{ fontSize: '0.8rem' }}>
                              {company.data_hora_cadastro
                                ? new Date(company.data_hora_cadastro).toLocaleDateString('pt-BR')
                                : '—'}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                {company.status_empresa !== 'A' ? (
                                  <button
                                    onClick={() => requestStatusChange(String(company.id), 'A', company.nome)}
                                    disabled={isUpdating}
                                    style={{
                                      padding: '5px 12px', borderRadius: 8, border: '1px solid #a7f3d0',
                                      background: '#ecfdf5', color: '#059669', fontSize: '0.75rem',
                                      fontWeight: 700, cursor: isUpdating ? 'wait' : 'pointer',
                                      opacity: isUpdating ? 0.6 : 1,
                                    }}
                                  >
                                    {isUpdating ? '↻' : '✓'} Ativar
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => requestStatusChange(String(company.id), 'I', company.nome)}
                                    disabled={isUpdating}
                                    style={{
                                      padding: '5px 12px', borderRadius: 8, border: '1px solid #fde68a',
                                      background: '#fffbeb', color: '#d97706', fontSize: '0.75rem',
                                      fontWeight: 700, cursor: isUpdating ? 'wait' : 'pointer',
                                      opacity: isUpdating ? 0.6 : 1,
                                    }}
                                  >
                                    {isUpdating ? '↻' : '‖'} Desativar
                                  </button>
                                )}
                                <button
                                  className="btn btn-secondary"
                                  onClick={() => setSelected(selected?.id === company.id ? null : company)}
                                  style={{ padding: '5px 10px', fontSize: '0.75rem' }}
                                >
                                  {selected?.id === company.id ? '▲' : '▼'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <Pagination
                currentPage={compPage}
                totalItems={filteredCompanies.length}
                itemsPerPage={compPerPage}
                onPageChange={setCompPage}
                onItemsPerPageChange={setCompPerPage}
              />
            </div>

            {/* Company Details Panel */}
            {selected && (
              <div className="card mt-md" style={{ animation: 'fadeInUp 0.2s ease' }}>
                <div className="card-header">
                  <h2 className="card-title">Detalhes — {selected.nome}</h2>
                  <button className="btn btn-secondary btn-sm" onClick={() => setSelected(null)}>✕ Fechar</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-md)', marginTop: 'var(--space-sm)' }}>
                  <div>
                    <p className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700 }}>Endereço</p>
                    <p>{selected.endereco || '—'}{selected.complemento ? `, ${selected.complemento}` : ''}</p>
                    <p>{selected.bairro || ''}</p>
                    <p>{selected.cidade}/{selected.uf} {selected.cep ? `— ${selected.cep}` : ''}</p>
                  </div>
                  <div>
                    <p className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700 }}>Contato</p>
                    <p>{selected.telefone || '—'}</p>
                    {selected.telefone_internacional && (
                      <p className="text-muted" style={{ fontSize: '0.8rem' }}>{selected.telefone_internacional}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700 }}>Contrato</p>
                    <p style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 700 }}>{selected.numero_contrato || '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700 }}>Pagamentos Aceitos</p>
                    <div className="flex gap-sm" style={{ marginTop: 4 }}>
                      {selected.tipos_pagamento?.map(t => (
                        <span key={t} className="badge badge-info">{t === 'F' ? 'Faturado' : t}</span>
                      )) || <span>—</span>}
                    </div>
                  </div>
                  <div>
                    <p className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700 }}>Categorias</p>
                    <div className="flex gap-sm" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                      {selected.categorias?.map(c => (
                        <span key={c.id} className="badge badge-info">{c.nome}</span>
                      )) || <span>—</span>}
                    </div>
                  </div>
                  <div>
                    <p className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700 }}>Administradores</p>
                    {selected.admins?.map((a, i) => (
                      <p key={a.id ?? i} style={{ fontSize: '0.85rem' }}>
                        <strong>{a.nome}</strong> — <span className="text-muted">{a.email}</span>
                      </p>
                    )) || <span>—</span>}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmAction && (
        <ConfirmModal
          title={confirmAction.newStatus === 'A' ? 'Ativar Empresa' : 'Desativar Empresa'}
          message={confirmAction.newStatus === 'A'
            ? `Deseja ativar a empresa "${confirmAction.companyName}"? Ela poderá solicitar entregas após ativação.`
            : `Deseja desativar a empresa "${confirmAction.companyName}"? Ela não poderá solicitar entregas enquanto inativa.`
          }
          confirmLabel={confirmAction.newStatus === 'A' ? 'Sim, Ativar' : 'Sim, Desativar'}
          confirmColor={confirmAction.newStatus === 'A' ? '#059669' : '#d97706'}
          onConfirm={executeStatusChange}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
