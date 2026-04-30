'use client';

import { useState } from 'react';
import { useAppContext } from '../context/AppContext';

// ── Icons ──────────────────────────────────────────────────────

const HomeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const CalendarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const UsersIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ChartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const LogOutIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export type SupervisorTab = 'dashboard' | 'escalas' | 'producao' | 'equipe';

interface SupervisorLayoutProps {
  activeTab: SupervisorTab;
  onTabChange: (tab: SupervisorTab) => void;
  children: React.ReactNode;
}

export default function SupervisorLayout({ activeTab, onTabChange, children }: SupervisorLayoutProps) {
  const { userName, selectedCompany, companies, setSelectedCompany, logout } = useAppContext();
  const [showMenu, setShowMenu] = useState(false);

  const tabs: { id: SupervisorTab; label: string; icon: React.ComponentType }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: HomeIcon },
    { id: 'escalas', label: 'Escalas', icon: CalendarIcon },
    { id: 'producao', label: 'Produção', icon: ChartIcon },
    { id: 'equipe', label: 'Equipe', icon: UsersIcon },
  ];

  return (
    <div className="sv-layout">
      {/* ── Header ─────────────────────────────────── */}
      <header className="sv-header">
        <div className="sv-header-left">
          <div className="sv-header-logo">
            <img src="/favicon.ico" alt="" width="24" height="24" />
          </div>
          <div>
            <div className="sv-header-brand">Expresso Neves</div>
          </div>
        </div>
        <div className="sv-header-right">
          {/* Company selector */}
          {companies.length > 1 && (
            <select
              className="sv-header-company-select"
              value={selectedCompany?.id || ''}
              onChange={(e) => {
                const c = companies.find(c => String(c.id) === e.target.value);
                if (c) setSelectedCompany(c);
              }}
            >
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          )}
          <div className="sv-avatar" onClick={() => setShowMenu(!showMenu)}>
            {(userName || 'S')[0].toUpperCase()}
          </div>
        </div>
      </header>

      {/* User menu dropdown */}
      {showMenu && (
        <>
          <div className="sv-overlay" onClick={() => setShowMenu(false)} />
          <div className="sv-dropdown-menu">
            <div className="sv-dropdown-header">
              <div className="sv-dropdown-name">{userName || 'Supervisor'}</div>
              <div className="sv-dropdown-role">Supervisor</div>
            </div>
            <div className="sv-dropdown-divider" />
            {companies.length > 1 && (
              <>
                <div className="sv-dropdown-section-title">Lojas</div>
                {companies.map(c => (
                  <button
                    key={c.id}
                    className={`sv-dropdown-item ${selectedCompany?.id === c.id ? 'active' : ''}`}
                    onClick={() => { setSelectedCompany(c); setShowMenu(false); }}
                  >
                    {c.nome}
                    {selectedCompany?.id === c.id && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    )}
                  </button>
                ))}
                <div className="sv-dropdown-divider" />
              </>
            )}
            <button className="sv-dropdown-item sv-dropdown-item--danger" onClick={logout}>
              <LogOutIcon /> Sair
            </button>
          </div>
        </>
      )}

      {/* ── Main Content (scrollable) ──────────────── */}
      <main className="sv-main">
        {children}
      </main>

      {/* ── Bottom Tab Bar ──────────────────────────── */}
      <nav className="sv-tabbar">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              className={`sv-tab ${isActive ? 'sv-tab--active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              <span className="sv-tab-icon"><Icon /></span>
              <span className="sv-tab-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
