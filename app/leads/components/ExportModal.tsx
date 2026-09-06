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
  /** IDs of the rows currently visible on the page — used for accurate current-page export */
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
  const BATCH_SIZE = 1000;
  const totalBatches = Math.max(1, Math.ceil(matchingCount / BATCH_SIZE));
  const [batchNum, setBatchNum] = useState(1);
  const [downloadedBatches, setDownloadedBatches] = useState<Set<number>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<'idle' | 'fetching' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync scope when selectedCount changes
  useEffect(() => {
    if (isOpen) {
      if (selectedCount > 0) {
        setScope(prev => prev === 'all_matching' ? 'selected' : prev);
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
    Math.min(BATCH_SIZE, Math.max(0, matchingCount - (batchNum - 1) * BATCH_SIZE));

  async function handleExport() {
    if (selectedCols.length === 0) return;
    setIsExporting(true);
    setExportProgress('fetching');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters,
          format,
          scope,
          selected_ids: selectedIds,
          columns: selectedCols,
          current_page_ids: scope === 'current_page' ? currentPageIds : [],
          limit: BATCH_SIZE,
          batch_num: scope === 'all_matching' ? batchNum : 1,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Export request failed');
      }

      setExportProgress('success');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leadbase_batch${batchNum}_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'csv' : format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Mark this batch as downloaded
      const nextDownloaded = new Set(downloadedBatches).add(batchNum);
      setDownloadedBatches(nextDownloaded);

      // Log to export history
      try {
        await fetch('/api/export-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_name: a.download,
            format,
            record_count: exportRecordCount,
            filter_summary: `Batch ${batchNum}/${totalBatches} — ${exportRecordCount} rows (${format.toUpperCase()})`,
            filter_state: filters,
          }),
        });
      } catch (logErr) {
        console.warn('History log warning:', logErr);
      }

      // Auto-advance to next batch if more remain
      setTimeout(() => {
        setExportProgress('idle');
        setIsExporting(false);
        if (batchNum < totalBatches) {
          setBatchNum(batchNum + 1);
        }
      }, 700);
      return; // skip the finally setIsExporting below (handled in setTimeout)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed. Please check server logs.';
      setErrorMessage(msg);
      setExportProgress('idle');
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '580px' }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">📥 Export Carriers</div>
            <div className="modal-sub">
              <strong>{exportRecordCount.toLocaleString()}</strong> carriers ready for export
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
              padding: '0.7rem 1rem',
              marginBottom: '1rem',
              color: '#fca5a5',
              fontSize: '0.83rem',
            }}>
              ⚠️ {errorMessage}
            </div>
          )}

          {/* Format selection */}
          <div className="ex-group">
            <label className="modal-label">1. File Format</label>
            <div className="ex-radio-cards">
              {[
                { id: 'csv', label: 'CSV', desc: 'Standard CSV file' },
                { id: 'excel', label: 'Excel (XLSX)', desc: 'CSV optimized for Microsoft Excel' },
                { id: 'json', label: 'JSON', desc: 'Structured JSON objects' },
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

          {/* Scope selection */}
          <div className="ex-group">
            <label className="modal-label">2. Target Records</label>
            <div className="ex-scope-list">
              <label className={`ex-scope-item ${scope === 'all_matching' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'all_matching'}
                  onChange={() => setScope('all_matching')}
                />
                <div style={{ width: '100%' }}>
                  <strong>All {matchingCount.toLocaleString()} matching carriers</strong>
                  <span className="ex-subtext">1,000 per batch · {totalBatches} batch{totalBatches !== 1 ? 'es' : ''} total</span>
                  {scope === 'all_matching' && totalBatches > 1 && (
                    <div style={{ marginTop: '0.6rem' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: '0.35rem' }}>Select batch to download:</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                        {Array.from({ length: totalBatches }, (_, i) => i + 1).map(n => {
                          const isDone = downloadedBatches.has(n);
                          const isCurrent = batchNum === n;
                          const from = (n - 1) * BATCH_SIZE + 1;
                          const to = Math.min(n * BATCH_SIZE, matchingCount);
                          return (
                            <button
                              key={n}
                              type="button"
                              title={`Rows ${from.toLocaleString()}–${to.toLocaleString()}`}
                              onClick={e => { e.preventDefault(); setBatchNum(n); }}
                              style={{
                                padding: '0.2rem 0.55rem',
                                fontSize: '0.72rem',
                                borderRadius: '5px',
                                border: isCurrent ? '1px solid var(--cyan)' : isDone ? '1px solid rgba(52,211,153,0.5)' : '1px solid var(--border)',
                                background: isCurrent ? 'rgba(34,211,238,0.15)' : isDone ? 'rgba(52,211,153,0.1)' : 'var(--bg2)',
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
                      <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.3rem' }}>
                        Batch {batchNum}: rows {((batchNum - 1) * BATCH_SIZE + 1).toLocaleString()}–{Math.min(batchNum * BATCH_SIZE, matchingCount).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              </label>

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
                    <span className="ex-subtext">Exports only rows you manually checked</span>
                  </div>
                </label>
              )}

              <label className={`ex-scope-item ${scope === 'current_page' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'current_page'}
                  onChange={() => setScope('current_page')}
                />
                <div>
                  <strong>Current page ({currentPageCount} records)</strong>
                  <span className="ex-subtext">Exports only the currently visible {currentPageCount} rows</span>
                </div>
              </label>
            </div>
          </div>

          {/* Column selector */}
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

          {/* Active Export Status Banner */}
          {isExporting && (
            <div style={{
              marginTop: '1rem',
              padding: '0.75rem 1rem',
              background: 'rgba(34, 211, 238, 0.08)',
              border: '1px solid rgba(34, 211, 238, 0.25)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <span style={{ fontSize: '1.2rem', display: 'inline-block' }}>⚡</span>
              <div>
                <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--cyan)' }}>
                  {exportProgress === 'success'
                    ? `✓ Batch ${batchNum} downloaded!${batchNum < totalBatches ? ` Advancing to batch ${batchNum + 1}…` : ' All done!'}`
                    : `Fetching batch ${batchNum}/${totalBatches} (${exportRecordCount.toLocaleString()} rows)…`}
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                  {exportProgress === 'success'
                    ? 'Your browser will save the file momentarily.'
                    : `Rows ${((batchNum - 1) * BATCH_SIZE + 1).toLocaleString()}–${Math.min(batchNum * BATCH_SIZE, matchingCount).toLocaleString()} · ${format.toUpperCase()}`}
                </div>
              </div>
            </div>
          )}

          {/* Batch progress summary */}
          {downloadedBatches.size > 0 && !isExporting && (
            <div style={{
              marginTop: '0.75rem',
              padding: '0.5rem 0.75rem',
              background: 'rgba(52,211,153,0.07)',
              border: '1px solid rgba(52,211,153,0.25)',
              borderRadius: '7px',
              fontSize: '0.76rem',
              color: '#34d399',
            }}>
              ✓ {downloadedBatches.size}/{totalBatches} batch{downloadedBatches.size !== 1 ? 'es' : ''} downloaded
              {downloadedBatches.size < totalBatches && (
                <span style={{ color: 'var(--muted)', marginLeft: '0.4rem' }}>· {totalBatches - downloadedBatches.size} remaining</span>
              )}
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
              ? `✓ Batch ${batchNum} Done!`
              : isExporting
              ? '⏳ Exporting…'
              : scope === 'all_matching' && totalBatches > 1
              ? `Download Batch ${batchNum} (${exportRecordCount.toLocaleString()} leads)`
              : `Export ${exportRecordCount.toLocaleString()} Carriers`}
          </button>
        </div>
      </div>
    </div>
  );
}
