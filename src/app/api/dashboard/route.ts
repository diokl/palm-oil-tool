import { NextResponse } from 'next/server';
import { dbAll, dbGet } from '@/lib/db';
import { seedInitialData } from '@/lib/seed-data';
import { generateAlerts } from '@/lib/inventory-calc';
import { calculateBoxRange } from '@/lib/box-range';

export async function GET() {
  try {
    await seedInitialData();

    // Active alerts
    const alerts = await generateAlerts();

    // Latest FCPO prices (most recent date, all contract months)
    const latestDate = await dbGet(
      `SELECT date FROM fcpo_settlement ORDER BY date DESC LIMIT 1`
    ) as { date: string } | undefined;

    let fcpoLatest: any[] = [];
    if (latestDate) {
      fcpoLatest = await dbAll(
        `SELECT contract_month, settlement_myr, settlement_usd,
         (SELECT settlement_myr FROM fcpo_settlement f2
          WHERE f2.contract_month = f1.contract_month AND f2.date < f1.date
          ORDER BY f2.date DESC LIMIT 1) as prev_myr
         FROM fcpo_settlement f1
         WHERE date = ?
         ORDER BY contract_month`,
        [latestDate.date]
      );
    }

    // Inventory summary (current year, latest month with data)
    const inventorySummary = await dbAll(
      `SELECT product, year, month, ending_stock, coverage_days
       FROM inventory
       WHERE (product = 'RBD' AND year = 2026 AND month = 4)
          OR (product = 'RSPO' AND year = 2026 AND month = 4)
       ORDER BY product`
    );

    // Box range for active months
    const boxRanges: any[] = [];
    for (const month of ['2026-04', '2026-05', '2026-06']) {
      const br = await calculateBoxRange(month);
      if (br) boxRanges.push({ contract_month: month, zone: br.current_zone, current_price: br.current_price });
    }

    // Recent purchases
    const recentPurchases = await dbAll(
      `SELECT * FROM purchases ORDER BY contract_date DESC LIMIT 5`
    );

    // Recent news
    const recentNews = await dbAll(
      `SELECT * FROM news ORDER BY date DESC LIMIT 5`
    );

    // Latest AI analysis
    const latestAnalysis = await dbGet(
      `SELECT result FROM analyses ORDER BY created_at DESC LIMIT 1`
    ) as { result: string } | undefined;

    return NextResponse.json({
      alerts,
      fcpo_latest: fcpoLatest,
      fcpo_latest_date: latestDate?.date,
      inventory_summary: inventorySummary,
      box_ranges: boxRanges,
      recent_purchases: recentPurchases,
      recent_news: recentNews,
      ai_analysis: latestAnalysis?.result ? JSON.parse(latestAnalysis.result) : null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
