'use client';

import { usePathname } from 'next/navigation';
import { useAppContext } from '../context/AppContext';
import { MenuIcon } from './icons';

const pageTitles: Record<string, string> = {
  '/': 'Operations Hub',
  '/corridas': 'Corridas',
  '/lancamentos': 'Lançamentos',
  '/motoboys': 'Motoboys',
  '/relatorios': 'Relatórios',
  '/financeiro': 'Financeiro',
  '/snapshots': 'Snapshots',
  '/configuracoes': 'Configurações',
  '/usuarios': 'Usuários',
  '/empresas': 'Empresas',
  '/sync': 'Sincronização',
  '/escala': 'Escala',
};

// Lojista sees simpler titles
const lojistaTitles: Record<string, string> = {
  '/': 'Painel de Operações',
};

// ── SVG Icons ──────────────────────────────────────────────


const BuildingIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" /><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M12 6h.01" /><path d="M12 10h.01" /><path d="M12 14h.01" /><path d="M16 10h.01" /><path d="M16 14h.01" /><path d="M8 10h.01" /><path d="M8 14h.01" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

interface TopBarProps {
  onMenuToggle?: () => void;
}

export default function TopBar({ onMenuToggle }: TopBarProps) {
  const pathname = usePathname();
  const {
    isAdmin,
    userName,
    userRole,
    companies,
    selectedCompany,
    setSelectedCompany,
    weekPeriod,
    weekOffset,
    goToPreviousWeek,
    goToNextWeek,
    goToCurrentWeek,
  } = useAppContext();

  const title = (!isAdmin && lojistaTitles[pathname])
    ? lojistaTitles[pathname]
    : pageTitles[pathname] || 'Expresso Neves';

  return (
    <div className="topbar">
      <div className="topbar-left">
        <button
          className="mobile-menu-btn"
          onClick={onMenuToggle}
          aria-label="Abrir menu"
        >
          <MenuIcon size={20} />
        </button>
        <h1 className="topbar-title">{title}</h1>
      </div>

      <div className="topbar-right">
        {/* Controls: Empresa + Semana */}
        <div className="topbar-controls">
          {/* Empresa selector — only for admin */}
          {isAdmin && (
            <div className="topbar-selector">
              <span style={{ display: 'flex', alignItems: 'center', color: 'var(--color-text-muted)' }}><BuildingIcon /></span>
              <select
                value={selectedCompany?.id || ''}
                onChange={(e) => {
                  if (e.target.value === '') {
                    setSelectedCompany(null);
                  } else {
                    const c = companies.find(c => c.id === Number(e.target.value));
                    setSelectedCompany(c || null);
                  }
                }}
              >
                <option value="">Todas as empresas</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
          )}

          {/* For lojista: show company name as a static badge */}
          {!isAdmin && selectedCompany && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
              background: 'rgba(229, 92, 0, 0.08)',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: 'var(--color-accent)',
            }}>
              <BuildingIcon /> {selectedCompany.nome}
            </div>
          )}

          {/* Week navigator */}
          <div className="topbar-week">
            <button className="topbar-week-btn" onClick={goToPreviousWeek}>
              ◀
            </button>
            <span className="topbar-week-label">{weekPeriod.label}</span>
            <button className="topbar-week-btn" onClick={goToNextWeek}>
              ▶
            </button>
            {weekOffset !== 0 && (
              <button className="topbar-week-reset" onClick={goToCurrentWeek}>
                Hoje
              </button>
            )}
          </div>
        </div>

        {/* Settings only — notification removed */}
        <button className="topbar-icon-btn" title="Configurações"
          onClick={() => window.location.href = '/configuracoes'}
        >
          <SettingsIcon />
        </button>
        <div
          className="topbar-avatar"
          title={`${userName} (${userRole})`}
          style={{
            background: isAdmin
              ? 'linear-gradient(135deg, #E55C00, #CC5200)'
              : 'linear-gradient(135deg, #333333, #555555)',
          }}
        >
          {(userName || 'U').charAt(0).toUpperCase()}
        </div>
      </div>
    </div>
  );
}
