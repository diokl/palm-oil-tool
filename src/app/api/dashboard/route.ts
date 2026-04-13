import { NextResponse } from 'next/server';
import { dbAll, dbGet } from '@/lib/db';
import { seedInitialData } from '@/lib/seed-data';
import { generateAlerts } from '@/lib/inventory-calc';
import { calculateBoxRange } from '@/lib/box-range';

export async function GET() {
  try {
    // Seed data (best-effort: skip if writes are blocked on free tier)
    try {
      await seedInitialData();
    } catch (seedErr: any) {
      console.warn('Seed data skipped:', seedErr.message);
    }

    // Active alerts (computed in-memory, DB write is best-effort)
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

    // Box range for all contract months with sufficient data (>=10 price points)
    const activeMonths = await dbAll(
      `SELECT contract_month, COUNT(*) as cnt
       FROM fcpo_settlement
       WHERE settlement_usd IS NOT NULL
       GROUP BY contract_month
       HAVING COUNT(*) >= 10
       ORDER BY contract_month`
    ) as { contract_month: string; cnt: number }[];

    const boxRangeResults = await Promise.all(
      activeMonths.map(({ contract_month }) => calculateBoxRange(contract_month).catch(() => null))
    );
    const boxRanges = activeMonths
      .map(({ contract_month }, i) => {
        const br = boxRangeResults[i];
        return br ? { contract_month, zone: br.current_zone, current_price: br.current_price } : null;
      })
      .filter(Boolean);

    // Recent purchases
    const recentPurchases = await dbAll(
      `SELECT * FROM purchases ORDER BY created_at DESC, id DESC LIMIT 5`
    );

    // Recent news
    const recentNews = await dbAll(
      `SELECT * FROM news ORDER BY date DESC LIMIT 5`
    );

    // MPOB Summary (latest year, key items only) — best-effort, skip if table doesn't exist
    let mpobSummary: any[] = [];
    try {
      mpobSummary = await dbAll(
        `SELECT category, item_name, month, value, value_rm
         FROM mpob_data
         WHERE year = 2026
           AND item_name IN ('RBD PALM OIL', 'RBD PALM OLEIN', 'RBD PALM STEARIN', 'PFAD', 'MALAYSIA', 'TOTAL')
         ORDER BY category, item_name, month`
      );
    } catch (e: any) {
      console.warn('MPOB summary skipped:', e.message);
    }

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
      mpob_summary: mpobSummary,
      recent_purchases: recentPurchases,
      recent_news: recentNews,
      ai_analysis: latestAnalysis?.result ? JSON.parse(latestAnalysis.result) : null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
