'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ExportErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Export Error Boundary caught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="modal-overlay" onClick={this.handleReset} style={{ zIndex: 9999 }}>
          <div
            className="modal-card"
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '520px',
              padding: '1.75rem',
              background: 'var(--bg2, #0d1527)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '16px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⚠️</div>
            <h3 style={{ color: '#f87171', fontSize: '1.1rem', fontWeight: 800, marginBottom: '0.5rem' }}>
              Export Dialog Encountered an Issue
            </h3>
            <p style={{ color: 'var(--muted2, #94a3b8)', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: '1.25rem' }}>
              {this.state.error?.message || 'An unexpected rendering error occurred. Please close this dialog and try again.'}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="btn-primary"
              style={{
                margin: '0 auto',
                padding: '0.55rem 1.4rem',
                cursor: 'pointer',
              }}
            >
              Close and Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
