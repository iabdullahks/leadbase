import { supabaseAdmin } from '@/lib/supabase';
import type { Carrier } from '@/lib/types';
import Link from 'next/link';
import { notFound } from 'next/navigation';

function fmt(n: number) { return n.toLocaleString(); }

function formatDate(iso: string) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

function StatusPill({ status }: { status: string }) {
  const s = (status ?? '').toLowerCase();
  const cls = s === 'active' ? 'pill-active' : s === 'inactive' ? 'pill-inactive' : s === 'pending' ? 'pill-pending' : 'pill-other';
  return <span className={`pill ${cls}`}>{status || '?'}</span>;
}

export default async function LeadDetailPage({ params }: { params: Promise<{ usdot: string }> }) {
  const { usdot } = await params;

  const { data: lead, error } = await supabaseAdmin
    .from('carriers')
    .select('*')
    .eq('usdot_number', usdot)
    .single();

  if (error || !lead) notFound();

  const c = lead as Carrier & Record<string, unknown>;

  return (
    <div className="detail-page">
      <Link href="/leads" className="btn-back">← Back to Leads</Link>

      {/* Header */}
      <div className="detail-header-card fade-up">
        <div>
          <h1 className="detail-title">{c.legal_name || '—'}</h1>
          <div className="detail-badges">
            <span className="badge-usdot">USDOT {c.usdot_number}</span>
            <StatusPill status={c.carrier_status} />
            {c.out_of_service && <span className="pill pill-inactive">⚠️ Out of Service</span>}
          </div>
        </div>
        <div className="detail-actions">
          <a
            href={c.profile_url as string || `https://motus.dot.gov/customer/${c.usdot_number}/account`}
            target="_blank" rel="noreferrer"
            className="da-btn da-blue"
            style={{ textDecoration: 'none' }}
          >
            🔗 View on MOTUS
          </a>
          {c.phone && (
            <a href={`tel:${c.phone}`} className="da-btn da-green" style={{ textDecoration: 'none' }}>
              📞 {c.phone as string}
            </a>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`} className="da-btn da-purple" style={{ textDecoration: 'none' }}>
              ✉️ {c.email as string}
            </a>
          )}
        </div>
      </div>

      {/* Detail grid */}
      <div className="detail-grid fade-up" style={{ animationDelay: '0.1s' }}>
        {/* Contact */}
        <div className="info-card">
          <div className="info-card-title">📞 Contact Information</div>
          <div className="info-rows">
            <div className="info-row">
              <span className="ir-label">Phone</span>
              <span className="ir-value">{c.phone
                ? <a href={`tel:${c.phone}`} style={{ color: 'var(--green)', textDecoration: 'none' }}>{c.phone as string}</a>
                : <span style={{ color: 'var(--muted)' }}>—</span>}
              </span>
            </div>
            <div className="info-row">
              <span className="ir-label">Email</span>
              <span className="ir-value" style={{ fontSize: '0.8rem' }}>{c.email
                ? <a href={`mailto:${c.email}`} style={{ color: 'var(--purple)', textDecoration: 'none' }}>{c.email as string}</a>
                : <span style={{ color: 'var(--muted)' }}>—</span>}
              </span>
            </div>
            {c.principal_address && (
              <div className="info-row">
                <span className="ir-label">Address</span>
                <span className="ir-value" style={{ fontSize: '0.82rem', textAlign: 'right' }}>{c.principal_address as string}</span>
              </div>
            )}
          </div>
        </div>

        {/* Registration */}
        <div className="info-card">
          <div className="info-card-title">📋 Registration</div>
          <div className="info-rows">
            <div className="info-row"><span className="ir-label">Status</span><span className="ir-value"><StatusPill status={c.carrier_status} /></span></div>
            <div className="info-row"><span className="ir-label">Out of Service</span><span className="ir-value">{c.out_of_service ? '⚠️ Yes' : '✅ No'}</span></div>
            {c.form_of_business && <div className="info-row"><span className="ir-label">Business Type</span><span className="ir-value">{c.form_of_business as string}</span></div>}
            {c.dba_name && <div className="info-row"><span className="ir-label">DBA Name</span><span className="ir-value">{c.dba_name as string}</span></div>}
          </div>
        </div>

        {/* Timestamps */}
        <div className="info-card">
          <div className="info-card-title">🕐 Timeline</div>
          <div className="info-rows">
            <div className="info-row"><span className="ir-label">MOTUS Entry Date</span><span className="ir-value" style={{ fontSize: '0.82rem' }}>{formatDate(c.motus_entry_date)}</span></div>
            <div className="info-row"><span className="ir-label">Last Updated</span><span className="ir-value" style={{ fontSize: '0.82rem' }}>{formatDate(c.motus_last_updated)}</span></div>
            <div className="info-row"><span className="ir-label">Date Scraped</span><span className="ir-value" style={{ fontSize: '0.82rem' }}>{formatDate(c.scraped_at)}</span></div>
          </div>
        </div>

        {/* Raw data preview */}
        {c.raw_data && (
          <div className="info-card">
            <div className="info-card-title">🔬 Raw Data Fields</div>
            <div className="info-rows">
              {Object.entries(c.raw_data as Record<string, unknown>).slice(0, 8).map(([k, v]) => (
                <div key={k} className="info-row">
                  <span className="ir-label mono" style={{ fontSize: '0.7rem' }}>{k}</span>
                  <span className="ir-value" style={{ fontSize: '0.78rem', color: 'var(--muted2)' }}>{String(v ?? '—')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
