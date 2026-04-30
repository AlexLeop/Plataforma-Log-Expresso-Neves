'use client';

import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '@/app/lib/api-client';

interface SyncTestResult {
  endpoint: string;
  status: number;
  count: number;
  error?: string;
}

interface SyncLogEntry {
  id: string;
  companyName: string;
  companyMachineId: string;
  syncType: string;
  status: string;
  recordsFetched: number | null;
  recordsUpserted: number | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export default function SyncPage() {
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<SyncTestResult[]>([]);
  const [lastTested, setLastTested] = useState<string | null>(null);
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);

  const loadSyncLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const res = await authFetch('/api/db/sync-logs?limit=30');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSyncLogs(data || []);
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : 'Erro ao carregar logs');
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSyncLogs();
  }, [loadSyncLogs]);

  async function runTests() {
    setTesting(true);
    setResults([]);
    const endpoints = [
      { name: 'Condutores', url: '/api/machine/drivers', key: 'drivers' },
      { name: 'Empresas', url: '/api/machine/companies', key: 'companies' },
      { name: 'Solicitações', url: '/api/machine/rides?limite=5', key: 'rides' },
    ];

    const newResults: SyncTestResult[] = [];

    for (const ep of endpoints) {
      try {
        const res = await authFetch(ep.url);
        const data = await res.json();
        newResults.push({
          endpoint: ep.name,
          status: res.status,
          count: data[ep.key]?.length ?? data.total ?? 0,
        });
      } catch (err) {
        newResults.push({
          endpoint: ep.name,
          status: 0,
          count: 0,
          error: err instanceof Error ? err.message : 'Erro',
        });
      }
    }

    setResults(newResults);
    setLastTested(new Date().toLocaleString('pt-BR'));
    setTesting(false);
  }

  function formatDuration(ms: number | null): string {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; badge: string }> = {
      success: { label: '✓ OK', badge: 'badge-success' },
      started: { label: '⏳ Em andamento', badge: 'badge-warning' },
      failed: { label: '✕ Erro', badge: 'badge-danger' },
    };
    const s = map[status] || { label: status, badge: 'badge-info' };
    return <span className={`badge ${s.badge}`}>{s.label}</span>;
  };

  // Stats from sync logs
  const last24h = syncLogs.filter(l => {
    const d = new Date(l.createdAt);
    return Date.now() - d.getTime() < 24 * 60 * 60 * 1000;
  });
  const successCount = last24h.filter(l => l.status === 'success').length;
  const failCount = last24h.filter(l => l.status === 'failed').length;
  const avgDuration = last24h
    .filter(l => l.durationMs !== null)
    .reduce((sum, l, _, arr) => sum + (l.durationMs || 0) / arr.length, 0);

  return (
    <>
      <header className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Sincronização</h1>
            <p className="page-subtitle">Status da integração com a Machine API</p>
          </div>
          <div className="flex gap-sm">
            <button
              className="btn btn-secondary"
              onClick={loadSyncLogs}
              disabled={logsLoading}
            >
              Atualizar Logs
            </button>
            <button
              className="btn"
              style={{ background: 'white', color: 'var(--color-primary)' }}
              onClick={runTests}
              disabled={testing}
            >
              {testing ? 'Testando...' : 'Testar Conexão'}
            </button>
          </div>
        </div>
      </header>

      <div className="page-body">
        {/* Stats Cards */}
        <div className="stats-grid mb-md" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="stat-card">
            <div className="stat-value">{last24h.length}</div>
            <div className="stat-label">Syncs (24h)</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-success">{successCount}</div>
            <div className="stat-label">Sucesso</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-danger">{failCount}</div>
            <div className="stat-label">Falhas</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{formatDuration(Math.round(avgDuration))}</div>
            <div className="stat-label">Duração Média</div>
          </div>
        </div>

        {/* Configuração atual */}
        <div className="card">
          <h2 className="card-title">Configuração Atual</h2>
          <div className="table-container mt-sm">
            <table>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 600, width: 200 }}>Base URL</td>
                  <td className="text-mono">https://api.taximachine.com.br</td>
                  <td><span className="badge badge-success">Produção</span></td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Autenticação</td>
                  <td className="text-mono">api-key + Basic Auth</td>
                  <td><span className="badge badge-success">Configurada</span></td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Polling interval</td>
                  <td className="text-mono">5 minutos</td>
                  <td><span className="badge badge-info">Cron</span></td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Retry</td>
                  <td className="text-mono">3 tentativas (backoff exponencial)</td>
                  <td><span className="badge badge-info">1s → 2s → 4s</span></td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Batch size</td>
                  <td className="text-mono">5 empresas/ciclo</td>
                  <td><span className="badge badge-info">Config</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Resultados dos testes */}
        {results.length > 0 && (
          <div className="card mt-md">
            <div className="card-header">
              <h2 className="card-title">Resultado do Teste de Conexão</h2>
              <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                Testado em: {lastTested}
              </span>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th className="text-center">Status HTTP</th>
                    <th className="text-center">Registros</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{r.endpoint}</td>
                      <td className="text-center text-mono">{r.status}</td>
                      <td className="text-center text-mono">{r.count}</td>
                      <td>
                        {r.status === 200 ? (
                          <span className="badge badge-success">✓ OK</span>
                        ) : (
                          <span className="badge badge-danger">✕ {r.error || 'Erro'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-sm mt-md" style={{ padding: '8px 12px', background: results.every(r => r.status === 200) ? '#dcfce7' : '#FFF0E5', borderRadius: 'var(--radius-md)' }}>
              <span style={{ fontSize: '1.2rem' }}>
                {results.every(r => r.status === 200) ? 'OK' : 'ERRO'}
              </span>
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                {results.every(r => r.status === 200)
                  ? 'Todos os endpoints respondendo corretamente.'
                  : 'Alguns endpoints apresentaram erros.'
                }
              </span>
            </div>
          </div>
        )}

        {/* Sync Logs */}
        <div className="card mt-md">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="card-title">Histórico de Sincronizações</h2>
            <span className="text-muted" style={{ fontSize: '0.7rem' }}>
              Últimas {syncLogs.length} execuções
            </span>
          </div>

          {logsLoading && (
            <div className="text-center" style={{ padding: 'var(--space-xl)' }}>
              <p className="text-muted">Carregando logs de sincronização...</p>
            </div>
          )}

          {logsError && (
            <div style={{ padding: '12px', background: '#FFF0E5', borderRadius: 'var(--radius-md)', margin: '12px' }}>
              <p className="text-danger" style={{ margin: 0 }}>
                {logsError}
              </p>
              <button className="btn btn-secondary mt-sm" onClick={loadSyncLogs} style={{ fontSize: '0.75rem' }}>
                Tentar novamente
              </button>
            </div>
          )}

          {!logsLoading && !logsError && syncLogs.length === 0 && (
            <div className="text-center" style={{ padding: 'var(--space-xl)' }}>
              <p className="text-muted">Nenhum log de sincronização encontrado.</p>
              <p className="text-muted" style={{ fontSize: '0.75rem' }}>
                Os logs aparecerão quando o cron de sincronização for executado.
              </p>
            </div>
          )}

          {!logsLoading && syncLogs.length > 0 && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Data/Hora</th>
                    <th>Empresa</th>
                    <th>Tipo</th>
                    <th className="text-center">Status</th>
                    <th className="text-center">Buscados</th>
                    <th className="text-center">Gravados</th>
                    <th className="text-center">Duração</th>
                    <th>Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="text-mono" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                        {formatDate(log.createdAt)}
                      </td>
                      <td style={{ fontWeight: 550, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {log.companyName}
                      </td>
                      <td>
                        <span className="badge badge-info" style={{ fontSize: '0.65rem' }}>
                          {log.syncType || 'polling'}
                        </span>
                      </td>
                      <td className="text-center">
                        {statusBadge(log.status)}
                      </td>
                      <td className="text-center text-mono">
                        {log.recordsFetched ?? '—'}
                      </td>
                      <td className="text-center text-mono">
                        {log.recordsUpserted ?? '—'}
                      </td>
                      <td className="text-center text-mono" style={{ fontSize: '0.75rem' }}>
                        {formatDuration(log.durationMs)}
                      </td>
                      <td className="text-danger" style={{
                        fontSize: '0.7rem',
                        maxWidth: 200,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {log.errorMessage || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Endpoints monitorados */}
        <div className="card mt-md">
          <h2 className="card-title">Endpoints Monitorados</h2>
          <div className="table-container mt-sm">
            <table>
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Método</th>
                  <th>Descrição</th>
                  <th>Uso</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { ep: '/api/integracao/condutor', method: 'GET', desc: 'Lista entregadores', use: 'Sync + Proxy' },
                  { ep: '/api/integracao/empresa', method: 'GET', desc: 'Lista empresas', use: 'Sync + Proxy' },
                  { ep: '/api/integracao/solicitacao', method: 'GET', desc: 'Lista corridas', use: 'Sync + Proxy' },
                  { ep: '/api/integracao/condutor', method: 'POST', desc: 'Cadastrar condutor', use: 'Proxy' },
                  { ep: '/api/integracao/condutor', method: 'PUT', desc: 'Atualizar condutor', use: 'Proxy' },
                  { ep: '/api/integracao/solicitacao', method: 'POST', desc: 'Criar solicitação', use: 'Proxy' },
                  { ep: '/api/integracao/solicitacao/cancelar', method: 'POST', desc: 'Cancelar solicitação', use: 'Proxy' },
                  { ep: '/api/integracao/empresa', method: 'POST', desc: 'Criar empresa', use: 'Proxy' },
                ].map((item, i) => (
                  <tr key={i}>
                    <td className="text-mono" style={{ fontSize: '0.75rem' }}>{item.ep}</td>
                    <td>
                      <span className={`badge ${item.method === 'GET' ? 'badge-info' : item.method === 'POST' ? 'badge-success' : 'badge-warning'}`}>
                        {item.method}
                      </span>
                    </td>
                    <td>{item.desc}</td>
                    <td className="text-muted">{item.use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
