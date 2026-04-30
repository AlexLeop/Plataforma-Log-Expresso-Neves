'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

// ============================================================
// Types
// ============================================================

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  dismissToast: (id: string) => void;
}

// ============================================================
// Context
// ============================================================

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// ============================================================
// Provider
// ============================================================

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, _exiting: true } as Toast : t));
    // Remove after exit animation
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 300);
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'success', duration = 3500) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const toast: Toast = { id, message, type, duration };

    setToasts(prev => [...prev, toast]);

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => dismissToast(id), duration);
    }
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

// ============================================================
// Toast Container + Toast Item
// ============================================================

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast-item toast-${toast.type}`}
          role="alert"
          onClick={() => onDismiss(toast.id)}
        >
          <span className="toast-icon">{ICONS[toast.type]}</span>
          <span className="toast-message">{toast.message}</span>
          <button className="toast-close" aria-label="Fechar" onClick={(e) => { e.stopPropagation(); onDismiss(toast.id); }}>
            ✕
          </button>
          <div className="toast-progress" style={{ animationDuration: `${toast.duration}ms` }} />
        </div>
      ))}
    </div>
  );
}
