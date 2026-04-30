'use client';

import { useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import { AppProvider, useAppContext } from '../context/AppContext';
import { ToastProvider } from '../components/Toast';
import { useSupabaseSync } from '../hooks/useSupabaseSync';

/** Inner component that uses the sync hook (needs AppProvider context) */
function DashboardInner({ children }: { children: React.ReactNode }) {
  useSupabaseSync();
  const { isSupervisor } = useAppContext();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Supervisors get a clean full-screen layout (no sidebar, no topbar)
  // Their own SupervisorLayout handles header + bottom tabs
  if (isSupervisor) {
    return <>{children}</>;
  }

  return (
    <div className="app-layout">
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'active' : ''}`}
        onClick={closeSidebar}
      />
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />
      <main className="main-content">
        <TopBar onMenuToggle={toggleSidebar} />
        {children}
      </main>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProvider>
      <ToastProvider>
        <DashboardInner>{children}</DashboardInner>
      </ToastProvider>
    </AppProvider>
  );
}
