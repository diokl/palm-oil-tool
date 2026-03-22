# 팜유 구매관리 시스템 - 설계안 V2.0

## 개요
삼양식품 기초원료구매팀의 팜유(RBD/RSPO) 구매 의사결정을 지원하는 웹 기반 시스템.
팀원 공동 사용, 서버 배포 기반.

---

## 탭 구성 (총 6개)

### 📊 탭 1: 대시보드 (요약)
> 로그인 시 첫 화면. 핵심 지표를 한눈에 파악.

| 섹션 | 내용 |
|------|------|
| **구매 알람 배너** | 재고 소진 예측 기반 긴급/경고/정상 알림 |
| **현재 시장 현황** | FCPO 최근 종가(MYR/USD), 전일 대비 등락, 주요 월물 가격 |
| **재고 요약 카드** | RBD/RSPO 각각 현재 재고, 재고회전일, 다음 통관 예정 |
| **박스권 게이지** | 현재 가격이 어느 구간인지 시각적 표시 (주요 2~3개 월물) |
| **가격 추이 미니차트** | 최근 30일 FCPO 주요 월물 가격 추이 |
| **구매 이력 요약** | 최근 3건 계약 내역 + 성과(성공/실패) |

---

### 📈 탭 2: FCPO 시장가격 DB
> 매일 자동 수집되는 FCPO Settlement 데이터.

**데이터 구조 (엑셀 팜유시장가격DB 시트와 동일):**
- 행: 날짜 (영업일 기준)
- 열: 각 월물 (2026-03, 2026-04, 2026-05, ... 2027-06 등 활성 계약월)
- 값: Settlement Price

**기능:**
- 매일 KST 21:00 자동 수집 (Bursa Malaysia → Puppeteer 스크래핑)
- MYR 원본 + USD 환산 (환율 자동 수집) 토글 전환
- 테이블 뷰 + 차트 뷰 전환
- 차트: 선택한 월물의 일별 가격 추이 (다중 월물 오버레이 가능)
- 수동 입력/수정 가능 (자동 수집 실패 시 대비)
- CSV/Excel 다운로드

**데이터 소스 우선순위:**
1. Bursa Malaysia 직접 스크래핑 (Puppeteer)
2. Investing.com FCPO 각 월물 페이지
3. 수동 입력

---

### 📦 탭 3: 재고현황
> 엑셀 RAW 시트 "E. 팜유 재고현황"과 동일한 구조.

**테이블 구조 (4개 서브테이블):**

```
┌─────────────────────────────────────────────────────────┐
│ RBD PALM OIL - 2025년                                    │
├──────────────┬──────┬──────┬──────┬──────┬...┬──────────┤
│              │ 1월  │ 2월  │ 3월  │ 4월  │   │ 12월     │
├──────────────┼──────┼──────┼──────┼──────┤   ├──────────┤
│ 예상소요량   │2,070 │2,425 │2,463 │2,456 │   │ 2,777    │ ← kg 단위
│ 통관수량     │2,000 │2,000 │3,000 │4,000 │   │          │
│ 기말재고     │2,348 │2,116 │2,859 │4,307 │   │ 7,009    │ ← 자동계산
│ 재고회전일   │ 1.1  │ 0.9  │ 1.2  │ 1.8  │   │ 2.5      │ ← 자동계산
│ 계약단가     │1,105 │1,095 │1,123 │1,110 │   │          │
│ 계약월       │10/25 │10/25 │11/26 │12/26 │   │          │
└──────────────┴──────┴──────┴──────┴──────┴...┴──────────┘

× 4개: RBD 2025, RBD 2026, RSPO 2025, RSPO 2026
```

**자동 계산 로직:**
- 기말재고 = 전월 기말재고 + 통관수량 - 예상소요량
- 재고회전일 = 기말재고 / 예상소요량

**기능:**
- 셀 클릭 → 인라인 수정 → 즉시 저장
- 기말재고 마이너스 구간 빨간색 하이라이트
- 연도 추가 (2027년 등) 기능
- 수정 이력 로그 (누가 언제 뭘 바꿨는지)

---

### 📐 탭 4: 박스권 분석
> 엑셀 "박스권 계산(V3)" 로직 완전 재현.

**월물 선택:** 드롭다운으로 분석 대상 월물 선택 (예: 2026-04, 2026-05)

**섹션 1: 핵심 요약**
| 구분 | 현재가 | 추천 행동 | 해당 구간 | 추세 방향 | 신뢰도 |
|------|--------|-----------|-----------|-----------|--------|

**섹션 2: 기간별 기본 데이터**
- 10일/20일/60일 기준: 최고가, 최저가, 이동평균, 표준편차, 변동폭, 변동률

**섹션 3: 이평선 위치 분석**
- 현재가 vs 10일/20일/60일 이평선 → 이평선 상회/하회 판정

