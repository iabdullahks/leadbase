'use client';

import { useState, useEffect, useRef } from 'react';
import { FilterState, AdvancedRule, TextMatchOperator, NumericOperator } from '@/lib/types';
import {
  FilterIcon,
  XIcon,
  TruckIcon,
  PhoneIcon,
  MailIcon,
  CalendarIcon,
  BuildingIcon,
  SparklesIcon,
  ChevronDownIcon,
  CheckIcon
} from '@/app/components/Icons';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
];

const CARGO_TYPES = [
  'General Freight', 'Household Goods', 'Motor Vehicles', 'Driveaway/Towaway',
  'Machinery/Large Objects', 'Fresh Produce', 'Liquids/Gases', 'Chemicals',
  'Agricultural/Farm Supplies', 'Construction', 'Grain/Feed/Ore', 'Other'
];

const EQUIPMENT_TYPES = [
  'All / Non-Filter',
  'No Equipment',
  'Tractor',
  'Trailer',
  'Straight Truck',
  'Van',
  'Hauling',
];

interface FilterDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  filters: FilterState;
  onApply: (newFilters: FilterState) => void;
  onReset: () => void;
  totalCount: number;
}

export default function FilterDrawer({
  isOpen,
  onClose,
  filters,
  onApply,
  onReset,
  totalCount
}: FilterDrawerProps) {
  const [draft, setDraft] = useState<FilterState>(filters);
  const [previewCount, setPreviewCount] = useState<number | null>(totalCount);
  const [isCounting, setIsCounting] = useState<boolean>(false);
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    ident: true,
    status: true,
    contact: true,
    location: true,
    fleet: true,
    cargo: false,
    dates: true,
    quality: false,
    advanced: false
  });

  useEffect(() => {
    if (isOpen) {
      setDraft(filters);
      setPreviewCount(totalCount);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (countTimer.current) clearTimeout(countTimer.current);
    setIsCounting(true);
    countTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters: draft, page: 1, limit: 1 })
        });
        const data = await res.json();
        setPreviewCount(typeof data.total === 'number' ? data.total : null);
      } catch (err) {
        console.error('Preview count error:', err);
      } finally {
        setIsCounting(false);
      }
    }, 350);

    return () => {
      if (countTimer.current) clearTimeout(countTimer.current);
    };
  }, [draft, isOpen]);

  if (!isOpen) return null;

  function toggleSection(sec: string) {
    setExpandedSections(prev => ({ ...prev, [sec]: !prev[sec] }));
  }

  function toggleState(st: string) {
    const list = draft.states || [];
    const next = list.includes(st) ? list.filter(s => s !== st) : [...list, st];
    setDraft({ ...draft, states: next });
  }

  function toggleStatus(st: string) {
    const list = draft.carrier_statuses || [];
    const next = list.includes(st) ? list.filter(s => s !== st) : [...list, st];
    setDraft({ ...draft, carrier_statuses: next });
  }

  function toggleCargo(cg: string) {
    const list = draft.cargo_types || [];
    const next = list.includes(cg) ? list.filter(c => c !== cg) : [...list, cg];
    setDraft({ ...draft, cargo_types: next });
  }

  function toggleEquipment(eq: string) {
    if (eq === 'All / Non-Filter' || eq === 'Both' || eq === 'all' || eq === 'non- filter') {
      setDraft({ ...draft, equipment_types: [], equipment_mode: 'both' });
      return;
    }
    if (eq === 'No Equipment') {
      const isSelected = (draft.equipment_types || []).includes('No Equipment') || draft.equipment_mode === 'no_equipment';
      if (isSelected) {
        setDraft({ ...draft, equipment_types: [], equipment_mode: 'both' });
      } else {
        setDraft({ ...draft, equipment_types: ['No Equipment'], equipment_mode: 'no_equipment' });
      }
      return;
    }

    const list = (draft.equipment_types || []).filter(e => e !== 'No Equipment' && e !== 'Both' && e !== 'All / Non-Filter');
    const next = list.includes(eq) ? list.filter(e => e !== eq) : [...list, eq];
    const mode = next.length > 0 ? 'has_equipment' : 'both';
    setDraft({ ...draft, equipment_types: next, equipment_mode: mode });
  }

  function addRule() {
    const rules = draft.advanced_rules || [];
    const newRule: AdvancedRule = {
      id: String(Date.now()),
      field: 'legal_name',
      operator: 'contains',
      value: '',
      logic: 'AND'
    };
    setDraft({ ...draft, advanced_rules: [...rules, newRule] });
  }

  function updateRule(id: string, updates: Partial<AdvancedRule>) {
    const rules = (draft.advanced_rules || []).map(r => r.id === id ? { ...r, ...updates } : r);
    setDraft({ ...draft, advanced_rules: rules });
  }

  function removeRule(id: string) {
    const rules = (draft.advanced_rules || []).filter(r => r.id !== id);
    setDraft({ ...draft, advanced_rules: rules });
  }

  function handleApply() {
    onApply(draft);
    onClose();
  }

  function handleReset() {
    onReset();
    onClose();
  }

  const displayCount = previewCount !== null ? previewCount : totalCount;

  return (
    <>
      <div className="filter-overlay" onClick={onClose} />
      <div className="filter-panel-drawer">
        {/* Header */}
        <div className="fp-head">
          <div className="fp-head-title">
            <FilterIcon size={16} style={{ color: 'var(--cyan)' }} />
            <span>Carrier Query Builder</span>
            <span className="fp-count-badge">
              {isCounting ? 'Counting matches…' : `${displayCount.toLocaleString()} matches`}
            </span>
          </div>
          <button className="fp-close" onClick={onClose} aria-label="Close filters">
            <XIcon size={16} />
          </button>
        </div>

        {/* Body / Sections */}
        <div className="fp-body">
          {/* Section 1: Identification */}
          <div className="fp-section">
            <div className="fp-sec-header" onClick={() => toggleSection('ident')}>
              <span>1. Identification &amp; Registry</span>
              <span>{expandedSections.ident ? '−' : '+'}</span>
            </div>
            {expandedSections.ident && (
              <div className="fp-sec-content">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <div>
                    <label className="fp-label">Match Type</label>
                    <select
                      className="fp-select"
                      value={draft.id_match_type || 'starts_from'}
                      onChange={e => setDraft({ ...draft, id_match_type: e.target.value as TextMatchOperator })}
                    >
                      <option value="starts_from">Starts From (≥ USDOT) — Continue to End</option>
                      <option value="starts_with">Starts With (Prefix e.g. 4582...)</option>
                      <option value="exact">Exact USDOT Match</option>
                      <option value="contains">Contains Substring</option>
                    </select>
                  </div>
                  <div>
                    <label className="fp-label">
                      {draft.id_match_type === 'exact'
                        ? 'USDOT Number (Exact)'
                        : draft.id_match_type === 'contains'
                        ? 'USDOT Contains'
                        : draft.id_match_type === 'starts_with'
                        ? 'USDOT Starts With (Prefix)'
                        : 'USDOT Starting From (≥)'}
                    </label>
                    <input
                      className="fp-input"
                      placeholder={
                        draft.id_match_type === 'exact'
                          ? 'e.g. 4582560'
                          : draft.id_match_type === 'starts_with'
                          ? 'e.g. 4582'
                          : 'e.g. 4582560'
                      }
                      value={draft.usdot || ''}
                      onChange={e => setDraft({ ...draft, usdot: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="fp-label">Company / Legal Name</label>
                  <input
                    className="fp-input"
                    placeholder="e.g. Freight Logistics Inc"
                    value={draft.company_name || ''}
                    onChange={e => setDraft({ ...draft, company_name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="fp-label">DBA Name</label>
                  <input
                    className="fp-input"
                    placeholder="e.g. Express Hauling"
                    value={draft.dba_name || ''}
                    onChange={e => setDraft({ ...draft, dba_name: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Status */}
          <div className="fp-section">
            <div className="fp-sec-header" onClick={() => toggleSection('status')}>
              <span>2. Authority &amp; Carrier Status</span>
              <span>{expandedSections.status ? '−' : '+'}</span>
            </div>
            {expandedSections.status && (
              <div className="fp-sec-content">
                <label className="fp-label">Carrier Status (Multi-Select)</label>
                <div className="fp-checkbox-grid">
                  {['Active', 'Inactive', 'Pending', 'Out of Service'].map(st => (
                    <label key={st} className={`fp-chip-check ${(draft.carrier_statuses || []).includes(st) ? 'selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={(draft.carrier_statuses || []).includes(st)}
                        onChange={() => toggleStatus(st)}
                      />
                      <span>{st}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Contact Info */}
          <div className="fp-section">
            <div className="fp-sec-header" onClick={() => toggleSection('contact')}>
              <span>3. Contact Availability</span>
              <span>{expandedSections.contact ? '−' : '+'}</span>
            </div>
            {expandedSections.contact && (
              <div className="fp-sec-content">
                <div>
                  <label className="fp-label">Available Channels</label>
                  <div className="fp-grid-2">
                    <label className={`fp-chip-check ${draft.has_phone === true ? 'selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={draft.has_phone === true}
                        onChange={e => setDraft({ ...draft, has_phone: e.target.checked ? true : null })}
                      />
                      <span>Phone Available</span>
                    </label>
                    <label className={`fp-chip-check ${draft.has_email === true ? 'selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={draft.has_email === true}
                        onChange={e => setDraft({ ...draft, has_email: e.target.checked ? true : null })}
                      />
                      <span>Email Available</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="fp-label">Missing Channels</label>
                  <div className="fp-grid-2">
                    <label className={`fp-chip-check ${draft.has_phone === false ? 'selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={draft.has_phone === false}
                        onChange={e => setDraft({ ...draft, has_phone: e.target.checked ? false : null })}
                      />
                      <span>Missing Phone</span>
                    </label>
                    <label className={`fp-chip-check ${draft.has_email === false ? 'selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={draft.has_email === false}
                        onChange={e => setDraft({ ...draft, has_email: e.target.checked ? false : null })}
                      />
                      <span>Missing Email</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="fp-label">Completeness Preset</label>
                  <select
                    className="fp-select"
                    value={draft.contact_completeness || ''}
                    onChange={e => setDraft({ ...draft, contact_completeness: e.target.value as FilterState['contact_completeness'] })}
                  >
                    <option value="">Any Contact Profile</option>
                    <option value="phone_email">Phone + Email Required</option>
                    <option value="any">Either Phone or Email Available</option>
                    <option value="none">Missing Both Phone &amp; Email</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Location */}
          <div className="fp-section">
            <div className="fp-sec-header" onClick={() => toggleSection('location')}>
              <span>4. Geography &amp; US States</span>
              <span>{expandedSections.location ? '−' : '+'}</span>
            </div>
            {expandedSections.location && (
              <div className="fp-sec-content">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <label className="fp-label" style={{ marginBottom: 0 }}>Select US States ({draft.states?.length || 0})</label>
                  {draft.states?.length ? (
                    <button className="fp-link-btn" onClick={() => setDraft({ ...draft, states: [] })}>Clear</button>
                  ) : null}
                </div>
                <div className="fp-states-grid">
                  {US_STATES.map(st => (
                    <button
                      key={st}
                      type="button"
                      className={`fp-state-btn ${(draft.states || []).includes(st) ? 'active' : ''}`}
                      onClick={() => toggleState(st)}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                <div className="fp-grid-2" style={{ marginTop: '0.5rem' }}>
                  <div>
                    <label className="fp-label">City</label>
                    <input
                      className="fp-input"
                      placeholder="e.g. Dallas"
                      value={draft.city || ''}
                      onChange={e => setDraft({ ...draft, city: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="fp-label">Street / Address</label>
                    <input
                      className="fp-input"
                      placeholder="e.g. Main St"
                      value={draft.address || ''}
                      onChange={e => setDraft({ ...draft, address: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 5: Equipment */}
          <div className="fp-section">
            <div className="fp-sec-header" onClick={() => toggleSection('fleet')}>
              <span>5. Equipment &amp; Vehicles</span>
              <span>{expandedSections.fleet ? '−' : '+'}</span>
            </div>
            {expandedSections.fleet && (
              <div className="fp-sec-content">
                <label className="fp-label">Vehicle Types</label>
                <div className="fp-checkbox-grid">
                  {EQUIPMENT_TYPES.map(eq => {
                    const isSelected = eq === 'All / Non-Filter'
                      ? (!draft.equipment_types?.length && (!draft.equipment_mode || draft.equipment_mode === 'both'))
                      : eq === 'No Equipment'
                      ? (draft.equipment_mode === 'no_equipment' || (draft.equipment_types || []).includes('No Equipment'))
                      : (draft.equipment_types || []).includes(eq);

                    return (
                      <label key={eq} className={`fp-chip-check ${isSelected ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleEquipment(eq)}
                        />
                        <span>{eq}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Section 6: Cargo Carried */}
          <div className="fp-section">
            <div className="fp-sec-header" onClick={() => toggleSection('cargo')}>
              <span>6. Cargo Classification</span>
              <span>{expandedSections.cargo ? '−' : '+'}</span>
            </div>
            {expandedSections.cargo && (
              <div className="fp-sec-content">
                <div className="fp-checkbox-grid">
                  {CARGO_TYPES.map(cg => (
                    <label key={cg} className={`fp-chip-check ${(draft.cargo_types || []).includes(cg) ? 'selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={(draft.cargo_types || []).includes(cg)}
                        onChange={() => toggleCargo(cg)}
                      />
                      <span>{cg}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Section 7: Dates & Timeline */}
          <div className="fp-section">
            <div className="fp-sec-header" onClick={() => toggleSection('dates')}>
              <span>7. Added on Motus Date Range</span>
              <span>{expandedSections.dates ? '−' : '+'}</span>
            </div>
            {expandedSections.dates && (
              <div className="fp-sec-content">
                <div style={{ marginBottom: '0.4rem' }}>
                  <label className="fp-label">Date Filter Target</label>
                  <div
                    style={{
                      padding: '0.4rem 0.6rem',
                      background: 'rgba(6, 182, 212, 0.08)',
                      border: '1px solid rgba(6, 182, 212, 0.25)',
                      borderRadius: 'var(--radius-xs)',
                      color: 'var(--cyan-light)',
                      fontSize: '0.76rem',
                      fontWeight: 600,
                    }}
                  >
                    Added on Motus (Verified Single Source of Truth)
                  </div>
                </div>

                <div>
                  <label className="fp-label">Preset Window</label>
                  <select
                    className="fp-select"
                    value={draft.date_preset || 'all'}
                    onChange={e => setDraft({ ...draft, date_preset: e.target.value as FilterState['date_preset'] })}
                  >
                    <option value="all">All Time</option>
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="last_7d">Last 7 Days</option>
                    <option value="last_30d">Last 30 Days</option>
                    <option value="last_90d">Last 90 Days</option>
                    <option value="this_month">This Month</option>
                    <option value="last_month">Last Month</option>
                    <option value="custom">Custom Date Range</option>
                  </select>
                </div>

                {draft.date_preset === 'custom' && (
                  <div className="fp-grid-2">
                    <div>
                      <label className="fp-label">From Date</label>
                      <input
                        type="date"
                        className="fp-input"
                        value={draft.date_from || ''}
                        onChange={e => setDraft({ ...draft, date_from: e.target.value, date_preset: 'custom' })}
                      />
                    </div>
                    <div>
                      <label className="fp-label">To Date</label>
                      <input
                        type="date"
                        className="fp-input"
                        value={draft.date_to || ''}
                        onChange={e => setDraft({ ...draft, date_to: e.target.value, date_preset: 'custom' })}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 8: Advanced Custom Rules */}
          <div className="fp-section">
            <div className="fp-sec-header" onClick={() => toggleSection('advanced')}>
              <span>8. Custom SQL Predicate Builder</span>
              <span>{expandedSections.advanced ? '−' : '+'}</span>
            </div>
            {expandedSections.advanced && (
              <div className="fp-sec-content">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                  <label className="fp-label" style={{ marginBottom: 0 }}>Active Rules</label>
                  <button className="fp-link-btn" onClick={addRule}>+ Add Rule</button>
                </div>
                {(draft.advanced_rules || []).map((rule, idx) => (
                  <div key={rule.id}>
                    {idx > 0 && (
                      <div style={{ display: 'flex', gap: '0.3rem', margin: '0.35rem 0' }}>
                        {(['AND', 'OR'] as const).map(l => (
                          <button
                            key={l}
                            type="button"
                            onClick={() => updateRule(rule.id, { logic: l })}
                            style={{
                              padding: '0.15rem 0.5rem',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              borderRadius: '4px',
                              border: (rule.logic || 'AND') === l ? '1px solid var(--cyan)' : '1px solid var(--border-subtle)',
                              background: (rule.logic || 'AND') === l ? 'rgba(6,182,212,0.15)' : 'var(--bg-card)',
                              color: (rule.logic || 'AND') === l ? 'var(--cyan)' : 'var(--text-secondary)',
                              cursor: 'pointer',
                            }}
                          >
                            {l}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="fp-rule-row">
                      <select
                        className="fp-select-sm"
                        value={rule.field}
                        onChange={e => updateRule(rule.id, { field: e.target.value })}
                      >
                        <option value="legal_name">Legal Name</option>
                        <option value="dba_name">DBA Name</option>
                        <option value="usdot_number">USDOT</option>
                        <option value="phone">Phone</option>
                        <option value="email">Email</option>
                        <option value="principal_address">Address</option>
                        <option value="carrier_status">Status</option>
                      </select>
                      <select
                        className="fp-select-sm"
                        value={rule.operator}
                        onChange={e => updateRule(rule.id, { operator: e.target.value })}
                      >
                        <option value="contains">Contains</option>
                        <option value="exact">Exact</option>
                        <option value="is_not_empty">Is Not Empty</option>
                        <option value="is_empty">Is Empty</option>
                        <option value="gt">&gt;</option>
                        <option value="gte">&ge;</option>
                        <option value="lt">&lt;</option>
                        <option value="lte">&le;</option>
                      </select>
                      {rule.operator !== 'is_not_empty' && rule.operator !== 'is_empty' && (
                        <input
                          className="fp-input-sm"
                          placeholder="Value..."
                          value={rule.value}
                          onChange={e => updateRule(rule.id, { value: e.target.value })}
                        />
                      )}
                      <button className="fp-rule-del" onClick={() => removeRule(rule.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="fp-foot">
          <button className="fp-btn-reset" onClick={handleReset}>Reset All</button>
          <button className="fp-btn-apply" onClick={handleApply}>
            {isCounting ? 'Computing matches…' : `Apply Filters (${displayCount.toLocaleString()} matches)`}
          </button>
        </div>
      </div>
    </>
  );
}
