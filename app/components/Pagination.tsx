'use client';

import React from 'react';

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onItemsPerPageChange?: (perPage: number) => void;
  perPageOptions?: number[];
  showPerPageSelector?: boolean;
}

export default function Pagination({
  currentPage,
  totalItems,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
  perPageOptions = [10, 25, 50, 100],
  showPerPageSelector = true,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  // Generate page numbers to display
  const getPageNumbers = (): (number | '...')[] => {
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  if (totalItems === 0) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 0',
      marginTop: '12px',
      borderTop: '1px solid var(--color-border-light)',
      flexWrap: 'wrap',
      gap: '8px',
    }}>
      {/* Left: Items info + per-page selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
          fontWeight: 500,
        }}>
          {startItem}–{endItem} de {totalItems}
        </span>

        {showPerPageSelector && onItemsPerPageChange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
              Exibir:
            </span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                onItemsPerPageChange(Number(e.target.value));
                onPageChange(1);
              }}
              style={{
                fontSize: '0.72rem',
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid var(--color-border)',
                background: 'white',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {perPageOptions.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Right: Page navigation */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {/* Previous */}
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            style={{
              width: 30,
              height: 30,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              background: currentPage === 1 ? 'var(--color-bg-subtle)' : 'white',
              cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.7rem',
              color: currentPage === 1 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
              transition: 'all 0.15s',
              fontFamily: 'var(--font-sans)',
            }}
            onMouseEnter={e => {
              if (currentPage > 1) {
                e.currentTarget.style.borderColor = 'var(--color-accent)';
                e.currentTarget.style.color = 'var(--color-accent)';
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.color = currentPage === 1 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)';
            }}
          >
            ◀
          </button>

          {/* Page numbers */}
          {getPageNumbers().map((page, idx) => (
            page === '...' ? (
              <span key={`dots-${idx}`} style={{
                width: 30,
                height: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.72rem',
                color: 'var(--color-text-muted)',
              }}>
                ⋯
              </span>
            ) : (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 'var(--radius-sm)',
                  border: page === currentPage ? '1px solid var(--color-accent)' : '1px solid transparent',
                  background: page === currentPage ? 'var(--color-accent)' : 'transparent',
                  color: page === currentPage ? 'white' : 'var(--color-text-secondary)',
                  fontWeight: page === currentPage ? 700 : 500,
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                  fontFamily: 'var(--font-sans)',
                }}
                onMouseEnter={e => {
                  if (page !== currentPage) {
                    e.currentTarget.style.background = 'var(--color-accent-light)';
                    e.currentTarget.style.color = 'var(--color-accent)';
                  }
                }}
                onMouseLeave={e => {
                  if (page !== currentPage) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--color-text-secondary)';
                  }
                }}
              >
                {page}
              </button>
            )
          ))}

          {/* Next */}
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            style={{
              width: 30,
              height: 30,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              background: currentPage === totalPages ? 'var(--color-bg-subtle)' : 'white',
              cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.7rem',
              color: currentPage === totalPages ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
              transition: 'all 0.15s',
              fontFamily: 'var(--font-sans)',
            }}
            onMouseEnter={e => {
              if (currentPage < totalPages) {
                e.currentTarget.style.borderColor = 'var(--color-accent)';
                e.currentTarget.style.color = 'var(--color-accent)';
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.color = currentPage === totalPages ? 'var(--color-text-muted)' : 'var(--color-text-secondary)';
            }}
          >
            ▶
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Helper hook ────────────────────────────────────────────
export function usePagination<T>(items: T[], defaultPerPage = 10) {
  const [currentPage, setCurrentPage] = React.useState(1);
  const [itemsPerPage, setItemsPerPage] = React.useState(defaultPerPage);

  // Reset to page 1 when items change significantly
  const prevLengthRef = React.useRef(items.length);
  React.useEffect(() => {
    if (items.length !== prevLengthRef.current) {
      setCurrentPage(1);
      prevLengthRef.current = items.length;
    }
  }, [items.length]);

  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedItems = React.useMemo(() => {
    const start = (safePage - 1) * itemsPerPage;
    return items.slice(start, start + itemsPerPage);
  }, [items, safePage, itemsPerPage]);

  return {
    paginatedItems,
    currentPage: safePage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
    totalItems: items.length,
  };
}
