'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  CheckIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CalendarIcon,
  ClockIcon
} from '@/app/components/Icons';

export interface SortOption {
  id: string;
  col: string;
  dir: 'asc' | 'desc';
  label: string;
  description: string;
}

export const SORT_OPTIONS: SortOption[] = [
  { id: 'motus_desc', col: 'added_to_motus', dir: 'desc', label: 'Newest Added on Motus', description: 'Recently entered Motus leads first' },
  { id: 'motus_asc', col: 'added_to_motus', dir: 'asc', label: 'Oldest Added on Motus', description: 'Earliest entered Motus leads first' },
  { id: 'usdot_asc', col: 'usdot_number', dir: 'asc', label: 'USDOT (1 → 9)', description: 'Lowest USDOT numbers first' },
  { id: 'usdot_desc', col: 'usdot_number', dir: 'desc', label: 'USDOT (9 → 1)', description: 'Highest USDOT numbers first' },
  { id: 'name_asc', col: 'legal_name', dir: 'asc', label: 'Company Name (A → Z)', description: 'Alphabetical ascending' },
  { id: 'name_desc', col: 'legal_name', dir: 'desc', label: 'Company Name (Z → A)', description: 'Alphabetical descending' },
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

  const isCustomSort = activeOption.id !== 'motus_desc';

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className={`crm-tb-btn ${isCustomSort ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <ArrowUpDownIcon size={14} />
        <span>Sort: {activeOption.label}</span>
        <ChevronDownIcon
          size={12}
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
            opacity: 0.6,
          }}
        />
      </button>

      {isOpen && (
        <div
          className="popover-menu"
          style={{ width: 260 }}
        >
          <div className="popover-header">Sort Records By</div>

          {SORT_OPTIONS.map(opt => {
            const isSelected = activeOption.id === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={`popover-item ${isSelected ? 'active' : ''}`}
                onClick={() => handleSelect(opt)}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontWeight: isSelected ? 600 : 500 }}>{opt.label}</span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>{opt.description}</span>
                </div>

                {isSelected && <CheckIcon size={14} style={{ color: 'var(--cyan)' }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
