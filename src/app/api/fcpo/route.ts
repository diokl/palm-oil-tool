import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun } from '@/lib/db';
import { seedInitialData } from '@/lib/seed-data';

export async function GET(request: NextRequest) {
  try {
    try { await seedInitialData(); } catch (e: any) { console.warn('Seed skipped:', e.message); }
    const { searchParams } = new URL(request.url);
    const contractMonth = searchParams.get('contract_month');
    const limit = parseInt(searchParams.get('limit') || '500');

    let query: string;
    let params: any[];

    if (contractMonth) {
      query = `SELECT * FROM fcpo_settlement WHERE contract_month = ? ORDER BY date DESC LIMIT ?`;
      params = [contractMonth, limit];
    } else {
      // Get contract months
      const months = await dbAll(
        `SELECT DISTINCT contract_month FROM fcpo_settlement ORDER BY contract_month`
      ) as { contract_month: string }[];

      // Get all data in a single query instead of N+1 queries
      const allData = await dbAll(
        `SELECT f.date, f.contract_month, f.settlement_myr, f.settlement_usd
         FROM fcpo_settlement f
         INNER JOIN (
           SELECT DISTINCT date FROM fcpo_settlement ORDER BY date DESC LIMIT ?
         ) d ON f.date = d.date
         ORDER BY f.date DESC`,
        [limit]
      ) as any[];

      // Pivot in JavaScript
      const pivotMap = new Map<string, any>();
      for (const row of allData) {
        if (!pivotMap.has(row.date)) {
          pivotMap.set(row.date, { date: row.date });
        }
        const pivotRow = pivotMap.get(row.date);
        pivotRow[`${row.contract_month}_myr`] = row.settlement_myr;
        pivotRow[`${row.contract_month}_usd`] = row.settlement_usd;
      }

      // Sort by date descending
      const pivotData = Array.from(pivotMap.values()).sort(
        (a, b) => b.date.localeCompare(a.date)
      );

      return NextResponse.json({
        data: pivotData,
        contract_months: months.map(m => m.contract_month),
      });
    }

    const data = await dbAll(query, params);
    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, contract_month, settlement_myr, settlement_usd, exchange_rate, source } = body;

    await dbRun(
      `INSERT INTO fcpo_settlement (date, contract_month, settlement_myr, settlement_usd, exchange_rate, source)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (date, contract_month) DO UPDATE SET
         settlement_myr = EXCLUDED.settlement_myr,
         settlement_usd = EXCLUDED.settlement_usd,
         exchange_rate = EXCLUDED.exchange_rate,
         source = EXCLUDED.source`,
      [date, contract_month, settlement_myr, settlement_usd, exchange_rate, source || 'manual']
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
