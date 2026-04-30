'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { authFetch } from '@/app/lib/api-client';

// ─── Types ────────────────────────────────────────────────────
interface UserCompany {
  id: string;
  name: string;
  machineEmpresaId: string;
  active: boolean;
}

interface UserRecord {
  id: string;
  email: string;
  fullName: string;
  role: string;
  companyId: string | null;
  companies: UserCompany[];
  createdAt: string;
}

interface CompanyOption {
  id: string;
  name: string;
  machineEmpresaId: string;
  active: boolean;
}

// ─── Role helpers ─────────────────────────────────────────────
const ROLE_MAP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  admin: { label: 'Administrador', color: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd' },
  manager: { label: 'Lojista', color: '#2563eb', bg: '#eff6ff', border: '#93c5fd' },
  supervisor: { label: 'Supervisor', color: '#ea580c', bg: '#fff7ed', border: '#fdba74' },
  coordinator: { label: 'Coordenador', color: '#0d9488', bg: '#f0fdfa', border: '#5eead4' },
  operator: { label: 'Operador', color: '#6b7280', bg: '#f9fafb', border: '#d1d5db' },
  viewer: { label: 'Visualizador', color: '#6b7280', bg: '#f9fafb', border: '#d1d5db' },
};

const CREATABLE_ROLES = [
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'coordinator', label: 'Coordenador' },
  { value: 'manager', label: 'Lojista' },
  { value: 'operator', label: 'Operador' },
];

// ─── Toast ────────────────────────────────────────────────────
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

// ─── Confirm Modal ────────────────────────────────────────────
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

