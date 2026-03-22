import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun } from '@/lib/db';
import { seedInitialData } from '@/lib/seed-data';

export async function GET(request: NextRequest) {
  try {
    await seedInitialData();
    const { searchParams } = new URL(request.url);
    const contractMonth = searchParams.get('contract_month');
    const limit = parseInt(searchParams.get('limit') || '60');

    let query: string;
    let params: any[];

    if (contractMonth) {
      query = `SELECT * FROM fcpo_settlement WHERE contract_month = ? ORDER BY date DESC LIMIT ?`;
      params = [contractMonth, limit];
    } else {
      // Get pivot table: dates as rows, contract months as columns
      const dates = await dbAll(
        `SELECT DISTINCT date FROM fcpo_settlement ORDER BY date DESC LIMIT ?`,
        [limit]
      ) as { date: string }[];

      const months = await dbAll(
        `SELECT DISTINCT contract_month FROM fcpo_settlement ORDER BY contract_month`
      ) as { contract_month: string }[];

      const pivotData = [];
      for (const d of dates) {
        const row: any = { date: d.date };
        const prices = await dbAll(
          `SELECT contract_month, settlement_myr, settlement_usd FROM fcpo_settlement WHERE date = ?`,
          [d.date]
        ) as any[];
        for (const p of prices) {
          row[`${p.contract_month}_myr`] = p.settlement_myr;
          row[`${p.contract_month}_usd`] = p.settlement_usd;
        }
        pivotData.push(row);
      }

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
      `INSERT OR REPLACE INTO fcpo_settlement (date, contract_month, settlement_myr, settlement_usd, exchange_rate, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [date, contract_month, settlement_myr, settlement_usd, exchange_rate, source || 'manual']
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
