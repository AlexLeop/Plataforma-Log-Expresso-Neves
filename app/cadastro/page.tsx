'use client';

import { useState, useCallback } from 'react';
import { LockIcon, CheckCircleIcon, InfoIcon } from '../components/icons';

interface FormData {
  nome_fantasia: string;
  documento: string;
  telefone: string;
  email: string;
  password: string;
  cep: string;
  endereco: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  lat: string;
  lng: string;
  website: string; // honeypot field
}

const INITIAL_FORM: FormData = {
  nome_fantasia: '',
  documento: '',
  telefone: '',
  email: '',
  password: '',
  cep: '',
  endereco: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  lat: '',
  lng: '',
  website: '', // honeypot
};

// ─── Formatters ───────────────────────────────────────────────
function formatCNPJ(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 10) {
    return digits.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  }
  return digits.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
}

function formatCEP(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits.replace(/^(\d{5})(\d)/, '$1-$2');
}

function validateCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  let sum = 0;
  let weight = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (let i = 0; i < 12; i++) sum += parseInt(digits[i]) * weight[i];
  let rem = sum % 11;
  if (parseInt(digits[12]) !== (rem < 2 ? 0 : 11 - rem)) return false;

  sum = 0;
  weight = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (let i = 0; i < 13; i++) sum += parseInt(digits[i]) * weight[i];
  rem = sum % 11;
  if (parseInt(digits[13]) !== (rem < 2 ? 0 : 11 - rem)) return false;

  return true;
}

// ─── Shared Style Constants (matching login page) ─────────────
const COLORS = {
  bg: 'linear-gradient(135deg, #1A1A1A 0%, #2A2A2A 50%, #333333 100%)',
  accent: '#E55C00',
  accentGradient: 'linear-gradient(135deg, #E55C00, #CC5200)',
  inputBorder: '#E5E5E5',
  inputBg: '#F9F9F9',
  cardBg: 'rgba(255,255,255,0.96)',
  textDark: '#333333',
  textMuted: '#999999',
  textLabel: '#666666',
  white: '#fff',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  border: `2px solid ${COLORS.inputBorder}`,
  borderRadius: '10px',
  fontSize: '0.88rem',
  color: COLORS.textDark,
  background: COLORS.inputBg,
  outline: 'none',
  transition: 'border-color 0.2s',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.7rem',
  fontWeight: 700,
  color: COLORS.textLabel,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: '5px',
};

