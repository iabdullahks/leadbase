import type { Metadata } from 'next';
import './globals.css';
import TopBar from './components/TopBar';

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
          <TopBar />
          <main className="main-content">{children}</main>
        </div>
        <div id="toast-root" />
      </body>
    </html>
  );
}
