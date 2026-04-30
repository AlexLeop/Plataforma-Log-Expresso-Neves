'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../components/Toast';
import { authFetch } from '@/app/lib/api-client';
import { getCompanyConfig, saveCompanyConfig, type CompanyConfig, type DiariaConfig, type ReportConfig, type FaixaHorasConfig } from '../../services/company-config';
import PlatformSettingsPanel from '../../components/PlatformSettingsPanel';

function formatBRL(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

export default function ConfiguracoesPage() {
  const { selectedCompany, companies, isAdmin } = useAppContext();
  const { showToast } = useToast();
  const [config, setConfig] = useState<CompanyConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [editCompanyId, setEditCompanyId] = useState<number | null>(null);

  // Webhook URL state (admin only)
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [webhookRegistering, setWebhookRegistering] = useState(false);

  // Carrega config da empresa selecionada ou editada
  const activeCompanyId = editCompanyId ?? selectedCompany?.id ?? null;
  const activeCompanyName = useMemo(() => {
    if (!activeCompanyId) return '';
    const c = companies.find(c => c.id === activeCompanyId);
    return c?.nome || `Empresa ${activeCompanyId}`;
  }, [activeCompanyId, companies]);

  useEffect(() => {
    if (activeCompanyId) {
      const cfg = getCompanyConfig(activeCompanyId, activeCompanyName);
      setConfig(cfg);
      setSaved(false);
    }
  }, [activeCompanyId, activeCompanyName]);

  // Load webhook URL from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('logipay:webhook_url');
      if (stored) setWebhookUrl(stored);
    }
  }, []);

  const handleSave = () => {
    if (!config) return;
    saveCompanyConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    showToast('Configurações salvas com sucesso', 'success');
  };

  const handleSaveWebhook = () => {
    localStorage.setItem('logipay:webhook_url', webhookUrl);
    setWebhookSaved(true);
    setTimeout(() => setWebhookSaved(false), 3000);
    showToast('URL do webhook salva', 'success');
  };

  const handleRegisterWebhook = async () => {
    // Auto-detect production URL if not specified
    const baseUrl = webhookUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!baseUrl) return;

    setWebhookRegistering(true);
    try {
      const res = await authFetch('/api/webhook/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookBaseUrl: baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setWebhookSaved(true);
        setWebhookUrl(baseUrl);
        localStorage.setItem('logipay:webhook_url', baseUrl);
        setTimeout(() => setWebhookSaved(false), 3000);
        showToast('Webhooks de status e posicao registrados com sucesso', 'success');
      } else {
        const failedTypes = (data.results || []).filter((r: { ok: boolean }) => !r.ok).map((r: { type: string }) => r.type).join(', ');
        showToast(`Falha ao registrar webhooks: ${failedTypes}`, 'error');
      }
    } catch {
      console.error('Failed to register webhooks');
      showToast('Erro de conexao ao registrar webhooks', 'error');
    } finally {
      setWebhookRegistering(false);
    }
  };

  const updateField = (field: keyof CompanyConfig, value: number | string) => {
    if (!config) return;
    setConfig({ ...config, [field]: value });
    setSaved(false);
  };

  const updateDiaria = (field: keyof DiariaConfig, value: number) => {
    if (!config) return;
    setConfig({
      ...config,
      diaria: { ...config.diaria, [field]: value },
    });
    setSaved(false);
  };

  // Simulação de exemplo no footer
  const weeklyExample = config ? (config.diaria.weekday * 5) + config.diaria.saturday + config.diaria.sunday : 0;

  return (
    <>
      <header className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Configurações</h1>
            <p className="page-subtitle">
              {isAdmin ? 'Taxas, pisos e valores por empresa' : 'Valor padrão da diária'}
            </p>
          </div>
          {saved && (
            <span className="badge badge-success" style={{ fontSize: '0.8rem', padding: '6px 16px' }}>
              ✓ Configuração salva com sucesso
            </span>
          )}
        </div>
      </header>

      <div className="page-body">
        {/* Selector de empresa — admin only */}
        {isAdmin && (
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Selecionar Empresa</h2>
            </div>
            <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
              {companies.map(c => (
                <button
                  key={c.id}
                  className={`btn ${(activeCompanyId === c.id) ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setEditCompanyId(c.id)}
                >
                  {c.nome}
                </button>
              ))}
            </div>
          </div>
        )}

        {config && (
          <>
            {/* ─── ADMIN ONLY: Taxa de corridas ─── */}
            {isAdmin && (
              <div className="card mt-md">
                <div className="card-header">
                  <h2 className="card-title">Taxa de Corridas</h2>
                  <span className="badge badge-info">{activeCompanyName}</span>
                </div>

                <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-md)' }}>
                  Valor cobrado por entrega realizada. Aplicado automaticamente no relatório sobre o total de entregas de cada motoboy.
                </p>

                <div className="form-group">
                  <label className="form-label">Valor por entrega (R$)</label>
                  <div className="flex items-center gap-sm">
                    <input
                      type="number"
                      className="form-input"
                      style={{ width: 150 }}
                      step="0.10"
                      value={config.taxaCorridaPerEntrega}
                      onChange={e => updateField('taxaCorridaPerEntrega', Number(e.target.value))}
                    />
                    <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                      Ex: Se um motoboy faz 10 entregas → {formatBRL(config.taxaCorridaPerEntrega * 10)}
                    </span>
                  </div>
                </div>

                <div style={{
                  background: 'rgba(229, 92, 0, 0.05)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm)',
                  fontSize: '0.7rem', color: 'var(--color-text-secondary)'
                }}>
                  A taxa varia de <strong>R$ 5,00</strong> a <strong>R$ 15,00</strong> dependendo da loja. O valor padrão é R$ 1,60.
                </div>
              </div>
            )}

            {/* ─── ADMIN ONLY: Report Parametrization ─── */}
            {isAdmin && (
              <div className="card mt-md">
                <div className="card-header">
                  <h2 className="card-title">Parametrização do Relatório</h2>
                  <span className="badge badge-info">{activeCompanyName}</span>
                </div>

                <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-md)' }}>
                  Defina como o relatório será gerado para esta loja. O lojista verá o relatório com estas configurações fixas.
                </p>

                {/* Report Type */}
                <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
                  <label className="form-label">Modo do Relatório</label>
                  <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                    {[
                      { value: 'producao' as const, label: 'Produção Padrão', desc: 'Mostra taxa/excedente por dia' },
                      { value: 'garantida' as const, label: 'Garantida Mínima', desc: 'Valor pago = máx(produção, diária)' },
                      { value: 'garantida_horas' as const, label: 'Garantida por Horas', desc: 'Diária varia conforme horas trabalhadas' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        className={`btn ${config.report.reportType === opt.value ? '' : 'btn-secondary'}`}
                        style={config.report.reportType === opt.value ? { background: 'var(--color-accent)', color: 'white', border: 'none' } : {}}
                        onClick={() => setConfig({ ...config, report: { ...config.report, reportType: opt.value } })}
                      >
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.75rem' }}>{opt.label}</div>
                          <div style={{ fontSize: '0.6rem', opacity: 0.8 }}>{opt.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ─── FAIXAS DE GARANTIDO POR HORAS ─── */}
                {config.report.reportType === 'garantida_horas' && (
                  <div style={{
                    background: 'rgba(168, 85, 247, 0.04)', border: '1px solid rgba(168, 85, 247, 0.15)',
                    borderRadius: 'var(--radius-lg)', padding: 'var(--space-md)', marginBottom: 'var(--space-md)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#7c3aed' }}> Faixas de Garantido por Horas</h3>
                        <p className="text-muted" style={{ margin: '4px 0 0', fontSize: '0.7rem' }}>
                          Configure as faixas de valor garantido por quantidade de horas trabalhadas. Cada motoboy receberá o valor da faixa correspondente ao seu expediente.
                        </p>
                      </div>
                    </div>

                    {(config.faixasHoras || []).length === 0 && (
                      <div style={{
                        textAlign: 'center', padding: 'var(--space-lg)', color: '#9ca3af',
                        border: '2px dashed #e5e7eb', borderRadius: 'var(--radius-md)',
                        marginBottom: 'var(--space-md)',
                      }}>
                        <p style={{ margin: 0, fontSize: '0.85rem' }}>Nenhuma faixa configurada ainda</p>
                        <p style={{ margin: '4px 0 0', fontSize: '0.7rem' }}>Adicione faixas para definir o garantido por horas trabalhadas</p>
                      </div>
                    )}

                    {(config.faixasHoras || []).map((faixa, idx) => (
                      <div key={faixa.id} style={{
                        display: 'grid', gridTemplateColumns: '1fr 100px 100px 120px auto',
                        gap: 'var(--space-sm)', alignItems: 'end',
                        padding: 'var(--space-sm) var(--space-md)',
                        background: '#fff', borderRadius: 'var(--radius-md)',
                        border: '1px solid #e5e7eb',
                        marginBottom: 6,
                      }}>
                        <div>
                          <label style={{ fontSize: '0.6rem', fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: 2 }}>
                            Nome da faixa
                          </label>
                          <input
                            type="text" className="form-input"
                            value={faixa.label}
                            placeholder="Ex: 4 horas"
                            style={{ fontSize: '0.8rem' }}
                            onChange={e => {
                              const updated = [...(config.faixasHoras || [])];
                              updated[idx] = { ...updated[idx], label: e.target.value };
                              setConfig({ ...config, faixasHoras: updated });
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.6rem', fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: 2 }}>
                            De (h)
                          </label>
                          <input
                            type="number" className="form-input" min={0} max={24} step={0.5}
                            value={faixa.horasMinimas}
                            style={{ fontSize: '0.8rem' }}
                            onChange={e => {
                              const updated = [...(config.faixasHoras || [])];
                              updated[idx] = { ...updated[idx], horasMinimas: Number(e.target.value) };
                              setConfig({ ...config, faixasHoras: updated });
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.6rem', fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: 2 }}>
                            Até (h)
                          </label>
                          <input
                            type="number" className="form-input" min={0} max={24} step={0.5}
                            value={faixa.horasMaximas}
                            style={{ fontSize: '0.8rem' }}
                            onChange={e => {
                              const updated = [...(config.faixasHoras || [])];
                              updated[idx] = { ...updated[idx], horasMaximas: Number(e.target.value) };
                              setConfig({ ...config, faixasHoras: updated });
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.6rem', fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: 2 }}>
                            Valor (R$)
                          </label>
                          <input
                            type="number" className="form-input" min={0} step={5}
                            value={faixa.valor}
                            style={{ fontSize: '0.8rem', fontWeight: 700 }}
                            onChange={e => {
                              const updated = [...(config.faixasHoras || [])];
                              updated[idx] = { ...updated[idx], valor: Number(e.target.value) };
                              setConfig({ ...config, faixasHoras: updated });
                            }}
                          />
                        </div>
                        <button
                          onClick={() => {
                            const updated = (config.faixasHoras || []).filter((_, i) => i !== idx);
                            setConfig({ ...config, faixasHoras: updated });
                          }}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#CC5200', fontWeight: 700, fontSize: '0.75rem', padding: '8px',
                          }}
                        >
                          ✕ Remover
                        </button>
                      </div>
                    ))}

                    <button
                      onClick={() => {
                        const newId = `faixa_${Date.now()}`;
                        const existing = config.faixasHoras || [];
                        const lastMax = existing.length > 0 ? existing[existing.length - 1].horasMaximas : 0;
                        const newFaixa: FaixaHorasConfig = {
                          id: newId,
                          label: `${lastMax}+ horas`,
                          horasMinimas: lastMax,
                          horasMaximas: lastMax + 4,
                          valor: 100,
                        };
                        setConfig({ ...config, faixasHoras: [...existing, newFaixa] });
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '10px 16px', borderRadius: 'var(--radius-md)',
                        border: '2px dashed #a855f7', background: 'rgba(168, 85, 247, 0.05)',
                        color: '#7c3aed', fontWeight: 700, fontSize: '0.75rem',
                        cursor: 'pointer', width: '100%', justifyContent: 'center',
                        marginTop: 'var(--space-sm)',
                      }}
                    >
                      + Adicionar Faixa
                    </button>

                    {(config.faixasHoras || []).length > 0 && (
                      <div style={{
                        display: 'flex', flexWrap: 'wrap', gap: 6,
                        marginTop: 'var(--space-md)', padding: 'var(--space-sm)',
                        background: 'rgba(168, 85, 247, 0.06)', borderRadius: 'var(--radius-md)',
                      }}>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#7c3aed', marginRight: 8 }}>Resumo:</span>
                        {(config.faixasHoras || []).map(f => (
                          <span key={f.id} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px', borderRadius: 4,
                            background: '#7c3aed', color: '#fff',
                            fontSize: '0.6rem', fontWeight: 600,
                          }}>
                            {f.label}: {formatBRL(f.valor)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Toggle buttons */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                  {/* Taxa Corridas */}
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                      <input
                        type="checkbox"
                        checked={config.report.includeTaxaCorridas}
                        onChange={e => setConfig({ ...config, report: { ...config.report, includeTaxaCorridas: e.target.checked } })}
                        style={{ width: 18, height: 18 }}
                      />
                      <span>Incluir Taxa de Corridas</span>
                    </label>
                    <span className="text-muted" style={{ fontSize: '0.65rem', display: 'block', marginTop: 4 }}>
                      Adiciona coluna de taxa administrativa por entrega
                    </span>
                  </div>

                  {/* Show Diária */}
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                      <input
                        type="checkbox"
                        checked={config.report.showDiaria}
                        onChange={e => setConfig({ ...config, report: { ...config.report, showDiaria: e.target.checked } })}
                        style={{ width: 18, height: 18 }}
                      />
                      <span>Exibir Coluna Diária</span>
                    </label>
                    <span className="text-muted" style={{ fontSize: '0.65rem', display: 'block', marginTop: 4 }}>
                      Visível somente no modo Garantida Mínima
                    </span>
                  </div>

                  {/* Show TX Corridas */}
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                      <input
                        type="checkbox"
                        checked={config.report.showTxCorridas}
                        onChange={e => setConfig({ ...config, report: { ...config.report, showTxCorridas: e.target.checked } })}
                        style={{ width: 18, height: 18 }}
                      />
                      <span>Exibir TX Corridas (Garantida)</span>
                    </label>
                    <span className="text-muted" style={{ fontSize: '0.65rem', display: 'block', marginTop: 4 }}>
                      Coluna separada de taxa no modo garantida
                    </span>
                  </div>

                  {/* Show Entregas */}
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                      <input
                        type="checkbox"
                        checked={config.report.showEntregas}
                        onChange={e => setConfig({ ...config, report: { ...config.report, showEntregas: e.target.checked } })}
                        style={{ width: 18, height: 18 }}
                      />
                      <span>Exibir Contagem de Entregas</span>
                    </label>
                    <span className="text-muted" style={{ fontSize: '0.65rem', display: 'block', marginTop: 4 }}>
                      Mostra nº de entregas por dia no modo garantida
                    </span>
                  </div>
                </div>

                <div style={{
                  background: 'rgba(229, 92, 0, 0.05)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-sm)',
                  fontSize: '0.7rem',
                  color: 'var(--color-text-secondary)',
                  marginTop: 'var(--space-md)',
                }}>
                  Modo: <strong>{config.report.reportType === 'producao' ? 'Produção Padrão' : config.report.reportType === 'garantida' ? 'Garantida Mínima' : 'Garantida por Horas'}</strong>
                  {' | '}Taxa corridas: <strong>{config.report.includeTaxaCorridas ? 'Sim' : 'Não'}</strong>
                  {config.report.reportType === 'garantida' && (<>
                    {' | '}Diária: <strong>{config.report.showDiaria ? 'Sim' : 'Não'}</strong>
                    {' | '}TX corridas: <strong>{config.report.showTxCorridas ? 'Sim' : 'Não'}</strong>
                    {' | '}Entregas: <strong>{config.report.showEntregas ? 'Sim' : 'Não'}</strong>
                  </>)}
                  {config.report.reportType === 'garantida_horas' && (<>
                    {' | '}Faixas: <strong>{(config.faixasHoras || []).length}</strong>
                  </>)}
                </div>
              </div>
            )}

            {/* ─── ADMIN ONLY: Piso mínimo ─── */}
            {isAdmin && (
              <div className="card mt-md">
                <div className="card-header">
                  <h2 className="card-title">Piso Mínimo de Logística</h2>
                </div>

                <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-md)' }}>
                  Se o total de taxas de corrida for inferior ao piso, o sistema aplica um complemento para atingir o valor mínimo.
                  O piso efetivo é o <strong>maior</strong> entre o fixo e o percentual.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                  <div className="form-group">
                    <label className="form-label">Piso Fixo (R$)</label>
                    <input
                      type="number"
                      className="form-input"
                      step="10"
                      value={config.pisoFixo}
                      onChange={e => updateField('pisoFixo', Number(e.target.value))}
                    />
                    <span className="text-muted" style={{ fontSize: '0.65rem', marginTop: 4, display: 'block' }}>
                      Valor fixo mínimo para logística. 0 = desativado.
                    </span>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Piso Percentual (%)</label>
                    <input
                      type="number"
                      className="form-input"
                      step="1"
                      value={config.pisoPercentual}
                      onChange={e => updateField('pisoPercentual', Number(e.target.value))}
                    />
                    <span className="text-muted" style={{ fontSize: '0.65rem', marginTop: 4, display: 'block' }}>
                      Percentual sobre total de logística. 0 = desativado.
                    </span>
                  </div>
                </div>

                <div style={{
                  background: config.pisoFixo > 0 || config.pisoPercentual > 0 ? 'rgba(245, 158, 11, 0.08)' : 'rgba(0,0,0,0.03)',
                  borderRadius: 'var(--radius-md)', padding: 'var(--space-sm)',
                  fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginTop: 'var(--space-sm)',
                }}>
                  {config.pisoFixo > 0 && config.pisoPercentual > 0 ? (
                    <>Piso efetivo = <strong>max({formatBRL(config.pisoFixo)}, {config.pisoPercentual}% do total)</strong></>
                  ) : config.pisoFixo > 0 ? (
                    <>Piso efetivo = <strong>{formatBRL(config.pisoFixo)}</strong> (fixo)</>
                  ) : config.pisoPercentual > 0 ? (
                    <>Piso efetivo = <strong>{config.pisoPercentual}%</strong> do total de logística</>
                  ) : (
                    <>Nenhum piso configurado — sem complemento aplicado.</>
                  )}
                </div>
              </div>
            )}

            {/* ─── BOTH: Valor padrão da diária ─── */}
            <div className="card mt-md">
              <div className="card-header">
                <h2 className="card-title">Valor Padrão da Diária</h2>
              </div>

              <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-md)' }}>
                Estes valores são preenchidos automaticamente ao marcar presença na tela de Lançamentos. 
                {isAdmin && ' O gestor pode ajustar individualmente por motoboy quando necessário (ex: turno duplo, desconto, etc).'}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                {/* Seg-Sex */}
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                      background: 'var(--color-accent)', color: 'white',
                      fontSize: '0.6rem', fontWeight: 700,
                    }}>
                      S-S
                    </span>
                    Segunda a Sexta (R$)
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    style={{ width: 150 }}
                    step="5"
                    value={config.diaria.weekday}
                    onChange={e => updateDiaria('weekday', Number(e.target.value))}
                  />
                  <span className="text-muted" style={{ fontSize: '0.65rem', marginTop: 4, display: 'block' }}>
                    Turno padrão de 6 horas
                  </span>
                </div>

                {/* Sábado */}
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                      background: '#7c3aed', color: 'white',
                      fontSize: '0.6rem', fontWeight: 700,
                    }}>
                      SÁB
                    </span>
                    Sábado (R$)
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    style={{ width: 150 }}
                    step="5"
                    value={config.diaria.saturday}
                    onChange={e => updateDiaria('saturday', Number(e.target.value))}
                  />
                </div>

                {/* Domingo */}
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                      background: '#E55C00', color: 'white',
                      fontSize: '0.6rem', fontWeight: 700,
                    }}>
                      DOM
                    </span>
                    Domingo (R$)
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    style={{ width: 150 }}
                    step="5"
                    value={config.diaria.sunday}
                    onChange={e => updateDiaria('sunday', Number(e.target.value))}
                  />
                </div>

                {/* Feriados */}
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                      background: '#d97706', color: 'white',
                      fontSize: '0.6rem', fontWeight: 700,
                    }}>
                      FER
                    </span>
                    Feriados (R$)
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    style={{ width: 150 }}
                    step="5"
                    value={config.diaria.holiday}
                    onChange={e => updateDiaria('holiday', Number(e.target.value))}
                  />
                  <span className="text-muted" style={{ fontSize: '0.65rem', marginTop: 4, display: 'block' }}>
                    Valor pré-definido pelo gestor para feriados
                  </span>
                </div>
              </div>

              {/* Preview visual */}
              <div style={{
                background: 'rgba(229, 92, 0, 0.05)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-md)',
                marginTop: 'var(--space-md)',
              }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: 'var(--space-sm)', color: 'var(--color-text-secondary)' }}>
                  Exemplo — Semana completa (7 dias):
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                  {['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map(day => (
                    <div key={day} style={{
                      textAlign: 'center', padding: '6px 10px',
                      background: 'white', borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-border)',
                      minWidth: 55,
                    }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>{day}</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-accent)' }}>
                        R$ {config.diaria.weekday}
                      </div>
                    </div>
                  ))}
                  <div style={{
                    textAlign: 'center', padding: '6px 10px',
                    background: '#f5f3ff', borderRadius: 'var(--radius-sm)',
                    border: '1px solid #7c3aed30',
                    minWidth: 55,
                  }}>
                    <div style={{ fontSize: '0.6rem', color: '#7c3aed', fontWeight: 600 }}>Sáb</div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed' }}>
                      R$ {config.diaria.saturday}
                    </div>
                  </div>
                  <div style={{
                    textAlign: 'center', padding: '6px 10px',
                    background: '#FFF7F0', borderRadius: 'var(--radius-sm)',
                    border: '1px solid #E55C0030',
                    minWidth: 55,
                  }}>
                    <div style={{ fontSize: '0.6rem', color: '#E55C00', fontWeight: 600 }}>Dom</div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#E55C00' }}>
                      R$ {config.diaria.sunday}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 'var(--space-sm)', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                  Total estimado por motoboy (7 dias): <strong style={{ color: 'var(--color-accent)' }}>{formatBRL(weeklyExample)}</strong>
                </div>
              </div>
            </div>

            {/* ─── Gerenciamento de Turnos ─── */}
            <div className="card mt-md">
              <div className="card-header">
                <h2 className="card-title">Turnos Múltiplos (Opcional)</h2>
              </div>
              <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-md)' }}>
                Se a operação da loja for dividida (Ex: Almoço e Jantar), adicione os turnos abaixo com seus respectivos valores de garantido mínimo. Se não houver turnos, o garantido é calculado pelo dia inteiro.
              </p>

              {(config.turnos || []).map((t, index) => {
                const turnoWeeklyEstimate = (t.diaria.weekday * 5) + t.diaria.saturday + t.diaria.sunday;
                return (
                <div key={t.id} style={{ marginBottom: 16, padding: '16px 20px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                  {/* Header do Turno */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 32, height: 32, borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-primary)', color: 'white',
                        fontSize: '0.7rem', fontWeight: 700,
                      }}>T{index + 1}</span>
                      <input 
                        className="form-input" 
                        value={t.nome} 
                        onChange={e => {
                          const arr = [...(config.turnos || [])];
                          arr[index].nome = e.target.value;
                          setConfig({ ...config, turnos: arr });
                          setSaved(false);
                        }} 
                        placeholder="Ex: Almoço" 
                        style={{ width: 180, fontWeight: 600 }} 
                      />
                    </div>
                    <button className="btn btn-secondary" style={{color: '#CC5200', border: '1px solid #FFF0E5', background: '#FFF7F0', fontSize: '0.7rem', padding: '4px 12px'}} onClick={() => {
                      const newTurnos = config.turnos!.filter((_, i) => i !== index);
                      setConfig({ ...config, turnos: newTurnos });
                      setSaved(false);
                    }}>
                      ✕ Remover
                    </button>
                  </div>

                  {/* Horário */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 4 }}>Horário de Operação</label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input className="form-input" type="time" value={t.startTime} onChange={e => {
                        const arr = [...(config.turnos || [])];
                        arr[index].startTime = e.target.value;
                        setConfig({ ...config, turnos: arr });
                        setSaved(false);
                      }} />
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>até</span>
                      <input className="form-input" type="time" value={t.endTime} onChange={e => {
                        const arr = [...(config.turnos || [])];
                        arr[index].endTime = e.target.value;
                        setConfig({ ...config, turnos: arr });
                        setSaved(false);
                      }} />
                    </div>
                  </div>

                  {/* Valores de Garantido por dia — layout rico */}
                  <label style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 8 }}>Garantido Mínimo deste Turno (R$)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-sm)' }}>
                    {/* Seg-Sex */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 24, height: 24, borderRadius: 'var(--radius-sm)',
                          background: 'var(--color-accent)', color: 'white',
                          fontSize: '0.55rem', fontWeight: 700,
                        }}>S-S</span>
                        Seg-Sex
                      </label>
                      <input className="form-input" type="number" step="0.5" value={t.diaria.weekday} onChange={e => {
                        const arr = [...(config.turnos || [])];
                        arr[index].diaria.weekday = parseFloat(e.target.value) || 0;
                        setConfig({ ...config, turnos: arr });
                        setSaved(false);
                      }} style={{width: '100%'}} placeholder="0" />
                    </div>
                    {/* Sábado */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 24, height: 24, borderRadius: 'var(--radius-sm)',
                          background: '#7c3aed', color: 'white',
                          fontSize: '0.55rem', fontWeight: 700,
                        }}>SÁB</span>
                        Sábado
                      </label>
                      <input className="form-input" type="number" step="0.5" value={t.diaria.saturday} onChange={e => {
                        const arr = [...(config.turnos || [])];
                        arr[index].diaria.saturday = parseFloat(e.target.value) || 0;
                        setConfig({ ...config, turnos: arr });
                        setSaved(false);
                      }} style={{width: '100%'}} placeholder="0" />
                    </div>
                    {/* Domingo */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 24, height: 24, borderRadius: 'var(--radius-sm)',
                          background: '#E55C00', color: 'white',
                          fontSize: '0.55rem', fontWeight: 700,
                        }}>DOM</span>
                        Domingo
                      </label>
                      <input className="form-input" type="number" step="0.5" value={t.diaria.sunday} onChange={e => {
                        const arr = [...(config.turnos || [])];
                        arr[index].diaria.sunday = parseFloat(e.target.value) || 0;
                        setConfig({ ...config, turnos: arr });
                        setSaved(false);
                      }} style={{width: '100%'}} placeholder="0" />
                    </div>
                  </div>

                  {/* Preview visual semanal do turno */}
                  <div style={{
                    background: 'rgba(37,99,235,0.05)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px',
                    marginTop: 10,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map(day => (
                        <span key={day} style={{
                          fontSize: '0.6rem', padding: '2px 6px', borderRadius: 4,
                          background: 'white', border: '1px solid var(--color-border)',
                          color: 'var(--color-accent)', fontWeight: 600,
                        }}>
                          {day}: R$ {t.diaria.weekday}
                        </span>
                      ))}
                      <span style={{
                        fontSize: '0.6rem', padding: '2px 6px', borderRadius: 4,
                        background: '#f5f3ff', border: '1px solid #7c3aed30',
                        color: '#7c3aed', fontWeight: 600,
                      }}>
                        Sáb: R$ {t.diaria.saturday}
                      </span>
                      <span style={{
                        fontSize: '0.6rem', padding: '2px 6px', borderRadius: 4,
                        background: '#FFF7F0', border: '1px solid #E55C0030',
                        color: '#E55C00', fontWeight: 600,
                      }}>
                        Dom: R$ {t.diaria.sunday}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      Semana: <strong style={{ color: 'var(--color-accent)' }}>{formatBRL(turnoWeeklyEstimate)}</strong>
                    </span>
                  </div>
                </div>
                );
              })}

              <button className="btn btn-secondary" style={{fontSize: '0.75rem', marginTop: 8}} onClick={() => {
                const newTurnos = [...(config.turnos || [])];
                const baseId = `turno_${Date.now().toString(36)}`;
                newTurnos.push({
                  id: baseId,
                  nome: `Turno ${newTurnos.length + 1}`,
                  startTime: '10:00',
                  endTime: '16:00',
                  diaria: { ...config.diaria }
                });
                setConfig({ ...config, turnos: newTurnos });
                setSaved(false);
              }}>
                + Adicionar Turno
              </button>
            </div>

            {/* ─── ADMIN ONLY: Extras por Km ─── */}
            {isAdmin && (
              <div className="card mt-md">
                <div className="card-header">
                  <h2 className="card-title">Extras por Km Excedente</h2>
                </div>

                <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-md)' }}>
                  Define se a loja paga extra para corridas acima do km mínimo.
                </p>

                <div className="form-group">
                  <label className="form-label">Modo de Cobrança</label>
                  <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                    {[
                      { mode: 'disabled' as const, label: 'Desativado', desc: 'Não paga extra' },
                      { mode: 'fixed' as const, label: 'Valor Fixo', desc: 'Ex: +R$3 por km excedente' },
                      { mode: 'delivery_fee' as const, label: 'Taxa de Entrega', desc: 'Cobra outra taxa de entrega como extra' },
                    ].map(opt => (
                      <button
                        key={opt.mode}
                        className={`btn ${config.extraKm.mode === opt.mode ? '' : 'btn-secondary'}`}
                        style={config.extraKm.mode === opt.mode ? { background: 'var(--color-accent)', color: 'white', border: 'none' } : {}}
                        onClick={() => setConfig({ ...config, extraKm: { ...config.extraKm, mode: opt.mode } })}
                      >
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.75rem' }}>{opt.label}</div>
                          <div style={{ fontSize: '0.6rem', opacity: 0.8 }}>{opt.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {config.extraKm.mode !== 'disabled' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
                    <div className="form-group">
                      <label className="form-label">Km mínimo</label>
                      <input
                        type="number"
                        className="form-input"
                        style={{ width: 120 }}
                        step="1"
                        value={config.extraKm.minKm}
                        onChange={e => setConfig({ ...config, extraKm: { ...config.extraKm, minKm: Number(e.target.value) } })}
                      />
                      <span className="text-muted" style={{ fontSize: '0.65rem', display: 'block', marginTop: 4 }}>
                        Corridas acima deste km geram extra
                      </span>
                    </div>

                    {config.extraKm.mode === 'fixed' && (
                      <div className="form-group">
                        <label className="form-label">Valor fixo do extra (R$)</label>
                        <input
                          type="number"
                          className="form-input"
                          style={{ width: 120 }}
                          step="0.50"
                          value={config.extraKm.fixedAmount}
                          onChange={e => setConfig({ ...config, extraKm: { ...config.extraKm, fixedAmount: Number(e.target.value) } })}
                        />
                      </div>
                    )}

                    {config.extraKm.mode === 'delivery_fee' && (
                      <div className="form-group">
                        <label className="form-label">Valor extra = taxa de entrega</label>
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-accent)', padding: '8px 0' }}>
                          {formatBRL(config.taxaCorridaPerEntrega)}
                        </div>
                        <span className="text-muted" style={{ fontSize: '0.65rem' }}>
                          Usa o mesmo valor da taxa de corrida configurada acima
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ─── BOTH: Crédito Automático de Diárias ─── */}
            {(
              <div className="card mt-md">
                <div className="card-header">
                  <h2 className="card-title">Crédito Automático de Diárias</h2>
                </div>

                <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-md)' }}>
                  Quando ativado, o sistema credita automaticamente na carteira Machine do condutor no horário de corte.
                  <br />
                  <strong>Garantia Mínima:</strong> Deposita apenas o complemento: <code style={{fontSize: '0.65rem'}}>max(Produção+Extras, Diária) − Produção − Adiantamentos</code><br />
                  <strong>Produção Padrão:</strong> Deposita o valor enfileirado integral: <code style={{fontSize: '0.65rem'}}>Diária + Extras − Adiantamentos</code>
                </p>

                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <input
                      type="checkbox"
                      checked={config.autoCredit.enabled}
                      onChange={e => setConfig({ ...config, autoCredit: { ...config.autoCredit, enabled: e.target.checked } })}
                      style={{ width: 18, height: 18 }}
                    />
                    <span style={{ fontWeight: 600 }}>
                      {config.autoCredit.enabled ? 'Ativado' : 'Desativado'}
                    </span>
                  </label>
                </div>

                {config.autoCredit.enabled && (
                  <>
                    <div className="form-group mt-sm">
                      <label className="form-label">Regra de Cálculo Automático</label>
                      <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                        {[
                          { mode: 'garantida' as const, label: 'Modo Garantida', desc: 'Deposita apenas o complemento para atingir o valor do dia.' },
                          { mode: 'producao' as const, label: 'Modo Produção Padrão', desc: 'Deposita o valor integral sem deduzir a produção.' },
                        ].map(opt => (
                          <button
                            key={opt.mode}
                            className={`btn ${config.autoCredit.mode === opt.mode ? '' : 'btn-secondary'}`}
                            style={config.autoCredit.mode === opt.mode ? { background: 'var(--color-accent)', color: 'white', border: 'none' } : {}}
                            onClick={() => setConfig({ ...config, autoCredit: { ...config.autoCredit, mode: opt.mode } })}
                          >
                            <div style={{ textAlign: 'left' }}>
                              <div style={{ fontWeight: 600, fontSize: '0.75rem' }}>{opt.label}</div>
                              <div style={{ fontSize: '0.6rem', opacity: 0.8 }}>{opt.desc}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginTop: 'var(--space-sm)' }}>
                    <div className="form-group">
                      <label className="form-label">Horário de corte</label>
                      <div className="flex items-center gap-sm">
                        <input
                          type="number"
                          className="form-input"
                          style={{ width: 70 }}
                          min="0" max="23"
                          value={config.autoCredit.cutoffHour}
                          onChange={e => setConfig({ ...config, autoCredit: { ...config.autoCredit, cutoffHour: Number(e.target.value) } })}
                        />
                        <span style={{ fontWeight: 700 }}>:</span>
                        <input
                          type="number"
                          className="form-input"
                          style={{ width: 70 }}
                          min="0" max="59" step="15"
                          value={config.autoCredit.cutoffMinute}
                          onChange={e => setConfig({ ...config, autoCredit: { ...config.autoCredit, cutoffMinute: Number(e.target.value) } })}
                        />
                      </div>
                      <span className="text-muted" style={{ fontSize: '0.65rem', display: 'block', marginTop: 4 }}>
                        Créditos são processados no dia seguinte à diária trabalhada
                      </span>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Descrição do crédito</label>
                      <input
                        type="text"
                        className="form-input"
                        value={config.autoCredit.creditDescription}
                        onChange={e => setConfig({ ...config, autoCredit: { ...config.autoCredit, creditDescription: e.target.value } })}
                      />
                      <span className="text-muted" style={{ fontSize: '0.65rem', display: 'block', marginTop: 4 }}>
                        Use {'{date}'} e {'{company}'} como variáveis
                      </span>
                    </div>
                  </div>
                  </>
                )}

                <div style={{
                  background: config.autoCredit.enabled ? 'rgba(22, 163, 74, 0.08)' : 'rgba(0,0,0,0.03)',
                  borderRadius: 'var(--radius-md)', padding: 'var(--space-sm)',
                  fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginTop: 'var(--space-sm)',
                }}>
                  {config.autoCredit.enabled ? (
                    <>Créditos serão processados automaticamente às <strong>{String(config.autoCredit.cutoffHour).padStart(2, '0')}:{String(config.autoCredit.cutoffMinute).padStart(2, '0')}</strong> do dia seguinte.</>
                  ) : (
                    <>Auto-crédito desativado — créditos devem ser processados manualmente na tela Financeiro.</>
                  )}
                </div>
              </div>
            )}

            {/* ─── ADMIN ONLY: Taxa de Supervisão & Débito Pendente ─── */}
            {isAdmin && (
              <div className="card mt-md">
                <div className="card-header">
                  <h2 className="card-title">Taxa de Supervisão & Débito Pendente</h2>
                  <span className="badge badge-info">{activeCompanyName}</span>
                </div>

                <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-md)' }}>
                  A taxa de supervisão é calculada como percentual sobre o total da tabela de motoboys.
                  O débito pendente representa valores que a loja está devendo à central.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                  <div className="form-group">
                    <label className="form-label">Taxa de Supervisão (R$)</label>
                    <input
                      type="number"
                      className="form-input"
                      style={{ width: 150 }}
                      step="10"
                      min="0"
                      value={config.taxaSupervisao}
                      onChange={e => updateField('taxaSupervisao', Number(e.target.value))}
                    />
                    <span className="text-muted" style={{ fontSize: '0.65rem', marginTop: 4, display: 'block' }}>
                      Valor fixo cobrado pela central. 0 = sem taxa.
                    </span>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Débito Pendente (R$)</label>
                    <input
                      type="number"
                      className="form-input"
                      style={{ width: 150 }}
                      step="10"
                      min="0"
                      value={config.debitoPendente}
                      onChange={e => updateField('debitoPendente', Number(e.target.value))}
                    />
                    <span className="text-muted" style={{ fontSize: '0.65rem', marginTop: 4, display: 'block' }}>
                      Valor que a loja deve à central. Aparece no relatório.
                    </span>
                  </div>
                </div>

                <div style={{
                  background: 'rgba(229, 92, 0, 0.05)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-sm)',
                  fontSize: '0.7rem',
                  color: 'var(--color-text-secondary)',
                  marginTop: 'var(--space-sm)',
                }}>
                  Supervisão: <strong>{formatBRL(config.taxaSupervisao)}</strong> | Débito: <strong>{formatBRL(config.debitoPendente)}</strong>
                </div>
              </div>
            )}

            {/* Botão Salvar */}
            <div className="flex justify-between items-center mt-lg">
              <p className="text-muted" style={{ fontSize: '0.7rem', fontStyle: 'italic' }}>
                Alterações atuam no relatório em tempo real após salvar.
              </p>
              <button className="btn btn-primary" onClick={handleSave} style={{ padding: '8px 24px', fontSize: '0.85rem' }}>
                 Salvar Configurações
              </button>
            </div>
          </>
        )}

        {/* ─── ADMIN ONLY: Webhook URL Configuration ─── */}
        {/* ─── Platform Settings (White-Label + Setup Tasks) ─── */}
        {isAdmin && <PlatformSettingsPanel />}

        {/* ─── Webhook Config ─── */}
        {isAdmin && (
          <div className="card mt-md" style={{ borderLeft: '3px solid var(--color-accent)' }}>
            <div className="card-header">
              <h2 className="card-title">Webhooks de Tempo Real (Machine API)</h2>
              {webhookSaved && (
                <span className="badge badge-success">Registrado</span>
              )}
            </div>

            <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-md)' }}>
              Registre os webhooks para receber atualizacoes de <strong>status das corridas</strong> e <strong>posicao dos motoboys</strong> em tempo real.
              A URL sera detectada automaticamente a partir do seu dominio atual, ou voce pode especificar manualmente.
            </p>

            <div className="form-group">
              <label className="form-label">URL Base da Plataforma</label>
              <div className="flex items-center gap-sm">
                <input
                  type="url"
                  className="form-input"
                  placeholder={typeof window !== 'undefined' ? window.location.origin : 'https://seu-dominio.com'}
                  value={webhookUrl}
                  onChange={e => setWebhookUrl(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleRegisterWebhook}
                  disabled={webhookRegistering}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {webhookRegistering ? 'Registrando...' : 'Registrar Webhooks'}
                </button>
              </div>
              <span className="text-muted" style={{ fontSize: '0.65rem', display: 'block', marginTop: 4 }}>
                Deixe em branco para usar o dominio atual. Precisa ser HTTPS e acessivel publicamente.
              </span>
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)',
              marginTop: 'var(--space-sm)',
            }}>
              <div style={{
                background: 'rgba(22, 163, 74, 0.06)', borderRadius: 'var(--radius-md)',
                padding: 'var(--space-sm)', fontSize: '0.7rem',
              }}>
                <strong style={{ color: '#16a34a' }}>Status Webhook</strong><br />
                <code style={{ fontSize: '0.6rem' }}>/api/webhook/status</code><br />
                <span className="text-muted" style={{ fontSize: '0.6rem' }}>
                  Recebe: aceite, em andamento, finalizada, cancelada
                </span>
              </div>
              <div style={{
                background: 'rgba(14, 116, 144, 0.06)', borderRadius: 'var(--radius-md)',
                padding: 'var(--space-sm)', fontSize: '0.7rem',
              }}>
                <strong style={{ color: '#0e7490' }}>Posicao Webhook</strong><br />
                <code style={{ fontSize: '0.6rem' }}>/api/webhook/posicao</code><br />
                <span className="text-muted" style={{ fontSize: '0.6rem' }}>
                  Recebe: GPS do motoboy a cada 15s durante corrida
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
