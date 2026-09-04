'use client';

import React, { useState, useRef, useEffect } from 'react';

export interface SortOption {
  id: string;
  col: string;
  dir: 'asc' | 'desc';
  label: string;
  icon: string;
  description: string;
}

export const SORT_OPTIONS: SortOption[] = [
  { id: 'scraped_desc', col: 'scraped_at', dir: 'desc', label: 'Newest Added', icon: '🆕', description: 'Recently scraped leads first' },
  { id: 'scraped_asc', col: 'scraped_at', dir: 'asc', label: 'Oldest Added', icon: '📅', description: 'Earliest scraped leads first' },
  { id: 'usdot_asc', col: 'usdot_number', dir: 'asc', label: 'USDOT (1 → 9)', icon: '🔢', description: 'Lowest USDOT numbers first' },
  { id: 'usdot_desc', col: 'usdot_number', dir: 'desc', label: 'USDOT (9 → 1)', icon: '🔢', description: 'Highest USDOT numbers first' },
  { id: 'name_asc', col: 'legal_name', dir: 'asc', label: 'Company (A → Z)', icon: '🔤', description: 'Alphabetical ascending' },
  { id: 'name_desc', col: 'legal_name', dir: 'desc', label: 'Company (Z → A)', icon: '🔤', description: 'Alphabetical descending' },
  { id: 'motus_desc', col: 'motus_entry_date', dir: 'desc', label: 'MOTUS Entry (Newest)', icon: '🗓️', description: 'Recent registration date' },
  { id: 'motus_asc', col: 'motus_entry_date', dir: 'asc', label: 'MOTUS Entry (Oldest)', icon: '🗓️', description: 'Earliest registration date' },
];

interface SortDropdownProps {
  sortCol: string;
  sortDir: 'asc' | 'desc';
  onChange: (col: string, dir: 'asc' | 'desc') => void;
}

export default function SortDropdown({ sortCol, sortDir, onChange }: SortDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeOption =
    SORT_OPTIONS.find(o => o.col === sortCol && o.dir === sortDir) || SORT_OPTIONS[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  function handleSelect(opt: SortOption) {
    onChange(opt.col, opt.dir);
    setIsOpen(false);
  }

  const isCustomSort = activeOption.id !== 'scraped_desc';

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className={`crm-tb-btn ${isCustomSort ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.45rem',
          cursor: 'pointer',
          userSelect: 'none',
          outline: 'none',
        }}
      >
        <span style={{ fontSize: '0.95rem' }}>{activeOption.icon}</span>
        <span>Sort: {activeOption.label}</span>
        <span
          style={{
            fontSize: '0.6rem',
            opacity: 0.6,
            marginLeft: '0.2rem',
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
          }}
        >
          ▼
        </span>
      </button>

      {isOpen && (
        <div
          className="fade-up"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width: '260px',
            background: '#0d1527',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: '10px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255,255,255,0.06)',
            padding: '0.45rem',
            zIndex: 1000,
            backdropFilter: 'blur(20px)',
          }}
        >
          <div
            style={{
              padding: '0.35rem 0.55rem 0.25rem',
              fontSize: '0.65rem',
              fontWeight: 700,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Sort Leads By
          </div>

          {SORT_OPTIONS.map(opt => {
            const isSelected = opt.col === sortCol && opt.dir === sortDir;

            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleSelect(opt)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '0.48rem 0.65rem',
                  borderRadius: '6px',
                  background: isSelected ? 'rgba(34, 211, 238, 0.12)' : 'transparent',
                  border: 'none',
                  color: isSelected ? '#22d3ee' : '#f1f5f9',
                  fontSize: '0.81rem',
                  fontWeight: isSelected ? 600 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.12s ease',
                  outline: 'none',
                  marginBottom: '2px',
                }}
                onMouseEnter={e => {
                  if (!isSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                }}
                onMouseLeave={e => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  <span style={{ fontSize: '0.92rem' }}>{opt.icon}</span>
                  <div>
                    <div style={{ lineHeight: '1.2' }}>{opt.label}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '2px' }}>
                      {opt.description}
                    </div>
                  </div>
                </span>
                {isSelected && <span style={{ color: '#22d3ee', fontSize: '0.85rem' }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
