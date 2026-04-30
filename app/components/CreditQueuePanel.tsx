'use client';

import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '@/app/lib/api-client';

/**
 * CreditQueuePanel — Real-time view of the credit_queue.
 *
 * Shows pending, processing, failed, and dead items.
 * Subscribes to Supabase Realtime for live updates.
 * Allows admin to manually retry dead items.
 */

interface QueueItem {
  id: string;
  company_id: string;
  driver_id: string;
  machine_condutor_id: string;
  net_amount: number;
  description: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead';
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  next_retry_at: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  // Joined
  driver_name?: string;
  company_name?: string;
}

function formatBRL(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}m atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  const days = Math.floor(hrs / 24);
  return `${days}d atrás`;
}

function nextRetryLabel(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return 'Agora (na próxima execução)';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `em ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `em ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `em ${days}d`;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pending: { label: 'Pendente', color: '#d97706', bg: 'rgba(217, 119, 6, 0.08)', icon: '◎' },
  processing: { label: 'Processando', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.08)', icon: '↻' },
  completed: { label: 'Concluído', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.08)', icon: '✓' },
  failed: { label: 'Falhou', color: '#E55C00', bg: 'rgba(229, 92, 0, 0.08)', icon: '△' },
  dead: { label: 'DLQ', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.08)', icon: '✕' },
};

interface CreditQueuePanelProps {
  companyId?: string;
}

