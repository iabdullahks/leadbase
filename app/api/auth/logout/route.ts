import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const token = req.cookies.get('sb_access_token')?.value;

  // Revoke the session server-side so the token can't be reused anywhere
  if (token) {
    try {
      // Get user from token, then sign them out server-side
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);
      if (user) {
        await supabaseAdmin.auth.admin.signOut(user.id, 'global');
      }
    } catch (e) {
      console.error('Server-side session revocation failed:', e);
    }
  }

  const response = NextResponse.json({ success: true, message: 'Logged out successfully.' });

  // Clear authentication cookies
  response.cookies.set('sb_access_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  response.cookies.set('sb_user_email', '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  return response;
}
