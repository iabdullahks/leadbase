'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Carrier, FilterState } from '@/lib/types';
import { defaultFilterState } from '@/lib/queryBuilder';
import FilterDrawer from './components/FilterDrawer';
import FilterChips from './components/FilterChips';
import SavedViewsModal from './components/SavedViewsModal';
import ExportModal from './components/ExportModal';
import ExportHistoryDrawer from './components/ExportHistoryDrawer';
import ColumnVisibilityModal from './components/ColumnVisibilityModal';

const PAGE_SIZE = 50;

function formatDate(iso: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatDateFull(iso: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function StatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  const cls = s === 'active' ? 'pill-active' : s === 'inactive' ? 'pill-inactive' : s === 'pending' ? 'pill-pending' : 'pill-other';
  return <span className={`pill ${cls}`}>{status || '?'}</span>;
}

export default function LeadsPage() {
  // Main data state
  const [leads, setLeads] = useState<Carrier[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Active Filter State
  const [filters, setFilters] = useState<FilterState>(defaultFilterState());
  const [sortCol, setSortCol] = useState('scraped_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Modals & Drawers state
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSavedViewsOpen, setIsSavedViewsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Carrier | null>(null);

  // Selection & Columns state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>([
    'usdot_number', 'legal_name', 'phone', 'email', 'carrier_status', 'motus_entry_date', 'scraped_at'
  ]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch leads from server
  const fetchLeads = useCallback(async (pg = 1, currentFilters = filters) => {
    setLoading(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          filters: currentFilters,
          page: pg,
          limit: PAGE_SIZE,
          sort: sortCol,
          dir: sortDir
        })
      });
      const data = await res.json();
      setLeads(data.leads || []);
      setTotal(data.total || 0);
      setPage(data.page || pg);
      setPages(data.pages || 1);
    } catch (e) {
      console.error('Fetch leads error:', e);
    } finally {
      setLoading(false);
    }
  }, [filters, sortCol, sortDir]);

  useEffect(() => {
    fetchLeads(1);
  }, []);

  function handleFilterApply(newFilters: FilterState) {
    setFilters(newFilters);
    setSelectedIds([]);
    setSelectAllMatching(false);
    fetchLeads(1, newFilters);
  }

  function handleFilterReset() {
    const clean = defaultFilterState();
    setFilters(clean);
    setSelectedIds([]);
    setSelectAllMatching(false);
    fetchLeads(1, clean);
  }

  function handleRemoveSingleFilter(key: keyof FilterState, val?: string) {
    const next = { ...filters };
    if (key === 'carrier_statuses') {
      next.carrier_statuses = (next.carrier_statuses || []).filter(s => s !== val);
    } else if (key === 'states') {
      next.states = (next.states || []).filter(s => s !== val);
    } else if (key === 'equipment_types') {
      next.equipment_types = (next.equipment_types || []).filter(e => e !== val);
      if (next.equipment_types.length === 0 && next.equipment_mode === 'has_equipment') {
        next.equipment_mode = 'both';
      }
    } else if (key === 'equipment_mode') {
      next.equipment_mode = 'both';
      next.equipment_types = (next.equipment_types || []).filter(e => e !== 'No Equipment');
    } else if (key === 'usdot') {
      delete next.usdot;
      delete next.usdot_to;
    } else if (key === 'date_preset') {
      next.date_preset = 'all';
      delete next.date_from;
      delete next.date_to;
    } else if (key === 'advanced_rules') {
      next.advanced_rules = (next.advanced_rules || []).filter(r => r.id !== val);
    } else {
      delete (next as Record<string, unknown>)[key];
    }
    setFilters(next);
    fetchLeads(1, next);
  }

  function handleSort(col: string) {
    const newDir = sortCol === col && sortDir === 'desc' ? 'asc' : 'desc';
    setSortCol(col);
    setSortDir(newDir);
    fetchLeads(page);
  }

  function handleSelectAll() {
    if (selectedIds.length === leads.length && leads.length > 0) {
      setSelectedIds([]);
      setSelectAllMatching(false);
    } else {
      setSelectedIds(leads.map(l => l.usdot_number));
    }
  }

  function handleSelectAllDatabase() {
    setSelectAllMatching(true);
    setSelectedIds(leads.map(l => l.usdot_number));
  }

  function handleClearSelection() {
    setSelectedIds([]);
    setSelectAllMatching(false);
  }

  function handleToggleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(leads.map(l => l.usdot_number));
    } else {
      setSelectedIds([]);
      setSelectAllMatching(false);
    }
  }

  const handleSelectPageRows = handleToggleSelectAll;

  function handleToggleRow(usdot: string) {
    if (selectedIds.includes(usdot)) {
      setSelectedIds(selectedIds.filter(id => id !== usdot));
      setSelectAllMatching(false);
    } else {
      setSelectedIds([...selectedIds, usdot]);
    }
  }

  const activeFilterCount =
    (filters.global_search ? 1 : 0) +
    (filters.usdot ? 1 : 0) +
    (filters.company_name ? 1 : 0) +
    (filters.carrier_statuses?.length || 0) +
    (filters.has_phone !== null && filters.has_phone !== undefined ? 1 : 0) +
    (filters.has_email !== null && filters.has_email !== undefined ? 1 : 0) +
    (filters.states?.length || 0) +
    (filters.city ? 1 : 0) +
    (filters.date_preset && filters.date_preset !== 'all' ? 1 : 0) +
    (filters.equipment_types?.length || 0) +
    (filters.equipment_mode && filters.equipment_mode !== 'both' && filters.equipment_mode !== 'all' ? 1 : 0) +
    (filters.advanced_rules?.length || 0);

  const isAllPageSelected = leads.length > 0 && leads.every(l => selectedIds.includes(l.usdot_number));

  return (
    <div className="leads-page-container fade-up">
      {/* Top Professional Toolbar (Linear/Attio/Clay Style) */}
      <div className="crm-toolbar">
        <div className="crm-tb-left">
          {/* Global Quick Search */}
          <div className="crm-search-box">
            <span className="crm-search-icon">🔍</span>
            <input
              className="crm-search-input"
              placeholder="Search legal name, DBA, DOT, phone, email..."
              value={filters.global_search || ''}
              onChange={e => {
                const val = e.target.value;
                const next = { ...filters, global_search: val };
                setFilters(next);
                if (searchTimer.current) clearTimeout(searchTimer.current);
                searchTimer.current = setTimeout(() => fetchLeads(1, next), 400);
              }}
            />
          </div>

          {/* Filters Button */}
          <button
            className={`crm-tb-btn ${activeFilterCount > 0 ? 'active' : ''}`}
            onClick={() => setIsFilterOpen(true)}
          >
            <span>⚙️ Filters</span>
            {activeFilterCount > 0 && <span className="crm-badge">{activeFilterCount}</span>}
          </button>

          {/* Quick Equipment Filter */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <select
              className="crm-select"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: '8px',
                padding: '0.45rem 0.75rem',
                fontSize: '0.84rem',
                cursor: 'pointer',
                outline: 'none',
              }}
              value={
                (filters.equipment_types || []).includes('No Equipment') || filters.equipment_mode === 'no_equipment'
                  ? 'no_equipment'
                  : (filters.equipment_types || []).length === 1
                  ? filters.equipment_types[0]
                  : filters.equipment_mode === 'has_equipment'
                  ? 'has_equipment'
                  : 'both'
              }
              onChange={e => {
                const val = e.target.value;
                let next: FilterState;
                if (val === 'both' || val === 'all') {
                  next = { ...filters, equipment_mode: 'both', equipment_types: [] };
                } else if (val === 'no_equipment') {
                  next = { ...filters, equipment_mode: 'no_equipment', equipment_types: ['No Equipment'] };
                } else if (val === 'has_equipment') {
                  next = { ...filters, equipment_mode: 'has_equipment', equipment_types: [] };
                } else {
                  next = { ...filters, equipment_mode: 'has_equipment', equipment_types: [val] };
                }
                setFilters(next);
                fetchLeads(1, next);
              }}
            >
              <option value="both">🚛 Equipment: All / Non-Filter</option>
              <option value="no_equipment">🚫 No Equipment</option>
              <option value="has_equipment">✅ Has Equipment</option>
              <option disabled>──────────────</option>
              <option value="Power Only">⚡ Power Only</option>
              <option value="Box Truck">📦 Box Truck</option>
              <option value="Cargo Van">🚐 Cargo Van</option>
              <option value="Hauler">🚗 Hauler (Car/Auto)</option>
              <option value="Hotshot">🚀 Hotshot</option>
              <option value="Tractor">🚚 Tractor</option>
              <option value="Truck">🚛 Truck</option>
              <option value="Trailer">📦 Trailer</option>
              <option value="Van">🚐 Van / Dry Van</option>
              <option value="Flatbed">🏗️ Flatbed</option>
              <option value="Refrigerated (Reefer)">❄️ Refrigerated (Reefer)</option>
              <option value="Tanker">🛢️ Tanker</option>
              <option value="Dump Truck">🚜 Dump Truck</option>
              <option value="Specialized">⚙️ Specialized</option>
            </select>
          </div>

          {/* Saved Views Button */}
          <button className="crm-tb-btn" onClick={() => setIsSavedViewsOpen(true)}>
            <span>⭐ Saved Views</span>
          </button>
        </div>

        <div className="crm-tb-right">
          {/* Columns Selector */}
          <button className="crm-tb-btn-icon" onClick={() => setIsColumnsOpen(true)} title="Columns">
            👁️ Columns
          </button>

          {/* Export History */}
          <button className="crm-tb-btn-icon" onClick={() => setIsHistoryOpen(true)} title="History">
            📜 Audit Logs
          </button>

          {/* Export Button */}
          <button className="crm-tb-btn-export" onClick={() => setIsExportOpen(true)}>
            📥 Export ({selectAllMatching ? total : selectedIds.length > 0 ? selectedIds.length : total})
          </button>
        </div>
      </div>

      {/* Active Filter Chips Bar */}
      <FilterChips
        filters={filters}
        onRemoveFilter={handleRemoveSingleFilter}
        onClearAll={handleFilterReset}
        matchingCount={total}
        totalCount={total}
      />

      {/* Bulk Selection Banner */}
      {selectedIds.length > 0 && (
        <div className="bulk-banner fade-up">
          <span>
            ☑ <strong>{selectedIds.length}</strong> carriers on this page selected.
          </span>
          {!selectAllMatching && total > leads.length && (
            <button className="bulk-btn-link" onClick={() => setSelectAllMatching(true)}>
              Select all <strong>{total.toLocaleString()}</strong> matching carriers across database
            </button>
          )}
          {selectAllMatching && (
            <span className="bulk-all-tag">
              ✨ All {total.toLocaleString()} matching records selected for export
            </span>
          )}
          <button className="bulk-btn-clear" onClick={() => { setSelectedIds([]); setSelectAllMatching(false); }}>
            Clear Selection
          </button>
        </div>
      )}

      {/* Main Carrier Table */}
      <div className="table-wrap-card">
        <table className="crm-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>
                <input
                  type="checkbox"
                  checked={isAllPageSelected}
                  onChange={e => handleSelectPageRows(e.target.checked)}
                />
              </th>
              {visibleCols.includes('usdot_number') && (
                <th onClick={() => handleSort('usdot_number')} className="sortable">
                  USDOT # {sortCol === 'usdot_number' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                </th>
              )}
              {visibleCols.includes('legal_name') && (
                <th onClick={() => handleSort('legal_name')} className="sortable">
                  Company Name {sortCol === 'legal_name' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                </th>
              )}
              {visibleCols.includes('phone') && <th>Phone</th>}
              {visibleCols.includes('email') && <th>Email</th>}
              {visibleCols.includes('carrier_status') && (
                <th onClick={() => handleSort('carrier_status')} className="sortable">
                  Status {sortCol === 'carrier_status' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                </th>
              )}
              {visibleCols.includes('motus_entry_date') && (
                <th onClick={() => handleSort('motus_entry_date')} className="sortable">
                  MOTUS Entry {sortCol === 'motus_entry_date' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                </th>
              )}
              {visibleCols.includes('scraped_at') && (
                <th onClick={() => handleSort('scraped_at')} className="sortable">
                  Date Added {sortCol === 'scraped_at' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                </th>
              )}
              <th style={{ width: '60px' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="table-msg">
                  <span className="spinner" /> Loading target carriers…
                </td>
              </tr>
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={10} className="table-msg">
                  <div style={{ fontSize: '1.8rem', marginBottom: '0.4rem' }}>🔍</div>
                  No carriers match your active filters
                </td>
              </tr>
            ) : (
              leads.map(lead => (
                <tr
                  key={lead.usdot_number}
                  className={selectedIds.includes(lead.usdot_number) ? 'row-selected' : ''}
                  onClick={() => setSelectedLead(lead)}
                >
                  <td onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(lead.usdot_number)}
                      onChange={() => handleToggleRow(lead.usdot_number)}
                    />
                  </td>
                  {visibleCols.includes('usdot_number') && <td><span className="td-usdot">{lead.usdot_number}</span></td>}
                  {visibleCols.includes('legal_name') && (
                    <td>
                      <span className="td-name" title={lead.legal_name}>
                        {lead.legal_name || '—'}
                      </span>
                    </td>
                  )}
                  {visibleCols.includes('phone') && (
                    <td>
                      {lead.phone ? (
                        <a href={`tel:${lead.phone}`} className="td-tel" onClick={e => e.stopPropagation()}>{lead.phone}</a>
                      ) : (
                        <span className="td-empty">—</span>
                      )}
                    </td>
                  )}
                  {visibleCols.includes('email') && (
                    <td>
                      {lead.email ? (
                        <a href={`mailto:${lead.email}`} className="td-email" onClick={e => e.stopPropagation()}>{lead.email}</a>
                      ) : (
                        <span className="td-empty">—</span>
                      )}
                    </td>
                  )}
                  {visibleCols.includes('carrier_status') && (
                    <td><StatusPill status={lead.carrier_status} /></td>
                  )}
                  {visibleCols.includes('motus_entry_date') && (
                    <td className="td-date">{formatDate(lead.motus_entry_date)}</td>
                  )}
                  {visibleCols.includes('scraped_at') && (
                    <td className="td-date">{formatDate(lead.scraped_at)}</td>
                  )}
                  <td>
                    <button className="btn-view" onClick={e => { e.stopPropagation(); setSelectedLead(lead); }}>
                      View →
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      {pages > 1 && (
        <div className="crm-pagination">
          <button className="pg-btn" onClick={() => fetchLeads(1)} disabled={page <= 1}>« First</button>
          <button className="pg-btn" onClick={() => fetchLeads(page - 1)} disabled={page <= 1}>‹ Prev</button>
          <span className="pg-info">Page <strong>{page}</strong> of <strong>{pages}</strong> ({total.toLocaleString()} total)</span>
          <button className="pg-btn" onClick={() => fetchLeads(page + 1)} disabled={page >= pages}>Next ›</button>
          <button className="pg-btn" onClick={() => fetchLeads(pages)} disabled={page >= pages}>Last »</button>
        </div>
      )}

      {/* Drawers & Modals */}
      <FilterDrawer
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        filters={filters}
        onApply={handleFilterApply}
        onReset={handleFilterReset}
        totalCount={total}
      />

      <SavedViewsModal
        isOpen={isSavedViewsOpen}
        onClose={() => setIsSavedViewsOpen(false)}
        currentFilters={filters}
        onApplyView={handleFilterApply}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        filters={filters}
        matchingCount={total}
        selectedCount={selectedIds.length}
        currentPageCount={leads.length}
        selectedIds={selectedIds}
      />

      <ExportHistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />

      <ColumnVisibilityModal
        isOpen={isColumnsOpen}
        onClose={() => setIsColumnsOpen(false)}
        visibleCols={visibleCols}
        onChange={setVisibleCols}
      />

      {/* Single Lead Detail Drawer */}
      {selectedLead && (
        <>
          <div className="filter-overlay" onClick={() => setSelectedLead(null)} />
          <div className="drawer open">
            <div className="drawer-head">
              <div>
                <div className="drawer-title">{selectedLead.legal_name || '—'}</div>
                <div className="drawer-usdot">USDOT {selectedLead.usdot_number}</div>
              </div>
              <button className="drawer-close" onClick={() => setSelectedLead(null)}>✕</button>
            </div>
            <div className="drawer-body">
              {/* Quick Actions */}
              {(selectedLead.phone || selectedLead.email) && (
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  {selectedLead.phone && (
                    <a href={`tel:${selectedLead.phone}`} className="drawer-action-link dlink-green">
                      📞 {selectedLead.phone}
                    </a>
                  )}
                  {selectedLead.email && (
                    <a href={`mailto:${selectedLead.email}`} className="drawer-action-link dlink-purple">
                      ✉️ {selectedLead.email}
                    </a>
                  )}
                  <a
                    href={`/leads/${selectedLead.usdot_number}`}
                    className="drawer-action-link dlink-blue"
                    target="_blank"
                    rel="noreferrer"
                  >
                    🔗 Full Profile
                  </a>
                </div>
              )}

              <div className="drawer-section">
                <div className="drawer-section-title">Contact Information</div>
                <div className="drawer-grid">
                  <div className="df"><div className="df-label">Phone</div><div className="df-value" style={{ color: selectedLead.phone ? 'var(--green-bright,#34d399)' : 'var(--muted)' }}>{selectedLead.phone || '—'}</div></div>
                  <div className="df"><div className="df-label">Email</div><div className="df-value" style={{ color: selectedLead.email ? 'var(--purple)' : 'var(--muted)', fontSize: '0.78rem' }}>{selectedLead.email || '—'}</div></div>
                </div>
              </div>
              <div className="drawer-section">
                <div className="drawer-section-title">Status & Registration</div>
                <div className="drawer-grid">
                  <div className="df"><div className="df-label">Status</div><div className="df-value"><StatusPill status={selectedLead.carrier_status} /></div></div>
                  <div className="df"><div className="df-label">USDOT</div><div className="df-value" style={{ fontFamily: 'JetBrains Mono,monospace', color: 'var(--cyan)', fontSize: '0.78rem' }}>{selectedLead.usdot_number}</div></div>
                </div>
              </div>
              <div className="drawer-section">
                <div className="drawer-section-title">Timeline</div>
                <div className="drawer-grid">
                  <div className="df"><div className="df-label">MOTUS Entry</div><div className="df-value">{formatDate(selectedLead.motus_entry_date)}</div></div>
                  <div className="df"><div className="df-label">Date Scraped</div><div className="df-value">{formatDateFull(selectedLead.scraped_at)}</div></div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