export default function CreditQueuePanel({ companyId }: CreditQueuePanelProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('active'); // 'active' | 'all' | 'dead'

  const loadQueue = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('company_id', companyId);
      if (filter === 'active') params.set('status', 'pending,processing,failed');
      else if (filter === 'dead') params.set('status', 'dead');

      const res = await authFetch(`/api/db/credit-queue?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch (err) {
      console.error('[CreditQueuePanel] Load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId, filter]);

  useEffect(() => {
    loadQueue();

    // Subscribe to Realtime changes on credit_queue
    let channel: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    let mounted = true;

    async function setupRealtime() {
      try {
        const { getRealtimeClient } = await import('@/lib/supabase/browser-singleton');
        const supabase = getRealtimeClient();
        if (!supabase) return;

        channel = supabase
          .channel('credit-queue-panel')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'credit_queue' },
            () => {
              if (mounted) loadQueue();
            }
          )
          .subscribe();
      } catch (err) {
        console.warn('[CreditQueuePanel] Realtime setup failed:', err);
      }
    }

    setupRealtime();

    return () => {
      mounted = false;
      channel?.unsubscribe?.();
    };
  }, [loadQueue]);

  const handleRetry = async (queueId: string) => {
    setRetrying(queueId);
    try {
      const res = await authFetch('/api/db/credit-queue/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue_ids: [queueId] }),
      });
      if (res.ok) {
        await loadQueue();
      }
    } catch (err) {
      console.error('[CreditQueuePanel] Retry failed:', err);
    } finally {
      setRetrying(null);
    }
  };

  const handleRetryAll = async () => {
    setRetrying('all');
    try {
      const res = await authFetch('/api/db/credit-queue/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retry_all: true }),
      });
      if (res.ok) {
        await loadQueue();
      }
    } catch (err) {
      console.error('[CreditQueuePanel] Retry all failed:', err);
    } finally {
      setRetrying(null);
    }
  };

  // Stats
  const queueStats = {
    pending: items.filter(i => i.status === 'pending').length,
    processing: items.filter(i => i.status === 'processing').length,
    failed: items.filter(i => i.status === 'failed').length,
    dead: items.filter(i => i.status === 'dead').length,
    totalAmount: items
      .filter(i => i.status !== 'completed')
      .reduce((sum, i) => sum + Number(i.net_amount), 0),
  };

  const hasAlerts = queueStats.dead > 0 || queueStats.failed > 0;

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2 className="card-title" style={{ margin: 0 }}>Fila de Créditos</h2>
          {hasAlerts && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 20, height: 20, borderRadius: '50%',
              background: queueStats.dead > 0 ? '#dc2626' : '#E55C00',
              color: 'white', fontSize: '0.6rem', fontWeight: 800,
              animation: 'pulse 2s infinite',
            }}>
              {queueStats.dead + queueStats.failed}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {/* Filter tabs */}
          {[
            { key: 'active', label: 'Ativos' },
            { key: 'dead', label: 'DLQ' },
            { key: 'all', label: 'Todos' },
          ].map(f => (
            <button
              key={f.key}
              className={`btn btn-sm ${filter === f.key ? '' : 'btn-secondary'}`}
              style={filter === f.key
                ? { background: 'var(--color-accent)', color: 'white', border: 'none', fontSize: '0.65rem', padding: '3px 10px' }
                : { fontSize: '0.65rem', padding: '3px 10px' }
              }
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <button
            className="btn btn-sm btn-secondary"
            onClick={loadQueue}
            style={{ fontSize: '0.65rem', padding: '3px 8px' }}
            title="Atualizar"
          >
            ⟳
          </button>
        </div>
      </div>

      {/* Queue Stats Bar */}
      <div style={{
        display: 'flex', gap: '12px', padding: '10px 16px',
        background: 'var(--color-surface-secondary)', borderRadius: 'var(--radius-md)',
        marginBottom: '12px',
      }}>
        {Object.entries(STATUS_CONFIG)
          .filter(([key]) => key !== 'completed')
          .map(([key, cfg]) => {
            const count = key === 'pending' ? queueStats.pending
              : key === 'processing' ? queueStats.processing
              : key === 'failed' ? queueStats.failed
              : queueStats.dead;
            return (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '4px 10px', borderRadius: '6px',
                background: count > 0 ? cfg.bg : 'transparent',
                border: count > 0 ? `1px solid ${cfg.color}20` : '1px solid transparent',
              }}>
                <span style={{ fontSize: '0.75rem' }}>{cfg.icon}</span>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: count > 0 ? cfg.color : 'var(--color-text-muted)' }}>
                  {count}
                </span>
                <span style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>
                  {cfg.label}
                </span>
              </div>
            );
          })}

        {queueStats.totalAmount > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>Total na fila:</span>
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--color-accent)' }}>
              {formatBRL(queueStats.totalAmount)}
            </span>
          </div>
        )}
      </div>

      {/* Dead Letter Alert */}
      {queueStats.dead > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 14px', marginBottom: '12px',
          background: 'rgba(220, 38, 38, 0.06)', border: '1px solid rgba(220, 38, 38, 0.2)',
          borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontSize: '1.2rem' }}>✕</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#dc2626' }}>
              {queueStats.dead} pagamento{queueStats.dead > 1 ? 's' : ''} na Dead Letter Queue
            </div>
            <div style={{ fontSize: '0.68rem', color: '#b91c1c' }}>
              Estes pagamentos falharam {5} vezes. Requerem intervenção manual.
            </div>
          </div>
          <button
            className="btn btn-sm"
            style={{
              background: '#dc2626', color: 'white', border: 'none',
              fontSize: '0.68rem', padding: '6px 14px', fontWeight: 700,
            }}
            onClick={handleRetryAll}
            disabled={retrying === 'all'}
          >
            {retrying === 'all' ? 'Reprocessando...' : '↻ Reprocessar Todos'}
          </button>
        </div>
      )}

      {/* Queue Items */}
      {loading ? (
        <div className="text-center text-muted" style={{ padding: '30px 0', fontSize: '0.82rem' }}>
          Carregando fila de créditos...
        </div>
      ) : items.length === 0 ? (
        <div className="text-center text-muted" style={{ padding: '30px 0' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '8px', opacity: 0.3 }}>✓</div>
          <div style={{ fontSize: '0.82rem' }}>Nenhum item na fila</div>
          <div style={{ fontSize: '0.7rem', marginTop: '4px' }}>
            Todos os créditos foram processados com sucesso
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Motoboy</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Tentativas</th>
                <th>Próximo Retry</th>
                <th>Erro</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
                return (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                        {item.driver_name || item.machine_condutor_id}
                      </div>
                      <div className="text-muted" style={{ fontSize: '0.65rem' }}>
                        {item.description?.slice(0, 40) || '—'}
                      </div>
                    </td>
                    <td>
                      <span className="text-mono" style={{ fontWeight: 700, color: 'var(--color-accent)' }}>
                        {formatBRL(Number(item.net_amount))}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '2px 8px', borderRadius: '4px',
                        background: cfg.bg, color: cfg.color,
                        fontSize: '0.68rem', fontWeight: 700,
                      }}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </td>
                    <td className="text-center">
                      <span className="text-mono" style={{ fontSize: '0.78rem' }}>
                        {item.attempt_count}/{item.max_attempts}
                      </span>
                    </td>
                    <td className="text-muted" style={{ fontSize: '0.7rem' }}>
                      {item.status === 'failed' && item.next_retry_at
                        ? nextRetryLabel(item.next_retry_at)
                        : item.status === 'dead'
                        ? 'Manual'
                        : item.status === 'pending'
                        ? 'Na próxima execução'
                        : '—'
                      }
                    </td>
                    <td>
                      {item.last_error && (
                        <div style={{
                          fontSize: '0.65rem', color: '#dc2626',
                          maxWidth: '200px', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                        title={item.last_error}
                        >
                          {item.last_error}
                        </div>
                      )}
                    </td>
                    <td>
                      {(item.status === 'dead' || item.status === 'failed') && (
                        <button
                          className="btn btn-sm"
                          style={{
                            fontSize: '0.65rem', padding: '3px 8px',
                            background: 'transparent',
                            border: `1px solid ${cfg.color}`,
                            color: cfg.color,
                            borderRadius: '4px', cursor: 'pointer',
                          }}
                          onClick={() => handleRetry(item.id)}
                          disabled={retrying === item.id}
                        >
                          {retrying === item.id ? '...' : '↻ Retry'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer — Last updated */}
      <div style={{
        marginTop: '8px', paddingTop: '8px',
        borderTop: '1px solid var(--color-border-light)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span className="text-muted" style={{ fontSize: '0.65rem' }}>
          Processamento automático: a cada 5 min via pg_cron
        </span>
        <span className="text-muted" style={{ fontSize: '0.65rem' }}>
          {items.length > 0
            ? `Última atualização: ${timeAgo(items[0].updated_at)}`
            : 'Atualização em tempo real via Realtime'
          }
        </span>
      </div>
    </div>
  );
}
