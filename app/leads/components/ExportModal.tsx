'use client';

import { useState, useEffect } from 'react';
import { FilterState } from '@/lib/types';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  filters: FilterState;
  matchingCount: number;
  selectedCount: number;
  currentPageCount: number;
  selectedIds: string[];
  currentPageIds?: string[];
}

const ALL_COLUMNS = [
  { id: 'usdot_number', label: 'USDOT Number' },
  { id: 'legal_name', label: 'Legal Name' },
  { id: 'dba_name', label: 'DBA Name' },
  { id: 'mc_number', label: 'MC Number' },
  { id: 'phone', label: 'Phone Number' },
  { id: 'email', label: 'Email Address' },
  { id: 'carrier_status', label: 'Carrier Status' },
  { id: 'out_of_service', label: 'Out of Service' },
  { id: 'principal_address', label: 'Principal Address' },
  { id: 'state_incorporated', label: 'State' },
  { id: 'motus_entry_date', label: 'MOTUS Entry Date' },
  { id: 'motus_last_updated', label: 'MOTUS Last Updated' },
  { id: 'scraped_at', label: 'Date Added' },
  { id: 'profile_url', label: 'MOTUS Profile Link' },
];

const BATCH_SIZE_OPTIONS = [1000, 2500, 5000, 10000];