// ─── Create/Edit Modal ───────────────────────────────────────
function UserFormModal({
  companies,
  editUser,
  onSave,
  onCancel,
}: {
  companies: CompanyOption[];
  editUser: UserRecord | null;
  onSave: (data: { email: string; password: string; fullName: string; role: string; companyIds: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const isEdit = !!editUser;
  const [email, setEmail] = useState(editUser?.email || '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState(editUser?.fullName || '');
  const [role, setRole] = useState(editUser?.role || 'supervisor');
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>(
    editUser?.companies?.map(c => c.id) || []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [companySearch, setCompanySearch] = useState('');

  const toggleCompany = (id: string) => {
    setSelectedCompanyIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const filteredCompanies = companies.filter(c => {
    if (!companySearch) return true;
    const q = companySearch.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.machineEmpresaId?.includes(q);
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !fullName || !role) {
      setError('Preencha todos os campos obrigatórios');
      return;
    }
    if (!isEdit && !password) {
      setError('Defina uma senha para o usuário');
      return;
    }
    if (!isEdit && password.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres');
      return;
    }
    if (selectedCompanyIds.length === 0) {
      setError('Selecione pelo menos uma empresa');
      return;
    }

    setSaving(true);
    try {
      await onSave({ email, password, fullName, role, companyIds: selectedCompanyIds });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'fadeInUp 0.2s ease',
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 16, padding: '28px 32px',
        maxWidth: 580, width: '94%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '1.15rem', fontWeight: 700, color: '#1e293b' }}>
          {isEdit ? 'Editar Usuário' : 'Novo Usuário'}
        </h3>
        <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: '#94a3b8' }}>
          {isEdit ? 'Altere a função ou empresas vinculadas' : 'Cadastre um supervisor, coordenador ou lojista'}
        </p>

        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: 10, marginBottom: 16,
            background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626',
            fontSize: '0.82rem', fontWeight: 500,
          }}>
            ✕ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Name */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Nome Completo *</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Ex: João Silva"
              required
              style={inputStyle}
            />
          </div>

          {/* Email */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Email *</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="usuario@email.com"
              required
              disabled={isEdit}
              style={{ ...inputStyle, ...(isEdit ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }}
            />
          </div>

          {/* Password (only for creation) */}
          {!isEdit && (
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Senha *</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                minLength={6}
                style={inputStyle}
              />
            </div>
          )}

          {/* Role */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Função *</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              style={inputStyle}
            >
              {CREATABLE_ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* Companies — Multi-select with checkboxes */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              Empresas Vinculadas *
              <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 6, color: '#94a3b8' }}>
                ({selectedCompanyIds.length} selecionada{selectedCompanyIds.length !== 1 ? 's' : ''})
              </span>
            </label>

            {/* Search inside company list */}
            <input
              type="text"
              value={companySearch}
              onChange={e => setCompanySearch(e.target.value)}
              placeholder="Filtrar empresas..."
              style={{ ...inputStyle, marginBottom: 8, fontSize: '0.8rem', padding: '7px 12px' }}
            />

            {/* Scrollable checkbox list */}
            <div style={{
              maxHeight: 200, overflowY: 'auto',
              border: '1px solid var(--color-border)', borderRadius: 10,
              background: 'var(--color-bg)',
            }}>
              {filteredCompanies.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem' }}>
                  Nenhuma empresa encontrada
                </div>
              ) : (
                filteredCompanies.map(c => {
                  const checked = selectedCompanyIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', cursor: 'pointer',
                        borderBottom: '1px solid var(--color-border)',
                        background: checked ? '#fff7ed' : 'transparent',
                        transition: 'background 0.15s',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCompany(c.id)}
                        style={{ width: 16, height: 16, accentColor: 'var(--color-primary)', flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1e293b' }}>{c.name}</div>
                        {c.machineEmpresaId && (
                          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>ID: {c.machineEmpresaId}</div>
                        )}
                      </div>
                      {!c.active && (
                        <span style={{
                          fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4,
                          background: '#fef3c7', color: '#92400e', fontWeight: 600,
                        }}>
                          Inativa
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>

            <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: '#94a3b8' }}>
              O usuário só terá acesso às empresas selecionadas
            </p>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel} style={{
              padding: '10px 20px', borderRadius: 10, border: '1px solid #e2e8f0',
              background: '#f8fafc', color: '#475569', fontSize: '0.85rem',
              fontWeight: 600, cursor: 'pointer',
            }}>Cancelar</button>
            <button type="submit" disabled={saving} style={{
              padding: '10px 24px', borderRadius: 10, border: 'none',
              background: saving ? '#94a3b8' : 'var(--color-primary)',
              color: '#fff', fontSize: '0.85rem',
              fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
            }}>
              {saving ? '↻ Salvando...' : (isEdit ? 'Salvar Alterações' : 'Criar Usuário')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', fontWeight: 600,
  color: '#475569', marginBottom: 4, textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px',
  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
  borderRadius: 10, fontSize: '0.88rem', color: 'var(--color-text)',
  outline: 'none', fontFamily: 'var(--font-sans)',
  boxSizing: 'border-box',
};

// ─── Main Page ────────────────────────────────────────────────
export default function UsuariosPage() {
  const { isAdmin } = useAppContext();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<UserRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRecord | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
  }, []);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authFetch('/api/db/users');
      if (!res.ok) throw new Error('Falha ao buscar usuários');
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao carregar', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // Fetch Supabase companies for dropdown
  const fetchCompanies = useCallback(async () => {
    try {
      const res = await authFetch('/api/db/companies');
      if (res.ok) {
        const data = await res.json();
        setCompanies(data);
      }
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchCompanies();
  }, [fetchUsers, fetchCompanies]);

  // Create user
  const handleCreate = async (formData: { email: string; password: string; fullName: string; role: string; companyIds: string[] }) => {
    const res = await authFetch('/api/db/users', {
      method: 'POST',
      body: JSON.stringify(formData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao criar usuário');
    showToast('Usuário criado com sucesso!', 'success');
    setShowForm(false);
    fetchUsers();
  };

  // Update user
  const handleUpdate = async (formData: { email: string; password: string; fullName: string; role: string; companyIds: string[] }) => {
    if (!editUser) return;
    const res = await authFetch('/api/db/users', {
      method: 'PUT',
      body: JSON.stringify({
        id: editUser.id,
        fullName: formData.fullName,
        role: formData.role,
        companyIds: formData.companyIds,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao atualizar');
    showToast('Usuário atualizado!', 'success');
    setEditUser(null);
    setShowForm(false);
    fetchUsers();
  };

  // Delete user
  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      const res = await authFetch(`/api/db/users?id=${confirmDelete.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao excluir');
      }
      showToast('Usuário excluído', 'success');
      fetchUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro', 'error');
    } finally {
      setConfirmDelete(null);
    }
  };

  // Filters
  const filtered = users.filter(u => {
    if (filterRole !== 'all' && u.role !== filterRole) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        u.fullName?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.companies?.some(c => c.name.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Stats
  const supervisorCount = users.filter(u => u.role === 'supervisor').length;
  const coordinatorCount = users.filter(u => u.role === 'coordinator').length;
  const lojistaCount = users.filter(u => u.role === 'manager').length;

  if (!isAdmin) {
    return (
      <div className="page-body">
        <div className="card text-center" style={{ padding: 'var(--space-2xl)' }}>
          <p className="text-muted">Acesso restrito a administradores.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Gestão de Usuários</h1>
            <p className="page-subtitle">
              Cadastre e gerencie supervisores, coordenadores e lojistas
            </p>
          </div>
          <button
            className="btn"
            style={{ background: 'white', color: 'var(--color-primary)', fontWeight: 700 }}
            onClick={() => { setEditUser(null); setShowForm(true); }}
          >
            + Novo Usuário
          </button>
        </div>
      </header>

      <div className="page-body">
        {/* Stats */}
        <div className="stats-grid mb-md" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div
            className="stat-card"
            onClick={() => setFilterRole('all')}
            style={{ cursor: 'pointer', outline: filterRole === 'all' ? '2px solid var(--color-primary)' : 'none', borderRadius: 12 }}
          >
            <div className="stat-label">Total</div>
            <div className="stat-value">{users.length}</div>
          </div>
          <div
            className="stat-card"
            onClick={() => setFilterRole('supervisor')}
            style={{ cursor: 'pointer', outline: filterRole === 'supervisor' ? '2px solid #ea580c' : 'none', borderRadius: 12 }}
          >
            <div className="stat-label">● Supervisores</div>
            <div className="stat-value" style={{ color: '#ea580c' }}>{supervisorCount}</div>
          </div>
          <div
            className="stat-card"
            onClick={() => setFilterRole('coordinator')}
            style={{ cursor: 'pointer', outline: filterRole === 'coordinator' ? '2px solid #0d9488' : 'none', borderRadius: 12 }}
          >
            <div className="stat-label">● Coordenadores</div>
            <div className="stat-value" style={{ color: '#0d9488' }}>{coordinatorCount}</div>
          </div>
          <div
            className="stat-card"
            onClick={() => setFilterRole('manager')}
            style={{ cursor: 'pointer', outline: filterRole === 'manager' ? '2px solid #2563eb' : 'none', borderRadius: 12 }}
          >
            <div className="stat-label">● Lojistas</div>
            <div className="stat-value" style={{ color: '#2563eb' }}>{lojistaCount}</div>
          </div>
        </div>

        {/* Search */}
        <div className="card mb-md" style={{ padding: 'var(--space-sm) var(--space-md)' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, email ou empresa..."
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
              Usuários Cadastrados
              {filterRole !== 'all' && (
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 8 }}>
                  (filtro: {ROLE_MAP[filterRole]?.label || filterRole})
                </span>
              )}
            </h2>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {filtered.length} usuário(s)
            </span>
          </div>

          {loading ? (
            <div style={{ padding: 'var(--space-2xl)', textAlign: 'center' }}>
              <p className="text-muted">Carregando usuários...</p>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Email</th>
                    <th>Função</th>
                    <th>Empresas Vinculadas</th>
                    <th>Cadastro</th>
                    <th style={{ textAlign: 'center' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-text-muted)' }}>
                        Nenhum usuário encontrado
                      </td>
                    </tr>
                  ) : (
                    filtered.map(user => {
                      const roleInfo = ROLE_MAP[user.role] || ROLE_MAP.viewer;
                      return (
                        <tr key={user.id}>
                          <td style={{ fontWeight: 600 }}>{user.fullName || '—'}</td>
                          <td className="text-muted" style={{ fontSize: '0.85rem' }}>{user.email}</td>
                          <td>
                            <span style={{
                              display: 'inline-block', padding: '3px 10px',
                              borderRadius: 6, fontSize: '0.75rem', fontWeight: 700,
                              color: roleInfo.color, background: roleInfo.bg,
                              border: `1px solid ${roleInfo.border}`,
                            }}>
                              {roleInfo.label}
                            </span>
                          </td>
                          <td>
                            {user.companies && user.companies.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {user.companies.map(c => (
                                  <span key={c.id} style={{
                                    display: 'inline-block', padding: '2px 8px',
                                    borderRadius: 6, fontSize: '0.72rem', fontWeight: 600,
                                    background: '#f1f5f9', color: '#334155',
                                    border: '1px solid #e2e8f0',
                                  }}>
                                    {c.name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted" style={{ fontSize: '0.8rem' }}>— Nenhuma —</span>
                            )}
                          </td>
                          <td className="text-muted" style={{ fontSize: '0.8rem' }}>
                            {user.createdAt
                              ? new Date(user.createdAt).toLocaleDateString('pt-BR')
                              : '—'}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                              {user.role !== 'admin' && (
                                <>
                                  <button
                                    onClick={() => { setEditUser(user); setShowForm(true); }}
                                    style={{
                                      padding: '5px 12px', borderRadius: 8, border: '1px solid #93c5fd',
                                      background: '#eff6ff', color: '#2563eb', fontSize: '0.75rem',
                                      fontWeight: 700, cursor: 'pointer',
                                    }}
                                  >
                                    ✎ Editar
                                  </button>
                                  <button
                                    onClick={() => setConfirmDelete(user)}
                                    style={{
                                      padding: '5px 12px', borderRadius: 8, border: '1px solid #fecaca',
                                      background: '#fef2f2', color: '#dc2626', fontSize: '0.75rem',
                                      fontWeight: 700, cursor: 'pointer',
                                    }}
                                  >
                                    ✕ Excluir
                                  </button>
                                </>
                              )}
                              {user.role === 'admin' && (
                                <span className="text-muted" style={{ fontSize: '0.75rem', fontStyle: 'italic' }}>
                                  Admin protegido
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <UserFormModal
          companies={companies}
          editUser={editUser}
          onSave={editUser ? handleUpdate : handleCreate}
          onCancel={() => { setShowForm(false); setEditUser(null); }}
        />
      )}

      {/* Delete Confirm */}
      {confirmDelete && (
        <ConfirmModal
          title="Excluir Usuário"
          message={`Deseja excluir o usuário "${confirmDelete.fullName}" (${confirmDelete.email})? Esta ação não pode ser desfeita.`}
          confirmLabel="Sim, Excluir"
          confirmColor="#dc2626"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
