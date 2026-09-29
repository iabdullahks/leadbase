'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import NavLink from './NavLink';

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('superadmin69@gmail.com');

  // Read client cookie or session
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const match = document.cookie.match(/sb_user_email=([^;]+)/);
      if (match && match[1]) {
        setUserEmail(decodeURIComponent(match[1]));
      }
    }
  }, []);

  // Do not show the dashboard header on the login page
  if (pathname === '/login') {
    return null;
  }

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch (e) {
      console.error('Logout error:', e);
      router.push('/login');
    } finally {
      setLoggingOut(false);
    }
  };

  return (
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

        {/* User Badge & Logout */}
        <div className="topbar-user-section">
          <div className="user-pill" title={`Logged in as ${userEmail}`}>
            <span className="user-avatar-circle">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <span className="user-email-text">{userEmail}</span>
          </div>

          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="btn-logout"
            title="Log out of LeadBase"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>{loggingOut ? 'Exiting...' : 'Sign Out'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
