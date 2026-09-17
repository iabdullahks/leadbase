'use client';

import { useState, useEffect } from 'react';
import { ExportHistoryItem } from '@/lib/types';
import { HistoryIcon, XIcon, CalendarIcon, DatabaseIcon, FileSpreadsheetIcon } from '@/app/components/Icons';

interface ExportHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ExportHistoryDrawer({ isOpen, onClose }: ExportHistoryDrawerProps) {
  const [history, setHistory] = useState<ExportHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch('/api/export-history')
      .then(res => res.json())
      .then(data => setHistory(data.history || []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div className="filter-overlay" onClick={onClose} />
      <div className="filter-panel-drawer" style={{ maxWidth: '480px' }}>
        <div className="fp-head">
          <div className="fp-head-title">
            <HistoryIcon size={16} style={{ color: 'var(--cyan)' }} />
            <span>Export Audit Trail</span>
          </div>
          <button className="fp-close" onClick={onClose} aria-label="Close history">
            <XIcon size={16} />
          </button>
        </div>

        <div className="fp-body">
          {loading ? (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
              <span className="spinner" style={{ marginRight: '0.5rem' }} />
              Loading audit logs…
            </div>
          ) : history.length === 0 ? (
            <div style={{ padding: '4rem 1.5rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <FileSpreadsheetIcon size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
              <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>No export records found</div>
              <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>Export batches will appear here for audit and traceability.</div>
            </div>
          ) : (
            <div className="eh-list">
              {history.map(h => (
                <div key={h.id} className="eh-card">
                  <div className="eh-head">
                    <span className="eh-file">{h.file_name}</span>
                    <span className="eh-badge">{h.format.toUpperCase()}</span>
                  </div>
                  <div className="eh-meta">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <CalendarIcon size={12} />
                      {new Date(h.created_at).toLocaleString()}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600, color: 'var(--text)' }}>
                      <DatabaseIcon size={12} />
                      {h.record_count.toLocaleString()} leads
                    </span>
                  </div>
                  {h.filter_summary && (
                    <div className="eh-summary">Filters: {h.filter_summary}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
