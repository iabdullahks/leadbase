'use client';

import { FilterState } from '@/lib/types';

interface FilterChipsProps {
  filters: FilterState;
  onRemoveFilter: (key: keyof FilterState, value?: string) => void;
  onClearAll: () => void;
  matchingCount: number;
  totalCount: number;
}

export default function FilterChips({
  filters,
  onRemoveFilter,
  onClearAll,
  matchingCount,
  totalCount,
}: FilterChipsProps) {
  const chips: { key: keyof FilterState; label: string; val?: string }[] = [];

  if (filters.global_search?.trim()) {
    chips.push({ key: 'global_search', label: `Search: "${filters.global_search.trim()}"` });
  }
  if (filters.usdot?.trim()) {
    const v = filters.usdot.trim();
    if (filters.id_match_type === 'exact') {
      chips.push({ key: 'usdot', label: `USDOT: "${v}" (Exact)` });
    } else if (filters.id_match_type === 'contains') {
      chips.push({ key: 'usdot', label: `USDOT: Contains "${v}"` });
    } else if (filters.id_match_type === 'starts_with') {
      chips.push({ key: 'usdot', label: `USDOT: Prefix "${v}"` });
    } else {
      chips.push({ key: 'usdot', label: `USDOT: From ${v} → End` });
    }
  }
  if (filters.company_name?.trim()) {
    chips.push({ key: 'company_name', label: `Company: ${filters.company_name.trim()}` });
  }
  if (filters.dba_name?.trim()) {
    chips.push({ key: 'dba_name', label: `DBA: ${filters.dba_name.trim()}` });
  }

  (filters.carrier_statuses || []).forEach(st => {
    chips.push({ key: 'carrier_statuses', label: `Status: ${st}`, val: st });
  });

  if (filters.has_phone === true) {
    chips.push({ key: 'has_phone', label: 'Has Phone' });
  } else if (filters.has_phone === false) {
    chips.push({ key: 'has_phone', label: 'No Phone' });
  }

  if (filters.has_email === true) {
    chips.push({ key: 'has_email', label: 'Has Email' });
  } else if (filters.has_email === false) {
    chips.push({ key: 'has_email', label: 'No Email' });
  }

  if (filters.contact_completeness === 'phone_email') {
    chips.push({ key: 'contact_completeness', label: 'Phone + Email Required' });
  }

  (filters.states || []).forEach(st => {
    chips.push({ key: 'states', label: `State: ${st}`, val: st });
  });

  if (filters.city?.trim()) {
    chips.push({ key: 'city', label: `City: ${filters.city.trim()}` });
  }
  if (filters.address?.trim()) {
    chips.push({ key: 'address', label: `Address: ${filters.address.trim()}` });
  }

  // Equipment chips
  if (filters.equipment_mode === 'no_equipment' || (filters.equipment_types || []).includes('No Equipment')) {
    chips.push({ key: 'equipment_mode', label: 'Equipment: No Equipment', val: 'no_equipment' });
  } else if (filters.equipment_mode === 'has_equipment') {
    chips.push({ key: 'equipment_mode', label: 'Equipment: Has Equipment', val: 'has_equipment' });
  }

  (filters.equipment_types || [])
    .filter(eq => eq !== 'No Equipment' && eq !== 'Both' && eq !== 'All / Non-Filter' && eq !== 'All' && eq !== 'non- filter')
    .forEach(eq => {
      chips.push({ key: 'equipment_types', label: `Equipment: ${eq}`, val: eq });
    });

  if (filters.date_preset && filters.date_preset !== 'all') {
    const fieldPrefix = filters.date_field === 'motus_entry_date' ? 'MOTUS Reg' : 'Added';
    const presetLabels: Record<string, string> = {
      today: `${fieldPrefix}: Today`,
      yesterday: `${fieldPrefix}: Yesterday`,
      last_7d: `${fieldPrefix}: Last 7 Days`,
      last_30d: `${fieldPrefix}: Last 30 Days`,
      last_90d: `${fieldPrefix}: Last 90 Days`,
      this_month: `${fieldPrefix}: This Month`,
      last_month: `${fieldPrefix}: Last Month`,
      custom: `${fieldPrefix}: ${filters.date_from || ''} → ${filters.date_to || ''}`
    };
    chips.push({ key: 'date_preset', label: presetLabels[filters.date_preset] || filters.date_preset });
  }

  (filters.advanced_rules || []).forEach(r => {
    if (r.field && r.operator) {
      chips.push({ key: 'advanced_rules', label: `${r.field} ${r.operator} ${r.value || ''}`, val: r.id });
    }
  });

  if (chips.length === 0) return null;

  return (
    <div className="filter-chips-bar fade-up">
      <div className="fc-left">
        <span className="fc-matching-tag">
          🎯 <strong>{matchingCount.toLocaleString()}</strong> matching carriers (out of {totalCount.toLocaleString()})
        </span>
        <div className="fc-chips-list">
          {chips.map((c, i) => (
            <span key={`${String(c.key)}-${c.val || i}`} className="chip-item">
              <span className="chip-text">{c.label}</span>
              <button
                className="chip-remove"
                onClick={() => onRemoveFilter(c.key, c.val)}
                title="Remove filter"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>
      <button className="fc-clear-all" onClick={onClearAll}>
        Clear All ({chips.length})
      </button>
    </div>
  );
}
