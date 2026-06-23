import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun, dbBatchRun } from '@/lib/db';
import {
  runSim, compareScenariosCore, sumBaseFromLocations, buildDemandMap,
  recommendManaged, RECO_DEFAULT, type RecoConfig,
} from '@/lib/mgd-core';

// mgd_config (key/value) 행 → RecoConfig. 테이블 없거나 비면 기본값.
function parseRecoConfig(rows: { key: string; value: number }[]): RecoConfig {
  const cfg: RecoConfig = { ...RECO_DEFAULT };
  for (const r of rows || []) {
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    if (r.key === 'july_cap_kg') cfg.julyCapKg = v;
    else if (r.key === 'committed_kg') cfg.committedKg = v;
    else if (r.key === 'coverage_months') cfg.coverageMonths = v;
    else if (r.key === 'lead_months') cfg.leadMonths = v;
  }
  return cfg;
}

// GET /api/mgd-simulation?inject_date=2026-07-15
//   → 시뮬레이션 + 4안 비교 + 위치별 재고
//   단일패스: 표시용 3쿼리(locations/demand/adjustments)를 1회 로드해
//   base/demand맵을 JS로 산출 → 메인 시뮬·4안을 in-memory 계산 (DB 재조회 없음).
//   클라이언트 즉시 재계산을 위해 원시입력(base/demandMap/adjustments)도 함께 반환.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const injectDate = searchParams.get('inject_date') || '2026-07-24';
    const [locations, demand, adjustments, cfgRows] = await Promise.all([
      dbAll('SELECT id, location, product, qty_kg, as_of_date, sort_order FROM stock_locations ORDER BY sort_order, product'),
      dbAll('SELECT id, product, month, monthly_kg FROM demand_config ORDER BY month, product').catch(() => []),
      dbAll('SELECT id, date, product, delta_kg, label, note FROM daily_adjustments ORDER BY date DESC, id DESC').catch(() => []),
      dbAll('SELECT key, value FROM mgd_config').catch(() => []),
    ]);
    const base = sumBaseFromLocations(locations as any);
    const demandMap = buildDemandMap(demand as any);
    const inputs = { base, demand: demandMap, adjustments: adjustments as any };
    const recoConfig = parseRecoConfig(cfgRows as any);
    const sim = runSim(injectDate, inputs);
    const scenarios = compareScenariosCore(inputs);
    const recommendation = recommendManaged(inputs, recoConfig);
    return NextResponse.json({ sim, scenarios, locations, base, demand, demandMap, adjustments, recommendation, recoConfig });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/mgd-simulation
//  - { kind:'location', id, qty_kg }              위치별 재고 수정
//  - { kind:'demand', product, month, monthly_kg } 월별 소요 수정
//  - (호환) { id, qty_kg }                         위치 재고 수정
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.kind === 'mgdcfg') {
      // 계획 파라미터 (key/value): july_cap_kg | committed_kg | coverage_months | lead_months
      const allowed = ['july_cap_kg', 'committed_kg', 'coverage_months', 'lead_months'];
      if (!allowed.includes(body.key)) return NextResponse.json({ error: 'invalid key' }, { status: 400 });
      await dbRun(
        `INSERT INTO mgd_config (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [body.key, Number(body.value) || 0],
      );
      return NextResponse.json({ success: true });
    }
    if (body.kind === 'demand') {
      await dbRun(
        `INSERT INTO demand_config (product, month, monthly_kg) VALUES (?, ?, ?)
         ON CONFLICT (product, month) DO UPDATE SET monthly_kg = EXCLUDED.monthly_kg, updated_at = NOW()`,
        [body.product, body.month, Number(body.monthly_kg) || 0],
      );
      return NextResponse.json({ success: true });
    }
    // 위치별 재고 (기본)
    if (body.id != null) {
      await dbRun('UPDATE stock_locations SET qty_kg = ?, updated_at = NOW() WHERE id = ?', [Number(body.qty_kg) || 0, body.id]);
    } else if (body.location && body.product) {
      await dbRun(
        `INSERT INTO stock_locations (location, product, qty_kg) VALUES (?, ?, ?)
         ON CONFLICT (location, product) DO UPDATE SET qty_kg = EXCLUDED.qty_kg, updated_at = NOW()`,
        [body.location, body.product, Number(body.qty_kg) || 0],
      );
    } else {
      return NextResponse.json({ error: 'id 또는 (location, product) 필요' }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/mgd-simulation — 일별 조정 추가 (단건 또는 배열)
// 단건: { date, product, delta_kg, label, note }
// 배열: { rows: [{ date, product, delta_kg, label, note }, ...] }  → 단일 트랜잭션 일괄 insert
export async function POST(request: NextRequest) {
  try {
    const b = await request.json();
    const rows: any[] = Array.isArray(b.rows) ? b.rows : (Array.isArray(b) ? b : [b]);
    const valid = rows.filter((r) => r && r.date && r.product && r.delta_kg != null);
    if (valid.length === 0) {
      return NextResponse.json({ error: 'date, product, delta_kg 필요' }, { status: 400 });
    }
    await dbBatchRun(valid.map((r) => ({
      sql: `INSERT INTO daily_adjustments (date, product, delta_kg, label, note) VALUES (?, ?, ?, ?, ?)`,
      params: [r.date, r.product, Number(r.delta_kg), r.label || '기타', r.note || null],
    })));
    return NextResponse.json({ success: true, added: valid.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/mgd-simulation?adj_id=123      — 일별 조정 단건 삭제
//        /api/mgd-simulation?ids=1,2,3       — 일괄 삭제 (단일 트랜잭션)
export async function DELETE(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;
    const idsParam = sp.get('ids');
    if (idsParam) {
      const ids = idsParam.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
      if (ids.length === 0) return NextResponse.json({ error: 'ids 필요' }, { status: 400 });
      await dbBatchRun(ids.map((id) => ({ sql: 'DELETE FROM daily_adjustments WHERE id = ?', params: [id] })));
      return NextResponse.json({ success: true, deleted: ids.length });
    }
    const id = sp.get('adj_id');
    if (!id) return NextResponse.json({ error: 'adj_id 또는 ids 필요' }, { status: 400 });
    await dbRun('DELETE FROM daily_adjustments WHERE id = ?', [parseInt(id, 10)]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
