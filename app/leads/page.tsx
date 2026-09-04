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
    setTimeout(() => fetchLeads(page), 0);
  }

  function handleSelectPageRows(checked: boolean) {
    if (checked) {
      const pageIds = leads.map(l => l.usdot_number);
      setSelectedIds(pageIds);
    } else {
      setSelectedIds([]);
      setSelectAllMatching(false);
    }
  }

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
              placeholder="Search company, USDOT, phone, email..."
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
                  {visibleCols.includes('usdot_number') && <td className="td-usdot">{lead.usdot_number}</td>}
                  {visibleCols.includes('legal_name') && (
                    <td className="td-name" title={lead.legal_name}>
                      {lead.legal_name || '—'}
                    </td>
                  )}
                  {visibleCols.includes('phone') && (
                    <td className="td-contact">
                      {lead.phone ? (
                        <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}>{lead.phone}</a>
                      ) : (
                        <span className="td-empty">—</span>
                      )}
                    </td>
                  )}
                  {visibleCols.includes('email') && (
                    <td className="td-contact">
                      {lead.email ? (
                        <a href={`mailto:${lead.email}`} onClick={e => e.stopPropagation()}>{lead.email}</a>
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
              <div className="drawer-section">
                <div className="drawer-section-title">Contact Information</div>
                <div className="drawer-grid">
                  <div className="df"><div className="df-label">Phone</div><div className="df-value">{selectedLead.phone || '—'}</div></div>
                  <div className="df"><div className="df-label">Email</div><div className="df-value">{selectedLead.email || '—'}</div></div>
                </div>
              </div>
              <div className="drawer-section">
                <div className="drawer-section-title">Details</div>
                <div className="drawer-grid">
                  <div className="df"><div className="df-label">Status</div><div className="df-value">{selectedLead.carrier_status}</div></div>
                  <div className="df"><div className="df-label">Date Added</div><div className="df-value">{formatDateFull(selectedLead.scraped_at)}</div></div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
