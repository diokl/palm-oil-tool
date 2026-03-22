import { NextResponse } from 'next/server';
import { seedInitialData } from '@/lib/seed-data';

export async function POST() {
  try {
    seedInitialData();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