export default function CadastroPage() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingCep, setLoadingCep] = useState(false);
  const [cnpjError, setCnpjError] = useState<string | null>(null);
  const [contractNumber, setContractNumber] = useState<string | null>(null);

  const updateField = useCallback((field: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (field === 'documento') setCnpjError(null);
  }, []);

  // ─── CEP Lookup ────────────────────────────────────────────
  const lookupCEP = useCallback(async (cep: string) => {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) return;

    setLoadingCep(true);
    try {
      const viaRes = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (viaRes.ok) {
        const data = await viaRes.json();
        if (!data.erro) {
          setForm(prev => ({
            ...prev,
            endereco: data.logradouro || prev.endereco,
            bairro: data.bairro || prev.bairro,
            cidade: data.localidade || prev.cidade,
            uf: data.uf || prev.uf,
          }));
        }
      }

      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?postalcode=${digits}&country=BR&format=json&limit=1`,
          { headers: { 'User-Agent': 'NevesGo/1.0' } }
        );
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData.length > 0) {
            setForm(prev => ({
              ...prev,
              lat: geoData[0].lat,
              lng: geoData[0].lon,
            }));
          }
        }
      } catch {
        // Geocoding is best-effort
      }
    } catch {
      // CEP lookup failed silently
    } finally {
      setLoadingCep(false);
    }
  }, []);

  // ─── Submit ────────────────────────────────────────────────
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateCNPJ(form.documento)) {
      setCnpjError('CNPJ inválido. Verifique os dígitos.');
      return;
    }

    // Validate email
    if (!form.email || !form.email.includes('@')) {
      setError('Informe um e-mail válido.');
      return;
    }
    if (!form.password || form.password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccess(true);
        setContractNumber(data.numero_contrato);
      } else {
        const msg = data?.details?.errors?.[0]?.message
          || data?.error
          || 'Erro ao cadastrar. Tente novamente.';
        setError(msg);
      }
    } catch {
      setError('Erro de conexão. Verifique sua internet e tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }, [form]);

  // ─── Success Screen ────────────────────────────────────────
  if (success) {
    return (
      <div className="login-container">
        {/* Left Branding Panel */}
        <BrandingPanel />

        {/* Right Success Card */}
        <div className="login-card-wrapper" style={{ width: '520px' }}>
          <div className="login-card" style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: '16px' }}><CheckCircleIcon size={48} color="#16a34a" /></div>
            <h2 style={{
              fontSize: '1.5rem',
              fontWeight: 800,
              color: COLORS.textDark,
              letterSpacing: '-0.03em',
              marginBottom: '8px',
            }}>
              Cadastro Realizado!
            </h2>
            <p style={{ fontSize: '0.9rem', color: COLORS.textMuted, marginBottom: '24px' }}>
              Sua empresa <strong style={{ color: COLORS.textDark }}>{form.nome_fantasia}</strong> foi cadastrada com sucesso.
            </p>

            {contractNumber && (
              <div style={{
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'center',
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '12px',
                padding: '12px 28px',
                marginBottom: '20px',
              }}>
                <span style={{
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  color: COLORS.accent,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                }}>
                  Nº Contrato
                </span>
                <span style={{
                  fontSize: '1.6rem',
                  fontWeight: 800,
                  color: COLORS.accent,
                  fontFamily: "monospace",
                }}>
                  {contractNumber}
                </span>
              </div>
            )}

            <div style={{
              padding: '12px 16px',
              borderRadius: '10px',
              background: '#F0FDF4',
              border: '1px solid #BBF7D0',
              color: '#166534',
              fontSize: '0.82rem',
              lineHeight: 1.6,
              marginBottom: '16px',
              textAlign: 'left',
            }}>
              <strong><CheckCircleIcon size={14} color="#16a34a" style={{ verticalAlign: '-2px', marginRight: 4 }} /> Você já pode fazer login</strong> com o e-mail e senha que cadastrou.
              Sua empresa ficará <strong>pendente de ativação</strong> pelo administrador.
            </div>

            <p style={{
              fontSize: '0.78rem',
              color: COLORS.textMuted,
              lineHeight: 1.6,
              marginBottom: '24px',
            }}>
              Assim que a ativação for concluída, o painel estará totalmente operacional para solicitar entregas.
            </p>

            <a
              href="/login"
              style={{
                display: 'inline-block',
                padding: '12px 32px',
                background: COLORS.accentGradient,
                color: 'white',
                borderRadius: '10px',
                textDecoration: 'none',
                fontWeight: 700,
                fontSize: '0.88rem',
                boxShadow: '0 4px 14px rgba(220, 38, 38, 0.35)',
              }}
            >
              ← Ir para o Login
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ─── Registration Form ────────────────────────────────────
  return (
    <div className="login-container">
      {/* Left Branding Panel */}
      <BrandingPanel />

      {/* Right Form Panel */}
      <div className="login-card-wrapper" style={{ width: '520px', overflowY: 'auto' }}>
        <div className="login-card">
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <h2 style={{
              fontSize: '1.3rem',
              fontWeight: 800,
              color: COLORS.textDark,
              letterSpacing: '-0.03em',
            }}>
              Cadastro de Empresa
            </h2>
            <p style={{
              fontSize: '0.8rem',
              color: COLORS.textMuted,
              marginTop: '4px',
            }}>
              Preencha os dados para se tornar parceiro
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Section: Acesso ao Painel */}
            <div style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              color: COLORS.accent,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              marginBottom: '12px',
              paddingBottom: '6px',
              borderBottom: '1px solid #E5E5E5',
            }}>
              <LockIcon size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} /> Acesso ao Painel
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>E-mail *</label>
              <input
                type="email"
                value={form.email}
                onChange={e => updateField('email', e.target.value)}
                placeholder="seu@email.com"
                required
                autoComplete="email"
                style={inputStyle}
                onFocus={e => e.currentTarget.style.borderColor = COLORS.accent}
                onBlur={e => e.currentTarget.style.borderColor = COLORS.inputBorder}
              />
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label style={labelStyle}>Senha *</label>
              <input
                type="password"
                value={form.password}
                onChange={e => updateField('password', e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                minLength={6}
                autoComplete="new-password"
                style={inputStyle}
                onFocus={e => e.currentTarget.style.borderColor = COLORS.accent}
                onBlur={e => e.currentTarget.style.borderColor = COLORS.inputBorder}
              />
            </div>

            {/* Section: Empresa */}
            <div style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              color: COLORS.accent,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              marginBottom: '12px',
              paddingBottom: '6px',
              borderBottom: '1px solid #E5E5E5',
            }}>
              Dados da Empresa
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Nome Fantasia *</label>
              <input
                type="text"
                value={form.nome_fantasia}
                onChange={e => updateField('nome_fantasia', e.target.value)}
                placeholder="Ex: Restaurante Sabor Brasil"
                required
                style={inputStyle}
                onFocus={e => e.currentTarget.style.borderColor = COLORS.accent}
                onBlur={e => e.currentTarget.style.borderColor = COLORS.inputBorder}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
              <div>
                <label style={labelStyle}>CNPJ *</label>
                <input
                  type="text"
                  value={form.documento}
                  onChange={e => updateField('documento', formatCNPJ(e.target.value))}
                  placeholder="00.000.000/0001-00"
                  required
                  style={{
                    ...inputStyle,
                    ...(cnpjError ? { borderColor: '#CC5200' } : {}),
                  }}
                  maxLength={18}
                  onFocus={e => e.currentTarget.style.borderColor = cnpjError ? '#CC5200' : COLORS.accent}
                  onBlur={e => e.currentTarget.style.borderColor = cnpjError ? '#CC5200' : COLORS.inputBorder}
                />
                {cnpjError && <span style={{ fontSize: '0.68rem', color: '#CC5200', fontWeight: 500 }}>{cnpjError}</span>}
              </div>
              <div>
                <label style={labelStyle}>Telefone *</label>
                <input
                  type="tel"
                  value={form.telefone}
                  onChange={e => updateField('telefone', formatPhone(e.target.value))}
                  placeholder="(21) 99999-9999"
                  required
                  style={inputStyle}
                  maxLength={15}
                  onFocus={e => e.currentTarget.style.borderColor = COLORS.accent}
                  onBlur={e => e.currentTarget.style.borderColor = COLORS.inputBorder}
                />
              </div>
            </div>

            {/* Section: Endereço */}
            <div style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              color: COLORS.accent,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              marginBottom: '12px',
              marginTop: '20px',
              paddingBottom: '6px',
              borderBottom: '1px solid #E5E5E5',
            }}>
              Endereço
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '12px', marginBottom: '14px' }}>
              <div style={{ position: 'relative' }}>
                <label style={labelStyle}>CEP</label>
                <input
                  type="text"
                  value={form.cep}
                  onChange={e => {
                    const formatted = formatCEP(e.target.value);
                    updateField('cep', formatted);
                    if (formatted.replace(/\D/g, '').length === 8) {
                      lookupCEP(formatted);
                    }
                  }}
                  placeholder="00000-000"
                  style={inputStyle}
                  maxLength={9}
                  onFocus={e => e.currentTarget.style.borderColor = COLORS.accent}
                  onBlur={e => e.currentTarget.style.borderColor = COLORS.inputBorder}
                />
                {loadingCep && (
                  <span style={{ position: 'absolute', right: 10, top: 30, fontSize: '0.75rem', color: COLORS.accent }}>⏳</span>
                )}
              </div>
              <div>
                <label style={labelStyle}>Endereço</label>
                <input
                  type="text"
                  value={form.endereco}
                  onChange={e => updateField('endereco', e.target.value)}
                  placeholder="Rua, Avenida..."
                  style={inputStyle}
                  onFocus={e => e.currentTarget.style.borderColor = COLORS.accent}
                  onBlur={e => e.currentTarget.style.borderColor = COLORS.inputBorder}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
              <div>
                <label style={labelStyle}>Complemento</label>
                <input
                  type="text"
                  value={form.complemento}
                  onChange={e => updateField('complemento', e.target.value)}
                  placeholder="Sala, Bloco..."
                  style={inputStyle}
                  onFocus={e => e.currentTarget.style.borderColor = COLORS.accent}
                  onBlur={e => e.currentTarget.style.borderColor = COLORS.inputBorder}
                />
              </div>
              <div>
                <label style={labelStyle}>Bairro</label>
                <input
                  type="text"
                  value={form.bairro}
                  onChange={e => updateField('bairro', e.target.value)}
                  placeholder="Bairro"
                  style={inputStyle}
                  onFocus={e => e.currentTarget.style.borderColor = COLORS.accent}
                  onBlur={e => e.currentTarget.style.borderColor = COLORS.inputBorder}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px', gap: '12px', marginBottom: '20px' }}>
              <div>
                <label style={labelStyle}>Cidade</label>
                <input
                  type="text"
                  value={form.cidade}
                  onChange={e => updateField('cidade', e.target.value)}
                  placeholder="Cidade"
                  style={inputStyle}
                  onFocus={e => e.currentTarget.style.borderColor = COLORS.accent}
                  onBlur={e => e.currentTarget.style.borderColor = COLORS.inputBorder}
                />
              </div>
              <div>
                <label style={labelStyle}>UF</label>
                <input
                  type="text"
                  value={form.uf}
                  onChange={e => updateField('uf', e.target.value.toUpperCase())}
                  placeholder="UF"
                  maxLength={2}
                  style={{ ...inputStyle, textAlign: 'center' }}
                  onFocus={e => e.currentTarget.style.borderColor = COLORS.accent}
                  onBlur={e => e.currentTarget.style.borderColor = COLORS.inputBorder}
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                padding: '10px 14px',
                borderRadius: '10px',
                background: '#FFF7F0',
                border: '1px solid #FFD6B3',
                color: '#E55C00',
                fontSize: '0.8rem',
                fontWeight: 500,
                marginBottom: '14px',
                textAlign: 'center',
              }}>
                {error}
              </div>
            )}

            {/* Honeypot — invisible */}
            <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', opacity: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input type="text" id="website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={e => updateField('website', e.target.value)} />
            </div>

            {/* Info */}
            <div style={{
              padding: '10px 14px',
              borderRadius: '10px',
              background: '#FFF7ED',
              border: '1px solid #FED7AA',
              color: '#C2410C',
              fontSize: '0.75rem',
              marginBottom: '18px',
              lineHeight: 1.5,
            }}>
              <strong><InfoIcon size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} /></strong> Após o cadastro, sua empresa ficará <strong>Inativa</strong> até aprovação pelo administrador.
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                padding: '13px',
                border: 'none',
                borderRadius: '10px',
                background: submitting ? '#FCA5A5' : COLORS.accentGradient,
                color: 'white',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: submitting ? 'not-allowed' : 'pointer',
                transition: 'opacity 0.2s',
                boxShadow: '0 4px 14px rgba(220, 38, 38, 0.35)',
              }}
              onMouseEnter={e => { if (!submitting) e.currentTarget.style.opacity = '0.9'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              {submitting ? 'Enviando cadastro...' : 'Cadastrar Empresa'}
            </button>
          </form>

          {/* Footer */}
          <div style={{
            marginTop: '16px',
            textAlign: 'center',
            padding: '12px 0 0',
            borderTop: '1px solid #E5E5E5',
          }}>
            <span style={{ fontSize: '0.8rem', color: COLORS.textMuted }}>
              Já tem cadastro?{' '}
              <a
                href="/login"
                style={{ color: COLORS.accent, fontWeight: 700, textDecoration: 'none' }}
                onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
              >
                Faça login
              </a>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared Branding Panel (matches login page) ─────────────────
function BrandingPanel() {
  return (
    <div className="login-branding">
      <div style={{ marginBottom: '40px' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '14px',
          marginBottom: '32px',
        }}>
          <img src="/favicon.ico" alt="Expresso Neves" style={{
            width: '52px',
            height: '52px',
            borderRadius: '14px',
            objectFit: 'contain',
          }} />
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.03em' }}>
              EXPRESSO NEVES
            </div>
            <div style={{ fontSize: '0.72rem', opacity: 0.6, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              Portal Logístico
            </div>
          </div>
        </div>

        <h1 style={{
          fontSize: '2.6rem',
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacing: '-0.04em',
          marginBottom: '16px',
        }}>
          Cadastre sua<br />
          <span style={{ color: '#E55C00' }}>Empresa</span> Conosco
        </h1>
        <p style={{
          fontSize: '1rem',
          opacity: 0.55,
          lineHeight: 1.6,
          maxWidth: '420px',
        }}>
          Faça parte da nossa rede de parceiros. Cadastre sua empresa e comece a solicitar entregas de forma prática e eficiente.
        </p>
      </div>

      {/* Feature pills */}
      <div className="login-pills" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {['Cadastro Rápido', 'Aprovação em 24h', 'Entregas Sob Demanda', 'Rastreio em Tempo Real'].map(f => (
          <span key={f} style={{
            padding: '6px 14px',
            borderRadius: '20px',
            border: '1px solid rgba(255,255,255,0.12)',
            fontSize: '0.72rem',
            fontWeight: 500,
            color: 'rgba(255,255,255,0.5)',
            background: 'rgba(255,255,255,0.04)',
          }}>
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}
