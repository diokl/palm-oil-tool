import * as XLSX from 'xlsx';
import { dbAll } from './db';
import { generateAlerts } from './inventory-calc';
import { calculateBoxRange } from './box-range';
import { getSupplyDemand } from './supply-demand';
import { getTermStructure } from './term-structure';
import { getMacroSnapshot } from './market-data';
import { runBacktest, STRATEGY_LABEL } from './backtest';
import { getExposureRisk } from './exposure-risk';
import { getUsdaTable } from './usda-psd';
import { GLOSSARY } from './glossary';
import { SPEC_LABEL, specOf, PRODUCT_LABEL } from './spec';
import { PRODUCT_PREMIUM_USD } from './prebuy-effect';

// ── 탭별 엑셀 내보내기 ──
// 각 워크북 = 데이터 시트(들) + '계산방식' 시트. 계산이 있는 표(선구매 효과, 재고관리)는 값이 아니라 엑셀 수식으로 넣어
// 파일을 열어 검증·재계산할 수 있게 한다. 값만 있는 분석(박스권·수급·백테스트)은 계산식을 텍스트로 병기.

export { EXPORT_TARGETS, type ExportTarget } from './export-targets';

type Row = Record<string, any>;
const num = (v: any) => (v == null || v === '' ? null : Number(v));
const col = (i: number) => XLSX.utils.encode_col(i); // 0 → A