export default function ExportModal({
  isOpen,
  onClose,
  filters,
  matchingCount,
  selectedCount,
  currentPageCount,
  selectedIds,
  currentPageIds = [],
}: ExportModalProps) {
  const [format, setFormat] = useState<'csv' | 'excel' | 'json'>('csv');
  const [scope, setScope] = useState<'all_matching' | 'selected' | 'current_page'>(
    selectedCount > 0 ? 'selected' : 'all_matching'
  );
  const [selectedCols, setSelectedCols] = useState<string[]>(ALL_COLUMNS.map(c => c.id));
  const [batchSize, setBatchSize] = useState<number>(1000);
  const [batchNum, setBatchNum] = useState<number>(1);
  const [downloadedBatches, setDownloadedBatches] = useState<Set<number>>(new Set());
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<'idle' | 'fetching' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const totalBatches = Math.max(1, Math.ceil(matchingCount / batchSize));

  // Sync scope when selectedCount changes
  useEffect(() => {
    if (isOpen) {
      if (selectedCount > 0) {
        setScope('selected');
      } else {
        setScope(prev => prev === 'selected' ? 'all_matching' : prev);
      }
      setErrorMessage(null);
      setExportProgress('idle');
    }
  }, [isOpen, selectedCount]);

  if (!isOpen) return null;

  function toggleColumn(colId: string) {
    if (selectedCols.includes(colId)) {
      setSelectedCols(selectedCols.filter(c => c !== colId));
    } else {
      setSelectedCols([...selectedCols, colId]);
    }
  }

  function selectAllCols() {
    setSelectedCols(ALL_COLUMNS.map(c => c.id));
  }

  function clearAllCols() {
    setSelectedCols(['usdot_number', 'legal_name']);
  }

  const exportRecordCount =
    scope === 'selected' ? selectedCount :
    scope === 'current_page' ? currentPageCount :
    Math.min(batchSize, Math.max(0, matchingCount - (batchNum - 1) * batchSize));

  async function handleExport() {
    if (selectedCols.length === 0) return;
    setIsExporting(true);
    setExportProgress('fetching');
    setErrorMessage(null);

    try {
      const params = {
        filters,
        format,
        scope,
        selected_ids: selectedIds,
        columns: selectedCols,
        current_page_ids: scope === 'current_page' ? currentPageIds : [],
        limit: batchSize,
        batch_num: scope === 'all_matching' ? batchNum : 1,
      };

      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Export failed (HTTP ${res.status})`);
      }

      // Read Content-Disposition header to get server filename
      let fileName = `leadbase_export_${exportRecordCount}_leads_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'csv' : format}`;
      const disposition = res.headers.get('Content-Disposition');
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match?.[1]) fileName = match[1];
      }

      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        throw new Error('Server returned an empty export file. Please check your filters.');
      }

      // Browser-native Blob download — 100% reliable, zero popup block, zero navigation cancellation
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.style.display = 'none';
      link.href = blobUrl;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();

      // Clean up blob URL after small delay
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      }, 3000);

      setExportProgress('success');
      setDownloadedBatches(prev => new Set(prev).add(batchNum));

      // Fire-and-forget export history log
      fetch('/api/export-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: fileName,
          format,
          record_count: exportRecordCount,
          filter_summary: scope === 'all_matching'
            ? `Batch ${batchNum}/${totalBatches} (${exportRecordCount} leads)`
            : `${exportRecordCount} ${scope} leads`,
          filter_state: filters,
        }),
      }).catch(e => console.warn('History log warning:', e));

      setTimeout(() => {
        setExportProgress('idle');
        setIsExporting(false);
        if (scope === 'all_matching' && batchNum < totalBatches) {
          setBatchNum(b => b + 1);
        }
      }, 1500);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed. Please try again.';
      setErrorMessage(msg);
      setExportProgress('idle');
      setIsExporting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '620px' }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">📥 Export Leads to CSV</div>
            <div className="modal-sub">
              <strong>{exportRecordCount.toLocaleString()}</strong> carriers ready for immediate export
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {errorMessage && (
            <div style={{
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: '8px',
              padding: '0.75rem 1rem',
              color: '#fca5a5',
              fontSize: '0.83rem',
            }}>
              ⚠️ {errorMessage}
            </div>
          )}

          {/* 1. File Format */}
          <div className="ex-group">
            <label className="modal-label">1. File Format</label>
            <div className="ex-radio-cards">
              {[
                { id: 'csv', label: 'CSV', desc: 'Universal CSV (UTF-8)' },
                { id: 'excel', label: 'Excel CSV', desc: 'Optimized for MS Excel' },
                { id: 'json', label: 'JSON', desc: 'Raw structured JSON' },
              ].map(f => (
                <label key={f.id} className={`ex-card ${format === f.id ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="format"
                    checked={format === f.id}
                    onChange={() => setFormat(f.id as 'csv' | 'excel' | 'json')}
                  />
                  <div>
                    <div className="ex-card-title">{f.label}</div>
                    <div className="ex-card-desc">{f.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* 2. Target Scope */}
          <div className="ex-group">
            <label className="modal-label">2. Target Scope</label>
            <div className="ex-scope-list">
              {selectedCount > 0 && (
                <label className={`ex-scope-item ${scope === 'selected' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === 'selected'}
                    onChange={() => setScope('selected')}
                  />
                  <div>
                    <strong>{selectedCount.toLocaleString()} selected records</strong>
                    <span className="ex-subtext">Exports only the specific leads you manually checked</span>
                  </div>
                </label>
              )}

              <label className={`ex-scope-item ${scope === 'all_matching' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'all_matching'}
                  onChange={() => setScope('all_matching')}
                />
                <div style={{ width: '100%' }}>
                  <strong>All {matchingCount.toLocaleString()} matching carriers</strong>
                  <span className="ex-subtext">Export in high-speed chunks (select chunk size below)</span>

                  {scope === 'all_matching' && (
                    <div style={{ marginTop: '0.75rem', padding: '0.65rem 0.8rem', background: 'rgba(255,255,255,0.025)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text)' }}>Bulk Export Size:</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--muted2)' }}>{totalBatches} total batch{totalBatches !== 1 ? 'es' : ''}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {BATCH_SIZE_OPTIONS.map(sz => (
                          <button
                            key={sz}
                            type="button"
                            onClick={() => { setBatchSize(sz); setBatchNum(1); }}
                            style={{
                              padding: '0.3rem 0.65rem',
                              fontSize: '0.74rem',
                              borderRadius: '6px',
                              border: batchSize === sz ? '1px solid var(--cyan)' : '1px solid var(--border)',
                              background: batchSize === sz ? 'rgba(34,211,238,0.18)' : 'var(--bg)',
                              color: batchSize === sz ? 'var(--cyan)' : 'var(--muted2)',
                              cursor: 'pointer',
                              fontWeight: batchSize === sz ? 700 : 500,
                            }}
                          >
                            {sz.toLocaleString()} rows / batch
                          </button>
                        ))}
                      </div>

                      {totalBatches > 1 && (
                        <div style={{ marginTop: '0.6rem' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '0.35rem' }}>Select batch number:</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', maxHeight: '100px', overflowY: 'auto' }}>
                            {Array.from({ length: Math.min(totalBatches, 50) }, (_, i) => i + 1).map(n => {
                              const isDone = downloadedBatches.has(n);
                              const isCurrent = batchNum === n;
                              return (
                                <button
                                  key={n}
                                  type="button"
                                  onClick={() => setBatchNum(n)}
                                  style={{
                                    padding: '0.2rem 0.5rem',
                                    fontSize: '0.72rem',
                                    borderRadius: '5px',
                                    border: isCurrent ? '1px solid var(--cyan)' : isDone ? '1px solid rgba(52,211,153,0.5)' : '1px solid var(--border)',
                                    background: isCurrent ? 'rgba(34,211,238,0.15)' : isDone ? 'rgba(52,211,153,0.1)' : 'var(--bg)',
                                    color: isCurrent ? 'var(--cyan)' : isDone ? '#34d399' : 'var(--muted2)',
                                    cursor: 'pointer',
                                    fontWeight: isCurrent ? 700 : 400,
                                  }}
                                >
                                  {isDone ? `✓ ${n}` : n}
                                </button>
                              );
                            })}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
                            Batch {batchNum}: rows {((batchNum - 1) * batchSize + 1).toLocaleString()}–{Math.min(batchNum * batchSize, matchingCount).toLocaleString()}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </label>

              <label className={`ex-scope-item ${scope === 'current_page' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'current_page'}
                  onChange={() => setScope('current_page')}
                />
                <div>
                  <strong>Current page ({currentPageCount} records)</strong>
                  <span className="ex-subtext">Exports only the currently visible {currentPageCount} rows on this page</span>
                </div>
              </label>
            </div>
          </div>

          {/* 3. Export Fields */}
          <div className="ex-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label className="modal-label" style={{ marginBottom: 0 }}>3. Select Export Fields ({selectedCols.length})</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="fp-link-btn" onClick={selectAllCols}>Select All</button>
                <button className="fp-link-btn" onClick={clearAllCols}>Clear All</button>
              </div>
            </div>

            <div className="ex-cols-grid">
              {ALL_COLUMNS.map(col => (
                <label key={col.id} className={`ex-col-item ${selectedCols.includes(col.id) ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selectedCols.includes(col.id)}
                    onChange={() => toggleColumn(col.id)}
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Live Progress Banner */}
          {isExporting && (
            <div style={{
              padding: '0.75rem 1rem',
              background: 'rgba(34, 211, 238, 0.08)',
              border: '1px solid rgba(34, 211, 238, 0.3)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <span className="spinner" style={{ width: '18px', height: '18px' }} />
              <div>
                <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--cyan)' }}>
                  {exportProgress === 'success'
                    ? `✓ Download completed!`
                    : `Fetching ${exportRecordCount.toLocaleString()} leads from Supabase...`}
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                  Processing data chunks in parallel and preparing CSV stream...
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={isExporting}>Cancel</button>
          <button
            className="btn-primary-lg"
            onClick={handleExport}
            disabled={isExporting || selectedCols.length === 0}
          >
            {exportProgress === 'success'
              ? '✓ Downloaded!'
              : isExporting
              ? '⏳ Fetching & Downloading...'
              : `📥 Export ${exportRecordCount.toLocaleString()} Carriers (${format.toUpperCase()})`}
          </button>
        </div>
      </div>
    </div>
  );
}
