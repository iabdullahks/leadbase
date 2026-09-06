'use client';

import { useState } from 'react';
import { Carrier } from '@/lib/types';
import { downloadSingleLeadCsv } from '@/lib/exportSingleLead';

export default function ExportLeadButton({ carrier }: { carrier: Carrier | Record<string, unknown> }) {
  const [downloaded, setDownloaded] = useState(false);

  function handleDownload() {
    downloadSingleLeadCsv(carrier as Carrier);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2500);
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="da-btn"
      style={{
        background: downloaded ? 'rgba(52,211,153,0.15)' : 'rgba(34,211,238,0.12)',
        borderColor: downloaded ? '#34d399' : 'var(--cyan)',
        color: downloaded ? '#34d399' : 'var(--cyan)',
        fontWeight: 700,
      }}
      title="Download this lead as CSV"
    >
      {downloaded ? '✓ Downloaded CSV' : '📥 Download CSV'}
    </button>
  );
}
