import { NextRequest, NextResponse } from 'next/server';
import { validateCredentials, createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { id, password } = await request.json();

    if (!id || !password) {
      return NextResponse.json({ error: 'ID와 비밀번호를 입력하세요' }, { status: 400 });
    }

    if (!validateCredentials(id, password)) {
      return NextResponse.json({ error: 'ID 또는 비밀번호가 올바르지 않습니다' }, { status: 401 });
    }

    const token = createSessionToken(id);

    const response = NextResponse.json({ success: true, user: id });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });

    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
