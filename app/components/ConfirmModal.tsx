'use client';

import { useEffect, useRef } from 'react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANTS = {
  danger: { accent: '#E55C00', bg: '#FFF7F0', border: '#FFD6B3', icon: '✕' },
  warning: { accent: '#D97706', bg: '#FFFBEB', border: '#FDE68A', icon: '!' },
  info: { accent: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE', icon: '?' },
};

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const v = VARIANTS[variant];

  // Focus cancel button when modal opens, handle Escape
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'white', borderRadius: '14px',
          width: '100%', maxWidth: '420px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          animation: 'slideUp 0.2s ease-out',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 0',
          display: 'flex', alignItems: 'flex-start', gap: '14px',
        }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px',
            background: v.bg, border: `1px solid ${v.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1rem', fontWeight: 800, color: v.accent,
            flexShrink: 0,
          }}>
            {v.icon}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: '0.95rem', fontWeight: 700, color: '#1F2937',
              marginBottom: '6px',
            }}>
              {title}
            </div>
            <div style={{
              fontSize: '0.8rem', color: '#6B7280', lineHeight: 1.5,
            }}>
              {message}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{
          padding: '20px 24px',
          display: 'flex', justifyContent: 'flex-end', gap: '8px',
        }}>
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '8px 18px', borderRadius: '8px',
              border: '1px solid #D1D5DB', background: 'white',
              color: '#374151', fontSize: '0.82rem', fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: '8px 18px', borderRadius: '8px',
              border: 'none', background: v.accent,
              color: 'white', fontSize: '0.82rem', fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.7 : 1,
              transition: 'all 0.15s',
            }}
          >
            {loading ? 'Processando...' : confirmLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