/** 객체 배열을 시트로. formulas: { 헤더: (r) => 'A{r}+B{r}' } — r 은 1-based 엑셀 행번호 */
function sheetFromRows(rows: Row[], headers: string[], formulas: Record<string, (r: number) => string> = {}, widths?: number[]): XLSX.WorkSheet {
  const aoa: any[][] = [headers, ...rows.map(r => headers.map(h => (h in formulas ? null : (r[h] ?? null))))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let i = 0; i < rows.length; i++) {
    const r = i + 2;
    for (const [h, fn] of Object.entries(formulas)) {
      const c = headers.indexOf(h); if (c < 0) continue;
      ws[`${col(c)}${r}`] = { t: 'n', v: 0, f: fn(r) };
    }
  }
  ws['!cols'] = (widths ?? headers.map(h => Math.max(10, Math.min(40, h.length * 2)))).map(w => ({ wch: w }));
  return ws;
}
function methodSheet(lines: [string, string][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([['항목', '계산방식 / 설명'], ...lines]);
  ws['!cols'] = [{ wch: 28 }, { wch: 120 }];
  return ws;
}
function glossaryLines(terms: string[]): [string, string][] {
  return GLOSSARY.filter(g => terms.includes(g.term)).map(g => [g.term, [g.definition, g.formula ? `계산: ${g.formula}` : '', g.reading ? `해석: ${g.reading}` : '', g.source ? `출처: ${g.source}` : ''].filter(Boolean).join(' | ')]);
}
function add(wb: XLSX.WorkBook, name: string, ws: XLSX.WorkSheet) { XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ')); }

// ───────────── 선구매 효과 ─────────────
export async function buildPrebuy(prebuy: any, wb = XLSX.utils.book_new()): Promise<XLSX.WorkBook> {
  const H = ['선적월', '스펙', '제품', '공급사', '계약번호', '단가($/MT)', '수량(MT)', '금액(USD)', 'RBD 시황가', '3-MCPD', 'GE', 'RSPO', '프리미엄 합', 'Base(RBD환산)', '정상가(시황+프리미엄)', '효과(USD)', '환율', '효과(KRW)', '평가'];
  const details: Row[] = [];
  for (const m of prebuy.data ?? []) for (const p of m.purchases ?? []) {
    details.push({
      '선적월': p.shipment_month, '스펙': SPEC_LABEL[specOf(p) as keyof typeof SPEC_LABEL] ?? p.spec, '제품': PRODUCT_LABEL[p.product as keyof typeof PRODUCT_LABEL] ?? p.product,
      '공급사': p.supplier, '계약번호': p.order_no, '단가($/MT)': num(p.unit_price), '수량(MT)': num(p.qty_mt), 'RBD 시황가': num(p.market_price_usd),
      '3-MCPD': p.prem_3mcpd ?? 0, 'GE': p.prem_ge ?? 0, 'RSPO': p.prem_rspo ?? (p.premium_usd && p.prem_3mcpd == null ? p.premium_usd : 0), '환율': num(p.exchange_rate),
    });
  }
  // 열: A선적월 B스펙 C제품 D공급사 E계약번호 F단가 G수량 H금액 I시황 J3mcpd K GE L RSPO M합 N Base O정상가 P효과USD Q환율 R효과KRW S평가
  const f = {
    '금액(USD)': (r: number) => `F${r}*G${r}`,
    '프리미엄 합': (r: number) => `J${r}+K${r}+L${r}`,
    'Base(RBD환산)': (r: number) => `F${r}-M${r}`,
    '정상가(시황+프리미엄)': (r: number) => `IF(I${r}="","",I${r}+M${r})`,
    '효과(USD)': (r: number) => `IF(I${r}="","",(O${r}-F${r})*G${r})`,
    '효과(KRW)': (r: number) => `IF(P${r}="","",P${r}*Q${r})`,
  };
  const ws = sheetFromRows(details, H, f, [9, 26, 14, 22, 16, 11, 10, 13, 11, 8, 8, 8, 10, 13, 18, 13, 8, 15, 8]);
  for (let i = 0; i < details.length; i++) ws[`S${i + 2}`] = { t: 's', v: '', f: `IF(P${i + 2}="","-",IF(P${i + 2}>0,"성공","실패"))` };
  add(wb, '건별(수식)', ws);

  const MH = ['선적월', '총 수량(MT)', '총 금액(USD)', '가중평균 단가', '평균 시황가', '효과(USD)', '효과(KRW)', '누적 효과(KRW)', '평가', 'RBD 수량', 'RBD 효과(USD)', 'RSPO 수량', 'RSPO 효과(USD)', '관리팜유 RPO 수량', '관리팜유 RPO 효과(USD)', '관리팜유 RSPO 수량', '관리팜유 RSPO 효과(USD)'];
  add(wb, '월별', sheetFromRows((prebuy.data ?? []).map((m: any) => ({
    '선적월': m.shipment_month, '총 수량(MT)': m.total_qty, '총 금액(USD)': m.total_amount, '가중평균 단가': m.wavg_price, '평균 시황가': m.avg_market_price,
    '효과(USD)': m.effect_usd, '효과(KRW)': m.effect_krw, '누적 효과(KRW)': m.cumulative_effect_krw, '평가': m.evaluation,
    'RBD 수량': m.rbd_qty, 'RBD 효과(USD)': m.rbd_effect_usd, 'RSPO 수량': m.rspo_qty, 'RSPO 효과(USD)': m.rspo_effect_usd,
    '관리팜유 RPO 수량': m.managed_qty, '관리팜유 RPO 효과(USD)': m.managed_effect_usd, '관리팜유 RSPO 수량': m.managed_rspo_qty, '관리팜유 RSPO 효과(USD)': m.managed_rspo_effect_usd,
  })), MH));

  const PH = ['선적월', '수량(MT)', '금액(USD)', '가중평균 단가', '평균 시황가', '가격차', '효과(USD)', '효과(KRW)', '누적 효과(KRW)', '평가'];
  for (const [key, name] of [['rbd', 'RBD'], ['rspo', 'RSPO'], ['managed', '관리팜유 RPO'], ['managed_rspo', '관리팜유 RSPO']] as const) {
    const rows = prebuy[key]?.rows ?? [];
    if (!rows.length) continue;
    add(wb, name, sheetFromRows(rows.map((m: any) => ({ '선적월': m.shipment_month, '수량(MT)': m.qty, '금액(USD)': m.amount, '가중평균 단가': m.wavg_price, '평균 시황가': m.market_price, '가격차': m.price_diff, '효과(USD)': m.effect_usd, '효과(KRW)': m.effect_krw, '누적 효과(KRW)': m.cumulative_effect_krw, '평가': m.evaluation })), PH));
  }
  if (prebuy.by_spec?.length) add(wb, '스펙별', sheetFromRows(prebuy.by_spec.map((s: any) => ({ '스펙': SPEC_LABEL[s.spec as keyof typeof SPEC_LABEL] ?? s.spec, '건수': s.n, '수량(MT)': s.qty, '금액(USD)': s.amount, '가중평균 단가': s.wavg_price, '평균 프리미엄': s.avg_premium, 'Base(RBD환산)': s.wavg_base, '평균 RBD 시황': s.avg_market, '효과(USD)': s.effect_usd, '효과(KRW)': s.effect_krw })), ['스펙', '건수', '수량(MT)', '금액(USD)', '가중평균 단가', '평균 프리미엄', 'Base(RBD환산)', '평균 RBD 시황', '효과(USD)', '효과(KRW)']));
  if (prebuy.premium_benchmark?.length) add(wb, '공급사 프리미엄', sheetFromRows(prebuy.premium_benchmark.map((b: any) => ({ '공급사': b.supplier, '스펙': SPEC_LABEL[b.spec as keyof typeof SPEC_LABEL] ?? b.spec, '건수': b.n, '수량(MT)': b.qty, '3-MCPD': b.avg_3mcpd, 'GE': b.avg_ge, 'RSPO': b.avg_rspo, '합계': b.avg_total, '선적월': (b.months || []).join(', ') })), ['공급사', '스펙', '건수', '수량(MT)', '3-MCPD', 'GE', 'RSPO', '합계', '선적월']));
  add(wb, '계산방식', methodSheet([
    ['효과(USD)', '(정상가 − 계약단가) × 수량. 정상가 = RBD 시황가 + 프리미엄 합(3-MCPD + GE + RSPO). 양수 = 절감(성공), 음수 = 초과(실패). 엑셀 원본 "3개월 선구매 정리" L열과 부호만 반대(원본은 계약가 − 정상가).'],
    ['효과(KRW)', '효과(USD) × 계약별 환율 (구매이력에 입력, 기본 1,450)'],
    ['RBD 시황가', `선적월 동안 거래된 해당 월물 종가(USD/MT)의 평균 = 엑셀 "구매 당월시황". 도구의 "시황가 자동 매칭"이 FCPO DB에서 채우며 수동 입력값이 우선.`],
    ['프리미엄', `계약별 분해값(품의서 SUPPLIER 표). 분해값이 없는 과거 행은 제품 기본값: RBD 0 / RSPO ${PRODUCT_PREMIUM_USD.RSPO} / 관리팜유 RPO ${PRODUCT_PREMIUM_USD.MANAGED} / 관리팜유 RSPO ${PRODUCT_PREMIUM_USD.MANAGED_RSPO}`],
    ['Base(RBD환산)', '계약단가 − 프리미엄 합. 스펙이 다른 계약과 시황(RBD)을 같은 기준으로 비교할 때 사용'],
    ['가중평균 단가', 'Σ(단가×수량) ÷ Σ수량 (월별·제품별)'],
    ['평가', '월 효과(USD) > 0 이면 성공'],
    ['누적 효과', '선적월 오름차순 누적 합 (KRW)'],
    ['스펙별 평균 프리미엄', 'Σ(프리미엄×수량) ÷ Σ수량'],
    ['공급사 프리미엄 벤치마크', '분해값이 저장된 계약만, 공급사(첫 단어)×스펙별 물량 가중 평균. 공급사 미기재·RBD 제외'],
    ...glossaryLines(['선구매 효과', '구매 당월시황 (시황가)', 'Base 가격 (RBD 환산가)', '3-MCPD', 'GE', 'RSPO (MB)']),
  ]));
  return wb;
}

// ───────────── 구매이력 RAW ─────────────
export async function buildPurchases(wb = XLSX.utils.book_new()) {
  const rows = await dbAll('SELECT * FROM purchases ORDER BY shipment_month DESC, id') as Row[];
  const H = ['ID', 'Order No', '스펙', '제품', '선적월', '공급사', '제조사', '품명', '단가($/MT)', '수량(MT)', '금액(USD)', '3-MCPD', 'GE', 'RSPO', '프리미엄 합', 'Base(RBD환산)', 'RBD 시황가', '시황가 출처', '환율', 'Incoterms', '결제조건', 'ETD', '계약번호', '비고', '등록일'];
  const ws = sheetFromRows(rows.map(p => ({
    'ID': p.id, 'Order No': p.order_no, '스펙': SPEC_LABEL[specOf(p) as keyof typeof SPEC_LABEL] ?? p.spec, '제품': PRODUCT_LABEL[p.product as keyof typeof PRODUCT_LABEL] ?? p.product, '선적월': p.shipment_month, '공급사': p.supplier, '제조사': p.manufacturer, '품명': p.product_name,
    '단가($/MT)': num(p.unit_price), '수량(MT)': num(p.qty_mt), '3-MCPD': p.prem_3mcpd ?? 0, 'GE': p.prem_ge ?? 0, 'RSPO': p.prem_rspo ?? 0,
    'RBD 시황가': num(p.market_price_usd), '시황가 출처': p.market_price_source, '환율': num(p.exchange_rate), 'Incoterms': p.incoterms, '결제조건': p.payment_terms, 'ETD': p.etd, '계약번호': p.contract_number, '비고': p.notes, '등록일': p.created_at ? String(p.created_at).slice(0, 10) : null,
  })), H, { '금액(USD)': r => `I${r}*J${r}`, '프리미엄 합': r => `L${r}+M${r}+N${r}`, 'Base(RBD환산)': r => `I${r}-O${r}` });
  add(wb, '구매이력', ws);
  add(wb, '계산방식', methodSheet([
    ['금액(USD)', '단가 × 수량'], ['프리미엄 합', '3-MCPD + GE + RSPO (계약별 협상값, 없으면 스펙 기본값 10/30/25)'], ['Base(RBD환산)', '단가 − 프리미엄 합'],
    ['통관수량 동기화', '재고관리의 통관수량 = 같은 제품의 선적월+1개월 계약 수량 합 × 1,000 (kg)'],
    ...glossaryLines(['관리팜유', '선적월 / 통관월', 'D/P at sight · L/C at sight · CAD']),
  ]));
  return wb;
}

// ───────────── 재고관리 ─────────────
export async function buildInventory(wb = XLSX.utils.book_new()) {
  const rows = await dbAll('SELECT * FROM inventory ORDER BY product, year, month') as Row[];
  const combos = [...new Set(rows.map(r => `${r.product}|${r.year}`))];
  for (const key of combos) {
    const [product, year] = key.split('|');
    const rs = rows.filter(r => r.product === product && Number(r.year) === Number(year));
    const prev = rows.find(r => r.product === product && Number(r.year) === Number(year) - 1 && Number(r.month) === 12);
    const opening = prev ? Number(prev.actual_ending_stock ?? prev.ending_stock ?? 0) : Number(rs[0]?.ending_stock ?? 0) - Number(rs[0]?.customs_volume ?? 0) + Number(rs[0]?.expected_usage ?? 0) + Number(rs[0]?.sales_volume ?? 0);
    // 행1 헤더, 행2 기초재고, 행3 헤더, 행4~ 데이터
    const aoa: any[][] = [
      [`${PRODUCT_LABEL[product as keyof typeof PRODUCT_LABEL] ?? product} ${year} (kg)`],
      ['전년 12월 기말(기초재고)', opening, '', '실재고 반영값이 있는 달은 계산값 대신 그 값을 채택하고 다음 달부터 이어 계산'],
      ['월', '예상소요량', '통관수량', '판매량', '실재고 반영값', '기말재고', '재고회전(개월)', '계약단가', '계약월', '수정자', '수정일'],
    ];
    rs.forEach(r => aoa.push([Number(r.month), num(r.expected_usage), num(r.customs_volume), num(r.sales_volume) ?? 0, num(r.actual_ending_stock), null, null, r.contract_price, r.contract_date, r.updated_by, r.updated_at ? String(r.updated_at).slice(0, 10) : null]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    rs.forEach((_, i) => {
      const r = i + 4; const prevRef = i === 0 ? 'B2' : `F${r - 1}`;
      ws[`F${r}`] = { t: 'n', v: 0, f: `IF(E${r}<>"",E${r},${prevRef}+C${r}-B${r}-D${r})` };
      ws[`G${r}`] = { t: 'n', v: 0, f: `IF(B${r}>0,ROUND(F${r}/B${r},1),0)` };
    });
    ws['!cols'] = [6, 14, 14, 12, 14, 14, 12, 22, 24, 14, 11].map(w => ({ wch: w }));
    add(wb, `${PRODUCT_LABEL[product as keyof typeof PRODUCT_LABEL] ?? product} ${year}`, ws);
  }
  add(wb, '계산방식', methodSheet([
    ['기말재고', '전월 기말재고 + 통관수량 − 예상소요량 − 판매량. 실재고 반영값(E열)이 있으면 그 값 채택. 1월은 전년 12월 기말(B2)에서 시작'],
    ['재고회전(개월)', '기말재고 ÷ 당월 예상소요량 (소요 0이면 0). 소요가 달라지는 달(관리팜유 RSPO 10월 구분 투입 등)은 대시보드의 선행 커버 참고'],
    ['통관수량', '구매이력 자동 동기화: 같은 제품의 (선적월 + 1개월) 계약 수량 합 × 1,000. 셀 직접 수정도 가능'],
    ['관리팜유 RPO / RSPO', 'RSPO 포함 스펙(3-MCPD+RSPO, 3-MCPD+GE+RSPO)은 관리팜유 RSPO, 나머지 관리팜유는 RPO 로 분리 관리'],
    ...glossaryLines(['실재고 반영값', '재고회전(개월)', '구매 알람']),
  ]));
  return wb;
}

// ───────────── FCPO ─────────────
export async function buildFcpo(wb = XLSX.utils.book_new()) {
  const rows = await dbAll(`SELECT date::text AS date, contract_month, settlement_usd, settlement_myr, exchange_rate, source FROM fcpo_settlement ORDER BY date DESC, contract_month`) as Row[];
  const months = [...new Set(rows.map(r => r.contract_month))].sort();
  const dates = [...new Set(rows.map(r => String(r.date).slice(0, 10)))].sort().reverse();
  const idx = new Map(rows.map(r => [`${String(r.date).slice(0, 10)}|${r.contract_month}`, r]));
  for (const [name, field] of [['USD', 'settlement_usd'], ['MYR', 'settlement_myr']] as const) {
    const aoa: any[][] = [['날짜', ...months], ...dates.map(d => [d, ...months.map(m => num(idx.get(`${d}|${m}`)?.[field]))])];
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 12 }, ...months.map(() => ({ wch: 9 }))];
    add(wb, `시세 ${name}`, ws);
  }
  add(wb, '원자료', sheetFromRows(rows.map(r => ({ '날짜': String(r.date).slice(0, 10), '월물': r.contract_month, 'USD/MT': num(r.settlement_usd), 'MYR/MT': num(r.settlement_myr), '환율(MYR/USD)': num(r.exchange_rate), '출처': r.source })), ['날짜', '월물', 'USD/MT', 'MYR/MT', '환율(MYR/USD)', '출처']));
  const ts = await getTermStructure();
  if (ts.curve.length) {
    add(wb, '월물 곡선', sheetFromRows(ts.curve.map(c => ({ '월물': c.contract_month, '개월 후': c.months_ahead, '가격': c.price, '근월 대비': c.spread_vs_front, '%': c.pct_vs_front, '월당 캐리': c.carry_per_month })), ['월물', '개월 후', '가격', '근월 대비', '%', '월당 캐리']));
    add(wb, '스프레드 추이', sheetFromRows(ts.history.map(h => ({ '날짜': h.date, 'M1': h.m1, 'M2': h.m2, 'M3': h.m3, '원월': h.far, 'M3−M1': h.spread_m1_m3, '원월−M1': h.spread_m1_far })), ['날짜', 'M1', 'M2', 'M3', '원월', 'M3−M1', '원월−M1']));
  }
  add(wb, '계산방식', methodSheet([
    ['시세', 'BMD 일일 보고서 RBD PALM OIL 물리 호가(USD/MT). M1~M3 + 분기(Q1~Q3)를 월로 펼쳐 저장 → 4개월 이후는 분기 단위 동일값'],
    ['환율', 'MYR ÷ USD (같은 호가의 두 통화 값에서 산출)'],
    ['월물 곡선 구조', `${ts.structure ?? '-'} (기준일 ${ts.as_of ?? '-'}): 원월−근월 ${ts.spread_m1_far ?? '-'}, M1−M3 백분위 ${ts.spread_m1_m3_percentile ?? '-'}%`],
    ['해석', ts.advice],
    ...glossaryLines(['FCPO', '월물', '월물 곡선', '콘탱고 / 백워데이션']),
  ]));
  return wb;
}

// ───────────── 박스권 ─────────────
export async function buildBoxRange(wb = XLSX.utils.book_new()) {
  const now = new Date(); const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const months = await dbAll(`SELECT contract_month FROM fcpo_settlement WHERE settlement_usd IS NOT NULL AND contract_month >= ? GROUP BY contract_month HAVING COUNT(*) >= 10 ORDER BY contract_month LIMIT 8`, [curYm]) as { contract_month: string }[];
  const summary: Row[] = [];
  for (const { contract_month } of months) {
    const br = await calculateBoxRange(contract_month);
    if (!br) continue;
    const p = (d: number) => br.periods.find(x => x.days === d);
    summary.push({
      '월물': contract_month, '기준일': br.as_of_date, '현재가': br.current_price, '구간': br.current_zone, '추천': br.recommendation, '신뢰도': br.confidence,
      '전량구매 상한': br.zones.full_buy_upper, '적극구매 상한': br.zones.active_buy_upper, '모니터링 상한': br.zones.monitoring_upper, '최소구매 상한': br.zones.min_buy_upper,
      'MA10': br.ma_positions.ma10, 'MA20': br.ma_positions.ma20, 'MA60': br.ma_positions.ma60, '20일 σ': p(20)?.stdev, '20일 고': p(20)?.high, '20일 저': p(20)?.low, '20일 변동률%': br.volatility.pct_20d,
      '단기추세': br.trends.short_term, '중기추세': br.trends.mid_term, '장기추세': br.trends.long_term, '골든크로스(10/20)': br.trends.golden_cross_10_20 ? 'Y' : '', '데드크로스(10/20)': br.trends.dead_cross_10_20 ? 'Y' : '',
      '변동성 분류': br.volatility.classification, '시장상태': br.volatility.market_status, '전략': br.volatility.strategy,
      'RSI14': br.indicators?.rsi14, 'MACD hist': br.indicators?.macd_hist, '볼린저 %B': br.indicators?.bb_pct_b, 'ATR14': br.indicators?.atr14, '기술 종합': br.indicators?.summary,
    });
    // 일별 시세 + MA20·σ 수식
    const prices = await dbAll(`SELECT date::text AS date, settlement_usd FROM fcpo_settlement WHERE contract_month = ? AND settlement_usd IS NOT NULL ORDER BY date`, [contract_month]) as Row[];
    const aoa: any[][] = [['날짜', '종가', 'MA10', 'MA20', 'MA60', '20일 σ', '전량구매 상한', '적극구매 상한', '모니터링 상한', '구간']];
    prices.forEach(r => aoa.push([String(r.date).slice(0, 10), Number(r.settlement_usd)]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    prices.forEach((_, i) => {
      const r = i + 2;
      if (i >= 9) ws[`C${r}`] = { t: 'n', v: 0, f: `AVERAGE(B${r - 9}:B${r})` };
      if (i >= 19) { ws[`D${r}`] = { t: 'n', v: 0, f: `AVERAGE(B${r - 19}:B${r})` }; ws[`F${r}`] = { t: 'n', v: 0, f: `STDEV(B${r - 19}:B${r})` }; ws[`G${r}`] = { t: 'n', v: 0, f: `ROUND(D${r}-F${r},0)` }; ws[`H${r}`] = { t: 'n', v: 0, f: `ROUND(D${r}-F${r}*0.5,0)` }; ws[`I${r}`] = { t: 'n', v: 0, f: `ROUND(D${r}+F${r}*0.5,0)` }; ws[`J${r}`] = { t: 's', v: '', f: `IF(B${r}<=G${r},"전량구매",IF(B${r}<=H${r},"적극구매",IF(B${r}<=I${r},"모니터링",IF(B${r}<=MAX(B${r - 19}:B${r}),"최소구매","구매대기"))))` }; }
      if (i >= 59) ws[`E${r}`] = { t: 'n', v: 0, f: `AVERAGE(B${r - 59}:B${r})` };
    });
    ws['!cols'] = [12, 9, 9, 9, 9, 9, 12, 12, 12, 10].map(w => ({ wch: w }));
    add(wb, `일별 ${contract_month}`, ws);
  }
  add(wb, '요약', sheetFromRows(summary, Object.keys(summary[0] ?? { '월물': 1 })));
  add(wb, '계산방식', methodSheet([
    ['구간(일반 모드)', '전량구매 상한 = MA20 − σ / 적극구매 상한 = MA20 − 0.5σ / 모니터링 상한 = MA20 + 0.5σ / 최소구매 상한 = 20일 최고가 / 그 위 = 구매대기 (σ = 20일 표본표준편차)'],
    ['전쟁이슈 모드', '현재가 ± σ×1.5(적극·모니터링), ±3σ(전량·최소) + 리스크 프리미엄(20일 변동률 5~10%: 변동폭×0.1, 10~15%: ×0.25, 15%+: ×0.5)'],
    ['추세', '현재가 vs MA10(단기)/MA20(중기)/MA60(장기) 상회·하회. 골든크로스 = MA10 > MA20, MA20 > MA60'],
    ['변동성', '20일 (고−저) ÷ 평균 ×100. <2% 매우낮음 정상구매 / 2~3% 낮음 / 3~5% 보통 분할 / 5~7% 높음 분할 / 7~10% 매우높음 소량분할 / >10% 극단 보류'],
    ['신뢰도', '현재가가 MA10·20·60 모두 아래 + 매수 구간이면 높음, 매수 구간이면 중상, 모니터링 보통, 그 외 낮음'],
    ['일별 시트', 'C~J열은 엑셀 수식(AVERAGE/STDEV)으로 재현 — 도구 값과 소수점 반올림 차이가 있을 수 있음'],
    ...glossaryLines(['박스권 분석 (V3)', 'RSI (14)', 'MACD (12,26,9)', '볼린저 %B', 'ATR (14)']),
  ]));
  return wb;
}

// ───────────── MPOB / 수급 ─────────────
export async function buildMpob(wb = XLSX.utils.book_new()) {
  const sd = await getSupplyDemand();
  add(wb, '수급 밸런스', sheetFromRows(sd.series.map(p => ({ '월': p.ym, '기초재고': p.opening_stock, 'CPO 생산': p.production, '팜유 수출': p.export, '추정 내수': p.implied_domestic, '기말재고(총재고)': p.closing_stock, '재고/수출(개월)': p.stock_export_ratio, '재고/소비': p.stock_use_ratio, 'FCPO 월평균(USD)': p.price_usd, '생산 YoY%': p.production_yoy, '수출 YoY%': p.export_yoy, '재고 YoY%': p.stock_yoy })), ['월', '기초재고', 'CPO 생산', '팜유 수출', '추정 내수', '기말재고(총재고)', '재고/수출(개월)', '재고/소비', 'FCPO 월평균(USD)', '생산 YoY%', '수출 YoY%', '재고 YoY%']));
  const s = sd.summary;
  add(wb, '수급 요약', XLSX.utils.aoa_to_sheet([['항목', '값'], ['최신 월', s.latest?.ym], ['총재고 백분위', s.stock_percentile], ['재고/수출 비율', s.latest?.stock_export_ratio], ['비율 백분위', s.ratio_percentile], ['비율 전 기간 평균', s.ratio_avg], ['회귀 n', s.regression?.n], ['회귀 절편 a', s.regression?.intercept], ['회귀 기울기 b', s.regression?.slope], ['상관계수 r', s.regression?.r], ['수급 적정가', s.regression?.fair_price], ['현재가 괴리 %', s.regression?.deviation_pct], ['해석', s.signal]]));
  const raw = await dbAll(`SELECT category, item_name, parent_group, year, month, value, value_rm FROM mpob_data ORDER BY category, sort_order, item_name, year, month`) as Row[];
  for (const cat of [...new Set(raw.map(r => r.category))]) {
    const rs = raw.filter(r => r.category === cat);
    const items = [...new Set(rs.map(r => r.item_name))];
    const yms = [...new Set(rs.map(r => `${r.year}-${String(r.month).padStart(2, '0')}`))].sort();
    const aoa: any[][] = [['항목', ...yms], ...items.map(it => [it, ...yms.map(ym => { const r = rs.find(x => x.item_name === it && `${x.year}-${String(x.month).padStart(2, '0')}` === ym); return r ? num(r.value) : null; })])];
    add(wb, `MPOB ${cat}`, XLSX.utils.aoa_to_sheet(aoa));
  }
  for (const c of ['PALM', 'SOY_OIL'] as const) {
    const t = await getUsdaTable(c);
    if (t.rows.length) add(wb, `USDA ${c === 'PALM' ? '팜유' : '대두유'}`, sheetFromRows(t.rows.map(r => ({ '국가': r.country_label, '마케팅연도': r.market_year, '기초재고': r.beginning_stocks, '생산': r.production, '수입': r.imports, '수입 YoY%': r.imports_yoy, '소비': r.domestic_consumption, '소비 YoY%': r.consumption_yoy, '수출': r.exports, '기말재고': r.ending_stocks, '재고/소비%': r.stock_to_use })), ['국가', '마케팅연도', '기초재고', '생산', '수입', '수입 YoY%', '소비', '소비 YoY%', '수출', '기말재고', '재고/소비%']));
  }
  add(wb, '계산방식', methodSheet([
    ['재고/수출 비율', '기말재고(총재고) ÷ 당월 팜유 수출 (개월)'], ['추정 내수', '기초재고 + CPO 생산 − 수출 − 기말재고 (수입 무시 → 참고용)'], ['재고/소비', '기말재고 ÷ (수출 + max(추정 내수, 0))'],
    ['FCPO 월평균', '각 거래일의 최근월물 USD 종가를 월 평균'], ['백분위', '전 기간 값 중 현재값보다 작은 비율(동률 0.5) ×100'],
    ['회귀', '가격 = a + b × 재고/수출 비율 (최소제곱). 적정가 = a + b × 최신 비율, 괴리 = (현재가 − 적정가) ÷ 적정가'],
    ['USDA 재고/소비%', '기말재고 ÷ (소비 + 수출) ×100, 단위 1,000 MT, 마케팅연도(팜유 10월~9월)'],
    ...glossaryLines(['MPOB', '총재고', 'CPO 생산', '재고/수출 비율', '재고/소비 비율', '수급 적정가', 'USDA PSD']),
  ]));
  return wb;
}

// ───────────── 환율·에너지 ─────────────
export async function buildMacro(wb = XLSX.utils.book_new()) {
  const rows = await dbAll(`SELECT series, date, value, source FROM market_data ORDER BY date DESC, series`) as Row[];
  const series = [...new Set(rows.map(r => r.series))].sort();
  const dates = [...new Set(rows.map(r => r.date))].sort().reverse();
  const idx = new Map(rows.map(r => [`${r.date}|${r.series}`, Number(r.value)]));
  const aoa: any[][] = [['날짜', ...series, '팜유(FCPO 근월 USD)', 'Brent(USD/MT)', '경유(USD/MT)', 'POGO(팜유−경유)', '팜유−Brent', '대련 팜유(USD/MT)', '대련−FCPO'], ...dates.map(d => [d, ...series.map(s => idx.get(`${d}|${s}`) ?? null)])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const snap = await getMacroSnapshot(1100);
  const palm = new Map(snap.series.map(p => [p.date, p.palm]));
  const ci = (name: string) => aoa[0].indexOf(name);
  dates.forEach((d, i) => {
    const r = i + 2; const pv = palm.get(d);
    if (pv != null) ws[`${col(ci('팜유(FCPO 근월 USD)'))}${r}`] = { t: 'n', v: pv };
    const B = col(ci('BRENT')), H = col(ci('HEATING_OIL')), C = col(ci('USDCNY')), D = col(ci('DCE_PALM')), P = col(ci('팜유(FCPO 근월 USD)'));
    if (ci('BRENT') >= 0) ws[`${col(ci('Brent(USD/MT)'))}${r}`] = { t: 'n', v: 0, f: `IF(${B}${r}="","",${B}${r}*7.33)` };
    if (ci('HEATING_OIL') >= 0) ws[`${col(ci('경유(USD/MT)'))}${r}`] = { t: 'n', v: 0, f: `IF(${H}${r}="","",${H}${r}*315)` };
    ws[`${col(ci('POGO(팜유−경유)'))}${r}`] = { t: 'n', v: 0, f: `IF(OR(${P}${r}="",${col(ci('경유(USD/MT)'))}${r}=""),"",${P}${r}-${col(ci('경유(USD/MT)'))}${r})` };
    ws[`${col(ci('팜유−Brent'))}${r}`] = { t: 'n', v: 0, f: `IF(OR(${P}${r}="",${col(ci('Brent(USD/MT)'))}${r}=""),"",${P}${r}-${col(ci('Brent(USD/MT)'))}${r})` };
    if (ci('DCE_PALM') >= 0 && ci('USDCNY') >= 0) { ws[`${col(ci('대련 팜유(USD/MT)'))}${r}`] = { t: 'n', v: 0, f: `IF(OR(${D}${r}="",${C}${r}=""),"",${D}${r}/${C}${r})` }; ws[`${col(ci('대련−FCPO'))}${r}`] = { t: 'n', v: 0, f: `IF(OR(${P}${r}="",${col(ci('대련 팜유(USD/MT)'))}${r}=""),"",${col(ci('대련 팜유(USD/MT)'))}${r}-${P}${r})` }; }
  });
  ws['!cols'] = aoa[0].map(() => ({ wch: 13 }));
  add(wb, '시계열(수식)', ws);
  add(wb, '최신값', sheetFromRows(snap.latest.map(l => ({ '지표': l.label, '단위': l.unit, '날짜': l.date, '값': l.value, '전일': l.prev, '변동%': l.change_pct })), ['지표', '단위', '날짜', '값', '전일', '변동%']));
  const sbo = await dbAll(`SELECT date, commodity, price_native, unit_native, price_usd_mt, source FROM oil_prices ORDER BY date DESC`) as Row[];
  add(wb, '대두유 등 식물유', sheetFromRows(sbo.map(r => ({ '날짜': r.date, '품목': r.commodity, '원값': num(r.price_native), '단위': r.unit_native, 'USD/MT': num(r.price_usd_mt), '출처': r.source })), ['날짜', '품목', '원값', '단위', 'USD/MT', '출처']));
  add(wb, '계산방식', methodSheet([
    ['Brent → USD/MT', 'USD/bbl × 7.33 (원유 1 MT ≈ 7.33 bbl)'], ['경유 → USD/MT', 'Heating Oil USD/gal × 315 (경유 1 MT ≈ 315 gal). ICE 가스오일 대용'],
    ['POGO', '팜유(FCPO 근월 USD/MT) − 경유(USD/MT). 음수 = 바이오디젤 원료로 유리 → 팜유 지지'], ['대련 팜유 USD', 'CNY/t ÷ USD/CNY. 증치세 9%·물류 포함 국내가'],
    ['대두유 USD/MT', 'cents/lb × 22.046'], ['팜유(근월)', '각 거래일에 만기 안 지난 가장 가까운 월물의 USD 종가 (없는 날은 빈칸)'],
    ['출처', '환율 ECB(frankfurter) / Brent·경유·대두유 Yahoo Finance / 대련 Sina Finance — 매일 07:30 KST 자동'],
    ...glossaryLines(['POGO 스프레드', '팜유−원유 스프레드', '대두유 스프레드', '대련 팜올레인 (DCE)', 'USD/MYR', 'USD/KRW']),
  ]));
  return wb;
}

// ───────────── 백테스트 ─────────────
export async function buildBacktest(wb = XLSX.utils.book_new()) {
  for (const product of ['RBD', 'RSPO', 'MANAGED', 'MANAGED_RSPO'] as const) {
    const bt = await runBacktest({ product, from: '2021-01' });
    const label = PRODUCT_LABEL[product];
    add(wb, `${label} 요약`, sheetFromRows(bt.summary.map(s => ({ '전략': s.label, '개월': s.months, '평균 단가': s.avg_price, '시황 대비 절감': s.vs_spot_avg, '승률%': s.win_rate_vs_spot, '기간 내 백분위': s.avg_percentile, '표준편차': s.stdev })), ['전략', '개월', '평균 단가', '시황 대비 절감', '승률%', '기간 내 백분위', '표준편차']));
    add(wb, `${label} 연도별`, sheetFromRows(bt.by_year.map(y => ({ '연도': y.year, '개월': y.months, '3개월 선구매': y.forward_3m, '기간 평균': y.window_avg, '박스권': y.box_range, '당월 시황': y.spot_month, '실제 계약(Base)': y.actual })), ['연도', '개월', '3개월 선구매', '기간 평균', '박스권', '당월 시황', '실제 계약(Base)']));
    const keys = Object.keys(STRATEGY_LABEL) as (keyof typeof STRATEGY_LABEL)[];
    add(wb, `${label} 선적월별`, sheetFromRows(bt.months.map(m => ({ '선적월': m.shipment_month, '기간 시작': m.window_from, '기간 끝': m.window_to, '거래일': m.window_days, ...Object.fromEntries(keys.map(k => [STRATEGY_LABEL[k], m.prices[k] ?? null])), '박스권 신호일': m.box_range_date, '실제 수량(MT)': m.actual_qty, '실제 백분위%': m.actual_percentile })), ['선적월', '기간 시작', '기간 끝', '거래일', ...keys.map(k => STRATEGY_LABEL[k]), '박스권 신호일', '실제 수량(MT)', '실제 백분위%']));
    if (product === 'RBD') add(wb, '계산방식', methodSheet([
      ['계약 가능 기간', '선적월 M 의 3개월 전 1일 ~ 1개월 전 말일 (M월물 종가 기준)'],
      ['3개월 선구매', 'M−3월 첫 거래일 종가 전량'], ['3분할', 'M−3, M−2, M−1 첫 거래일 종가 평균'], ['기간 평균', '계약 가능 기간 전 거래일 평균 (완전 분할)'], ['최대 지연', 'M−1월 마지막 거래일'],
      ['박스권 적극구매', '기간 중 종가 ≤ 20일 이평 − 0.5σ 첫 진입일, 없으면 마지막 날'], ['박스권 전량구매', '종가 ≤ 20일 이평 − σ 첫 진입일'],
      ['당월 시황', '선적월 M 동안 M월물 종가 평균 (= 구매 당월시황, 미선구매 벤치마크)'], ['최저/최고', '기간 내 최저·최고 (사후 완벽 정보)'],
      ['실제 계약', '구매이력의 선적월별 Base(단가 − 스펙 프리미엄) 가중평균 → 시황과 같은 RBD 기준'],
      ['시황 대비 절감', '당월 시황 − 전략 단가 (양수 = 선구매 유리)'], ['승률', '시황보다 쌌던 선적월 비율'], ['기간 내 백분위', '그 전략의 가격이 기간 내 거래일 종가 중 몇 번째로 쌌는지 (0% = 최저)'],
      ...glossaryLines(['전략 백테스트', 'Base 가격 (RBD 환산가)']),
    ]));
  }
  return wb;
}

// ───────────── 알람·리스크 ─────────────
export async function buildAlerts(wb = XLSX.utils.book_new()) {
  const alerts = await generateAlerts(false);
  add(wb, '활성 알람', sheetFromRows(alerts.map(a => ({ '제품': PRODUCT_LABEL[a.product as keyof typeof PRODUCT_LABEL] ?? a.product, '레벨': a.alert_level, '소진 예상월': a.depletion_month, '필요 물량(kg)': a.required_volume, '권장 선적월': a.recommended_shipment, '메시지': a.message })), ['제품', '레벨', '소진 예상월', '필요 물량(kg)', '권장 선적월', '메시지']));
  const risk = await getExposureRisk(6);
  add(wb, '리스크 요약', XLSX.utils.aoa_to_sheet([['항목', '값'], ['기준일', risk.as_of], ['FCPO 근월', risk.fcpo_price], ['일 변동성 σ', risk.sigma_daily], ['VaR95 1개월 %', risk.var1m_pct], ['VaR95 3개월 %', risk.var3m_pct], ['USD/KRW', risk.usdkrw], ['해석', risk.signal]]));
  const flows: Row[] = [];
  for (const p of risk.products) for (const f of p.flow) flows.push({ '제품': PRODUCT_LABEL[p.product], '월': f.ym, '예상소요': f.usage, '계약 통관': f.customs, '기말재고': f.ending, '부족분': f.shortfall });
  add(wb, '6개월 재고 흐름', sheetFromRows(flows, ['제품', '월', '예상소요', '계약 통관', '기말재고', '부족분']));
  add(wb, '제품별 노출', sheetFromRows(risk.products.map(p => ({ '제품': PRODUCT_LABEL[p.product], '미확정 물량(kg)': p.uncovered_kg, '첫 부족월': p.first_shortage_ym, '기준가(RBD+프리미엄)': p.ref_price, '현재가 매입 시(USD)': p.cost_now_usd, 'VaR95 1개월(USD)': p.var1m_usd, 'VaR95 3개월(USD)': p.var3m_usd, 'VaR95 3개월(KRW)': p.var3m_krw, '계획단가': p.plan.plan_price, '올해 계약(MT)': p.plan.ytd_qty_mt, '올해 가중평균': p.plan.ytd_wavg, '잔여 미계약(kg)': p.plan.remaining_kg, '연간 예상 평균': p.plan.projected_avg, '계획 대비': p.plan.gap_vs_plan, '예산 영향(KRW)': p.plan.budget_impact_krw })), ['제품', '미확정 물량(kg)', '첫 부족월', '기준가(RBD+프리미엄)', '현재가 매입 시(USD)', 'VaR95 1개월(USD)', 'VaR95 3개월(USD)', 'VaR95 3개월(KRW)', '계획단가', '올해 계약(MT)', '올해 가중평균', '잔여 미계약(kg)', '연간 예상 평균', '계획 대비', '예산 영향(KRW)']));
  add(wb, '계산방식', methodSheet([
    ['알람 레벨', '선행 커버(현 재고 ÷ 향후 월소요; 향후 데이터 없으면 재고회전) ≤ 1.5개월 긴급, ≤ 2.5 경고. 기말재고 음수 첫 달 = 소진 예상월, 권장 선적월 = 그 3개월 전. 당월·향후 소요 모두 0이면 제외'],
    ['미확정 물량', '향후 6개월 흐름에서 기말재고가 0 아래로 내려가는 누적분 (부족분은 그 달 구매로 메운다고 가정)'],
    ['VaR95', '1.645 × 일변동성(최근 60일 로그수익률 σ, 롤오버 ±8% 초과 제외) × √영업일(1개월 21, 3개월 63) × 기준가 × 미확정 물량'],
    ['기준가', 'FCPO 근월 + 제품 기본 프리미엄 (RSPO 25 / 관리팜유 RPO 40 / RSPO 65)'],
    ['연간 예상 평균', '(올해 계약 금액 + 잔여 미계약 물량 × 기준가) ÷ (올해 계약 물량 + 잔여 물량)'], ['예산 영향', '(연간 예상 평균 − 계획단가) × 총 물량 × USD/KRW'],
    ...glossaryLines(['구매 알람', '미확정 물량', 'VaR 95%', '계획단가']),
  ]));
  return wb;
}

// ───────────── 뉴스 ─────────────
export async function buildNews(wb = XLSX.utils.book_new()) {
  const rows = await dbAll(`SELECT * FROM news ORDER BY date DESC, id DESC`) as Row[];
  add(wb, '뉴스', sheetFromRows(rows.map(r => ({ '날짜': String(r.date).slice(0, 10), '카테고리': r.category, '시황': r.sentiment, '영향도': r.impact, '핵심이슈': r.is_key ? 'Y' : '', '제목/요약': r.content, '본문': r.full_content, '등록': r.created_by })), ['날짜', '카테고리', '시황', '영향도', '핵심이슈', '제목/요약', '본문', '등록'], {}, [11, 8, 6, 8, 6, 60, 80, 12]));
  add(wb, '계산방식', methodSheet([['시황·영향도', 'Claude API 가 기사 본문에서 팜유 가격 전망(강세/약세/보합)과 영향도(High/Medium/Low)를 판정. 수동 수정 가능'], ['핵심이슈', '대시보드 핵심이슈 카드 = is_key 핀 또는 High 영향도, 최신순 6건'], ...glossaryLines(['변곡점', '북마클릿 (뉴스)'])]));
  return wb;
}

// ───────────── 용어집 ─────────────
export function buildGlossary(wb = XLSX.utils.book_new()) {
  add(wb, '용어집', sheetFromRows(GLOSSARY.map(g => ({ '분류': g.category, '용어': g.term, '영문': g.en, '정의': g.definition, '계산식': g.formula, '해석': g.reading, '출처': g.source, '위치': g.where })), ['분류', '용어', '영문', '정의', '계산식', '해석', '출처', '위치'], {}, [14, 22, 30, 60, 60, 60, 30, 20]));
  return wb;
}

// ───────────── 대시보드 요약 ─────────────
export async function buildDashboard(dashboard: any, wb = XLSX.utils.book_new()) {
  add(wb, '알람', sheetFromRows((dashboard.alerts ?? []).map((a: any) => ({ '제품': a.product, '레벨': a.alert_level, '메시지': a.message })), ['제품', '레벨', '메시지']));
  add(wb, '재고 요약', sheetFromRows((dashboard.inventory_summary ?? []).map((x: any) => ({
    '제품': x.product, '연월': `${x.year}-${x.month}`, '기말재고(kg)': x.ending_stock, '당월 예상소요(kg)': x.expected_usage,
    '재고회전(당월)': x.coverage_days,
    '선행 커버(개월)': x.coverage_forward_evaluable ? `${x.coverage_forward}${x.coverage_forward_capped ? '+' : ''}` : '-',
    '다음 소요 개시월': x.usage_start_month ?? '-', '그 달 소요(kg)': x.next_usage ?? '-',
  })), ['제품', '연월', '기말재고(kg)', '당월 예상소요(kg)', '재고회전(당월)', '선행 커버(개월)', '다음 소요 개시월', '그 달 소요(kg)']));
  add(wb, 'FCPO 최신', sheetFromRows((dashboard.fcpo_latest ?? []).map((f: any) => ({ '월물': f.contract_month, 'USD': f.settlement_usd, 'MYR': f.settlement_myr, '전일 MYR': f.prev_myr })), ['월물', 'USD', 'MYR', '전일 MYR']));
  add(wb, '박스권', sheetFromRows((dashboard.box_ranges ?? []).map((b: any) => ({ '월물': b.contract_month, '구간': b.zone, '현재가': b.current_price })), ['월물', '구간', '현재가']));
  add(wb, '계산방식', methodSheet([
    ['재고회전(당월)', '기말재고 ÷ 당월 예상소요 (엑셀 재고회전일과 동일)'],
    ['선행 커버(개월)', '기말재고로 다음 달부터의 예상소요를 몇 개월 감당하는지 (통관 예정량 제외). "+" 는 데이터 범위 끝까지 재고가 남음(하한값). 소요가 달라지는 달(관리팜유 RPO 10월 투입 개시, 관리팜유 RSPO 10월 RPO/RSPO 구분 투입)에는 이 값이 실제 소진 기간'],
    ...glossaryLines(['재고회전(개월)', '선행 커버(개월)', '구매 알람']),
  ]));
  return wb;
}

export function toBuffer(wb: XLSX.WorkBook): Buffer {
  // 엑셀이 열 때 수식을 전부 재계산하도록 (SheetJS 는 캐시값을 0 으로 씀)
  wb.Workbook = { ...(wb.Workbook ?? {}), CalcPr: { fullCalcOnLoad: true } } as any;
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
