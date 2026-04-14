import { NextRequest, NextResponse } from 'next/server';
import { validateCredentials, createSessionToken, SESSION_COOKIE_NAME, agreeToTerms } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { id, password, agreeTerms } = await request.json();

    if (!id || !password) {
      return NextResponse.json({ error: 'ID와 비밀번호를 입력하세요' }, { status: 400 });
    }

    const result = await validateCredentials(id, password);

    if (!result.valid) {
      if (result.reason === 'pending_approval') {
        return NextResponse.json({
          error: '관리자 승인 대기중입니다. 마스터 계정 관리자에게 문의하세요.',
          pending: true,
        }, { status: 403 });
      }
      return NextResponse.json({ error: 'ID 또는 비밀번호가 올바르지 않습니다' }, { status: 401 });
    }

    // If user agreed to terms in this request, store it
    if (agreeTerms && !result.termsAgreed) {
      await agreeToTerms(id);
      result.termsAgreed = true;
    }

    const token = createSessionToken(id, result.role, result.canWrite);

    const response = NextResponse.json({
      success: true,
      user: id,
      role: result.role,
      canWrite: result.canWrite,
      termsAgreed: result.termsAgreed,
    });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });

    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
