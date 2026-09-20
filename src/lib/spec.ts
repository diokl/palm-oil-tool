import type { Product } from './types';

// ── 팜유 스펙(속성 조합)과 프리미엄 ──
//
// 관리팜유는 항상 Low 3-MCPD 가 기본이고, 여기에 GE(Glycidyl Esters) 관리와 RSPO(MB) 인증이 각각 붙거나 안 붙는다.
// 품의서 기준 계약가 = Base(RBD 협상가) + 3-MCPD 프리미엄 + GE 프리미엄 + RSPO 프리미엄 이며,
// 프리미엄은 계약(공급사·시점)마다 협상되므로 purchases 행에 분해값(prem_3mcpd / prem_ge / prem_rspo)을 저장한다.
//   예) 26년 6월 IOI 1차: 1,177.5 + (10+30) + 25 = 1,242.5 / 26년 9월 IOI RPO: 1,170 + 10 = 1,180
//
// 재고관리·알람·리스크는 RSPO 여부로만 갈리므로(GE는 재고 흐름과 무관) product 는 4개:
//   RBD / RSPO / MANAGED(관리팜유 RPO: 3-MCPD, ±GE) / MANAGED_RSPO(관리팜유 RSPO: 3-MCPD, ±GE, +RSPO)
// 세부 스펙은 spec 컬럼: RBD / RSPO / MGD / MGD_GE / MGD_RSPO / MGD_GE_RSPO

export type Spec = 'RBD' | 'RSPO' | 'MGD' | 'MGD_GE' | 'MGD_RSPO' | 'MGD_GE_RSPO';

export const SPEC_OPTIONS: Spec[] = ['RBD', 'RSPO', 'MGD', 'MGD_GE', 'MGD_RSPO', 'MGD_GE_RSPO'];

export const SPEC_LABEL: Record<Spec, string> = {
  RBD: 'RBD',
  RSPO: 'RSPO(MB)',
  MGD: '관리팜유 RPO (3-MCPD)',
  MGD_GE: '관리팜유 RPO (3-MCPD+GE)',
  MGD_RSPO: '관리팜유 RSPO (3-MCPD+RSPO)',
  MGD_GE_RSPO: '관리팜유 RSPO (3-MCPD+GE+RSPO)',
};
export const SPEC_SHORT: Record<Spec, string> = {
  RBD: 'RBD', RSPO: 'RSPO', MGD: '3-MCPD', MGD_GE: '3-MCPD+GE', MGD_RSPO: '3-MCPD+RSPO', MGD_GE_RSPO: '3-MCPD+GE+RSPO',
};

export const PRODUCT_LABEL: Record<Product, string> = {
  RBD: 'RBD Palm Oil', RSPO: 'RSPO(MB)', MANAGED: '관리팜유 RPO', MANAGED_RSPO: '관리팜유 RSPO',
};

// 속성별 기본 프리미엄 (USD/MT) — 계약 입력 시 초기값. 실제 협상값은 계약별로 저장.
// 3-MCPD +10 은 공급사 공통, GE 는 30~35 로 공급사·시점별 상이, RSPO +25.
export const DEFAULT_PREMIUM = { mcpd: 10, ge: 30, rspo: 25 };

export function specFlags(spec: Spec | string | null | undefined): { managed: boolean; mcpd: boolean; ge: boolean; rspo: boolean } {
  const s = String(spec || '');
  const managed = s.startsWith('MGD');
  return { managed, mcpd: managed, ge: s.includes('_GE'), rspo: s === 'RSPO' || s.includes('RSPO') };
}

export function specFromFlags(f: { managed: boolean; ge?: boolean; rspo?: boolean }): Spec {
  if (!f.managed) return f.rspo ? 'RSPO' : 'RBD';
  if (f.ge && f.rspo) return 'MGD_GE_RSPO';
  if (f.ge) return 'MGD_GE';
  if (f.rspo) return 'MGD_RSPO';
  return 'MGD';
}

export function productForSpec(spec: Spec | string): Product {
  const f = specFlags(spec);
  if (!f.managed) return f.rspo ? 'RSPO' : 'RBD';
  return f.rspo ? 'MANAGED_RSPO' : 'MANAGED';
}

// product 만 있고 spec 이 없는 과거 행의 추정 스펙
export function specOf(row: { spec?: string | null; product?: string | null }): Spec {
  if (row.spec && (SPEC_OPTIONS as string[]).includes(row.spec)) return row.spec as Spec;
  switch (row.product) {
    case 'RSPO': return 'RSPO';
    case 'MANAGED': return 'MGD_GE';
    case 'MANAGED_RSPO': return 'MGD_GE_RSPO';
    default: return 'RBD';
  }
}

export function defaultPremiums(spec: Spec | string): { prem_3mcpd: number; prem_ge: number; prem_rspo: number } {
  const f = specFlags(spec);
  return {
    prem_3mcpd: f.mcpd ? DEFAULT_PREMIUM.mcpd : 0,
    prem_ge: f.ge ? DEFAULT_PREMIUM.ge : 0,
    prem_rspo: f.rspo ? DEFAULT_PREMIUM.rspo : 0,
  };
}

export function premiumSum(p: { prem_3mcpd?: number | null; prem_ge?: number | null; prem_rspo?: number | null }): number {
  return Number(p.prem_3mcpd ?? 0) + Number(p.prem_ge ?? 0) + Number(p.prem_rspo ?? 0);
}

/** 분해값이 하나라도 저장된 행이면 그 합, 아니면 null (호출부가 제품 기본값으로 폴백) */
export function premiumOverride(p: { prem_3mcpd?: number | null; prem_ge?: number | null; prem_rspo?: number | null }): number | null {
  if (p.prem_3mcpd == null && p.prem_ge == null && p.prem_rspo == null) return null;
  return premiumSum(p);
}
