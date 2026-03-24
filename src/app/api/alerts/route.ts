import { NextRequest, NextResponse } from 'next/server';
import { dbRun } from '@/lib/db';
import { seedInitialData } from '@/lib/seed-data';
import { generateAlerts } from '@/lib/inventory-calc';

export async function GET() {
  try {
    try { await seedInitialData(); } catch (e: any) { console.warn('Seed skipped:', e.message); }
    const alerts = await generateAlerts();
    return NextResponse.json({ data: alerts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action_taken } = body;

    await dbRun(`UPDATE alerts SET action_taken = ? WHERE id = ?`, [action_taken, id]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
