import { Suspense } from 'react';

export default function LeadsLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--muted)' }}>Loading…</div>}>{children}</Suspense>;
}
