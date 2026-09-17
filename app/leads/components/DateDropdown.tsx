'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FilterState } from '@/lib/types';
import {
  CalendarIcon,
  ChevronDownIcon,
  CheckIcon,
  ClockIcon,
  SparklesIcon,
  XIcon
} from '@/app/components/Icons';

interface DateDropdownProps {
  filters: FilterState;
  onChange: (nextFilters: FilterState) => void;
}

interface DatePresetOption {
  value: FilterState['date_preset'];
  label: string;
}

const DATE_PRESETS: DatePresetOption[] = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_7d', label: 'Last 7 Days' },
  { value: 'last_30d', label: 'Last 30 Days' },
  { value: 'last_90d', label: 'Last 90 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
];

function formatDisplayDate(isoStr?: string): string {
  if (!isoStr) return '';
  try {
    const raw = isoStr.split('T')[0];
    const parts = raw.split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const monthIdx = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      if (monthIdx >= 0 && monthIdx < 12) {
        return `${months[monthIdx]} ${day}, ${year}`;
      }
    }
  } catch {}
  return isoStr;
}

export default function DateDropdown({ filters, onChange }: DateDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Local state for custom date inputs
  const [customFrom, setCustomFrom] = useState(filters.date_from || '');
  const [customTo, setCustomTo] = useState(filters.date_to || '');
  const targetField: FilterState['date_field'] = 'added_to_motus';

  // Sync local inputs when filters change externally
  useEffect(() => {
    setCustomFrom(filters.date_from || '');
    setCustomTo(filters.date_to || '');
  }, [filters.date_from, filters.date_to]);

  const currentPreset = filters.date_preset || 'all';
  const isCustom = currentPreset === 'custom' || Boolean(filters.date_from || filters.date_to);
  const isActive = currentPreset !== 'all';

  const todayIso = new Date().toISOString().slice(0, 10);

  // Compute trigger button label
  let buttonLabel = 'Date: All Time';

  if (isCustom) {
    if (filters.date_from && filters.date_to) {
      buttonLabel = `Date: ${formatDisplayDate(filters.date_from)} → ${formatDisplayDate(filters.date_to)}`;
    } else if (filters.date_from) {
      buttonLabel = `Date: From ${formatDisplayDate(filters.date_from)}`;
    } else if (filters.date_to) {
      buttonLabel = `Date: Up to ${formatDisplayDate(filters.date_to)}`;
    } else {
      buttonLabel = 'Date: Custom Range';
    }
  } else if (currentPreset !== 'all') {
    const found = DATE_PRESETS.find(p => p.value === currentPreset);
    if (found) {
      buttonLabel = `Date: ${found.label}`;
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

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Toolbar Trigger Button */}
      <button
        type="button"
        className={`crm-tb-btn ${isActive ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <CalendarIcon size={14} />
        <span style={{ maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {buttonLabel}
        </span>
        <ChevronDownIcon
          size={12}
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
            opacity: 0.6,
          }}
        />
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          className="popover-menu"
          style={{ width: 290 }}
        >
          {/* Header & Target Field Notice */}
          <div style={{ padding: '0.35rem 0.55rem 0.6rem', borderBottom: '1px solid var(--border-hairline)', marginBottom: '0.45rem' }}>
            <div className="popover-header" style={{ padding: '0 0 0.3rem 0' }}>
              Date Filter Target
            </div>
            <div
              style={{
                width: '100%',
                padding: '0.35rem 0.55rem',
                fontSize: '0.74rem',
                background: 'rgba(6, 182, 212, 0.08)',
                border: '1px solid rgba(6, 182, 212, 0.25)',
                borderRadius: 'var(--radius-xs)',
                color: 'var(--cyan-light)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontWeight: 600,
              }}
            >
              <CalendarIcon size={12} />
              <span>Added on Motus (Single Source of Truth)</span>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="popover-header">Quick Presets</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px', marginBottom: '0.65rem' }}>
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
                    justifyContent: 'space-between',
                    padding: '0.4rem 0.6rem',
                    fontSize: '0.75rem',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid',
                    borderColor: isSelected ? 'rgba(6, 182, 212, 0.35)' : 'transparent',
                    background: isSelected ? 'rgba(6, 182, 212, 0.1)' : 'transparent',
                    color: isSelected ? 'var(--cyan-light)' : 'var(--text-secondary)',
                    fontWeight: isSelected ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'var(--t-fast)',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                      e.currentTarget.style.color = 'var(--text)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                    }
                  }}
                >
                  <span>{preset.label}</span>
                  {isSelected && <CheckIcon size={12} style={{ color: 'var(--cyan)' }} />}
                </button>
              );
            })}
          </div>

          {/* Custom Date Range Section */}
          <div style={{ borderTop: '1px solid var(--border-hairline)', paddingTop: '0.55rem' }}>
            <div className="popover-header">Custom Date Range</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem', marginBottom: '0.45rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-tertiary)', marginBottom: '0.2rem', fontWeight: 600 }}>
                  From {customFrom && <span style={{ color: 'var(--cyan-light)', fontSize: '0.62rem' }}>({formatDisplayDate(customFrom)})</span>}
                </label>
                <input
                  type="date"
                  value={customFrom}
                  max={todayIso}
                  onChange={e => setCustomFrom(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.35rem 0.45rem',
                    fontSize: '0.74rem',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-hairline)',
                    borderRadius: 'var(--radius-xs)',
                    color: 'var(--text)',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-tertiary)', marginBottom: '0.2rem', fontWeight: 600 }}>
                  To {customTo && <span style={{ color: 'var(--cyan-light)', fontSize: '0.62rem' }}>({formatDisplayDate(customTo)})</span>}
                </label>
                <input
                  type="date"
                  value={customTo}
                  max={todayIso}
                  onChange={e => setCustomTo(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.35rem 0.45rem',
                    fontSize: '0.74rem',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-hairline)',
                    borderRadius: 'var(--radius-xs)',
                    color: 'var(--text)',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginBottom: '0.5rem', paddingLeft: '0.1rem' }}>
              Today is {formatDisplayDate(todayIso)}. Future dates return 0 leads.
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '0.45rem' }}>
              <button
                type="button"
                onClick={handleApplyCustom}
                disabled={!customFrom && !customTo}
                style={{
                  flex: 1,
                  padding: '0.4rem 0.65rem',
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  borderRadius: 'var(--radius-xs)',
                  border: 'none',
                  background: customFrom || customTo ? 'var(--cyan)' : 'rgba(255, 255, 255, 0.06)',
                  color: customFrom || customTo ? 'var(--bg-canvas)' : 'var(--text-tertiary)',
                  cursor: customFrom || customTo ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  transition: 'var(--t-fast)',
                }}
              >
                Apply Range
              </button>

              {isActive && (
                <button
                  type="button"
                  onClick={handleClearDate}
                  style={{
                    padding: '0.4rem 0.65rem',
                    fontSize: '0.76rem',
                    fontWeight: 500,
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid var(--border-subtle)',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'var(--t-fast)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
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
