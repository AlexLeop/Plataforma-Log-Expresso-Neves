'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from './Toast';
import { authFetch } from '@/app/lib/api-client';
import { LockIcon, SaveIcon, ClipboardListIcon, LoaderIcon, CheckCircleIcon, ClockIcon } from './icons';

/**
 * PlatformSettingsPanel — Admin-only component for managing:
 * 1. Support Email (White-Label alias interceptor)
 * 2. Setup Tasks (Shadow Registration pending tasks)
 *
 * Reads from: system_settings, setup_tasks
 * Writes to: system_settings, setup_tasks (via API)
 *
 * FINANCIAL INTEGRITY: Does NOT touch manual_entries, credit_queue,
 * or any financial tables.
 */

interface SetupTask {
  id: string;
  company_id: string;
  machine_empresa_id: string;
  generated_alias_email: string;
  status: string;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  company_name?: string;
}

export default function PlatformSettingsPanel() {
  const { showToast } = useToast();

  // Support email
  const [supportEmail, setSupportEmail] = useState('');
  const [originalEmail, setOriginalEmail] = useState('');
  const [loadingEmail, setLoadingEmail] = useState(true);
  const [savingEmail, setSavingEmail] = useState(false);

  // Setup tasks
  const [tasks, setTasks] = useState<SetupTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [completingId, setCompletingId] = useState<string | null>(null);

  // ─── Load support email ───
  useEffect(() => {
    async function loadEmail() {
      try {
        const res = await authFetch('/api/db/system-settings');
        if (res.ok) {
          const data = await res.json();
          setSupportEmail(data.support_email || '');
          setOriginalEmail(data.support_email || '');
        }
      } catch {
        console.error('Failed to load support email');
      } finally {
        setLoadingEmail(false);
      }
    }
    loadEmail();
  }, []);

  // ─── Load setup tasks ───
  const loadTasks = useCallback(async () => {
    try {
      const res = await authFetch('/api/db/setup-tasks');
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch {
      console.error('Failed to load setup tasks');
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // ─── Save support email ───
  const handleSaveEmail = async () => {
    if (!supportEmail || !supportEmail.includes('@')) {
      showToast('E-mail inválido', 'error');
      return;
    }
    setSavingEmail(true);
    try {
      const res = await authFetch('/api/db/system-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ support_email: supportEmail }),
      });
      if (res.ok) {
        setOriginalEmail(supportEmail);
        showToast('E-mail de interceptação atualizado', 'success');
      } else {
        showToast('Erro ao salvar', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setSavingEmail(false);
    }
  };

  // ─── Complete setup task ───
  const handleComplete = async (taskId: string) => {
    setCompletingId(taskId);
    try {
      const res = await authFetch('/api/db/setup-tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, status: 'completed' }),
      });
      if (res.ok) {
        showToast('Tarefa marcada como concluída', 'success');
        await loadTasks();
      } else {
        showToast('Erro ao atualizar tarefa', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setCompletingId(null);
    }
  };

  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const completedTasks = tasks.filter(t => t.status === 'completed');
  const emailChanged = supportEmail !== originalEmail;

  return (
    <>
      {/* ─── Support Email Config ─── */}
      <div className="card mt-md">
        <div className="card-header">
          <h2 className="card-title"><LockIcon size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} /> Configuração White-Label</h2>
          <span className="badge badge-warning">Plataforma</span>
        </div>

        <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-md)' }}>
          E-mail base para o <strong>Shadow Registration</strong>. Quando um novo lojista se cadastra,
          o sistema gera um alias (ex: <code style={{ fontSize: '0.68rem' }}>{supportEmail || 'nome'}+pdv_123@gmail.com</code>)
          para criar o &quot;Gestor Fantasma&quot; na Machine, permitindo que a senha temporária chegue no seu inbox.
        </p>

        <div className="form-group">
          <label className="form-label">E-mail de Interceptação White-Label</label>
          <div className="flex items-center gap-sm">
            <input
              type="email"
              className="form-input"
              placeholder="seu-email@gmail.com"
              value={supportEmail}
              onChange={e => setSupportEmail(e.target.value)}
              disabled={loadingEmail}
              style={{ flex: 1 }}
            />
            <button
              className={`btn ${emailChanged ? 'btn-primary' : 'btn-secondary'}`}
              onClick={handleSaveEmail}
              disabled={savingEmail || !emailChanged}
            >
              {savingEmail ? <><LoaderIcon size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} /> Salvando...</> : <><SaveIcon size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} /> Salvar</>}
            </button>
          </div>
          <span className="text-muted" style={{ fontSize: '0.65rem', display: 'block', marginTop: 4 }}>
            Use um Gmail para suportar aliases com &quot;+&quot;. Fallback: <code style={{ fontSize: '0.6rem' }}>{process.env.NEXT_PUBLIC_DEFAULT_SUPPORT_EMAIL || 'variável DEFAULT_SUPPORT_EMAIL'}</code>
          </span>
        </div>

        <div style={{
          background: 'rgba(220, 38, 38, 0.04)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-sm)',
          fontSize: '0.7rem',
          color: 'var(--color-text-secondary)',
          marginTop: 'var(--space-sm)',
        }}>
          <strong>Como funciona:</strong> Novo cadastro → empresa criada na Machine → alias <code style={{ fontSize: '0.65rem' }}>
            {supportEmail.split('@')[0] || 'nome'}+pdv_[ID]@{supportEmail.split('@')[1] || 'gmail.com'}
          </code> gerado → setup_task criada → admin cria gestor manualmente na Machine com esse alias → marca como concluído abaixo.
        </div>
      </div>

      {/* ─── Setup Tasks ─── */}
      <div className="card mt-md">
        <div className="card-header">
          <h2 className="card-title"><ClipboardListIcon size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} /> Tarefas de Setup (Shadow Registration)</h2>
          {pendingTasks.length > 0 && (
            <span className="badge badge-warning">{pendingTasks.length} pendente(s)</span>
          )}
        </div>

        <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-md)' }}>
          Cada nova empresa cadastrada gera uma tarefa pendente. O suporte deve criar o &quot;Usuário Gestor&quot;
          na Machine usando o alias gerado e marcar como concluído.
        </p>

        {loadingTasks ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-muted)' }}>
            <LoaderIcon size={16} style={{ marginRight: 6, verticalAlign: '-3px' }} /> Carregando tarefas...
          </div>
        ) : pendingTasks.length === 0 && completedTasks.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '32px 20px',
            color: 'var(--color-text-muted)',
            fontSize: '0.85rem',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}><CheckCircleIcon size={32} color="#16a34a" /></div>
            Nenhuma tarefa de setup pendente.
            <br />
            <span style={{ fontSize: '0.72rem' }}>Tarefas aparecem quando um novo lojista se cadastra.</span>
          </div>
        ) : (
          <>
            {/* Pending tasks */}
            {pendingTasks.length > 0 && (
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <div style={{
                  fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.1em', color: 'var(--color-warning)',
                  marginBottom: 'var(--space-xs)',
                }}>
                  <ClockIcon size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} /> Pendentes
                </div>
                {pendingTasks.map(task => (
                  <div key={task.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(245, 158, 11, 0.06)',
                    border: '1px solid rgba(245, 158, 11, 0.15)',
                    marginBottom: '8px',
                    gap: '12px',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '2px' }}>
                        Machine ID: {task.machine_empresa_id}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
                        Alias: <code style={{ fontSize: '0.68rem', background: 'rgba(0,0,0,0.05)', padding: '1px 4px', borderRadius: '3px' }}>
                          {task.generated_alias_email}
                        </code>
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                        Criado em: {new Date(task.created_at).toLocaleString('pt-BR')}
                      </div>
                    </div>
                    <button
                      className="btn btn-primary"
                      style={{ whiteSpace: 'nowrap', fontSize: '0.75rem', padding: '6px 14px' }}
                      disabled={completingId === task.id}
                      onClick={() => handleComplete(task.id)}
                    >
                      {completingId === task.id ? <><LoaderIcon size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} />...</> : <><CheckCircleIcon size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} /> Concluir</>}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Completed tasks (collapsed) */}
            {completedTasks.length > 0 && (
              <details style={{ marginTop: 'var(--space-sm)' }}>
                <summary style={{
                  cursor: 'pointer',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: 'var(--color-text-secondary)',
                  paddingBottom: '8px',
                }}>
                  <CheckCircleIcon size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} /> Concluídas ({completedTasks.length})
                </summary>
                {completedTasks.map(task => (
                  <div key={task.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(22, 163, 74, 0.04)',
                    border: '1px solid rgba(22, 163, 74, 0.1)',
                    marginBottom: '6px',
                    fontSize: '0.72rem',
                    color: 'var(--color-text-secondary)',
                    gap: '12px',
                  }}>
                    <span style={{ flex: 1 }}>
                      Machine ID: {task.machine_empresa_id} — {task.generated_alias_email}
                    </span>
                    <span style={{ fontSize: '0.65rem' }}>
                      {task.completed_at ? new Date(task.completed_at).toLocaleString('pt-BR') : ''}
                    </span>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
      </div>
    </>
  );
}
