import { supabaseAdmin } from '@/lib/supabase';
import type { Stats } from '@/lib/types';
import Link from 'next/link';

async function getStats(): Promise<Stats> {
  try {
    const [totalRes, activeRes, inactiveRes, phoneRes, emailRes, todayRes] = await Promise.all([
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true }),
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true }).eq('carrier_status', 'Active'),
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true }).eq('carrier_status', 'Inactive'),
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true }).neq('phone', ''),
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true }).neq('email', ''),
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true })
        .gte('scraped_at', new Date().toISOString().slice(0, 10)),
    ]);
    return {
      total:      totalRes.count   ?? 0,
      active:     activeRes.count  ?? 0,
      inactive:   inactiveRes.count ?? 0,
      with_phone: phoneRes.count   ?? 0,
      with_email: emailRes.count   ?? 0,
      new_today:  todayRes.count   ?? 0,
    };
  } catch (err) {
    console.error('getStats error:', err);
    return { total: 0, active: 0, inactive: 0, with_phone: 0, with_email: 0, new_today: 0 };
  }
}

async function getRecentLeads() {
  try {
    const { data, error } = await supabaseAdmin
      .from('carriers')
      .select('usdot_number, legal_name, carrier_status, scraped_at')
      .order('scraped_at', { ascending: false })
      .limit(10);
    if (error) {
      console.error('getRecentLeads error:', error);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error('getRecentLeads error:', err);
    return [];
  }
}

function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmt(n: number) {
  return n.toLocaleString();
}

export default async function DashboardPage() {
  const [stats, recent] = await Promise.all([getStats(), getRecentLeads()]);

  return (
    <div className="dashboard-page">
      <div className="page-header fade-up">
        <h1 className="page-title">🚛 Carrier Intelligence Dashboard</h1>
        <p className="page-subtitle">Real-time USDOT lead data — {fmt(stats.total)} carriers tracked</p>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        {[
          { icon: '📊', label: 'Total Leads',     value: fmt(stats.total),      cls: 'si-blue',   delay: '0s' },
          { icon: '✅', label: 'Active Carriers', value: fmt(stats.active),     cls: 'si-green',  delay: '0.05s' },
          { icon: '📞', label: 'With Phone',      value: fmt(stats.with_phone), cls: 'si-cyan',   delay: '0.1s' },
          { icon: '✉️', label: 'With Email',      value: fmt(stats.with_email), cls: 'si-purple', delay: '0.15s' },
          { icon: '🆕', label: 'Added Today',     value: fmt(stats.new_today),  cls: 'si-orange', delay: '0.2s' },
        ].map(s => (
          <div key={s.label} className="stat-card fade-up" style={{ animationDelay: s.delay }}>
            <div className={`stat-icon ${s.cls}`}>{s.icon}</div>
            <div>
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div className="dashboard-grid fade-up" style={{ animationDelay: '0.25s' }}>
        {/* Recent leads */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">🕐 Recent Leads</span>
            <Link href="/leads" style={{ fontSize: '0.8rem', color: 'var(--cyan)', textDecoration: 'none' }}>
              View all →
            </Link>
          </div>
          <div className="card-body">
            {recent.map(lead => (
              <Link
                key={lead.usdot_number}
                href={`/leads/${lead.usdot_number}`}
                className="recent-lead-row"
              >
                <span className="rl-usdot">{lead.usdot_number}</span>
                <span className="rl-name">{lead.legal_name || '—'}</span>
                <span
                  className={`pill pill-${(lead.carrier_status || '').toLowerCase() === 'active'
                    ? 'active'
                    : (lead.carrier_status || '').toLowerCase() === 'inactive'
                    ? 'inactive'
                    : 'other'}`}
                >
                  {lead.carrier_status}
                </span>
                <span className="rl-date">{formatDate(lead.scraped_at)}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Quick actions */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">⚡ Quick Actions</span>
          </div>
          <div className="card-body">
            <div className="quick-actions">
              <Link href="/leads" className="qa-btn qa-blue">
                <span className="qa-icon">🔍</span>
                <span className="qa-text">
                  <span className="qa-label">Browse All Leads</span>
                  <span className="qa-desc">Search, filter and sort {fmt(stats.total)} carriers</span>
                </span>
              </Link>
              <Link href="/leads?has_phone=1&status=active" className="qa-btn qa-green">
                <span className="qa-icon">📞</span>
                <span className="qa-text">
                  <span className="qa-label">Active With Phone</span>
                  <span className="qa-desc">{fmt(stats.with_phone)} leads ready to call</span>
                </span>
              </Link>
              <Link href="/leads?has_email=1&has_phone=1&status=active" className="qa-btn qa-purple">
                <span className="qa-icon">✉️</span>
                <span className="qa-text">
                  <span className="qa-label">Full Contact Leads</span>
                  <span className="qa-desc">Active carriers with both phone & email</span>
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Coverage bar */}
      <div className="card fade-up" style={{ animationDelay: '0.3s' }}>
        <div className="card-header">
          <span className="card-title">📈 Database Coverage</span>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {[
            { label: 'Active Carriers', value: stats.active, total: stats.total, color: 'var(--green)' },
            { label: 'With Phone Number', value: stats.with_phone, total: stats.total, color: 'var(--cyan)' },
            { label: 'With Email Address', value: stats.with_email, total: stats.total, color: 'var(--purple)' },
          ].map(bar => {
            const pct = stats.total > 0 ? Math.round((bar.value / stats.total) * 100) : 0;
            return (
              <div key={bar.label} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--muted2)' }}>{bar.label}</span>
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{fmt(bar.value)} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({pct}%)</span></span>
                </div>
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '99px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${pct}%`, borderRadius: '99px',
                    background: bar.color, boxShadow: `0 0 10px ${bar.color}40`,
                    transition: 'width 1s ease',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
