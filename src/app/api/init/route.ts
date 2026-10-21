import { NextResponse } from 'next/server';
import { seedInitialData } from '@/lib/seed-data';

export async function POST() {
  try {
    await seedInitialData(); // (이전: await 없이 호출 → 끝나기 전에 success 응답, 실패는 처리되지 않은 rejection)
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
