import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LeadBase — Carrier Intelligence Dashboard',
  description: 'Premium trucking leads dashboard. Search, filter, and export USDOT carrier data in real time.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div id="app-root">
          <header className="topbar">
            <div className="topbar-left">
              <div className="brand">
                <span className="brand-icon">🚛</span>
                <div>
                  <div className="brand-name">LeadBase</div>
                  <div className="brand-sub">Carrier Intelligence</div>
                </div>
              </div>
              <nav className="top-nav">
                <a href="/" className="nav-link">Dashboard</a>
                <a href="/leads" className="nav-link">Leads</a>
              </nav>
            </div>
            <div className="topbar-right">
              <div className="live-badge">
                <span className="live-dot" />
                Live Database
              </div>
            </div>
          </header>
          <main className="main-content">{children}</main>
        </div>
        <div id="toast-root" />
      </body>
    </html>
  );
}
