'use client';

import { useState, useEffect } from 'react';
import { ExportHistoryItem } from '@/lib/types';

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
            <span>📜 Export Audit History</span>
          </div>
          <button className="fp-close" onClick={onClose}>✕</button>
        </div>

        <div className="fp-body">
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Loading history…</div>
          ) : history.length === 0 ? (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📁</div>
              No export records found in audit history.
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
                    <span>📅 {new Date(h.created_at).toLocaleString()}</span>
                    <span>📊 {h.record_count.toLocaleString()} records</span>
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
