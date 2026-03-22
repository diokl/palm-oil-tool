import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun, dbLastId } from '@/lib/db';
import { seedInitialData } from '@/lib/seed-data';

export async function GET(request: NextRequest) {
  try {
    await seedInitialData();
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '30');

    const data = await dbAll('SELECT * FROM news ORDER BY date DESC, id DESC LIMIT ?', [limit]);

    // Sentiment summary
    const recent = await dbAll(
      `SELECT sentiment, COUNT(*) as cnt FROM news WHERE date >= date('now', '-7 days') GROUP BY sentiment`
    ) as { sentiment: string; cnt: number }[];

    return NextResponse.json({ data, sentiment_summary: recent });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, content, sentiment, impact, created_by } = body;

    await dbRun(
      `INSERT INTO news (date, content, sentiment, impact, created_by) VALUES (?, ?, ?, ?, ?)`,
      [date, content, sentiment, impact, created_by || 'user']
    );

    const id = await dbLastId();
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
