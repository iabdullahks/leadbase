'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Carrier, FilterState } from '@/lib/types';
import { defaultFilterState } from '@/lib/queryBuilder';
import FilterDrawer from './components/FilterDrawer';
import FilterChips from './components/FilterChips';
import SavedViewsModal from './components/SavedViewsModal';
import ExportModal from './components/ExportModal';
import ExportErrorBoundary from './components/ExportErrorBoundary';
import ExportHistoryDrawer from './components/ExportHistoryDrawer';
import ColumnVisibilityModal from './components/ColumnVisibilityModal';
import EquipmentDropdown from './components/EquipmentDropdown';
import StatusDropdown from './components/StatusDropdown';
import DateDropdown from './components/DateDropdown';
import SortDropdown from './components/SortDropdown';
import { downloadSingleLeadCsv } from '@/lib/exportSingleLead';
import {
  SearchIcon,
  FilterIcon,
  DownloadIcon,
  HistoryIcon,
  BookmarkIcon,
  ColumnsIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowUpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PhoneIcon,
  MailIcon,
  ExternalLinkIcon,
  XIcon,
  ClockIcon,
  FileSpreadsheetIcon
} from '@/app/components/Icons';

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
  return (
    <span className={`pill ${cls}`}>
      <span className="pill-dot" />
      {status || 'Unknown'}
    </span>
  );
}

