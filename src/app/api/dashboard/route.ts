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

    // Inventory summary — 재고관리 탭의 각 제품 최신 기말재고(KG)를 그대로 반영.
    // 고정 월 대신: 각 제품별로 '현재월 이하에서 기말재고가 있는 최신 월'을 선택.
    // (MANAGED는 7월 통관 시작이라 현재월 이하 데이터가 없으면 최초 운영월로 폴백)
    const now = new Date();
    const cutoff = now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1); // 현재 year*12+month
    const invRows = await dbAll(
      `SELECT product, year, month, ending_stock, coverage_days, customs_volume
       FROM inventory
       WHERE product IN ('RBD', 'RSPO', 'MANAGED')
         AND ending_stock IS NOT NULL
       ORDER BY product, year, month`
    ) as { product: string; year: number; month: number; ending_stock: number; coverage_days: number; customs_volume: number }[];
    const byProduct: Record<string, typeof invRows> = {};
    for (const r of invRows) (byProduct[r.product] ??= []).push(r);
    const inventorySummary = ['RBD', 'RSPO', 'MANAGED'].map((prod) => {
      const rows = byProduct[prod];
      if (!rows || rows.length === 0) return null;
      const past = rows.filter((r) => r.year * 12 + r.month <= cutoff);
      // 현재월 이하 최신, 없으면(미시작 제품) 가장 이른 운영월
      const pick = past.length ? past[past.length - 1] : rows[0];
      // 현재 재고가 0이면 임박한 통관 예정량을 힌트로 — 관리팜유 7월 7,500톤 등
      // (기말재고가 아니라 '앞으로 들어올 통관량 합계'를 표시)
      let upcoming: { year: number; month: number; customs_total: number } | null = null;
      if ((pick.ending_stock ?? 0) <= 0) {
        const futureCustoms = rows.filter((r) => r.year * 12 + r.month > cutoff && (r.customs_volume ?? 0) > 0);
        if (futureCustoms.length) {
          const customsTotal = futureCustoms.reduce((s, r) => s + Number(r.customs_volume || 0), 0);
          const first = futureCustoms[0];
          upcoming = { year: first.year, month: first.month, customs_total: customsTotal };
        }
      }
      return { ...pick, upcoming };
    }).filter(Boolean);

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

    // 핵심 이슈 — 핀(is_key) 또는 High impact, 최신순 (best-effort: is_key 컬럼 없을 수 있음)
    let keyIssues: any[] = [];
    try {
      keyIssues = await dbAll(
        `SELECT * FROM news WHERE is_key = 1 OR impact = 'High' ORDER BY is_key DESC, date DESC LIMIT 6`
      );
    } catch {
      keyIssues = await dbAll(`SELECT * FROM news WHERE impact = 'High' ORDER BY date DESC LIMIT 6`);
    }

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
      key_issues: keyIssues,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
