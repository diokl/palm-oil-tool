// ===== FCPO Settlement =====
export interface FcpoSettlement {
  id?: number;
  date: string;
  contract_month: string;
  settlement_myr: number | null;
  settlement_usd: number | null;
  exchange_rate: number | null;
  source: string;
}

// ===== Inventory =====
export interface InventoryRow {
  id?: number;
  product: 'RBD' | 'RSPO';
  year: number;
  month: number;
  expected_usage: number | null;
  customs_volume: number | null;
  ending_stock: number | null;
  coverage_days: number | null;
  contract_price: string | null;
  contract_date: string | null;
  updated_at?: string;
  updated_by?: string;
}

export interface InventoryTable {
  product: string;
  year: number;
  rows: InventoryRow[];
}

// ===== Box Range (V3 Logic) =====
export interface BoxRangeResult {
  contract_month: string;
  current_price: number;
  as_of_date?: string;
  // Basic data (10/20/60 day)
  periods: {
    days: number;
    high: number;
    low: number;
    average: number;
    stdev: number;
    range: number;
    volatility_pct: number;
  }[];
  // Box range boundaries (20-day based)
  zones: {
    full_buy_upper: number;     // 전량구매 상한 = MA20 - STDEV
    active_buy_upper: number;   // 적극구매 상한 = MA20 - STDEV*0.5
    monitoring_upper: number;   // 모니터링 상한 = MA20 + STDEV*0.5
    min_buy_upper: number;      // 최소구매 상한 = HIGH(20)
  };
  // Current zone
  current_zone: '전량구매' | '적극구매' | '모니터링' | '최소구매' | '구매대기';
  zone_range: string;
  recommendation: string;
  // Moving average positions
  ma_positions: {
    ma10: number;
    ma20: number;
    ma60: number;
    vs_ma10: number;
    vs_ma20: number;
    vs_ma60: number;
    ma10_signal: string;
    ma20_signal: string;
    ma60_signal: string;
  };
  // Trend signals
  trends: {
    short_term: string;
    mid_term: string;
    long_term: string;
    golden_cross_10_20: boolean;
    golden_cross_20_60: boolean;
    dead_cross_10_20: boolean;
    dead_cross_20_60: boolean;
  };
  // Volatility classification
  volatility: {
    pct_20d: number;
    classification: string;
    market_status: string;
    strategy: string;
  };
  confidence: string;
}

// ===== Purchases =====
export interface Purchase {
  id?: number;
  shipment_month: string;
  contract_date: string | null;
  contract_price: number | null;
  quantity_mt: number | null;
  supplier: string | null;
  market_price: number | null;
  price_diff: number | null;
  prebuy_effect_krw: number | null;
  evaluation: '성공' | '실패' | null;
  product: string;
  notes: string | null;
}

// ===== News =====
export interface NewsItem {
  id?: number;
  date: string;
  content: string;
  sentiment: '강세' | '약세' | '보합';
  impact: 'High' | 'Medium' | 'Low';
  created_by?: string;
}

// ===== Alerts =====
export interface Alert {
  id?: number;
  product: string;
  alert_level: 'critical' | 'warning' | 'normal';
  depletion_month: string | null;
  required_volume: number | null;
  recommended_shipment: string | null;
  current_price: number | null;
  box_range_zone: string | null;
  message: string | null;
  action_taken: string | null;
  is_active: boolean;
  created_at?: string;
}

// ===== AI Analysis =====
export interface AnalysisResult {
  decision: 'BUY' | 'WAIT' | 'PARTIAL_BUY';
  confidence: number;
  reasoning: string[];
  target_price: number;
  recommended_volume_mt: number;
  recommended_timing: string;
  risks: string[];
  market_outlook: string;
}

// ===== Dashboard =====
export interface DashboardSummary {
  active_alerts: Alert[];
  fcpo_latest: { contract_month: string; settlement_myr: number; settlement_usd: number; change_pct: number }[];
  inventory_summary: { product: string; year: number; current_month_stock: number; coverage_days: number; depletion_month: string | null }[];
  box_range_summary: { contract_month: string; zone: string; current_price: number }[];
  recent_purchases: Purchase[];
  ai_analysis: string | null;
}
