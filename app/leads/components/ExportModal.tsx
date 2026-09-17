'use client';

import { useState, useEffect, useRef } from 'react';
import { FilterState } from '@/lib/types';
import {
  DownloadIcon,
  XIcon,
  AlertCircleIcon,
  CheckIcon,
  FileSpreadsheetIcon,
  SparklesIcon
} from '@/app/components/Icons';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  filters?: FilterState;
  matchingCount?: number;
  selectedCount?: number;
  currentPageCount?: number;
  selectedIds?: string[];
  currentPageIds?: string[];
}

const ALL_COLUMNS = [
  { id: 'usdot_number', label: 'USDOT Number' },
  { id: 'legal_name', label: 'Legal Name' },
  { id: 'dba_name', label: 'DBA Name' },
  { id: 'phone', label: 'Phone Number' },
  { id: 'email', label: 'Email Address' },
  { id: 'carrier_status', label: 'Carrier Status' },
  { id: 'out_of_service', label: 'Out of Service' },
  { id: 'principal_address', label: 'Principal Address' },
  { id: 'state_incorporated', label: 'State' },
  { id: 'motus_entry_date', label: 'MOTUS Entry Date' },
  { id: 'motus_last_updated', label: 'MOTUS Last Updated' },
  { id: 'added_to_motus', label: 'Added on Motus' },
  { id: 'profile_url', label: 'MOTUS Profile Link' },
];

const CHUNK_SIZE = 2500;
const MAX_AUTO_CHUNK_LIMIT = 75000;

