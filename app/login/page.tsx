'use client';

import React, { useState, Suspense } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Invalid email or password.');
        setLoading(false);
        return;
      }

      // Smooth transition to target redirect path
      router.push(redirectPath);
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Network connection error. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="login-viewport">
      {/* Background ambient decorative glows */}
      <div className="login-ambient-glow glow-cyan" />
      <div className="login-ambient-glow glow-indigo" />
      <div className="login-ambient-grid" />

      <div className="login-card-container">
        {/* Header / Brand */}
        <div className="login-card-header">
          <div className="login-brand-wrapper">
            <div className="login-logo-container">
              <Image
                src="/logo.jpg"
                alt="LeadBase Logo"
                width={42}
                height={42}
                style={{ objectFit: 'cover', borderRadius: '8px' }}
                priority
              />
            </div>
            <div className="login-brand-text">
              <div className="login-brand-title">
                <span>LeadBase</span>
                <span className="brand-badge">PRO</span>
              </div>
              <span className="login-brand-subtitle">Carrier Intelligence Platform</span>
            </div>
          </div>
          <h1 className="login-title">Sign in to Terminal</h1>
          <p className="login-description">
            Enter your credentials to access verified USDOT lead feeds and equipment registries.
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="login-alert-error" role="alert">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="alert-icon"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field-group">
            <label htmlFor="email" className="login-label">
              Admin Email
            </label>
            <div className="login-input-wrap">
              <span className="login-input-icon">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </span>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                placeholder="superadmin69@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="login-input"
                autoFocus
              />
            </div>
          </div>

          <div className="login-field-group">
            <div className="login-label-row">
              <label htmlFor="password" className="login-label">
                Master Password
              </label>
            </div>
            <div className="login-input-wrap">
              <span className="login-input-icon">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-input"
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" x2="22" y1="2" y2="22" />
                  </svg>
                ) : (
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`login-submit-btn ${loading ? 'loading' : ''}`}
          >
            {loading ? (
              <span className="login-spinner-wrap">
                <span className="login-spinner" />
                <span>Verifying credentials...</span>
              </span>
            ) : (
              <span className="login-btn-content">
                <span>Access Terminal</span>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </span>
            )}
          </button>
        </form>

        {/* Security Footer Notice */}
        <div className="login-security-notice">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: 'var(--cyan)' }}
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <span>End-to-end encrypted session • Authorized personnel only</span>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="login-viewport">
          <div className="login-spinner" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