**섹션 4: 박스권 경계값 (20일 기준)**
```
전량구매 상한 = 20일 이평선 - 표준편차
적극구매 상한 = 20일 이평선 - (표준편차 × 0.5)
모니터링 상한 = 20일 이평선 + (표준편차 × 0.5)
최소구매 상한 = 최고가(20일)
```

**섹션 5: 박스권 구간 시각화**
- 가격 축 위에 4개 구간을 색상 바로 표시
- 현재가 위치를 화살표로 표시
- 게이지 차트 형태

**섹션 6: 추세 신호 분석**
- 단기/중기/장기 추세 (현재가 vs 각 이평선)
- 골든크로스 / 데드크로스 감지 (10일vs20일, 20일vs60일)

**섹션 7: 변동성 분석**
- 20일 변동률 기준 시장 상태 분류:
  - < 2%: 매우 낮음 → 정상 구매
  - 2~3%: 낮음 → 정상 구매
  - 3~5%: 보통 → 분할 매수
  - 5~7%: 높음 → 분할 매수
  - 7~10%: 매우 높음 → 소량 분할
  - > 10%: 극단적 → 구매 보류

**섹션 8: 가격 차트**
- 일별 종가 + 10일/20일/60일 이평선 오버레이
- 박스권 경계선 수평 표시 (점선, 색상 구분)
- 구매 실행 포인트 마커 (구매이력에서 가져옴)

---

### 🛒 탭 5: 구매 이력
> 엑셀 "3개월 선구매 정리" + "그래프 정리" 통합.

**테이블 구조:**
| 선적물 | 계약시점 | 계약가격($/MT) | 구매당월 시황 | 가격차이 | 선구매효과(백만원) | 평가 | 비고 |
|--------|----------|----------------|---------------|----------|-------------------|------|------|

**기능:**
- 새 계약 등록 (선적월, 계약일, 단가, 수량, 업체, 비고)
- 시황가격 자동 매칭 (FCPO DB에서 해당 월물의 해당 일자 가격)
- 선구매 효과 자동 계산: (시장가 - 계약가) × 수량
- 성공/실패 자동 판정 (가격차이 음수면 성공)
- 월별/분기별 성과 요약 차트

**차트 (그래프 정리 시트 재현):**
- X축: 선적월, Y축: 가격($/톤)
- 시황가격 라인 + 계약단가 포인트 오버레이
- 계획단가 기준선

---

### 🔔 탭 6: 구매 알람
> 재고현황 + 가격 데이터를 결합한 자동 알림 시스템.

**알람 생성 로직:**
1. 재고현황에서 기말재고가 마이너스로 전환되는 첫 월 감지
2. 해당 월의 2~3개월 전 = 구매 필요 시점 (선적 → 통관 리드타임 고려)
3. 필요 물량 = 해당 월 예상소요량 (기본값, 수동 조정 가능)

**알람 레벨:**
| 레벨 | 조건 | 색상 |
|------|------|------|
| 🔴 긴급 | 재고회전일 ≤ 1.5 또는 다음 달 기말재고 마이너스 | 빨강 |
| 🟡 경고 | 재고회전일 ≤ 2.5 또는 2개월 내 기말재고 마이너스 | 노랑 |
| 🟢 정상 | 재고회전일 > 2.5 | 초록 |

**알람 카드 내용:**
```
🔴 긴급: RBD PALM OIL 2026년 8월 재고 소진 예상
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 예상 소진 시점: 2026년 8월 (기말재고 -626톤)
• 필요 구매량: 최소 2,600톤 (5월 선적 기준)
• 현재 FCPO 5월물: 4,605 MYR (≈$1,012/MT)
• 박스권 분석: 전량구매 구간 ($1,010~$1,018)
• 추천: 지금이 매수 적기입니다
```

**알람 이력:** 과거 알람 + 조치 내역 기록

---

## 데이터베이스 스키마 (PostgreSQL)

### fcpo_settlement
```sql
CREATE TABLE fcpo_settlement (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  contract_month VARCHAR(7) NOT NULL,  -- '2026-04'
  settlement_myr DECIMAL(10,2),        -- MYR/톤
  settlement_usd DECIMAL(10,2),        -- USD/톤 (환산)
  exchange_rate DECIMAL(10,4),         -- MYR/USD
  source VARCHAR(50),                  -- 'bursa_malaysia', 'investing', 'manual'
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(date, contract_month)
);
```

