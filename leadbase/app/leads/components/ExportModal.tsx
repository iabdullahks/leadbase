'use client';

import { useState } from 'react';
import { FilterState, ExportOptions } from '@/lib/types';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  filters: FilterState;
  matchingCount: number;
  selectedCount: number;
  currentPageCount: number;
  selectedIds: string[];
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
  selectedIds
}: ExportModalProps) {
  const [format, setFormat] = useState<'csv' | 'excel' | 'json'>('csv');
  const [scope, setScope] = useState<'all_matching' | 'selected' | 'current_page'>('all_matching');
  const [selectedCols, setSelectedCols] = useState<string[]>(ALL_COLUMNS.map(c => c.id));
  const [isExporting, setIsExporting] = useState(false);

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
    scope === 'all_matching' ? matchingCount :
    scope === 'selected' ? selectedCount : currentPageCount;

  async function handleExport() {
    if (selectedCols.length === 0) return;
    setIsExporting(true);

    try {
      const opts: ExportOptions = {
        format,
        scope,
        selected_ids: selectedIds,
        columns: selectedCols
      };

      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, ...opts })
      });

      if (!res.ok) throw new Error('Export request failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leadbase_carriers_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'csv' : format}`;
      a.click();
      URL.revokeObjectURL(url);

      // Log to export history
      try {
        await fetch('/api/export-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_name: a.download,
            format,
            record_count: exportRecordCount,
            filter_summary: `${matchingCount} matches (${format.toUpperCase()})`,
            filter_state: filters
          })
        });
      } catch (logErr) {
        console.warn('History log warning:', logErr);
      }

      onClose();
    } catch (err) {
      alert('Export failed. Please check server logs.');
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
                <div>
                  <strong>All {matchingCount.toLocaleString()} matching carriers</strong>
                  <span className="ex-subtext">Exports every carrier matching your active filters</span>
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
                  <span className="ex-subtext">Exports only the currently visible 50 rows</span>
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
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary-lg"
            onClick={handleExport}
            disabled={isExporting || selectedCols.length === 0}
          >
            {isExporting ? 'Generating Export…' : `Export ${exportRecordCount.toLocaleString()} Carriers`}
          </button>
        </div>
      </div>
    </div>
  );
}
