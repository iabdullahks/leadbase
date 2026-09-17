'use client';

import { useState } from 'react';
import { Carrier } from '@/lib/types';
import { downloadSingleLeadCsv } from '@/lib/exportSingleLead';
import { DownloadIcon, CheckIcon } from '@/app/components/Icons';

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
        background: downloaded ? 'rgba(16,185,129,0.12)' : 'rgba(6,182,212,0.1)',
        borderColor: downloaded ? 'rgba(16,185,129,0.35)' : 'rgba(6,182,212,0.3)',
        color: downloaded ? '#34d399' : 'var(--cyan-light)',
        fontWeight: 600,
      }}
      title="Download this lead as CSV"
    >
      {downloaded ? (
        <>
          <CheckIcon size={14} />
          <span>Downloaded CSV</span>
        </>
      ) : (
        <>
          <DownloadIcon size={14} />
          <span>Download CSV</span>
        </>
      )}
    </button>
  );
}