export default function LeadsPage() {
  // Main data state
  const [leads, setLeads] = useState<Carrier[]>([]);
  const [total, setTotal] = useState(0);
  const [dbTotalCount, setDbTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Active Filter State
  const [filters, setFilters] = useState<FilterState>(defaultFilterState());
  const [sortCol, setSortCol] = useState('added_to_motus');
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
    'usdot_number', 'legal_name', 'phone', 'email', 'carrier_status', 'added_to_motus'
  ]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcut to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch leads from server
  const fetchLeads = useCallback(async (
    pg = 1,
    currentFilters = filters,
    currentSortCol = sortCol,
    currentSortDir = sortDir
  ) => {
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
          sort: currentSortCol,
          dir: currentSortDir
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
    fetch('/api/stats')
      .then(r => r.json())
      .then(d => {
        if (typeof d.total === 'number' && d.total > 0) {
          setDbTotalCount(d.total);
        }
      })
      .catch(() => {});
  }, []);

  function handleFilterApply(newFilters: FilterState) {
    setFilters(newFilters);
    setSelectedIds([]);
    setSelectAllMatching(false);
    fetchLeads(1, newFilters, sortCol, sortDir);
  }

  function handleFilterReset() {
    const clean = defaultFilterState();
    setFilters(clean);
    setSelectedIds([]);
    setSelectAllMatching(false);
    fetchLeads(1, clean, sortCol, sortDir);
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
    } else if (key === 'has_phone') {
      next.has_phone = null;
    } else if (key === 'has_email') {
      next.has_email = null;
    } else if (key === 'contact_completeness') {
      next.contact_completeness = '';
    } else if (key === 'legal_name') {
      delete next.legal_name;
    } else {
      delete (next as Record<string, unknown>)[key];
    }
    setFilters(next);
    fetchLeads(1, next, sortCol, sortDir);
  }

  function handleSort(col: string, dir?: 'asc' | 'desc') {
    const newDir = dir || (sortCol === col && sortDir === 'desc' ? 'asc' : 'desc');
    setSortCol(col);
    setSortDir(newDir);
    fetchLeads(1, filters, col, newDir);
  }

  function handleToggleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(leads.map(l => l.usdot_number));
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
    (filters.equipment_types?.length || 0) +
    (filters.equipment_mode && filters.equipment_mode !== 'both' && filters.equipment_mode !== 'all' ? 1 : 0) +
    (filters.advanced_rules?.length || 0);

  const isAllPageSelected = leads.length > 0 && leads.every(l => selectedIds.includes(l.usdot_number));

  function renderSortIcon(colName: string) {
    if (sortCol !== colName) return <ArrowUpDownIcon size={12} style={{ opacity: 0.4, marginLeft: 4 }} />;
    return sortDir === 'asc' ? (
      <ArrowUpIcon size={12} style={{ color: 'var(--cyan)', marginLeft: 4 }} />
    ) : (
      <ArrowDownIcon size={12} style={{ color: 'var(--cyan)', marginLeft: 4 }} />
    );
  }

  return (
    <div className="leads-page-container fade-up">
      {/* Linear-Style Command Toolbar */}
      <div className="crm-toolbar">
        <div className="crm-tb-left">
          {/* Quick Search */}
          <div className="crm-search-box">
            <span className="crm-search-icon">
              <SearchIcon size={14} />
            </span>
            <input
              ref={searchInputRef}
              className="crm-search-input"
              placeholder="Search legal name, DOT, phone, email…"
              value={filters.global_search || ''}
              onChange={e => {
                const val = e.target.value;
                const next = { ...filters, global_search: val };
                setFilters(next);
                if (searchTimer.current) clearTimeout(searchTimer.current);
                searchTimer.current = setTimeout(() => fetchLeads(1, next), 400);
              }}
            />
            <span className="crm-search-kbd">⌘K</span>
          </div>

          {/* Full Filters Drawer Trigger */}
          <button
            className={`crm-tb-btn ${activeFilterCount > 0 ? 'active' : ''}`}
            onClick={() => setIsFilterOpen(true)}
          >
            <FilterIcon size={13} />
            <span>Filters</span>
            {activeFilterCount > 0 && <span className="crm-badge">{activeFilterCount}</span>}
          </button>

          {/* Quick Status Filter Popover */}
          <StatusDropdown
            filters={filters}
            onChange={next => {
              setFilters(next);
              fetchLeads(1, next);
            }}
          />

          {/* Quick Equipment Filter Popover */}
          <EquipmentDropdown
            filters={filters}
            onChange={next => {
              setFilters(next);
              fetchLeads(1, next, sortCol, sortDir);
            }}
          />

          {/* Quick Motus Date Filter Popover */}
          <DateDropdown
            filters={filters}
            onChange={next => {
              setFilters(next);
              fetchLeads(1, next, sortCol, sortDir);
            }}
          />

          {/* Quick Sort Dropdown */}
          <SortDropdown
            sortCol={sortCol}
            sortDir={sortDir}
            onChange={handleSort}
          />

          {/* Saved Views Popover */}
          <button className="crm-tb-btn" onClick={() => setIsSavedViewsOpen(true)}>
            <BookmarkIcon size={13} />
            <span>Saved Views</span>
          </button>
        </div>

        <div className="crm-tb-right">
          {/* Columns Selector */}
          <button className="crm-tb-btn-icon" onClick={() => setIsColumnsOpen(true)} title="Customize table columns">
            <ColumnsIcon size={13} />
            <span>Columns</span>
          </button>

          {/* Audit History */}
          <button className="crm-tb-btn-icon" onClick={() => setIsHistoryOpen(true)} title="View export audit trail">
            <HistoryIcon size={13} />
            <span>Audit Trail</span>
          </button>

          {/* Export Primary Action */}
          <button className="crm-tb-btn-export" onClick={() => setIsExportOpen(true)}>
            <DownloadIcon size={14} />
            <span>Export ({selectAllMatching ? total.toLocaleString() : selectedIds.length > 0 ? selectedIds.length.toLocaleString() : total.toLocaleString()})</span>
          </button>
        </div>
      </div>

      {/* Active Filter Chips Bar */}
      <FilterChips
        filters={filters}
        onRemoveFilter={handleRemoveSingleFilter}
        onClearAll={handleFilterReset}
        matchingCount={total}
        totalCount={dbTotalCount || total}
      />

      {/* Bulk Selection Banner */}
      {selectedIds.length > 0 && (
        <div className="bulk-banner fade-up">
          <span>
            <strong>{selectedIds.length}</strong> carriers on this page selected.
          </span>
          {!selectAllMatching && total > leads.length && (
            <button className="bulk-btn-link" onClick={() => setSelectAllMatching(true)}>
              Select all {total.toLocaleString()} matching carriers across database
            </button>
          )}
          {selectAllMatching && (
            <span className="bulk-all-tag">
              All {total.toLocaleString()} matching records selected for export
            </span>
          )}
          <button
            className="bulk-btn-clear"
            onClick={() => { setSelectedIds([]); setSelectAllMatching(false); }}
          >
            Clear Selection
          </button>
        </div>
      )}

      {/* Main Carrier Data Table */}
      <div className="table-wrap-card">
        <table className="crm-table">
          <thead>
            <tr>
              <th style={{ width: '38px', paddingLeft: '1rem' }}>
                <input
                  type="checkbox"
                  checked={isAllPageSelected}
                  onChange={e => handleToggleSelectAll(e.target.checked)}
                />
              </th>
              {visibleCols.includes('usdot_number') && (
                <th onClick={() => handleSort('usdot_number')} className={`sortable ${sortCol === 'usdot_number' ? 'sorted' : ''}`}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    USDOT # {renderSortIcon('usdot_number')}
                  </span>
                </th>
              )}
              {visibleCols.includes('legal_name') && (
                <th onClick={() => handleSort('legal_name')} className={`sortable ${sortCol === 'legal_name' ? 'sorted' : ''}`}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Company Name {renderSortIcon('legal_name')}
                  </span>
                </th>
              )}
              {visibleCols.includes('phone') && <th>Phone</th>}
              {visibleCols.includes('email') && <th>Email</th>}
              {visibleCols.includes('carrier_status') && (
                <th onClick={() => handleSort('carrier_status')} className={`sortable ${sortCol === 'carrier_status' ? 'sorted' : ''}`}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Status {renderSortIcon('carrier_status')}
                  </span>
                </th>
              )}
              {(visibleCols.includes('added_to_motus') || visibleCols.includes('scraped_at') || visibleCols.includes('motus_entry_date')) && (
                <th onClick={() => handleSort('added_to_motus')} className={`sortable ${sortCol === 'added_to_motus' ? 'sorted' : ''}`}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Added on Motus {renderSortIcon('added_to_motus')}
                  </span>
                </th>
              )}
              <th style={{ width: '130px', textAlign: 'right', paddingRight: '1rem' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="table-msg">
                  <span className="spinner" style={{ marginRight: '0.6rem' }} />
                  Loading carrier records…
                </td>
              </tr>
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={10} className="table-msg">
                  <div style={{ color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>
                    <SearchIcon size={24} />
                  </div>
                  <div>No carriers match your active filters</div>
                  <div style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>Try clearing or relaxing some search parameters.</div>
                </td>
              </tr>
            ) : (
              leads.map(lead => (
                <tr
                  key={lead.usdot_number}
                  className={selectedIds.includes(lead.usdot_number) ? 'row-selected' : ''}
                  onClick={() => setSelectedLead(lead)}
                >
                  <td style={{ paddingLeft: '1rem' }} onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(lead.usdot_number)}
                      onChange={() => handleToggleRow(lead.usdot_number)}
                    />
                  </td>
                  {visibleCols.includes('usdot_number') && (
                    <td>
                      <span className="td-usdot">#{lead.usdot_number}</span>
                    </td>
                  )}
                  {visibleCols.includes('legal_name') && (
                    <td>
                      <span className="td-name" title={lead.legal_name || ''}>
                        {lead.legal_name || 'Unnamed Carrier'}
                      </span>
                    </td>
                  )}
                  {visibleCols.includes('phone') && (
                    <td>
                      {lead.phone ? (
                        <a href={`tel:${lead.phone}`} className="td-tel" onClick={e => e.stopPropagation()}>
                          <PhoneIcon size={12} />
                          <span>{lead.phone}</span>
                        </a>
                      ) : (
                        <span className="td-empty">—</span>
                      )}
                    </td>
                  )}
                  {visibleCols.includes('email') && (
                    <td>
                      {lead.email ? (
                        <a href={`mailto:${lead.email}`} className="td-email" onClick={e => e.stopPropagation()}>
                          <MailIcon size={12} />
                          <span style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.email}</span>
                        </a>
                      ) : (
                        <span className="td-empty">—</span>
                      )}
                    </td>
                  )}
                  {visibleCols.includes('carrier_status') && (
                    <td><StatusPill status={lead.carrier_status} /></td>
                  )}
                  {(visibleCols.includes('added_to_motus') || visibleCols.includes('scraped_at') || visibleCols.includes('motus_entry_date')) && (
                    <td className="td-date">{formatDate(lead.added_to_motus || lead.motus_entry_date)}</td>
                  )}
                  <td style={{ textAlign: 'right', paddingRight: '1rem', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                      <button className="btn-view" onClick={() => setSelectedLead(lead)}>
                        <span>View</span>
                        <ChevronRightIcon size={11} />
                      </button>
                      <button
                        type="button"
                        className="btn-csv-single"
                        onClick={() => downloadSingleLeadCsv(lead)}
                        title="Download this single lead as CSV"
                      >
                        <DownloadIcon size={11} />
                        <span>CSV</span>
                      </button>
                    </div>
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
          <button className="pg-btn" onClick={() => fetchLeads(page - 1)} disabled={page <= 1}>
            <ChevronLeftIcon size={12} style={{ verticalAlign: 'middle' }} />
          </button>
          <span className="pg-info">
            Page <strong>{page}</strong> of <strong>{pages}</strong> ({total.toLocaleString()} total)
          </span>
          <button className="pg-btn" onClick={() => fetchLeads(page + 1)} disabled={page >= pages}>
            <ChevronRightIcon size={12} style={{ verticalAlign: 'middle' }} />
          </button>
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
        totalCount={dbTotalCount || total}
      />

      <SavedViewsModal
        isOpen={isSavedViewsOpen}
        onClose={() => setIsSavedViewsOpen(false)}
        currentFilters={filters}
        onApplyView={handleFilterApply}
      />

      <ExportErrorBoundary onReset={() => setIsExportOpen(false)}>
        <ExportModal
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          filters={filters}
          matchingCount={total || 0}
          selectedCount={selectAllMatching ? 0 : (selectedIds?.length || 0)}
          currentPageCount={leads?.length || 0}
          selectedIds={selectAllMatching ? [] : (selectedIds || [])}
          currentPageIds={(leads || []).map(l => l.usdot_number)}
        />
      </ExportErrorBoundary>

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

      {/* Single Lead Detail Quick Drawer */}
      {selectedLead && (
        <>
          <div className="filter-overlay" onClick={() => setSelectedLead(null)} />
          <div className="drawer open">
            <div className="drawer-head">
              <div>
                <div className="drawer-title">{selectedLead.legal_name || 'Unnamed Carrier'}</div>
                <div className="drawer-usdot">USDOT #{selectedLead.usdot_number}</div>
              </div>
              <button className="drawer-close" onClick={() => setSelectedLead(null)} aria-label="Close detail">
                <XIcon size={16} />
              </button>
            </div>
            <div className="drawer-body">
              {/* Quick Actions */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => downloadSingleLeadCsv(selectedLead)}
                  className="drawer-action-link"
                  style={{
                    background: 'rgba(6,182,212,0.1)',
                    borderColor: 'rgba(6,182,212,0.3)',
                    color: 'var(--cyan-light)',
                    cursor: 'pointer',
                  }}
                  title="Download this lead as CSV"
                >
                  <DownloadIcon size={13} />
                  <span>Export CSV</span>
                </button>
                {selectedLead.phone && (
                  <a href={`tel:${selectedLead.phone}`} className="drawer-action-link dlink-green">
                    <PhoneIcon size={13} />
                    <span>{selectedLead.phone}</span>
                  </a>
                )}
                {selectedLead.email && (
                  <a href={`mailto:${selectedLead.email}`} className="drawer-action-link dlink-purple">
                    <MailIcon size={13} />
                    <span>Email Carrier</span>
                  </a>
                )}
                <a
                  href={`/leads/${selectedLead.usdot_number}`}
                  className="drawer-action-link dlink-blue"
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLinkIcon size={13} />
                  <span>Full Profile</span>
                </a>
              </div>

              <div className="drawer-section">
                <div className="drawer-section-title">Contact Information</div>
                <div className="drawer-grid">
                  <div className="df">
                    <div className="df-label">Direct Phone</div>
                    <div className="df-value" style={{ color: selectedLead.phone ? '#34d399' : 'var(--text-tertiary)' }}>
                      {selectedLead.phone || '—'}
                    </div>
                  </div>
                  <div className="df">
                    <div className="df-label">Direct Email</div>
                    <div className="df-value" style={{ color: selectedLead.email ? '#c084fc' : 'var(--text-tertiary)' }}>
                      {selectedLead.email || '—'}
                    </div>
                  </div>
                  {selectedLead.principal_address && (
                    <div className="df">
                      <div className="df-label">Principal Address</div>
                      <div className="df-value">{selectedLead.principal_address}</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="drawer-section">
                <div className="drawer-section-title">Authority &amp; Classification</div>
                <div className="drawer-grid">
                  <div className="df">
                    <div className="df-label">Carrier Status</div>
                    <div className="df-value"><StatusPill status={selectedLead.carrier_status} /></div>
                  </div>
                  <div className="df">
                    <div className="df-label">USDOT Number</div>
                    <div className="df-value" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--cyan)' }}>
                      #{selectedLead.usdot_number}
                    </div>
                  </div>
                  {selectedLead.form_of_business && (
                    <div className="df">
                      <div className="df-label">Business Structure</div>
                      <div className="df-value">{selectedLead.form_of_business}</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="drawer-section">
                <div className="drawer-section-title">Motus Discovery Timeline</div>
                <div className="drawer-grid">
                  <div className="df">
                    <div className="df-label">Added on Motus</div>
                    <div className="df-value">{formatDateFull(selectedLead.added_to_motus || selectedLead.motus_entry_date)}</div>
                  </div>
                  <div className="df">
                    <div className="df-label">Last Ingested</div>
                    <div className="df-value">{formatDateFull(selectedLead.scraped_at)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
