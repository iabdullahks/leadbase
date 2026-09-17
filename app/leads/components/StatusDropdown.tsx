'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FilterState } from '@/lib/types';
import { ChevronDownIcon, CheckIcon, CheckCircleIcon, XCircleIcon, ClockIcon, AlertCircleIcon, LayersIcon } from '@/app/components/Icons';

interface StatusDropdownProps {
  filters: FilterState;
  onChange: (nextFilters: FilterState) => void;
}

interface StatusOption {
  value: string;
  label: string;
  description: string;
  dotColor?: string;
}

const STATUS_OPTIONS: StatusOption[] = [
  { value: 'all', label: 'All Statuses', description: 'Show all carriers in index' },
  { value: 'Active', label: 'Active', description: 'Authorized & operating carriers', dotColor: '#34d399' },
  { value: 'Inactive', label: 'Inactive', description: 'Inactive or revoked authorities', dotColor: '#fb7185' },
  { value: 'Pending', label: 'Pending', description: 'Pending authorization', dotColor: '#fbbf24' },
  { value: 'Out of Service', label: 'Out of Service', description: 'Carriers with active OOS orders', dotColor: '#f43f5e' },
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
        aria-expanded={isOpen}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {singleOpt?.dotColor ? (
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: singleOpt.dotColor, marginRight: 2 }} />
          ) : (
            <LayersIcon size={14} />
          )}
        </span>
        <span>Status: {currentLabel}</span>
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
          style={{ width: 240 }}
        >
          <div className="popover-header">
            Carrier Operating Status
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
                className={`popover-item ${isSelected ? 'active' : ''}`}
                onClick={() => handleSelect(opt.value)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {opt.dotColor ? (
                    <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: opt.dotColor }} />
                  ) : (
                    <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: 'var(--text-tertiary)' }} />
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: isSelected ? 600 : 500 }}>{opt.label}</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>{opt.description}</span>
                  </div>
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
