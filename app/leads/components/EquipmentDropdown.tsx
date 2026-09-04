'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FilterState } from '@/lib/types';

interface EquipmentDropdownProps {
  filters: FilterState;
  onChange: (nextFilters: FilterState) => void;
}

interface EquipmentOption {
  value: string;
  label: string;
  icon: string;
  category: 'status' | 'type';
}

const EQUIPMENT_OPTIONS: EquipmentOption[] = [
  { value: 'both', label: 'All / Non-Filter', icon: '🔄', category: 'status' },
  { value: 'no_equipment', label: 'No Equipment', icon: '🚫', category: 'status' },
  { value: 'has_equipment', label: 'Has Equipment', icon: '✅', category: 'status' },
  { value: 'Power Only', label: 'Power Only', icon: '⚡', category: 'type' },
  { value: 'Box Truck', label: 'Box Truck', icon: '📦', category: 'type' },
  { value: 'Cargo Van', label: 'Cargo Van', icon: '🚐', category: 'type' },
  { value: 'Hauler', label: 'Hauler (Car/Auto)', icon: '🚗', category: 'type' },
  { value: 'Hotshot', label: 'Hotshot', icon: '🚀', category: 'type' },
  { value: 'Tractor', label: 'Tractor', icon: '🚚', category: 'type' },
  { value: 'Truck', label: 'Truck', icon: '🚛', category: 'type' },
  { value: 'Trailer', label: 'Trailer', icon: '📦', category: 'type' },
  { value: 'Van', label: 'Van / Dry Van', icon: '🚐', category: 'type' },
  { value: 'Flatbed', label: 'Flatbed', icon: '🏗️', category: 'type' },
  { value: 'Refrigerated (Reefer)', label: 'Refrigerated (Reefer)', icon: '❄️', category: 'type' },
  { value: 'Tanker', label: 'Tanker', icon: '🛢️', category: 'type' },
  { value: 'Dump Truck', label: 'Dump Truck', icon: '🚜', category: 'type' },
  { value: 'Specialized', label: 'Specialized', icon: '⚙️', category: 'type' },
];

export default function EquipmentDropdown({ filters, onChange }: EquipmentDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine current selection
  const isNoEquipment =
    (filters.equipment_types || []).includes('No Equipment') || filters.equipment_mode === 'no_equipment';
  const isSingleType = (filters.equipment_types || []).length === 1 && !isNoEquipment;
  const singleVal = isSingleType ? filters.equipment_types[0] : null;
  const isHasEquipment =
    filters.equipment_mode === 'has_equipment' &&
    (!filters.equipment_types || filters.equipment_types.length === 0);

  let currentVal = 'both';
  if (isNoEquipment) currentVal = 'no_equipment';
  else if (singleVal) currentVal = singleVal;
  else if (isHasEquipment) currentVal = 'has_equipment';

  const selectedOpt = EQUIPMENT_OPTIONS.find(o => o.value === currentVal) || EQUIPMENT_OPTIONS[0];
  const isActive = currentVal !== 'both';

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
    if (val === 'both') {
      next = { ...filters, equipment_mode: 'both', equipment_types: [] };
    } else if (val === 'no_equipment') {
      next = { ...filters, equipment_mode: 'no_equipment', equipment_types: ['No Equipment'] };
    } else if (val === 'has_equipment') {
      next = { ...filters, equipment_mode: 'has_equipment', equipment_types: [] };
    } else {
      next = { ...filters, equipment_mode: 'has_equipment', equipment_types: [val] };
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
        <span style={{ fontSize: '0.95rem' }}>{selectedOpt.icon}</span>
        <span>Equipment: {selectedOpt.label}</span>
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
            width: '245px',
            maxHeight: '380px',
            overflowY: 'auto',
            background: '#0d1527',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: '10px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255,255,255,0.06)',
            padding: '0.45rem',
            zIndex: 1000,
            backdropFilter: 'blur(20px)',
          }}
        >
          {/* Section 1: Fleet Status */}
          <div
            style={{
              padding: '0.35rem 0.55rem 0.2rem',
              fontSize: '0.65rem',
              fontWeight: 700,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Fleet Status
          </div>

          {EQUIPMENT_OPTIONS.filter(o => o.category === 'status').map(opt => {
            const isSelected = opt.value === currentVal;
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
                  padding: '0.48rem 0.65rem',
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
                  <span>{opt.label}</span>
                </span>
                {isSelected && <span style={{ color: '#22d3ee', fontSize: '0.85rem' }}>✓</span>}
              </button>
            );
          })}

          <div
            style={{
              height: '1px',
              background: 'rgba(255, 255, 255, 0.08)',
              margin: '0.4rem 0.2rem',
            }}
          />

          {/* Section 2: Specific Equipment Names */}
          <div
            style={{
              padding: '0.2rem 0.55rem 0.2rem',
              fontSize: '0.65rem',
              fontWeight: 700,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Equipment Types
          </div>

          {EQUIPMENT_OPTIONS.filter(o => o.category === 'type').map(opt => {
            const isSelected = opt.value === currentVal;
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
                  padding: '0.44rem 0.65rem',
                  borderRadius: '6px',
                  background: isSelected ? 'rgba(34, 211, 238, 0.12)' : 'transparent',
                  border: 'none',
                  color: isSelected ? '#22d3ee' : '#e2e8f0',
                  fontSize: '0.81rem',
                  fontWeight: isSelected ? 600 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.12s ease',
                  outline: 'none',
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
                  <span>{opt.label}</span>
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
