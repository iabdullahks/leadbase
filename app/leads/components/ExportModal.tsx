'use client';

import { useState, useEffect, useRef } from 'react';
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

const CHUNK_SIZE = 2500; // Optimal speed (1.5-2s per chunk, zero Vercel timeout)
const MAX_AUTO_CHUNK_LIMIT = 50000; // Download up to 50k leads in a single combined CSV

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
  const [exportMode, setExportMode] = useState<'all_stream' | 'batch'>('all_stream');
  const [selectedCols, setSelectedCols] = useState<string[]>(ALL_COLUMNS.map(c => c.id));
  const [batchSize, setBatchSize] = useState<number>(1000);
  const [batchNum, setBatchNum] = useState<number>(1);
  const [downloadedBatches, setDownloadedBatches] = useState<Set<number>>(new Set());
  
  // Progress states
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStatus, setProgressStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cancelRef = useRef<boolean>(false);

  const totalBatches = Math.max(1, Math.ceil(matchingCount / batchSize));

  // Determine how many records will be downloaded in the chosen mode
  const targetAllCount = Math.min(matchingCount, MAX_AUTO_CHUNK_LIMIT);
  const exportRecordCount =
    scope === 'selected' ? selectedCount :
    scope === 'current_page' ? currentPageCount :
    exportMode === 'all_stream' ? targetAllCount :
    Math.min(batchSize, Math.max(0, matchingCount - (batchNum - 1) * batchSize));

  // Sync scope when selectedCount changes
  useEffect(() => {
    if (isOpen) {
      if (selectedCount > 0) {
        setScope('selected');
      } else {
        setScope(prev => prev === 'selected' ? 'all_matching' : prev);
      }
      setErrorMessage(null);
      setIsExporting(false);
      setProgressPercent(0);
      cancelRef.current = false;
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

  function triggerBlobDownload(blob: Blob, filename: string) {
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = blobUrl;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    }, 3000);
  }

  async function handleExport() {
    if (selectedCols.length === 0) return;
    setIsExporting(true);
    setErrorMessage(null);
    setProgressPercent(5);
    cancelRef.current = false;

    const dateStr = new Date().toISOString().slice(0, 10);

    try {
      // ── MODE 1: All Matching Auto-Chunked Combined Stream ─────────────────────
      if (scope === 'all_matching' && exportMode === 'all_stream') {
        const totalTarget = targetAllCount;
        const totalChunksNeeded = Math.ceil(totalTarget / CHUNK_SIZE);
        const csvRowsAccumulator: string[] = [];
        let headerRow = '';
        let totalRecordsGathered = 0;

        for (let chunkIdx = 0; chunkIdx < totalChunksNeeded; chunkIdx++) {
          if (cancelRef.current) break;

          const currentBatchNum = chunkIdx + 1;
          const pct = Math.min(95, Math.round(((chunkIdx) / totalChunksNeeded) * 100));
          setProgressPercent(pct);
          setProgressStatus(
            `Fetching batch ${currentBatchNum}/${totalChunksNeeded} (${totalRecordsGathered.toLocaleString()} / ${totalTarget.toLocaleString()} leads)...`
          );

          const res = await fetch('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filters,
              format: 'csv',
              scope: 'all_matching',
              columns: selectedCols,
              limit: CHUNK_SIZE,
              batch_num: currentBatchNum,
            }),
          });

          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.error || `Chunk ${currentBatchNum} failed (HTTP ${res.status})`);
          }

          const rawText = await res.text();
          const cleanText = rawText.startsWith('\uFEFF') ? rawText.slice(1) : rawText;
          const lines = cleanText.split('\n').filter(l => l.trim().length > 0);

          if (lines.length > 0) {
            if (!headerRow) {
              headerRow = lines[0];
            }
            // Data lines (exclude header from subsequent chunks)
            const dataLines = lines.slice(1);
            if (dataLines.length > 0) {
              csvRowsAccumulator.push(...dataLines);
              totalRecordsGathered += dataLines.length;
            }
            if (dataLines.length < CHUNK_SIZE) {
              // Reached end of database matching records
              break;
            }
          }
        }

        if (totalRecordsGathered === 0) {
          throw new Error('No carrier records found matching your active filters.');
        }

        setProgressPercent(100);
        setProgressStatus(`✓ Successfully compiled ${totalRecordsGathered.toLocaleString()} leads! Saving file...`);

        // Assemble single combined CSV
        const finalCsv = '\uFEFF' + [headerRow, ...csvRowsAccumulator].join('\n');
        const finalBlob = new Blob([finalCsv], { type: 'text/csv;charset=utf-8;' });
        const finalFileName = `leadbase_all_${totalRecordsGathered}_leads_${dateStr}.${format === 'excel' ? 'csv' : format}`;
        triggerBlobDownload(finalBlob, finalFileName);

        // History log
        fetch('/api/export-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_name: finalFileName,
            format,
            record_count: totalRecordsGathered,
            filter_summary: `All Filtered Leads (${totalRecordsGathered.toLocaleString()} rows)`,
            filter_state: filters,
          }),
        }).catch(e => console.warn('History log warning:', e));

        setTimeout(() => {
          setIsExporting(false);
          onClose();
        }, 1800);
        return;
      }

      // ── MODE 2: Single Batch or Selected / Current Page ──────────────────────
      setProgressStatus(`Exporting ${exportRecordCount.toLocaleString()} carriers...`);
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

      let fileName = `leadbase_export_${exportRecordCount}_leads_${dateStr}.${format === 'excel' ? 'csv' : format}`;
      const disposition = res.headers.get('Content-Disposition');
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match?.[1]) fileName = match[1];
      }

      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        throw new Error('Server returned an empty export file. Please check your filters.');
      }

      triggerBlobDownload(blob, fileName);

      setProgressPercent(100);
      setProgressStatus(`✓ File saved!`);
      setDownloadedBatches(prev => new Set(prev).add(batchNum));

      // History log
      fetch('/api/export-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: fileName,
          format,
          record_count: exportRecordCount,
          filter_summary: `${exportRecordCount} records (${scope})`,
          filter_state: filters,
        }),
      }).catch(e => console.warn('History log warning:', e));

      setTimeout(() => {
        setIsExporting(false);
        if (scope === 'all_matching' && batchNum < totalBatches) {
          setBatchNum(b => b + 1);
        }
      }, 1500);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed. Please try again.';
      setErrorMessage(msg);
      setIsExporting(false);
      setProgressPercent(0);
    }
  }

  return (
    <div className="modal-overlay" onClick={() => { if (!isExporting) onClose(); }}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">📥 Export Leads to CSV</div>
            <div className="modal-sub">
              <strong>{matchingCount.toLocaleString()}</strong> carriers match your current filters
            </div>
          </div>
          <button className="modal-close" onClick={() => { if (!isExporting) onClose(); }} disabled={isExporting}>✕</button>
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
                    disabled={isExporting}
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
                    disabled={isExporting}
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
                  disabled={isExporting}
                />
                <div style={{ width: '100%' }}>
                  <strong>All {matchingCount.toLocaleString()} matching carriers</strong>
                  <span className="ex-subtext">Exports all records satisfying your active search & filters</span>

                  {scope === 'all_matching' && (
                    <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {/* Sub-option A: All Stream Combined */}
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.6rem',
                          padding: '0.6rem 0.8rem',
                          background: exportMode === 'all_stream' ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.02)',
                          border: exportMode === 'all_stream' ? '1px solid var(--cyan)' : '1px solid var(--border)',
                          borderRadius: '8px',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="radio"
                          name="exportMode"
                          checked={exportMode === 'all_stream'}
                          onChange={() => setExportMode('all_stream')}
                          disabled={isExporting}
                          style={{ marginTop: '2px' }}
                        />
                        <div>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: exportMode === 'all_stream' ? 'var(--cyan)' : 'var(--text)' }}>
                            ⚡ Download ALL {targetAllCount.toLocaleString()} Leads in 1 Single CSV File
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>
                            Auto-chunks in parallel background streams and merges into one complete CSV. Zero timeouts.
                            {matchingCount > MAX_AUTO_CHUNK_LIMIT && (
                              <span style={{ color: '#fbbf24', display: 'block' }}>
                                (Capped at first 50,000 leads for browser stability. Use filters for specific segments.)
                              </span>
                            )}
                          </span>
                        </div>
                      </label>

                      {/* Sub-option B: Paginated Batches */}
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.6rem',
                          padding: '0.6rem 0.8rem',
                          background: exportMode === 'batch' ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.02)',
                          border: exportMode === 'batch' ? '1px solid var(--cyan)' : '1px solid var(--border)',
                          borderRadius: '8px',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="radio"
                          name="exportMode"
                          checked={exportMode === 'batch'}
                          onChange={() => setExportMode('batch')}
                          disabled={isExporting}
                          style={{ marginTop: '2px' }}
                        />
                        <div style={{ width: '100%' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: exportMode === 'batch' ? 'var(--cyan)' : 'var(--text)' }}>
                            📦 Download in Individual Batches (1k / 5k per file)
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>
                            Useful if you want separate smaller files for specific lead batches.
                          </span>

                          {exportMode === 'batch' && (
                            <div style={{ marginTop: '0.6rem' }}>
                              <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.5rem' }}>
                                {[1000, 2500, 5000, 10000].map(sz => (
                                  <button
                                    key={sz}
                                    type="button"
                                    onClick={() => { setBatchSize(sz); setBatchNum(1); }}
                                    style={{
                                      padding: '0.25rem 0.55rem',
                                      fontSize: '0.72rem',
                                      borderRadius: '6px',
                                      border: batchSize === sz ? '1px solid var(--cyan)' : '1px solid var(--border)',
                                      background: batchSize === sz ? 'rgba(34,211,238,0.2)' : 'var(--bg)',
                                      color: batchSize === sz ? 'var(--cyan)' : 'var(--muted2)',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {sz.toLocaleString()} / file
                                  </button>
                                ))}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '0.3rem' }}>
                                Select batch ({totalBatches} total):
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', maxHeight: '80px', overflowY: 'auto' }}>
                                {Array.from({ length: Math.min(totalBatches, 40) }, (_, i) => i + 1).map(n => (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => setBatchNum(n)}
                                    style={{
                                      padding: '0.2rem 0.45rem',
                                      fontSize: '0.7rem',
                                      borderRadius: '4px',
                                      border: batchNum === n ? '1px solid var(--cyan)' : downloadedBatches.has(n) ? '1px solid rgba(52,211,153,0.5)' : '1px solid var(--border)',
                                      background: batchNum === n ? 'rgba(34,211,238,0.2)' : downloadedBatches.has(n) ? 'rgba(52,211,153,0.1)' : 'var(--bg)',
                                      color: batchNum === n ? 'var(--cyan)' : downloadedBatches.has(n) ? '#34d399' : 'var(--muted2)',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {downloadedBatches.has(n) ? `✓ ${n}` : n}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </label>
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
                  disabled={isExporting}
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
                <button className="fp-link-btn" onClick={selectAllCols} disabled={isExporting}>Select All</button>
                <button className="fp-link-btn" onClick={clearAllCols} disabled={isExporting}>Clear All</button>
              </div>
            </div>

            <div className="ex-cols-grid">
              {ALL_COLUMNS.map(col => (
                <label key={col.id} className={`ex-col-item ${selectedCols.includes(col.id) ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selectedCols.includes(col.id)}
                    onChange={() => toggleColumn(col.id)}
                    disabled={isExporting}
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Live Progress Bar & Status */}
          {isExporting && (
            <div style={{
              padding: '0.85rem 1.1rem',
              background: 'rgba(34, 211, 238, 0.08)',
              border: '1px solid rgba(34, 211, 238, 0.35)',
              borderRadius: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--cyan)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="spinner" style={{ width: '16px', height: '16px' }} />
                  {progressStatus || 'Starting export stream...'}
                </div>
                <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--cyan)' }}>{progressPercent}%</span>
              </div>

              {/* Visual Progress Bar */}
              <div style={{ width: '100%', height: '7px', background: 'rgba(255,255,255,0.08)', borderRadius: '99px', overflow: 'hidden' }}>
                <div style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--cyan), var(--blue))',
                  borderRadius: '99px',
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {isExporting ? (
            <button
              className="btn-secondary"
              onClick={() => {
                cancelRef.current = true;
                setIsExporting(false);
                setProgressStatus('Export stopped by user.');
              }}
              style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}
            >
              Cancel Export
            </button>
          ) : (
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
          )}

          <button
            className="btn-primary-lg"
            onClick={handleExport}
            disabled={isExporting || selectedCols.length === 0}
          >
            {isExporting
              ? `⏳ Exporting (${progressPercent}%)...`
              : scope === 'all_matching' && exportMode === 'all_stream'
              ? `⚡ Export All ${targetAllCount.toLocaleString()} Leads (Single CSV)`
              : `📥 Export ${exportRecordCount.toLocaleString()} Carriers (${format.toUpperCase()})`}
          </button>
        </div>
      </div>
    </div>
  );
}