function fmtNum(val: unknown): string {
  const n = Number(val);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

export default function ExportModal({
  isOpen,
  onClose,
  filters,
  matchingCount = 0,
  selectedCount = 0,
  currentPageCount = 0,
  selectedIds = [],
  currentPageIds = [],
}: ExportModalProps) {
  const safeMatching = Math.max(0, Number(matchingCount) || 0);
  const safeSelected = Math.max(0, Number(selectedCount) || 0);
  const safeCurrentPage = Math.max(0, Number(currentPageCount) || 0);

  const [format, setFormat] = useState<'csv' | 'excel' | 'json'>('csv');
  const [scope, setScope] = useState<'all_matching' | 'selected' | 'current_page'>(
    safeSelected > 0 ? 'selected' : 'all_matching'
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

  const safeBatchSize = Math.max(100, Number(batchSize) || 1000);
  const totalBatches = Number.isFinite(safeMatching / safeBatchSize)
    ? Math.max(1, Math.ceil(safeMatching / safeBatchSize))
    : 1;

  const activeScope = scope || 'all_matching';
  const activeMode = exportMode || 'all_stream';

  const targetAllCount = Math.min(safeMatching, MAX_AUTO_CHUNK_LIMIT);
  const exportRecordCount =
    activeScope === 'selected' ? safeSelected :
    activeScope === 'current_page' ? safeCurrentPage :
    activeMode === 'all_stream' ? targetAllCount :
    Math.min(safeBatchSize, Math.max(0, safeMatching - (batchNum - 1) * safeBatchSize));

  const isOverCap = activeScope === 'all_matching' && activeMode === 'all_stream' && safeMatching > MAX_AUTO_CHUNK_LIMIT;

  useEffect(() => {
    if (isOpen) {
      if (safeSelected > 0) {
        setScope('selected');
      } else {
        setScope(prev => (prev === 'selected' ? 'all_matching' : prev));
      }
      setErrorMessage(null);
      setIsExporting(false);
      setProgressPercent(0);
      cancelRef.current = false;
    }
  }, [isOpen, safeSelected]);

  if (!isOpen) return null;

  function toggleColumn(colId: string) {
    if (selectedCols.includes(colId)) {
      if (selectedCols.length <= 1) return;
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
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  async function handleExport(e: React.MouseEvent) {
    e.preventDefault();
    if (isExporting) return;

    const currentScope = scope || 'all_matching';
    const currentMode = exportMode || 'all_stream';
    const colsToExport = selectedCols.length > 0 ? selectedCols : ALL_COLUMNS.map(c => c.id);

    setIsExporting(true);
    setErrorMessage(null);
    setProgressPercent(5);
    cancelRef.current = false;

    const dateStr = new Date().toISOString().slice(0, 10);

    try {
      if (currentScope === 'all_matching' && currentMode === 'all_stream') {
        const totalToDownload = Math.min(safeMatching, MAX_AUTO_CHUNK_LIMIT);
        const totalChunks = Math.max(1, Math.ceil(totalToDownload / CHUNK_SIZE));
        const blobParts: string[] = [];
        let totalRecordsGathered = 0;
        let cursorId = 0;

        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
          if (cancelRef.current) {
            setProgressStatus('Export cancelled by user.');
            setIsExporting(false);
            return;
          }

          const currentBatchNum = chunkIdx + 1;
          const pct = Math.round(((chunkIdx) / totalChunks) * 90) + 5;
          setProgressPercent(pct);
          setProgressStatus(`Downloading batch ${currentBatchNum} of ${totalChunks} (${fmtNum(totalRecordsGathered)} rows gathered)…`);

          const res = await fetch('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filters: filters || {},
              format: 'csv',
              scope: 'all_matching',
              columns: colsToExport,
              limit: CHUNK_SIZE,
              batch_num: currentBatchNum,
              cursor_id: cursorId > 0 ? cursorId : undefined,
            }),
          });

          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.error || `Chunk ${currentBatchNum} failed (HTTP ${res.status})`);
          }

          const nextCursorHeader = res.headers.get('X-Next-Cursor-Id');
          if (nextCursorHeader && Number.isFinite(Number(nextCursorHeader))) {
            cursorId = Number(nextCursorHeader);
          }

          let rawText = await res.text();
          if (rawText.startsWith('\uFEFF')) {
            rawText = rawText.slice(1);
          }
          if (!rawText.endsWith('\n')) {
            rawText += '\n';
          }

          const firstNewline = rawText.indexOf('\n');
          if (firstNewline === -1) {
            break;
          }

          let chunkPayload = '';
          let batchDataRows = 0;

          if (chunkIdx === 0) {
            chunkPayload = rawText;
            const lines = rawText.trim().split('\n');
            batchDataRows = Math.max(0, lines.length - 1);
          } else {
            chunkPayload = rawText.slice(firstNewline + 1);
            const cleanData = chunkPayload.trim();
            batchDataRows = cleanData.length > 0 ? cleanData.split('\n').length : 0;
          }

          if (batchDataRows === 0) break;

          blobParts.push(chunkPayload);
          totalRecordsGathered += batchDataRows;

          if (batchDataRows < CHUNK_SIZE) break;

          await new Promise((r) => setTimeout(r, 20));
        }

        if (totalRecordsGathered === 0) {
          throw new Error('No carrier records found matching your active filters.');
        }

        setProgressPercent(100);
        setProgressStatus(`Successfully compiled ${fmtNum(totalRecordsGathered)} leads! Saving file…`);

        const finalBlob = new Blob(blobParts, { type: 'text/csv;charset=utf-8;' });
        const finalFileName = `leadbase_all_${totalRecordsGathered}_leads_${dateStr}.${format === 'excel' ? 'csv' : format}`;
        triggerBlobDownload(finalBlob, finalFileName);

        fetch('/api/export-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_name: finalFileName,
            format,
            record_count: totalRecordsGathered,
            filter_summary: `All Filtered Leads (${fmtNum(totalRecordsGathered)} rows)`,
            filter_state: filters,
          }),
        }).catch((e) => console.warn('History log warning:', e));

        setTimeout(() => {
          onClose();
        }, 1600);
        return;
      }

      // Single Batch or Selected / Current Page
      setProgressStatus(`Exporting ${fmtNum(exportRecordCount)} carriers…`);
      const params = {
        filters: filters || {},
        format,
        scope: currentScope,
        selected_ids: selectedIds,
        columns: colsToExport,
        current_page_ids: currentScope === 'current_page' ? currentPageIds : [],
        limit: safeBatchSize,
        batch_num: currentScope === 'all_matching' ? batchNum : 1,
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
      setProgressStatus(`File saved!`);
      setDownloadedBatches(prev => new Set(prev).add(batchNum));

      fetch('/api/export-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: fileName,
          format,
          record_count: exportRecordCount,
          filter_summary: `${fmtNum(exportRecordCount)} records (${currentScope})`,
          filter_state: filters,
        }),
      }).catch(e => console.warn('History log warning:', e));

      setTimeout(() => {
        if (currentScope === 'all_matching' && batchNum < totalBatches) {
          setBatchNum(b => b + 1);
        } else if (currentScope === 'selected' || currentScope === 'current_page') {
          onClose();
        }
      }, 1400);

    } catch (err: any) {
      setErrorMessage(err?.message || 'Export failed. Please try again.');
      setProgressPercent(0);
    } finally {
      setIsExporting(false);
    }
  }

  const safeBatchCount = Number.isFinite(totalBatches) && totalBatches > 0
    ? Math.min(Math.floor(totalBatches), 40)
    : 1;
  const batchNumbers = Array.from({ length: safeBatchCount }, (_, i) => i + 1);

  return (
    <div className="modal-overlay" onClick={() => { if (!isExporting) onClose(); }}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">
              <DownloadIcon size={16} style={{ color: 'var(--cyan)' }} />
              <span>Export Carrier Leads</span>
            </div>
            <div className="modal-sub">
              <strong>{fmtNum(safeMatching)}</strong> carriers match your current filters
            </div>
          </div>
          <button type="button" className="modal-close" onClick={() => { if (!isExporting) onClose(); }} disabled={isExporting}>
            <XIcon size={16} />
          </button>
        </div>

        <div className="modal-body">
          {isOverCap && (
            <div style={{
              background: 'rgba(244,63,94,0.1)',
              border: '1px solid rgba(244,63,94,0.35)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.85rem 1rem',
              color: '#fda4af',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
            }}>
              <AlertCircleIcon size={18} style={{ color: 'var(--red)', flexShrink: 0 }} />
              <div>
                Active filters match <strong>{fmtNum(safeMatching)}</strong> leads. Single download stream is capped at {fmtNum(MAX_AUTO_CHUNK_LIMIT)}. Use filters or batch download for specific slices.
              </div>
            </div>
          )}

          {errorMessage && (
            <div style={{
              background: 'rgba(244,63,94,0.1)',
              border: '1px solid rgba(244,63,94,0.35)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.75rem 1rem',
              color: '#fda4af',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}>
              <AlertCircleIcon size={16} style={{ color: 'var(--red)', flexShrink: 0 }} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 1. File Format */}
          <div>
            <label className="modal-label">1. File Format</label>
            <div className="ex-radio-cards">
              {[
                { id: 'csv', label: 'CSV (Universal)', desc: 'Standard UTF-8 comma separated' },
                { id: 'excel', label: 'Excel CSV', desc: 'Optimized for MS Excel import' },
                { id: 'json', label: 'JSON Array', desc: 'Raw structured JSON objects' },
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
          <div>
            <label className="modal-label">2. Target Scope</label>
            <div className="ex-scope-list">
              {safeSelected > 0 && (
                <label className={`ex-scope-item ${scope === 'selected' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === 'selected'}
                    onChange={() => setScope('selected')}
                    disabled={isExporting}
                  />
                  <div>
                    <strong style={{ color: 'var(--text)' }}>{fmtNum(safeSelected)} selected records</strong>
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
                  <strong style={{ color: 'var(--text)' }}>All {fmtNum(safeMatching)} matching carriers</strong>
                  <span className="ex-subtext">Exports all records satisfying your active search &amp; filters</span>

                  {scope === 'all_matching' && (
                    <div style={{ marginTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      {/* Option A: Single Merged File */}
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.6rem',
                          padding: '0.6rem 0.8rem',
                          background: exportMode === 'all_stream' ? 'rgba(6,182,212,0.1)' : 'rgba(255,255,255,0.02)',
                          border: exportMode === 'all_stream' ? '1px solid var(--cyan)' : '1px solid var(--border-hairline)',
                          borderRadius: 'var(--radius-xs)',
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
                          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: exportMode === 'all_stream' ? 'var(--cyan-light)' : 'var(--text)' }}>
                            Download All {fmtNum(targetAllCount)} Leads in 1 Single File
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', display: 'block', marginTop: '2px' }}>
                            Streams in high-speed batches and merges into one file automatically.
                          </span>
                        </div>
                      </label>

                      {/* Option B: Chunked Batches */}
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.6rem',
                          padding: '0.6rem 0.8rem',
                          background: exportMode === 'batch' ? 'rgba(6,182,212,0.1)' : 'rgba(255,255,255,0.02)',
                          border: exportMode === 'batch' ? '1px solid var(--cyan)' : '1px solid var(--border-hairline)',
                          borderRadius: 'var(--radius-xs)',
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
                          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: exportMode === 'batch' ? 'var(--cyan-light)' : 'var(--text)' }}>
                            Download in Individual Batches (1k / 5k per file)
                          </span>
                          {exportMode === 'batch' && (
                            <div style={{ marginTop: '0.5rem' }}>
                              <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.45rem', flexWrap: 'wrap' }}>
                                {[1000, 2500, 5000, 10000].map(sz => (
                                  <button
                                    key={sz}
                                    type="button"
                                    onClick={() => { setBatchSize(sz); setBatchNum(1); }}
                                    style={{
                                      padding: '0.25rem 0.55rem',
                                      fontSize: '0.72rem',
                                      borderRadius: '4px',
                                      border: safeBatchSize === sz ? '1px solid var(--cyan)' : '1px solid var(--border-hairline)',
                                      background: safeBatchSize === sz ? 'rgba(6,182,212,0.15)' : 'var(--bg-input)',
                                      color: safeBatchSize === sz ? 'var(--cyan-light)' : 'var(--text-secondary)',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {fmtNum(sz)} / file
                                  </button>
                                ))}
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', maxHeight: '80px', overflowY: 'auto' }}>
                                {batchNumbers.map(n => (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => setBatchNum(n)}
                                    style={{
                                      padding: '0.2rem 0.45rem',
                                      fontSize: '0.7rem',
                                      borderRadius: '3px',
                                      border: batchNum === n ? '1px solid var(--cyan)' : downloadedBatches.has(n) ? '1px solid rgba(16,185,129,0.4)' : '1px solid var(--border-hairline)',
                                      background: batchNum === n ? 'rgba(6,182,212,0.18)' : downloadedBatches.has(n) ? 'rgba(16,185,129,0.08)' : 'var(--bg-input)',
                                      color: batchNum === n ? 'var(--cyan-light)' : downloadedBatches.has(n) ? '#34d399' : 'var(--text-secondary)',
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
                  <strong style={{ color: 'var(--text)' }}>Current page ({fmtNum(safeCurrentPage)} records)</strong>
                  <span className="ex-subtext">Exports only the currently visible {fmtNum(safeCurrentPage)} rows</span>
                </div>
              </label>
            </div>
          </div>

          {/* 3. Export Fields */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <label className="modal-label" style={{ marginBottom: 0 }}>3. Select Export Fields ({selectedCols.length})</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="fp-link-btn" onClick={selectAllCols} disabled={isExporting}>Select All</button>
                <button type="button" className="fp-link-btn" onClick={clearAllCols} disabled={isExporting}>Reset</button>
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
          {(isExporting || (progressPercent > 0 && !errorMessage)) && (
            <div style={{
              padding: '0.85rem 1.1rem',
              background: 'rgba(6, 182, 212, 0.08)',
              border: '1px solid rgba(6, 182, 212, 0.28)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--cyan-light)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {isExporting && <span className="spinner" style={{ width: '14px', height: '14px' }} />}
                  <span>{progressStatus || 'Preparing export stream…'}</span>
                </div>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--cyan-light)', fontVariantNumeric: 'tabular-nums' }}>{progressPercent}%</span>
              </div>

              <div style={{ width: '100%', height: '5px', background: 'rgba(255,255,255,0.06)', borderRadius: '99px', overflow: 'hidden' }}>
                <div style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--cyan), var(--blue))',
                  borderRadius: '99px',
                  transition: 'width 0.2s ease',
                }} />
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {isExporting ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                cancelRef.current = true;
                setIsExporting(false);
                setProgressStatus('Export stopped by user.');
              }}
              style={{ color: 'var(--red)' }}
            >
              Cancel
            </button>
          ) : (
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          )}

          <button
            type="button"
            className="btn-primary-lg"
            onClick={(e) => handleExport(e)}
            disabled={isExporting}
            style={{
              opacity: isOverCap ? 0.6 : 1,
              cursor: isOverCap ? 'not-allowed' : 'pointer',
            }}
          >
            {isOverCap
              ? `Exceeds 75k Limit (${fmtNum(safeMatching)} Matches)`
              : isExporting
              ? `Exporting (${progressPercent}%)…`
              : activeScope === 'all_matching' && activeMode === 'all_stream'
              ? `Download All ${fmtNum(targetAllCount)} Leads`
              : `Download ${fmtNum(exportRecordCount)} Carriers`}
          </button>
        </div>
      </div>
    </div>
  );
}
