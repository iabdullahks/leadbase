import { NextResponse, type NextRequest } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  FORCE LOGOUT EPOCH                                             │
 * │                                                                  │
 * │  Any JWT issued BEFORE this Unix timestamp (seconds) is          │
 * │  rejected instantly — no Supabase call needed.                   │
 * │                                                                  │
 * │  To force-logout everyone again in the future, just update       │
 * │  this number to the current Unix timestamp and redeploy.         │
 * │                                                                  │
 * │  Current value = 2026-10-06T14:22:00Z                            │
 * └──────────────────────────────────────────────────────────────────┘
 */
const FORCE_LOGOUT_BEFORE = 1791455000;

/**
 * Decode a JWT payload without verification (we only need `iat`).
 * Works in Edge Runtime — no external libraries needed.
 */
function decodeJwtPayload(token: string): { iat?: number; exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Base64url → Base64 → decode
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Validate token against Supabase Auth.
 * Returns true only if the token maps to a real, active user session.
 */
async function isTokenValid(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    return res.ok; // 200 = valid, 401/403 = revoked/expired
  } catch {
    return false;
  }
}

/**
 * Build a response that clears auth cookies and redirects to login (or returns 401 for APIs).
 */
function buildUnauthorizedResponse(request: NextRequest, pathname: string): NextResponse {
  if (pathname.startsWith('/api/')) {
    const res = NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    clearAuthCookies(res);
    return res;
  }

  const loginUrl = new URL('/login', request.url);
  if (pathname !== '/') {
    loginUrl.searchParams.set('redirect', pathname);
  }
  const res = NextResponse.redirect(loginUrl);
  clearAuthCookies(res);
  return res;
}

function clearAuthCookies(response: NextResponse) {
  response.cookies.set('sb_access_token', '', { path: '/', maxAge: 0 });
  response.cookies.set('sb_user_email', '', { path: '/', maxAge: 0 });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get('sb_access_token')?.value;

  // 1. Allow login route and public auth APIs
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    // If already logged in and visiting /login, redirect to main dashboard
    if (token && pathname === '/login') {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  // 2. No token at all → redirect to login
  if (!token) {
    return buildUnauthorizedResponse(request, pathname);
  }

  // 3. FORCE LOGOUT CHECK — reject tokens issued before the epoch
  //    This is instant (no network call) and kills ALL old sessions on deploy.
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.iat || payload.iat < FORCE_LOGOUT_BEFORE) {
    return buildUnauthorizedResponse(request, pathname);
  }

  // 4. Validate token against Supabase — blocks revoked/expired sessions
  const valid = await isTokenValid(token);
  if (!valid) {
    return buildUnauthorizedResponse(request, pathname);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, logo.jpg, images
     */
    '/((?!_next/static|_next/image|favicon.ico|logo.jpg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
