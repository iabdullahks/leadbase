'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FilterState } from '@/lib/types';

interface StatusDropdownProps {
  filters: FilterState;
  onChange: (nextFilters: FilterState) => void;
}

interface StatusOption {
  value: string;
  label: string;
  icon: string;
  description: string;
}

const STATUS_OPTIONS: StatusOption[] = [
  { value: 'all', label: 'All Statuses', icon: '🌐', description: 'Show all carriers' },
  { value: 'Active', label: 'Active', icon: '🟢', description: 'Authorized & operating carriers' },
  { value: 'Inactive', label: 'Inactive', icon: '🔴', description: 'Inactive or revoked authorities' },
  { value: 'Pending', label: 'Pending', icon: '🟡', description: 'Pending authorization' },
  { value: 'Out of Service', label: 'Out of Service', icon: '⛔', description: 'Carriers with OOS orders' },
];

export default function StatusDropdown({ filters, onChange }: StatusDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedList = filters.carrier_statuses || [];
  const isAll = selectedList.length === 0;
  const isSingle = selectedList.length === 1;
  const singleOpt = isSingle ? STATUS_OPTIONS.find(o => o.value.toLowerCase() === selectedList[0].toLowerCase()) : null;

  const currentLabel = isAll
    ? 'All'
    : isSingle
    ? singleOpt ? singleOpt.label : selectedList[0]
    : `${selectedList.length} Selected`;

  const currentIcon = isAll ? '🌐' : isSingle && singleOpt ? singleOpt.icon : '✅';
  const isActive = !isAll;

  // Click outside listener
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

  function handleSelect(val: string) {
    let next: FilterState;
    if (val === 'all') {
      next = { ...filters, carrier_statuses: [] };
    } else {
      next = { ...filters, carrier_statuses: [val] };
    }
    setIsOpen(false);
    onChange(next);
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className={`crm-tb-btn ${isActive ? 'active' : ''}`}
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
        <span style={{ fontSize: '0.95rem' }}>{currentIcon}</span>
        <span>Status: {currentLabel}</span>
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
            width: '240px',
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
            Carrier Status
          </div>

          {STATUS_OPTIONS.map(opt => {
            const isSelected =
              opt.value === 'all'
                ? isAll
                : selectedList.some(s => s.toLowerCase() === opt.value.toLowerCase());

            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '0.5rem 0.65rem',
                  borderRadius: '6px',
                  background: isSelected ? 'rgba(34, 211, 238, 0.12)' : 'transparent',
                  border: 'none',
                  color: isSelected ? '#22d3ee' : '#f1f5f9',
                  fontSize: '0.82rem',
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
                  <span style={{ fontSize: '0.95rem' }}>{opt.icon}</span>
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
