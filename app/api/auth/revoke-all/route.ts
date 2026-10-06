import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/auth/revoke-all
 * 
 * NUCLEAR OPTION: Revokes ALL sessions for ALL users.
 * Every single logged-in user will be forced to log in again.
 */
export async function POST() {
  try {
    const { data: userList, error: listError } = await supabaseAdmin.auth.admin.listUsers();

    if (listError) {
      return NextResponse.json({ error: `Failed to list users: ${listError.message}` }, { status: 500 });
    }

    const results: { email: string | undefined; id: string; revoked: boolean; error?: string }[] = [];

    for (const user of userList.users) {
      try {
        const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(
          user.id,
          'global'
        );

        results.push({
          email: user.email,
          id: user.id,
          revoked: !signOutError,
          error: signOutError?.message,
        });
      } catch (e: any) {
        results.push({
          email: user.email,
          id: user.id,
          revoked: false,
          error: e.message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Revoked sessions for ${results.filter(r => r.revoked).length}/${userList.users.length} users.`,
      totalUsers: userList.users.length,
      results,
    });
  } catch (err: any) {
    console.error('Revoke all sessions error:', err);
    return NextResponse.json(
      { error: err.message || 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/revoke-all
 * 
 * Lists all Supabase Auth users (for finding the unknown user).
 */
export async function GET() {
  try {
    const { data: userList, error } = await supabaseAdmin.auth.admin.listUsers();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const users = userList.users.map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      confirmed: !!u.email_confirmed_at,
    }));

    return NextResponse.json({
      totalUsers: users.length,
      users,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
