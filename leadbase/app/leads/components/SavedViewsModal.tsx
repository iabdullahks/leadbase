'use client';

import { useState, useEffect } from 'react';
import { FilterState, SavedView } from '@/lib/types';

interface SavedViewsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFilters: FilterState;
  onApplyView: (viewFilters: FilterState) => void;
}

const DEFAULT_PRESET_VIEWS: SavedView[] = [
  {
    id: 'preset-tx-active',
    name: 'New Texas Active Carriers',
    description: 'Active carriers in Texas added in the last 30 days',
    created_at: new Date().toISOString(),
    filter_state: {
      carrier_statuses: ['Active'],
      authority_statuses: [],
      states: ['TX'],
      cargo_types: [],
      equipment_types: [],
      date_field: 'scraped_at',
      date_preset: 'last_30d',
      missing_fields: [],
      advanced_rules: []
    }
  },
  {
    id: 'preset-phone-ready',
    name: 'Phone & Email Verified Leads',
    description: 'Carriers with both phone and email contact info ready to outreach',
    created_at: new Date().toISOString(),
    filter_state: {
      carrier_statuses: ['Active'],
      authority_statuses: [],
      states: [],
      has_phone: true,
      has_email: true,
      contact_completeness: 'phone_email',
      cargo_types: [],
      equipment_types: [],
      date_field: 'scraped_at',
      date_preset: 'all',
      missing_fields: [],
      advanced_rules: []
    }
  },
  {
    id: 'preset-recent-7d',
    name: 'Fresh Scrapes (Last 7 Days)',
    description: 'All newly discovered carrier leads in the last 7 days',
    created_at: new Date().toISOString(),
    filter_state: {
      carrier_statuses: [],
      authority_statuses: [],
      states: [],
      cargo_types: [],
      equipment_types: [],
      date_field: 'scraped_at',
      date_preset: 'last_7d',
      missing_fields: [],
      advanced_rules: []
    }
  }
];

export default function SavedViewsModal({
  isOpen,
  onClose,
  currentFilters,
  onApplyView
}: SavedViewsModalProps) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [newViewName, setNewViewName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    try {
      const stored = localStorage.getItem('leadbase_saved_views');
      if (stored) {
        setViews([...DEFAULT_PRESET_VIEWS, ...JSON.parse(stored)]);
      } else {
        setViews(DEFAULT_PRESET_VIEWS);
      }
    } catch {
      setViews(DEFAULT_PRESET_VIEWS);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleSaveCurrentView() {
    if (!newViewName.trim()) return;
    setIsSaving(true);
    const view: SavedView = {
      id: `custom-${Date.now()}`,
      name: newViewName.trim(),
      description: 'Custom user saved view',
      filter_state: currentFilters,
      created_at: new Date().toISOString()
    };

    const customOnly = views.filter(v => !v.id.startsWith('preset-'));
    const nextCustom = [view, ...customOnly];
    try {
      localStorage.setItem('leadbase_saved_views', JSON.stringify(nextCustom));
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }

    setViews([view, ...views]);
    setNewViewName('');
    setIsSaving(false);
  }

  function handleDeleteView(id: string) {
    const customOnly = views.filter(v => !v.id.startsWith('preset-') && v.id !== id);
    try {
      localStorage.setItem('leadbase_saved_views', JSON.stringify(customOnly));
    } catch {}
    setViews(prev => prev.filter(v => v.id !== id));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '540px' }}>
        <div className="modal-header">
          <div className="modal-title">⭐ Saved Filter Views</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Save new view */}
          <div className="sv-save-box">
            <label className="modal-label">Save Active Filters as New View</label>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <input
                className="fp-input"
                placeholder="View Name (e.g., Texas Active Fleet)"
                value={newViewName}
                onChange={e => setNewViewName(e.target.value)}
              />
              <button
                className="btn-primary"
                onClick={handleSaveCurrentView}
                disabled={!newViewName.trim() || isSaving}
              >
                Save View
              </button>
            </div>
          </div>

          {/* List of Views */}
          <div className="sv-list-section">
            <label className="modal-label">Select View to Apply</label>
            <div className="sv-list">
              {views.map(v => (
                <div key={v.id} className="sv-item">
                  <div className="sv-item-info">
                    <div className="sv-item-name">{v.name}</div>
                    {v.description && <div className="sv-item-desc">{v.description}</div>}
                  </div>
                  <div className="sv-item-actions">
                    <button
                      className="btn-apply-sm"
                      onClick={() => { onApplyView(v.filter_state); onClose(); }}
                    >
                      Apply View →
                    </button>
                    {!v.id.startsWith('preset-') && (
                      <button className="btn-del-sm" onClick={() => handleDeleteView(v.id)}>✕</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
