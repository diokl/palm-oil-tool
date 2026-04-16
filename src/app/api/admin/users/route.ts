import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME, resetUserPassword } from '@/lib/auth';
import { dbAll, dbRun } from '@/lib/db';

// Helper: verify master role from cookie
function getMasterUser(request: NextRequest): { valid: boolean; userId?: string } {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return { valid: false };
  const payload = verifySessionToken(token);
  if (!payload.valid || payload.role !== 'master') return { valid: false };
  return { valid: true, userId: payload.userId };
}

// GET — list all users (master only)
export async function GET(request: NextRequest) {
  try {
    const master = getMasterUser(request);
    if (!master.valid) {
      return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 });
    }

    const users = await dbAll(
      `SELECT id, username, role, can_write, approved, terms_agreed, terms_agreed_at, created_at
       FROM users ORDER BY created_at DESC`
    );

    return NextResponse.json({ users });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT — update user permissions or reset password (master only)
export async function PUT(request: NextRequest) {
  try {
    const master = getMasterUser(request);
    if (!master.valid) {
      return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 });
    }

    const body = await request.json();
    const { action, userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    if (action === 'reset_password') {
      await resetUserPassword(userId);
      return NextResponse.json({ success: true, message: '비밀번호가 초기화되었습니다' });
    }

    if (action === 'toggle_write') {
      const { canWrite } = body;
      await dbRun('UPDATE users SET can_write = ? WHERE id = ?', [canWrite, userId]);
      return NextResponse.json({ success: true });
    }

    if (action === 'approve') {
      await dbRun('UPDATE users SET approved = TRUE WHERE id = ?', [userId]);
      return NextResponse.json({ success: true, message: '승인되었습니다' });
    }

    if (action === 'revoke_approval') {
      await dbRun('UPDATE users SET approved = FALSE WHERE id = ? AND role != \'master\'', [userId]);
      return NextResponse.json({ success: true });
    }

    if (action === 'change_role') {
      const { role } = body;
      if (!['master', 'user'].includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      }
      await dbRun('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE — delete user (master only)
export async function DELETE(request: NextRequest) {
  try {
    const master = getMasterUser(request);
    if (!master.valid) {
      return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Prevent deleting master account
    const user = await dbAll('SELECT role FROM users WHERE id = ?', [parseInt(userId)]);
    if (user.length > 0 && user[0].role === 'master') {
      return NextResponse.json({ error: '마스터 계정은 삭제할 수 없습니다' }, { status: 400 });
    }

    await dbRun('DELETE FROM users WHERE id = ?', [parseInt(userId)]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
