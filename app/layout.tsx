import type { Metadata } from 'next';
import Image from 'next/image';
import './globals.css';
import NavLink from './components/NavLink';

export const metadata: Metadata = {
  title: 'LeadBase — Carrier Intelligence Dashboard',
  description: 'Premium trucking leads dashboard. Search, filter, and export USDOT carrier data in real time.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500;14..32,600;14..32,700;14..32,800;14..32,900&family=JetBrains+Mono:wght@400;500;600&display=swap"
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
                      width={36}
                      height={36}
                      style={{ borderRadius: 8, display: 'block' }}
                      priority
                    />
                  </div>
                  <div>
                    <div className="brand-name">LeadBase</div>
                    <div className="brand-sub">Carrier Intelligence</div>
                  </div>
                </div>
              </NavLink>
              <nav className="top-nav">
                <NavLink href="/">Dashboard</NavLink>
                <NavLink href="/leads">Leads</NavLink>
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
