import type { Metadata } from 'next';
import Image from 'next/image';
import './globals.css';
import NavLink from './components/NavLink';
import { DatabaseIcon } from './components/Icons';

export const metadata: Metadata = {
  title: 'LeadBase — Carrier Intelligence Platform',
  description: 'Enterprise trucking leads and carrier intelligence. Search, filter, and export USDOT carrier data in real time.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500;14..32,600;14..32,700;14..32,800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div id="app-root">
          <header className="topbar">
            <div className="topbar-left">
              <NavLink href="/">
                <div className="brand">
                  <div className="brand-logo">
                    <Image
                      src="/logo.jpg"
                      alt="LeadBase logo"
                      width={32}
                      height={32}
                      style={{ objectFit: 'cover', display: 'block' }}
                      priority
                    />
                  </div>
                  <div className="brand-info">
                    <div className="brand-name">
                      <span>LeadBase</span>
                      <span className="brand-badge">PRO</span>
                    </div>
                    <div className="brand-sub">Carrier Intelligence</div>
                  </div>
                </div>
              </NavLink>

              <nav className="top-nav" aria-label="Main Navigation">
                <NavLink href="/">Dashboard</NavLink>
                <NavLink href="/leads">Leads</NavLink>
              </nav>
            </div>

            <div className="topbar-right">
              <div className="live-badge" title="Connected to real-time Motus database">
                <span className="live-dot-wrap">
                  <span className="live-dot-ping" />
                  <span className="live-dot" />
                </span>
                <span>Live Database</span>
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
