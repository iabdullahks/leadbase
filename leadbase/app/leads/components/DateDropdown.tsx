'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FilterState } from '@/lib/types';

interface DateDropdownProps {
  filters: FilterState;
  onChange: (nextFilters: FilterState) => void;
}

interface DatePresetOption {
  value: FilterState['date_preset'];
  label: string;
  icon: string;
}

const DATE_PRESETS: DatePresetOption[] = [
  { value: 'all', label: 'All Time', icon: '🌐' },
  { value: 'today', label: 'Today', icon: '⚡' },
  { value: 'yesterday', label: 'Yesterday', icon: '⏪' },
  { value: 'last_7d', label: 'Last 7 Days', icon: '📆' },
  { value: 'last_30d', label: 'Last 30 Days', icon: '🗓️' },
  { value: 'last_90d', label: 'Last 90 Days', icon: '📊' },
  { value: 'this_month', label: 'This Month', icon: '📅' },
  { value: 'last_month', label: 'Last Month', icon: '⏮️' },
];

export default function DateDropdown({ filters, onChange }: DateDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Local state for custom date inputs
  const [customFrom, setCustomFrom] = useState(filters.date_from || '');
  const [customTo, setCustomTo] = useState(filters.date_to || '');
  const [targetField, setTargetField] = useState<FilterState['date_field']>(
    filters.date_field || 'scraped_at'
  );

  // Sync local inputs when filters change externally
  useEffect(() => {
    setCustomFrom(filters.date_from || '');
    setCustomTo(filters.date_to || '');
    setTargetField(filters.date_field || 'scraped_at');
  }, [filters.date_from, filters.date_to, filters.date_field]);

  const currentPreset = filters.date_preset || 'all';
  const isCustom = currentPreset === 'custom' || Boolean(filters.date_from || filters.date_to);
  const isActive = currentPreset !== 'all';

  // Compute trigger button label
  let buttonLabel = 'Date: All Time';
  let buttonIcon = '📅';

  if (isCustom) {
    buttonIcon = '🎯';
    if (filters.date_from && filters.date_to) {
      buttonLabel = `Date: ${filters.date_from} → ${filters.date_to}`;
    } else if (filters.date_from) {
      buttonLabel = `Date: From ${filters.date_from}`;
    } else if (filters.date_to) {
      buttonLabel = `Date: Up to ${filters.date_to}`;
    } else {
      buttonLabel = 'Date: Custom Range';
    }
  } else if (currentPreset !== 'all') {
    const found = DATE_PRESETS.find(p => p.value === currentPreset);
    if (found) {
      buttonLabel = `Date: ${found.label}`;
      buttonIcon = found.icon;
    }
  }

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

  function handleSelectPreset(preset: FilterState['date_preset']) {
    let next: FilterState;
    if (preset === 'all') {
      next = {
        ...filters,
        date_preset: 'all',
        date_field: targetField,
        date_from: undefined,
        date_to: undefined,
      };
      setCustomFrom('');
      setCustomTo('');
    } else {
      next = {
        ...filters,
        date_preset: preset,
        date_field: targetField,
        date_from: undefined,
        date_to: undefined,
      };
    }
    setIsOpen(false);
    onChange(next);
  }

  function handleApplyCustom() {
    if (!customFrom && !customTo) return;
    const next: FilterState = {
      ...filters,
      date_preset: 'custom',
      date_field: targetField,
      date_from: customFrom || undefined,
      date_to: customTo || undefined,
    };
    setIsOpen(false);
    onChange(next);
  }

  function handleClearDate() {
    const next: FilterState = {
      ...filters,
      date_preset: 'all',
      date_from: undefined,
      date_to: undefined,
    };
    setCustomFrom('');
    setCustomTo('');
    setIsOpen(false);
    onChange(next);
  }

  function handleTargetFieldChange(field: FilterState['date_field']) {
    setTargetField(field);
    if (isActive) {
      onChange({
        ...filters,
        date_field: field,
      });
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Toolbar Trigger Button */}
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
        <span style={{ fontSize: '0.95rem' }}>{buttonIcon}</span>
        <span style={{ maxWidth: '210px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {buttonLabel}
        </span>
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

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          className="fade-up"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width: '290px',
            background: '#0d1527',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: '10px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255,255,255,0.06)',
            padding: '0.6rem',
            zIndex: 1000,
            backdropFilter: 'blur(20px)',
          }}
        >
          {/* Header & Target Field */}
          <div style={{ marginBottom: '0.5rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <div
              style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: '0.35rem',
              }}
            >
              Date Target Column
            </div>
            <select
              value={targetField}
              onChange={e => handleTargetFieldChange(e.target.value as FilterState['date_field'])}
              style={{
                width: '100%',
                padding: '0.35rem 0.5rem',
                fontSize: '0.78rem',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '6px',
                color: '#f1f5f9',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="scraped_at" style={{ background: '#0d1527', color: '#fff' }}>Date Added (Scraped)</option>
              <option value="motus_create_or_update" style={{ background: '#0d1527', color: '#fff' }}>MOTUS Created/Updated</option>
              <option value="motus_entry_date" style={{ background: '#0d1527', color: '#fff' }}>MOTUS Registration Date</option>
              <option value="motus_last_updated" style={{ background: '#0d1527', color: '#fff' }}>MOTUS Last Updated</option>
            </select>
          </div>

          {/* Quick Presets */}
          <div
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: '0.3rem',
              paddingLeft: '0.2rem',
            }}
          >
            Quick Presets
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem', marginBottom: '0.6rem' }}>
            {DATE_PRESETS.map(preset => {
              const isSelected = !isCustom && currentPreset === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => handleSelectPreset(preset.value)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.38rem 0.5rem',
                    borderRadius: '6px',
                    background: isSelected ? 'rgba(34, 211, 238, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    border: isSelected ? '1px solid rgba(34, 211, 238, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                    color: isSelected ? '#22d3ee' : '#e2e8f0',
                    fontSize: '0.76rem',
                    fontWeight: isSelected ? 600 : 400,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.12s ease',
                    outline: 'none',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                  }}
                >
                  <span style={{ fontSize: '0.85rem' }}>{preset.icon}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preset.label}</span>
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '0.4rem 0' }} />

          {/* Custom Date Range Section */}
          <div style={{ padding: '0.2rem' }}>
            <div
              style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: '0.4rem',
              }}
            >
              Custom Date Range
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.55rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.2rem' }}>From</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.35rem 0.45rem',
                    fontSize: '0.75rem',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '6px',
                    color: '#f1f5f9',
                    colorScheme: 'dark',
                    outline: 'none',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.2rem' }}>To</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.35rem 0.45rem',
                    fontSize: '0.75rem',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '6px',
                    color: '#f1f5f9',
                    colorScheme: 'dark',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.4rem' }}>
              <button
                type="button"
                onClick={handleApplyCustom}
                disabled={!customFrom && !customTo}
                style={{
                  flex: 1,
                  padding: '0.42rem 0.6rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  background: (customFrom || customTo) ? '#0284c7' : 'rgba(255, 255, 255, 0.05)',
                  border: 'none',
                  color: (customFrom || customTo) ? '#fff' : '#64748b',
                  cursor: (customFrom || customTo) ? 'pointer' : 'not-allowed',
                  transition: 'background 0.12s ease',
                  outline: 'none',
                }}
              >
                Apply Range
              </button>

              {isActive && (
                <button
                  type="button"
                  onClick={handleClearDate}
                  style={{
                    padding: '0.42rem 0.6rem',
                    fontSize: '0.78rem',
                    borderRadius: '6px',
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    color: '#f87171',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
