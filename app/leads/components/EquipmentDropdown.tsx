'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FilterState } from '@/lib/types';
import {
  TruckIcon,
  ChevronDownIcon,
  CheckIcon,
  BoxIcon,
  LayersIcon,
  XCircleIcon,
  CheckCircleIcon
} from '@/app/components/Icons';

interface EquipmentDropdownProps {
  filters: FilterState;
  onChange: (nextFilters: FilterState) => void;
}

interface EquipmentOption {
  value: string;
  label: string;
  category: 'status' | 'type';
}

const EQUIPMENT_OPTIONS: EquipmentOption[] = [
  { value: 'both',          label: 'All / Non-Filter',     category: 'status' },
  { value: 'no_equipment',  label: 'No Equipment',         category: 'status' },
  { value: 'has_equipment', label: 'Has Equipment',        category: 'status' },
  { value: 'Tractor',        label: 'Tractor / Power Only', category: 'type' },
  { value: 'Trailer',        label: 'Trailer',              category: 'type' },
  { value: 'Straight Truck', label: 'Straight Truck',       category: 'type' },
  { value: 'Van',            label: 'Van / Cargo Van',      category: 'type' },
  { value: 'Hauling',        label: 'Hauling (Car/Auto)',   category: 'type' },
];

export default function EquipmentDropdown({ filters, onChange }: EquipmentDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine current selection
  const isNoEquipment =
    (filters.equipment_types || []).includes('No Equipment') || filters.equipment_mode === 'no_equipment';
  const equipmentTypeCount = (filters.equipment_types || []).filter(
    e => e !== 'No Equipment' && e !== 'Both' && e !== 'All / Non-Filter' && e !== 'All'
  ).length;
  const isSingleType = equipmentTypeCount === 1 && !isNoEquipment;
  const isMultiType = equipmentTypeCount > 1 && !isNoEquipment;
  const singleVal = isSingleType ? filters.equipment_types.find(
    e => e !== 'No Equipment' && e !== 'Both' && e !== 'All / Non-Filter' && e !== 'All'
  ) ?? null : null;
  const isHasEquipment =
    filters.equipment_mode === 'has_equipment' &&
    (!filters.equipment_types || filters.equipment_types.length === 0);

  let currentVal = 'both';
  if (isNoEquipment) currentVal = 'no_equipment';
  else if (isMultiType) currentVal = '__multi__';
  else if (singleVal) currentVal = singleVal;
  else if (isHasEquipment) currentVal = 'has_equipment';

  const selectedOpt = currentVal === '__multi__'
    ? { label: `Multiple (${equipmentTypeCount})`, value: '__multi__' }
    : EQUIPMENT_OPTIONS.find(o => o.value === currentVal) || EQUIPMENT_OPTIONS[0];
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
        aria-expanded={isOpen}
      >
        <TruckIcon size={14} />
        <span>Equipment: {selectedOpt.label}</span>
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
          style={{ width: 250 }}
        >
          {/* Status Mode Section */}
          <div className="popover-header">Equipment Status</div>
          {EQUIPMENT_OPTIONS.filter(o => o.category === 'status').map(opt => {
            const isSelected = currentVal === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                className={`popover-item ${isSelected ? 'active' : ''}`}
                onClick={() => handleSelect(opt.value)}
              >
                <span>{opt.label}</span>
                {isSelected && <CheckIcon size={14} style={{ color: 'var(--cyan)' }} />}
              </button>
            );
          })}

          {/* Vehicle Types Section */}
          <div className="popover-header" style={{ borderTop: '1px solid var(--border-hairline)', marginTop: '0.45rem', paddingTop: '0.45rem' }}>
            FMCSA Vehicle Types
          </div>
          {EQUIPMENT_OPTIONS.filter(o => o.category === 'type').map(opt => {
            const isSelected = (filters.equipment_types || []).includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                className={`popover-item ${isSelected ? 'active' : ''}`}
                onClick={() => handleSelect(opt.value)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <TruckIcon size={13} style={{ color: isSelected ? 'var(--cyan)' : 'var(--text-tertiary)' }} />
                  <span>{opt.label}</span>
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
