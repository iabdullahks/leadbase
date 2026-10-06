import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/auth/revoke-sessions
 * 
 * Admin endpoint to revoke all sessions for a specific user by email.
 * This immediately invalidates any active tokens, forcing that user to log in again.
 * 
 * Body: { email: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    // Find the user by email using admin API
    const { data: userList, error: listError } = await supabaseAdmin.auth.admin.listUsers();

    if (listError) {
      return NextResponse.json({ error: `Failed to list users: ${listError.message}` }, { status: 500 });
    }

    const targetUser = userList.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (!targetUser) {
      return NextResponse.json({ error: `No user found with email: ${email}` }, { status: 404 });
    }

    // Sign out the user from all sessions (server-side revocation)
    const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(
      targetUser.id,
      'global' // Revoke ALL sessions, not just the current one
    );

    if (signOutError) {
      return NextResponse.json(
        { error: `Failed to revoke sessions: ${signOutError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `All sessions revoked for ${email}. User will be forced to log in again.`,
      userId: targetUser.id,
    });
  } catch (err: any) {
    console.error('Revoke sessions error:', err);
    return NextResponse.json(
      { error: err.message || 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}