### inventory
```sql
CREATE TABLE inventory (
  id SERIAL PRIMARY KEY,
  product VARCHAR(20) NOT NULL,        -- 'RBD' or 'RSPO'
  year INT NOT NULL,
  month INT NOT NULL,                  -- 1~12
  expected_usage DECIMAL(15,3),        -- 예상소요량 (kg)
  customs_volume DECIMAL(15,3),        -- 통관수량 (kg)
  ending_stock DECIMAL(15,3),          -- 기말재고 (자동계산)
  coverage_days DECIMAL(5,2),          -- 재고회전일 (자동계산)
  contract_price VARCHAR(100),         -- 계약단가 (텍스트, 복수가 가능)
  contract_date VARCHAR(100),          -- 계약월 (텍스트)
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by VARCHAR(50),
  UNIQUE(product, year, month)
);
```

### purchases
```sql
CREATE TABLE purchases (
  id SERIAL PRIMARY KEY,
  shipment_month VARCHAR(20) NOT NULL, -- '25년 4월'
  contract_date DATE,
  contract_price DECIMAL(10,2),        -- $/MT
  quantity_mt DECIMAL(10,2),           -- 톤
  supplier VARCHAR(50),                -- 'KLK', 'IOI', 'WILMAR' 등
  market_price DECIMAL(10,2),          -- 구매당월 시황
  price_diff DECIMAL(10,2),            -- 시장가 - 계약가
  prebuy_effect BIGINT,                -- 선구매효과 (원)
  evaluation VARCHAR(10),              -- '성공', '실패'
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### alerts
```sql
CREATE TABLE alerts (
  id SERIAL PRIMARY KEY,
  product VARCHAR(20) NOT NULL,
  alert_level VARCHAR(10) NOT NULL,    -- 'critical', 'warning', 'normal'
  depletion_month VARCHAR(7),          -- '2026-08'
  required_volume DECIMAL(15,3),
  recommended_shipment VARCHAR(7),     -- '2026-05'
  current_fcpo_price DECIMAL(10,2),
  box_range_zone VARCHAR(20),          -- '전량구매', '적극구매' 등
  message TEXT,
  action_taken TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### edit_log
```sql
CREATE TABLE edit_log (
  id SERIAL PRIMARY KEY,
  table_name VARCHAR(50),
  record_id INT,
  field_name VARCHAR(50),
  old_value TEXT,
  new_value TEXT,
  edited_by VARCHAR(50),
  edited_at TIMESTAMP DEFAULT NOW()
);
```

---

## 자동화 스케줄

| 작업 | 시간 | 설명 |
|------|------|------|
| FCPO Settlement 수집 | KST 21:00 | Bursa Malaysia 스크래핑 |
| MYR/USD 환율 수집 | KST 21:05 | 환율 API (exchangerate-api 등) |
| 알람 재계산 | KST 21:10 | 새 가격 반영하여 알람 갱신 |
| 일일 요약 생성 | KST 21:15 | 대시보드 캐시 갱신 |

---

## 기술 스택

- **Frontend:** Next.js 14+ (App Router), React 18, TypeScript
- **CSS:** Tailwind CSS (깔끔하고 전문적인 UI)
- **차트:** Recharts (가격 차트, 박스권 게이지)
- **DB:** PostgreSQL (팀 동시 접속 지원)
- **ORM:** Prisma 또는 Drizzle
- **스케줄러:** node-cron 또는 서버 cron job
- **스크래핑:** Puppeteer (Bursa Malaysia) + fetch (Investing.com fallback)
- **배포:** Docker + 사내 서버 또는 클라우드 (Vercel + Supabase 등)
- **인증:** NextAuth.js (팀원 접근 관리)

---

## 기존 코드 대비 변경 사항

### 유지
- Next.js App Router 구조
- 기본 레이아웃/네비게이션
- 엑셀 초기 데이터 임포트 (1회성)

### 삭제/교체
- SQLite → PostgreSQL
- 기존 박스권 계산 로직 → 엑셀 V3 방식으로 교체
- 기존 price-fetcher → FCPO 월물별 스크래핑으로 교체
- 기존 단순 AlertBanner → 재고 소진 예측 기반 알람으로 교체
- 기존 AI 분석 기능 → 제거 (불필요)
- 기존 MPOB 스크래핑 → 선택적 유지 (참고용)

### 신규 개발
- FCPO Settlement 월물별 자동 수집 + DB 탭
- 박스권 V3 분석 전용 탭
- 대시보드 요약 탭
- 구매 알람 시스템 (재고 소진 예측 기반)
- 수정 이력 로그
- 사용자 인증

---

## UI/UX 방향

- **톤:** 전문적, 금융 대시보드 느낌 (다크/라이트 모드)
- **색상:** 네이비/화이트 기반, 알람은 빨강/노랑/초록
- **폰트:** Pretendard (한글), Inter (영문/숫자)
- **레이아웃:** 사이드바 네비게이션 + 메인 콘텐츠
- **반응형:** 데스크탑 최적화 (1280px+), 태블릿 지원
