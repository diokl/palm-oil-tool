import { NextResponse } from 'next/server';
import { runMpobSync } from '@/lib/mpob-sync';

// Scraping involves a login + 4 page fetches + 4 report fetches, which can
// exceed the default serverless timeout. Allow up to 60s and never cache.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await runMpobSync();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
