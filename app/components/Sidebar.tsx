'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAppContext } from '../context/AppContext';

// ── SVG Icon Components (Lucide-style) ─────────────────────

const DashboardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);
const RouteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" />
  </svg>
);
const ClipboardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" />
  </svg>
);
const UsersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const ChartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" />
  </svg>
);
const WalletIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
  </svg>
);
const CameraIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" />
  </svg>
);
const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const BuildingIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" /><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M12 6h.01" /><path d="M12 10h.01" /><path d="M12 14h.01" /><path d="M16 10h.01" /><path d="M16 14h.01" /><path d="M8 10h.01" /><path d="M8 14h.01" />
  </svg>
);
const UserCogIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="19" cy="11" r="1.5" /><path d="M19 8.5v1" /><path d="M19 13.5v-1" /><path d="M17.17 9.5l.87.5" /><path d="M20.83 12.5l-.87-.5" /><path d="M17.17 12.5l.87-.5" /><path d="M20.83 9.5l-.87.5" />
  </svg>
);
const SyncIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
  </svg>
);
const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const LogOutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

// ── Navigation Config ──────────────────────────────────────

interface NavLink {
  href: string;
  icon: React.ComponentType;
  label: string;
  adminOnly?: boolean;
  supervisorVisible?: boolean; // If true, supervisors can see this link
}

interface NavSection {
  section: string;
  links: NavLink[];
}

const navItems: NavSection[] = [
  {
    section: 'OPERAÇÕES',
    links: [
      { href: '/', icon: DashboardIcon, label: 'Dashboard' },
      { href: '/corridas', icon: RouteIcon, label: 'Corridas' },
      { href: '/lancamentos', icon: ClipboardIcon, label: 'Lançamentos' },
      { href: '/escala', icon: CalendarIcon, label: 'Escala', adminOnly: true, supervisorVisible: true },
      { href: '/motoboys', icon: UsersIcon, label: 'Motoboys', adminOnly: true },
    ],
  },
  {
    section: 'FINANCEIRO',
    links: [
      { href: '/relatorios', icon: ChartIcon, label: 'Relatórios' },
      { href: '/financeiro', icon: WalletIcon, label: 'Financeiro' },
      { href: '/snapshots', icon: CameraIcon, label: 'Snapshots' },
    ],
  },
  {
    section: 'SISTEMA',
    links: [
      { href: '/configuracoes', icon: SettingsIcon, label: 'Configurações' },
      { href: '/usuarios', icon: UserCogIcon, label: 'Usuários', adminOnly: true },
      { href: '/empresas', icon: BuildingIcon, label: 'Empresas', adminOnly: true },
      { href: '/sync', icon: SyncIcon, label: 'Sincronização', adminOnly: true },
    ],
  },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { isAdmin, isSupervisor, userName, userRole, selectedCompany, logout } = useAppContext();

  // Filter nav items based on role
  const filteredSections = navItems
    .map((section) => ({
      ...section,
      links: section.links.filter((link) => {
        // Admin sees everything
        if (isAdmin) return true;
        // Supervisor only sees items marked supervisorVisible
        if (isSupervisor) return link.supervisorVisible === true;
        // Lojista sees everything except adminOnly
        return !link.adminOnly;
      }),
    }))
    .filter((section) => section.links.length > 0);

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      {/* Brand */}
      <div className="sidebar-header">
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          overflow: 'hidden',
          background: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <img
            src="/favicon.ico"
            alt="Expresso Neves"
            style={{ width: '28px', height: '28px', objectFit: 'contain' }}
          />
        </div>
        <div className="sidebar-brand">
          EXPRESSO NEVES
          <small>
            {isAdmin ? 'Admin Portal' : selectedCompany?.nome || 'Portal Logístico'}
          </small>
        </div>
      </div>

      {/* Role badge */}
      <div style={{
        padding: '0 16px',
        marginBottom: '8px',
      }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '6px',
          fontSize: '0.6rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          background: isAdmin
            ? 'rgba(229, 92, 0, 0.15)'
            : isSupervisor
            ? 'rgba(59, 130, 246, 0.15)'
            : 'rgba(22, 163, 74, 0.15)',
          color: isAdmin
            ? '#CC5200'
            : isSupervisor
            ? '#3B82F6'
            : '#22C55E',
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: isAdmin ? '#CC5200' : isSupervisor ? '#3B82F6' : '#22C55E',
          }} />
          {isAdmin ? 'Administrador' : isSupervisor ? 'Supervisor' : 'Lojista'}
        </span>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {filteredSections.map((section) => (
          <div key={section.section} className="nav-section">
            <div className="nav-section-title">{section.section}</div>
            {section.links.map((link) => {
              const IconComponent = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`nav-link ${pathname === link.href ? 'active' : ''}`}
                  onClick={() => onClose?.()}
                >
                  <span className="nav-icon" style={{ display: 'flex', alignItems: 'center' }}>
                    <IconComponent />
                  </span>
                  {link.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div style={{
          padding: '8px 12px',
          marginBottom: '6px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.04)',
        }}>
          <div style={{
            fontSize: '0.72rem',
            fontWeight: 600,
            color: 'rgba(255,255,255,0.7)',
            marginBottom: '2px',
          }}>
            {userName || 'Usuário'}
          </div>
          <div style={{
            fontSize: '0.6rem',
            color: 'rgba(255,255,255,0.35)',
          }}>
            {userRole === 'admin' ? 'Central' : selectedCompany?.nome || '—'}
          </div>
        </div>

        <button className="sidebar-footer-link" onClick={logout}>
          <span style={{ display: 'flex', alignItems: 'center' }}><LogOutIcon /></span>
          Sair
        </button>
      </div>
    </aside>
  );
}
