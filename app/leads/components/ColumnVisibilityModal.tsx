'use client';

import { ColumnsIcon, XIcon } from '@/app/components/Icons';

interface ColumnVisibilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  visibleCols: string[];
  onChange: (cols: string[]) => void;
}

const TABLE_COLUMNS = [
  { id: 'usdot_number', label: 'USDOT Number' },
  { id: 'legal_name', label: 'Company Name' },
  { id: 'dba_name', label: 'DBA Name' },
  { id: 'phone', label: 'Phone' },
  { id: 'email', label: 'Email' },
  { id: 'carrier_status', label: 'Status' },
  { id: 'state_incorporated', label: 'State' },
  { id: 'added_to_motus', label: 'Added on Motus' },
  { id: 'principal_address', label: 'Address' },
];

export default function ColumnVisibilityModal({
  isOpen,
  onClose,
  visibleCols,
  onChange
}: ColumnVisibilityModalProps) {
  if (!isOpen) return null;

  function toggle(id: string) {
    if (visibleCols.includes(id)) {
      if (visibleCols.length <= 1) return; // Keep at least one
      onChange(visibleCols.filter(c => c !== id));
    } else {
      onChange([...visibleCols, id]);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
        <div className="modal-header">
          <div className="modal-title">
            <ColumnsIcon size={16} style={{ color: 'var(--cyan)' }} />
            <span>Table Columns</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close modal">
            <XIcon size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="cv-grid">
            {TABLE_COLUMNS.map(col => (
              <label key={col.id} className={`cv-item ${visibleCols.includes(col.id) ? 'active' : ''}`}>
                <input
                  type="checkbox"
                  checked={visibleCols.includes(col.id)}
                  onChange={() => toggle(col.id)}
                />
                <span>{col.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
