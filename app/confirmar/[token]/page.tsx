'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface EntryData {
  id: string;
  date: string;
  shiftLabel: string;
  shiftStart: string;
  shiftEnd: string;
  dailyRate: number;
  status: string;
  confirmedAt: string | null;
}

interface ConfirmData {
  entry: EntryData;
  driver: { id: string; name: string };
  company: { id: string; name: string; address: string | null };
  deadline: string;
  expired: boolean;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  return `${days[date.getDay()]}, ${d}/${m}/${y}`;
}

function formatTime(time: string): string {
  return time.slice(0, 5);
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export default function ConfirmPage() {
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<ConfirmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmTime, setConfirmTime] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/schedules/confirm/${token}`);
        const json = await res.json();

        if (!res.ok) {
          setError(json.error || 'Link inválido');
          return;
        }

        setData(json);

        if (json.entry.status === 'confirmed') {
          setConfirmed(true);
          setConfirmTime(json.entry.confirmedAt);
        }
      } catch {
        setError('Erro ao carregar dados');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  async function handleConfirm() {
    if (!agreed || confirming) return;

    setConfirming(true);
    try {
      const res = await fetch(`/api/schedules/confirm/${token}`, { method: 'POST' });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || 'Erro ao confirmar');
        return;
      }

      setConfirmed(true);
      setConfirmTime(json.confirmedAt);
    } catch {
      setError('Erro de conexão');
    } finally {
      setConfirming(false);
    }
  }

  // ── Branded Header ─────────────────────────────────────────
  function BrandHeader() {
    return (
      <div style={styles.brandHeader}>
        <div style={styles.brandLogo}>
          <img src="/favicon.ico" alt="Expresso Neves" width="28" height="28" style={{ objectFit: 'contain' }} />
        </div>
        <div style={styles.brandText}>
          <span style={styles.brandName}>Expresso Neves</span>
          <span style={styles.brandSub}>Confirmação de Escala</span>
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <BrandHeader />
          <div style={styles.centerContent}>
            <div style={styles.spinner} />
            <p style={styles.loadingText}>Carregando informações...</p>
          </div>
        </div>
        <style>{keyframes}</style>
      </div>
    );
  }

  // ── Error / Invalid ────────────────────────────────────────
  if (error && !data) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <BrandHeader />
          <div style={styles.statusBlock}>
            <div style={{ ...styles.statusIcon, background: 'linear-gradient(135deg, #FEE2E2, #FECACA)' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="1.8">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2 style={styles.statusTitle}>{error}</h2>
            <p style={styles.statusSub}>Verifique o link recebido ou entre em contato com seu supervisor.</p>
          </div>
        </div>
        <style>{keyframes}</style>
      </div>
    );
  }

  if (!data) return null;

  const { entry, driver, company } = data;

  // ── Already Confirmed ──────────────────────────────────────
  if (confirmed) {
    const ct = confirmTime ? new Date(confirmTime) : null;
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <BrandHeader />

          <div style={styles.statusBlock}>
            <div style={{ ...styles.statusIcon, background: 'linear-gradient(135deg, #D1FAE5, #A7F3D0)' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2 style={{ ...styles.statusTitle, color: '#059669' }}>Presença Confirmada!</h2>
            {ct && (
              <p style={styles.statusTimestamp}>
                {ct.toLocaleDateString('pt-BR')} às {ct.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>

          <div style={styles.detailsCard}>
            <DetailRow icon="" label="Motoboy" value={driver.name} />
            <DetailRow icon="" label="Loja" value={company.name} />
            {company.address && <DetailRow icon="" label="Endereço" value={company.address} />}
            <DetailRow icon="" label="Data" value={formatDate(entry.date)} />
            <DetailRow icon="⏰" label="Turno" value={`${entry.shiftLabel} (${formatTime(entry.shiftStart)} — ${formatTime(entry.shiftEnd)})`} />
            <DetailRow icon="" label="Diária" value={formatBRL(entry.dailyRate)} highlight />
          </div>

          <div style={styles.footer}>
            <p style={styles.footerText}>Compareça no horário indicado. Bom trabalho!</p>
          </div>
        </div>
        <style>{keyframes}</style>
      </div>
    );
  }

  // ── Expired ────────────────────────────────────────────────
  if (data.expired) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <BrandHeader />
          <div style={styles.statusBlock}>
            <div style={{ ...styles.statusIcon, background: 'linear-gradient(135deg, #FEF3C7, #FDE68A)' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="1.8">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h2 style={{ ...styles.statusTitle, color: '#D97706' }}>Prazo Expirado</h2>
            <p style={styles.statusSub}>O período para confirmação de presença encerrou. Entre em contato com seu supervisor.</p>
          </div>
        </div>
        <style>{keyframes}</style>
      </div>
    );
  }

  // ── Confirmation Form ──────────────────────────────────────
  const deadlineDate = new Date(data.deadline);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <BrandHeader />

        <div style={styles.greeting}>
          <h1 style={styles.greetingTitle}>Olá, {driver.name}!</h1>
          <p style={styles.greetingSub}>Você foi escalado para o turno abaixo. Confirme sua presença para garantir a vaga.</p>
        </div>

        <div style={styles.detailsCard}>
          <DetailRow icon="" label="Loja" value={company.name} />
          {company.address && <DetailRow icon="" label="Endereço" value={company.address} />}
          <DetailRow icon="" label="Data" value={formatDate(entry.date)} />
          <DetailRow icon="⏰" label="Turno" value={`${entry.shiftLabel} (${formatTime(entry.shiftStart)} — ${formatTime(entry.shiftEnd)})`} />
          <DetailRow icon="" label="Diária" value={formatBRL(entry.dailyRate)} highlight />
        </div>

        <label style={styles.checkboxArea}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            style={styles.checkboxInput}
          />
          <div style={{
            ...styles.checkboxCustom,
            ...(agreed ? { background: '#E8530E', borderColor: '#E8530E' } : {}),
          }}>
            {agreed && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <span style={styles.checkboxText}>
            Eu, <strong>{driver.name}</strong>, confirmo minha presença para o dia e horário indicados.
          </span>
        </label>

        {error && (
          <div style={styles.inlineError}>{error}</div>
        )}

        <button
          style={{
            ...styles.confirmBtn,
            ...((!agreed || confirming) ? styles.confirmBtnDisabled : {}),
          }}
          onClick={handleConfirm}
          disabled={!agreed || confirming}
        >
          {confirming ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
              <span style={{ ...styles.btnSpinner }} /> Confirmando...
            </span>
          ) : (
            '✓  Confirmar Presença'
          )}
        </button>

        <p style={styles.deadline}>
          Confirmação válida até <strong>{deadlineDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong> de <strong>{deadlineDate.toLocaleDateString('pt-BR')}</strong>
        </p>

        <div style={styles.footer}>
          <p style={styles.footerText}>Powered by <strong>Expresso Neves</strong></p>
        </div>
      </div>
      <style>{keyframes}</style>
    </div>
  );
}

// ── Detail Row Component ─────────────────────────────────────
function DetailRow({ icon, label, value, highlight }: { icon: string; label: string; value: string; highlight?: boolean }) {
  return (
    <div style={styles.detailRow}>
      <div style={styles.detailRowLeft}>
        <span style={styles.detailIcon}>{icon}</span>
        <span style={styles.detailLabel}>{label}</span>
      </div>
      <span style={{
        ...styles.detailValue,
        ...(highlight ? { color: '#059669', fontWeight: 700, fontSize: '0.95rem' } : {}),
      }}>
        {value}
      </span>
    </div>
  );
}

// ── Keyframes ────────────────────────────────────────────────
const keyframes = `
  @keyframes cp-spin { to { transform: rotate(360deg); } }
  @keyframes cp-fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes cp-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
`;

// ── Styles ───────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(160deg, #0F172A 0%, #1E293B 40%, #334155 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px 16px',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    background: 'rgba(255, 255, 255, 0.97)',
    borderRadius: '24px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255,255,255,0.1)',
    overflow: 'hidden',
    animation: 'cp-fadeIn 500ms ease-out',
  },

  // Brand Header
  brandHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '20px 24px',
    background: 'linear-gradient(135deg, #FFF7ED, #FFEDD5)',
    borderBottom: '1px solid #FED7AA',
  },
  brandLogo: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    background: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(232, 83, 14, 0.15)',
  },
  brandText: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  brandName: {
    fontSize: '1.05rem',
    fontWeight: 800,
    color: '#1E293B',
    letterSpacing: '-0.3px',
  },
  brandSub: {
    fontSize: '0.72rem',
    color: '#94A3B8',
    fontWeight: 500,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },

  // Center Content (loading)
  centerContent: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 24px',
    gap: '16px',
  },
  spinner: {
    width: '36px',
    height: '36px',
    border: '3px solid #E2E8F0',
    borderTopColor: '#E8530E',
    borderRadius: '50%',
    animation: 'cp-spin 800ms linear infinite',
  },
  loadingText: {
    fontSize: '0.85rem',
    color: '#94A3B8',
    margin: 0,
  },

  // Status Block
  statusBlock: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '40px 24px 24px',
    textAlign: 'center' as const,
  },
  statusIcon: {
    width: '72px',
    height: '72px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '16px',
    animation: 'cp-pulse 2s ease-in-out infinite',
  },
  statusTitle: {
    fontSize: '1.25rem',
    fontWeight: 800,
    color: '#1E293B',
    margin: '0 0 8px',
  },
  statusSub: {
    fontSize: '0.85rem',
    color: '#64748B',
    margin: 0,
    lineHeight: 1.5,
  },
  statusTimestamp: {
    fontSize: '0.78rem',
    color: '#94A3B8',
    margin: 0,
    fontWeight: 500,
  },

  // Greeting
  greeting: {
    padding: '28px 24px 0',
  },
  greetingTitle: {
    fontSize: '1.3rem',
    fontWeight: 800,
    color: '#1E293B',
    margin: '0 0 8px',
    letterSpacing: '-0.3px',
  },
  greetingSub: {
    fontSize: '0.85rem',
    color: '#64748B',
    margin: 0,
    lineHeight: 1.5,
  },

  // Details Card
  detailsCard: {
    margin: '20px 24px',
    background: '#F8FAFC',
    borderRadius: '16px',
    padding: '4px 0',
    border: '1px solid #E2E8F0',
  },
  detailRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #F1F5F9',
  },
  detailRowLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  detailIcon: {
    fontSize: '1rem',
  },
  detailLabel: {
    fontSize: '0.78rem',
    color: '#94A3B8',
    fontWeight: 500,
  },
  detailValue: {
    fontSize: '0.82rem',
    color: '#1E293B',
    fontWeight: 600,
    textAlign: 'right' as const,
    maxWidth: '55%',
  },

  // Checkbox
  checkboxArea: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '0 24px 16px',
    cursor: 'pointer',
  },
  checkboxInput: {
    display: 'none',
  },
  checkboxCustom: {
    width: '22px',
    height: '22px',
    minWidth: '22px',
    borderRadius: '6px',
    border: '2px solid #CBD5E1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '2px',
    transition: 'all 200ms',
  },
  checkboxText: {
    fontSize: '0.8rem',
    color: '#475569',
    lineHeight: 1.5,
  },

  // Inline Error
  inlineError: {
    margin: '0 24px 12px',
    padding: '10px 14px',
    background: '#FEF2F2',
    borderRadius: '10px',
    fontSize: '0.78rem',
    color: '#DC2626',
    fontWeight: 600,
    border: '1px solid #FECACA',
  },

  // Confirm Button
  confirmBtn: {
    display: 'block',
    width: 'calc(100% - 48px)',
    margin: '0 24px 12px',
    padding: '16px',
    borderRadius: '14px',
    border: 'none',
    background: 'linear-gradient(135deg, #E8530E, #EA580C, #F97316)',
    color: 'white',
    fontSize: '0.95rem',
    fontWeight: 800,
    fontFamily: "'Inter', sans-serif",
    cursor: 'pointer',
    transition: 'all 200ms',
    letterSpacing: '0.3px',
    boxShadow: '0 4px 12px rgba(232, 83, 14, 0.35)',
  },
  confirmBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  btnSpinner: {
    width: '16px',
    height: '16px',
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: 'white',
    borderRadius: '50%',
    animation: 'cp-spin 800ms linear infinite',
    display: 'inline-block',
  },

  // Deadline
  deadline: {
    fontSize: '0.72rem',
    color: '#94A3B8',
    textAlign: 'center' as const,
    padding: '0 24px 8px',
    margin: 0,
  },

  // Footer
  footer: {
    padding: '14px 24px',
    borderTop: '1px solid #F1F5F9',
    textAlign: 'center' as const,
  },
  footerText: {
    fontSize: '0.68rem',
    color: '#CBD5E1',
    margin: 0,
  },
};
