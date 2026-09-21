// 엑셀 내보내기 대상 목록 — 클라이언트(page.tsx)와 서버(export-xlsx.ts) 공용. DB 의존 없음.
export const EXPORT_TARGETS = [
  { id: 'prebuy', label: '선구매 효과 분석', desc: '건별(수식)·월별·제품별·스펙별·공급사 프리미엄 벤치마크·계산방식' },
  { id: 'purchases', label: '구매이력 RAW', desc: '전체 계약 + 스펙·프리미엄 분해·Base(수식)' },
  { id: 'inventory', label: '재고관리', desc: '제품·연도별 시트, 기말재고·재고회전 수식, 실재고 반영' },
  { id: 'fcpo', label: 'FCPO 가격 DB', desc: '날짜×월물 USD/MYR 피벗 + 월물 곡선' },
  { id: 'box-range', label: '박스권 분석', desc: '활성 월물별 구간·이평·추세·변동성·보조지표 + 일별 시세(MA20·σ 수식)' },
  { id: 'mpob', label: 'MPOB 수급', desc: '수급 밸런스(재고/수출·회귀)·헤드라인·정제유·수출 원자료·USDA 세계 수급' },
  { id: 'macro', label: '환율·에너지·대두유', desc: '환율·Brent·경유·대련 시계열, POGO·스프레드 수식' },
  { id: 'backtest', label: '전략 백테스트', desc: 'RBD/RSPO/관리팜유 전략별 단가·연도별·선적월별' },
  { id: 'alerts', label: '구매 알람·리스크', desc: '활성 알람, 6개월 재고 흐름, VaR·계획단가' },
  { id: 'news', label: '뉴스·시황', desc: '전체 기사(날짜·시황·영향도·카테고리)' },
  { id: 'glossary', label: '용어집', desc: '모든 지표의 정의·계산식·해석·출처' },
  { id: 'dashboard', label: '대시보드 요약', desc: '알람·재고 요약·FCPO 최신·박스권 구간' },
] as const;
export type ExportTarget = typeof EXPORT_TARGETS[number]['id'];
