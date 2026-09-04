'use client';

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
  { id: 'motus_entry_date', label: 'MOTUS Entry Date' },
  { id: 'scraped_at', label: 'Date Added' },
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
          <div className="modal-title">👁️ Table Columns</div>
          <button className="modal-close" onClick={onClose}>✕</button>
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
