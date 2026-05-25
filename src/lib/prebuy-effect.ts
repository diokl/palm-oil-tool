import type { Product } from './types';

// 제품별 RBD 대비 정상 프리미엄 (USD/MT)
// 엑셀 '3개월 선구매 정리' L18~L20 검증된 값.
// RBD(일반팜유)는 기준이므로 0, RSPO는 +$25, 관리팜유(3-MCPD+GE+RSPO)는 +$65.
export const PRODUCT_PREMIUM_USD: Record<Product, number> = {
  RBD: 0,
  RSPO: 25,
  MANAGED: 65,
};

export const DEFAULT_EXCHANGE_RATE = 1450;

export interface PrebuyEffectInput {
  product: Product;
  contract_price: number; // 계약가 (USD/MT)
  market_price_rbd: number; // RBD 기준 시황가 (USD/MT). RSPO/MANAGED도 동일 RBD 시황가를 넘김.
  qty_mt: number;
  exchange_rate?: number; // 기본 1,450 KRW/USD
}

export interface PrebuyEffectResult {
  product: Product;
  contract_price: number;
  market_price_rbd: number;
  premium_usd: number;
  normalized_market_price: number; // = market_price_rbd + premium
  qty_mt: number;
  exchange_rate: number;
  // 두 가지 부호 규약 모두 제공
  // - effect_excel_usd: (계약가 - 정상가) × 수량. 음수=절감(성공). 엑셀 '3개월 선구매 정리' L열 규약.
  // - savings_usd:     (정상가 - 계약가) × 수량. 양수=절감(성공). page.tsx handlePrebuySummary 규약.
  effect_excel_usd: number;
  effect_excel_krw: number;
  savings_usd: number;
  savings_krw: number;
  evaluation: '성공' | '실패';
}

// 단일 구매건 선구매 효과 계산.
// 엑셀 공식 (L20 예시):
//   효과 = ((계약가 - (RBD시황 + 프리미엄)) × 수량) × 환율
// 음수 = 절감(시황+프리미엄보다 싸게 구매했음) → '성공'
export function calculatePrebuyEffect(input: PrebuyEffectInput): PrebuyEffectResult {
  const premium = PRODUCT_PREMIUM_USD[input.product];
  const normalizedMarket = input.market_price_rbd + premium;
  const er = input.exchange_rate ?? DEFAULT_EXCHANGE_RATE;
  const effectExcelUsd = (input.contract_price - normalizedMarket) * input.qty_mt;
  const effectExcelKrw = effectExcelUsd * er;
  return {
    product: input.product,
    contract_price: input.contract_price,
    market_price_rbd: input.market_price_rbd,
    premium_usd: premium,
    normalized_market_price: normalizedMarket,
    qty_mt: input.qty_mt,
    exchange_rate: er,
    effect_excel_usd: effectExcelUsd,
    effect_excel_krw: effectExcelKrw,
    savings_usd: -effectExcelUsd,
    savings_krw: -effectExcelKrw,
    evaluation: effectExcelUsd <= 0 ? '성공' : '실패',
  };
}

export interface PrebuyEffectBatchSummary {
  items: PrebuyEffectResult[];
  total_effect_excel_usd: number;
  total_effect_excel_krw: number;
  total_savings_usd: number;
  total_savings_krw: number;
  by_product: Record<Product, {
    effect_excel_usd: number;
    effect_excel_krw: number;
    savings_usd: number;
    savings_krw: number;
    qty_mt: number;
    contract_amount_usd: number;
  }>;
}

// 여러 구매건의 효과 집계. 제품별·총합 동시 산출.
export function calculatePrebuyEffectBatch(inputs: PrebuyEffectInput[]): PrebuyEffectBatchSummary {
  const items = inputs.map(calculatePrebuyEffect);

  const by_product: PrebuyEffectBatchSummary['by_product'] = {
    RBD:     { effect_excel_usd: 0, effect_excel_krw: 0, savings_usd: 0, savings_krw: 0, qty_mt: 0, contract_amount_usd: 0 },
    RSPO:    { effect_excel_usd: 0, effect_excel_krw: 0, savings_usd: 0, savings_krw: 0, qty_mt: 0, contract_amount_usd: 0 },
    MANAGED: { effect_excel_usd: 0, effect_excel_krw: 0, savings_usd: 0, savings_krw: 0, qty_mt: 0, contract_amount_usd: 0 },
  };

  for (const it of items) {
    const bucket = by_product[it.product];
    bucket.effect_excel_usd += it.effect_excel_usd;
    bucket.effect_excel_krw += it.effect_excel_krw;
    bucket.savings_usd += it.savings_usd;
    bucket.savings_krw += it.savings_krw;
    bucket.qty_mt += it.qty_mt;
    bucket.contract_amount_usd += it.contract_price * it.qty_mt;
  }

  const total_effect_excel_usd = items.reduce((s, i) => s + i.effect_excel_usd, 0);
  const total_effect_excel_krw = items.reduce((s, i) => s + i.effect_excel_krw, 0);

  return {
    items,
    total_effect_excel_usd,
    total_effect_excel_krw,
    total_savings_usd: -total_effect_excel_usd,
    total_savings_krw: -total_effect_excel_krw,
    by_product,
  };
}

// 제품 코드에 해당하는 프리미엄을 반환. UI 표시용.
export function getPremium(product: Product): number {
  return PRODUCT_PREMIUM_USD[product];
}
