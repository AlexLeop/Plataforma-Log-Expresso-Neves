'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { EyeIcon, EyeOffIcon } from '../components/icons';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Falha na autenticação');
        return;
      }

      // Store session
      localStorage.setItem('logipay:session', JSON.stringify({
        user: data.user,
        basicAuth: data.basicAuth,
        loginAt: Date.now(),
      }));

      router.push('/');
    } catch {
      setError('Erro de conexão com o servidor');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-container">
      {/* Left Branding Panel */}
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
            Gestão de<br />
            <span style={{ color: '#E55C00' }}>Entregas</span> Inteligente
          </h1>
          <p style={{
            fontSize: '1rem',
            opacity: 0.55,
            lineHeight: 1.6,
            maxWidth: '420px',
          }}>
            Controle financeiro, rastreamento em tempo real e relatórios automatizados para sua operação de logística.
          </p>
        </div>

        {/* Feature pills */}
        <div className="login-pills" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {['Mapa em Tempo Real', 'Relatórios Financeiros', 'Diárias Automáticas', 'API Machine'].map(f => (
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

      {/* Right Login Panel */}
      <div className="login-card-wrapper">
        <div className="login-card">
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <h2 style={{
              fontSize: '1.4rem',
              fontWeight: 800,
              color: '#333333',
              letterSpacing: '-0.03em',
            }}>
              Entrar no Painel
            </h2>
            <p style={{
              fontSize: '0.82rem',
              color: '#999999',
              marginTop: '6px',
            }}>
              Use suas credenciais da Machine
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '18px' }}>
              <label style={{
                display: 'block',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#666666',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: '6px',
              }}>
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                autoComplete="email"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  border: '2px solid #E5E5E5',
                  borderRadius: '10px',
                  fontSize: '0.9rem',
                  color: '#333333',
                  background: '#F9F9F9',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  boxSizing: 'border-box',
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = '#E55C00'}
                onBlur={(e) => e.currentTarget.style.borderColor = '#E5E5E5'}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#666666',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: '6px',
              }}>
                Senha
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  style={{
                    width: '100%',
                    padding: '12px 44px 12px 14px',
                    border: '2px solid #E5E5E5',
                    borderRadius: '10px',
                    fontSize: '0.9rem',
                    color: '#333333',
                    background: '#F9F9F9',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#E55C00'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#E5E5E5'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '1.1rem',
                    color: '#999',
                    padding: '4px',
                    lineHeight: 1,
                  }}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                padding: '10px 14px',
                borderRadius: '10px',
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                color: '#DC2626',
                fontSize: '0.8rem',
                fontWeight: 500,
                marginBottom: '18px',
                textAlign: 'center',
              }}>
                {error}
              </div>
            )}

            <button
              id="login-submit"
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '13px',
                border: 'none',
                borderRadius: '10px',
                background: loading
                  ? '#FFB380'
                  : 'linear-gradient(135deg, #E55C00, #CC5200)',
                color: 'white',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'opacity 0.2s, transform 0.15s',
                boxShadow: '0 4px 14px rgba(229, 92, 0, 0.35)',
              }}
            >
              {loading ? 'Autenticando...' : 'Entrar'}
            </button>
          </form>

          <div style={{
            marginTop: '20px',
            textAlign: 'center',
            padding: '14px',
            borderTop: '1px solid #E5E5E5',
          }}>
            <span style={{ fontSize: '0.8rem', color: '#999999' }}>
              É lojista?{' '}
              <a
                href="/cadastro"
                style={{
                  color: '#E55C00',
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                Cadastre sua empresa
              </a>
            </span>
          </div>

          <div style={{
            marginTop: '12px',
            textAlign: 'center',
            fontSize: '0.7rem',
            color: '#999999',
          }}>
            © {new Date().getFullYear()} Expresso Neves • Portal Logístico
          </div>
        </div>
      </div>
    </div>
  );
}
