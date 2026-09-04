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
    chips.push({ key: 'usdot', label: `USDOT: ${filters.usdot.trim()}` });
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

  if (filters.date_preset && filters.date_preset !== 'all') {
    const presetLabels: Record<string, string> = {
      today: 'Added: Today',
      yesterday: 'Added: Yesterday',
      last_7d: 'Added: Last 7 Days',
      last_30d: 'Added: Last 30 Days',
      last_90d: 'Added: Last 90 Days',
      this_month: 'Added: This Month',
      last_month: 'Added: Last Month',
      custom: `Date: ${filters.date_from || ''} → ${filters.date_to || ''}`
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
