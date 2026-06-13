import { NextResponse } from 'next/server';
import { dbAll, dbGet } from '@/lib/db';
import { seedInitialData } from '@/lib/seed-data';
import { generateAlerts } from '@/lib/inventory-calc';
import { calculateBoxRange } from '@/lib/box-range';
import { calculatePrebuyEffect, DEFAULT_EXCHANGE_RATE } from '@/lib/prebuy-effect';
import { getOilSpread } from '@/lib/oil-spread';
import type { Product } from '@/lib/types';

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
    // MANAGED 포함 — 26년 7월부터 통관 시작하는 관리팜유
    const inventorySummary = await dbAll(
      `SELECT product, year, month, ending_stock, coverage_days
       FROM inventory
       WHERE product IN ('RBD', 'RSPO', 'MANAGED')
         AND year = 2026 AND month = 4
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

    // MPOB Summary — 25/26 모두 가져와 YoY 계산 가능하게
    let mpobSummary: any[] = [];
    try {
      mpobSummary = await dbAll(
        `SELECT category, item_name, year, month, value, value_rm
         FROM mpob_data
         WHERE year IN (2024, 2025, 2026)
           AND item_name IN ('RBD PALM OIL', 'RBD PALM OLEIN', 'RBD PALM STEARIN', 'PFAD', 'MALAYSIA', 'TOTAL')
         ORDER BY category, item_name, year, month`
      );
    } catch (e: any) {
      console.warn('MPOB summary skipped:', e.message);
    }

    // Latest AI analysis
    const latestAnalysis = await dbGet(
      `SELECT result FROM analyses ORDER BY created_at DESC LIMIT 1`
    ) as { result: string } | undefined;

    // Prebuy effect — per-purchase market_price_usd based
    let prebuyEffect = null;
    try {
      const allPurchases = await dbAll('SELECT * FROM purchases ORDER BY shipment_month ASC');

      // Group by month
      const grouped = new Map<string, any[]>();
      allPurchases.forEach((p: any) => {
        if (!grouped.has(p.shipment_month)) grouped.set(p.shipment_month, []);
        grouped.get(p.shipment_month)!.push(p);
      });

      const months: any[] = [];
      for (const [month, purchases] of grouped.entries()) {
        const rbdP     = purchases.filter((p: any) => p.product === 'RBD');
        const rspoP    = purchases.filter((p: any) => p.product === 'RSPO');
        const managedP = purchases.filter((p: any) => p.product === 'MANAGED');

        // Per-purchase effect with per-purchase exchange_rate.
        // 프리미엄 자동 가산 (RBD:0 / RSPO:+25 / MANAGED:+65) — prebuy-effect.ts 위임.
        const calcGroup = (arr: any[]) => {
          let qty = 0, amount = 0, effectUsd = 0, effectKrw = 0;
          for (const p of arr) {
            qty += p.qty_mt || 0;
            amount += p.amount_usd || 0;
            if (p.market_price_usd != null) {
              const er = p.exchange_rate != null ? Number(p.exchange_rate) : DEFAULT_EXCHANGE_RATE;
              const r = calculatePrebuyEffect({
                product: p.product as Product,
                contract_price: p.unit_price ?? 0,
                market_price_rbd: Number(p.market_price_usd),
                qty_mt: p.qty_mt || 0,
                exchange_rate: er,
              });
              // 양수=절감 (savings 부호) — 기존 대시보드 표시 호환
              effectUsd += r.savings_usd;
              effectKrw += r.savings_krw;
            }
          }
          return { qty, amount, effectUsd, effectKrw };
        };

        const rbdS     = calcGroup(rbdP);
        const rspoS    = calcGroup(rspoP);
        const managedS = calcGroup(managedP);

        months.push({
          shipment_month: month,
          rbd_qty: rbdS.qty, rbd_amount: rbdS.amount,
          rbd_effect_usd: rbdS.effectUsd, rbd_effect_krw: rbdS.effectKrw,
          rspo_qty: rspoS.qty, rspo_amount: rspoS.amount,
          rspo_effect_usd: rspoS.effectUsd, rspo_effect_krw: rspoS.effectKrw,
          managed_qty: managedS.qty, managed_amount: managedS.amount,
          managed_effect_usd: managedS.effectUsd, managed_effect_krw: managedS.effectKrw,
          total_qty: rbdS.qty + rspoS.qty + managedS.qty,
          total_amount: rbdS.amount + rspoS.amount + managedS.amount,
          effect_usd: rbdS.effectUsd + rspoS.effectUsd + managedS.effectUsd,
          effect_krw: rbdS.effectKrw + rspoS.effectKrw + managedS.effectKrw,
        });
      }

      prebuyEffect = {
        months,
        total_records: allPurchases.length,
      };
    } catch (e: any) {
      console.warn('Prebuy effect calc skipped:', e.message);
    }

    // 팜유-대두유 스프레드 (best-effort)
    let oilSpread = null;
    try { oilSpread = await getOilSpread(90); } catch (e: any) { console.warn('Oil spread skipped:', e.message); }

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
      prebuy_effect: prebuyEffect,
      oil_spread: oilSpread,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
