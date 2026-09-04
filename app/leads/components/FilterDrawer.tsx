'use client';

import { useState, useEffect } from 'react';
import { FilterState, AdvancedRule, TextMatchOperator, NumericOperator } from '@/lib/types';

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
  'Tractor', 'Truck', 'Trailer', 'Van', 'Flatbed',
  'Refrigerated (Reefer)', 'Tanker', 'Dump Truck', 'Specialized', 'Other'
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
  const [activeTab, setActiveTab] = useState<string>('ident');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    ident: true,
    status: true,
    contact: true,
    location: false,
    fleet: false,
    cargo: false,
    dates: false,
    quality: false,
    advanced: false
  });

  useEffect(() => {
    setDraft(filters);
  }, [filters, isOpen]);

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

  return (
    <>
      <div className="filter-overlay" onClick={onClose} />
      <div className="filter-panel-drawer">
        {/* Header */}
        <div className="fp-head">
          <div className="fp-head-title">
            <span>⚙️ Advanced Carrier Filters</span>
            <span className="fp-count-badge">{totalCount.toLocaleString()} matches</span>
          </div>
          <button className="fp-close" onClick={onClose}>✕</button>
        </div>

        {/* Body / Sections */}
        <div className="fp-body">
          {/* Section 1: Identification */}
          <div className="fp-section">
            <div className="fp-sec-header" onClick={() => toggleSection('ident')}>
              <span>🪪 1. Identification</span>
              <span>{expandedSections.ident ? '−' : '+'}</span>
            </div>
            {expandedSections.ident && (
              <div className="fp-sec-content">
                <div className="fp-grid-2">
                  <div>
                    <label className="fp-label">Match Type</label>
                    <select
                      className="fp-select"
                      value={draft.id_match_type || 'contains'}
                      onChange={e => setDraft({ ...draft, id_match_type: e.target.value as TextMatchOperator })}
                    >
                      <option value="contains">Contains</option>
                      <option value="exact">Exact Match</option>
                      <option value="starts_with">Starts With</option>
                    </select>
                  </div>
                  <div>
                    <label className="fp-label">USDOT Number</label>
                    <input
                      className="fp-input"
                      placeholder="e.g. 4582560"
                      value={draft.usdot || ''}
                      onChange={e => setDraft({ ...draft, usdot: e.target.value })}
                    />
                  </div>
                </div>
                <div className="fp-row">
                  <label className="fp-label">Company / Legal Name</label>
                  <input
                    className="fp-input"
                    placeholder="e.g. Freight Logistics Inc"
                    value={draft.company_name || ''}
                    onChange={e => setDraft({ ...draft, company_name: e.target.value })}
                  />
                </div>
                <div className="fp-row">
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
              <span>✅ 2. Status & Authority</span>
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
                      {st}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Contact Info */}
          <div className="fp-section">
            <div className="fp-sec-header" onClick={() => toggleSection('contact')}>
              <span>📞 3. Contact Information</span>
              <span>{expandedSections.contact ? '−' : '+'}</span>
            </div>
            {expandedSections.contact && (
              <div className="fp-sec-content">
                <div className="fp-grid-2">
                  <label className={`fp-chip-check ${draft.has_phone === true ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={draft.has_phone === true}
                      onChange={e => setDraft({ ...draft, has_phone: e.target.checked ? true : null })}
                    />
                    📞 Has Phone Number
                  </label>
                  <label className={`fp-chip-check ${draft.has_email === true ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={draft.has_email === true}
                      onChange={e => setDraft({ ...draft, has_email: e.target.checked ? true : null })}
                    />
                    ✉️ Has Email Address
                  </label>
                </div>
                <div style={{ marginTop: '0.8rem' }}>
                  <label className="fp-label">Contact Completeness</label>
                  <select
                    className="fp-select"
                    value={draft.contact_completeness || ''}
                    onChange={e => setDraft({ ...draft, contact_completeness: e.target.value as FilterState['contact_completeness'] })}
                  >
                    <option value="">Any Completeness</option>
                    <option value="phone_email">Phone + Email Required</option>
                    <option value="any">Either Phone or Email</option>
                    <option value="none">Missing Both Phone & Email</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Location */}
          <div className="fp-section">
            <div className="fp-sec-header" onClick={() => toggleSection('location')}>
              <span>📍 4. Location & US States</span>
              <span>{expandedSections.location ? '−' : '+'}</span>
            </div>
            {expandedSections.location && (
              <div className="fp-sec-content">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <label className="fp-label" style={{ marginBottom: 0 }}>Select US States ({draft.states?.length || 0})</label>
                  {draft.states?.length ? (
                    <button className="fp-link-btn" onClick={() => setDraft({ ...draft, states: [] })}>Clear States</button>
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
                <div className="fp-grid-2" style={{ marginTop: '0.8rem' }}>
                  <div>
                    <label className="fp-label">City</label>
                    <input
                      className="fp-input"
                      placeholder="e.g. Houston"
                      value={draft.city || ''}
                      onChange={e => setDraft({ ...draft, city: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="fp-label">Address Contains</label>
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

          {/* Section 5: Dates */}
          <div className="fp-section">
            <div className="fp-sec-header" onClick={() => toggleSection('dates')}>
              <span>📅 5. Dates & Freshness</span>
              <span>{expandedSections.dates ? '−' : '+'}</span>
            </div>
            {expandedSections.dates && (
              <div className="fp-sec-content">
                <div className="fp-grid-2">
                  <div>
                    <label className="fp-label">Target Date Field</label>
                    <select
                      className="fp-select"
                      value={draft.date_field || 'scraped_at'}
                      onChange={e => setDraft({ ...draft, date_field: e.target.value as FilterState['date_field'] })}
                    >
                      <option value="scraped_at">Date Added (Scraped)</option>
                      <option value="motus_entry_date">MOTUS Entry Date</option>
                    </select>
                  </div>
                  <div>
                    <label className="fp-label">Timeframe Preset</label>
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
                      <option value="custom">Custom Range</option>
                    </select>
                  </div>
                </div>
                {(draft.date_preset === 'custom' || draft.date_from || draft.date_to) && (
                  <div className="fp-grid-2" style={{ marginTop: '0.6rem' }}>
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

          {/* Section 6: Advanced Condition Builder */}
          <div className="fp-section">
            <div className="fp-sec-header" onClick={() => toggleSection('advanced')}>
              <span>⚡ 6. Advanced Custom Rules</span>
              <span>{expandedSections.advanced ? '−' : '+'}</span>
            </div>
            {expandedSections.advanced && (
              <div className="fp-sec-content">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                  <span className="fp-label" style={{ marginBottom: 0 }}>Custom Logic Rules ({draft.advanced_rules?.length || 0})</span>
                  <button className="fp-add-btn" onClick={addRule}>+ Add Rule</button>
                </div>
                {draft.advanced_rules?.map((rule, idx) => (
                  <div key={rule.id} className="fp-rule-row">
                    {idx > 0 && <span className="fp-rule-and">AND</span>}
                    <select
                      className="fp-select-sm"
                      value={rule.field}
                      onChange={e => updateRule(rule.id, { field: e.target.value })}
                    >
                      <option value="legal_name">Legal Name</option>
                      <option value="usdot_number">USDOT Number</option>
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
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="fp-foot">
          <button className="fp-btn-reset" onClick={handleReset}>Reset All</button>
          <button className="fp-btn-apply" onClick={handleApply}>
            Apply Filters ({totalCount.toLocaleString()})
          </button>
        </div>
      </div>
    </>
  );
}
