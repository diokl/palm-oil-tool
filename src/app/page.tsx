'use client';

import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Bar
} from 'recharts';

// ============ AUTH CONTEXT ============
const AuthContext = createContext<{ canWrite: boolean; role: string }>({ canWrite: false, role: 'user' });
const useAuth = () => useContext(AuthContext);

type Tab = 'dashboard' | 'fcpo' | 'inventory' | 'box-range' | 'purchases' | 'news' | 'alerts' | 'lc' | 'doc-verify' | 'mpob' | 'admin';
type InventorySubTab = 'rbd2025' | 'rbd2026' | 'rspo2025' | 'rspo2026' | 'managed2026';

const INVENTORY_SUB_TABS: { id: InventorySubTab; label: string; product: 'RBD' | 'RSPO' | 'MANAGED'; year: number }[] = [
  { id: 'rbd2025',     label: 'RBD 2025',        product: 'RBD',     year: 2025 },
  { id: 'rbd2026',     label: 'RBD 2026',        product: 'RBD',     year: 2026 },
  { id: 'rspo2025',    label: 'RSPO 2025',       product: 'RSPO',    year: 2025 },
  { id: 'rspo2026',    label: 'RSPO 2026',       product: 'RSPO',    year: 2026 },
  { id: 'managed2026', label: '관리팜유 2026',    product: 'MANAGED', year: 2026 },
];

// ============ TYPES ============

interface DashboardAlert {
  product: string;
  alert_level: 'critical' | 'warning' | 'normal';
  depletion_month: string;
  required_volume: number;
  recommended_shipment: string;
  current_price: number | null;
  box_range_zone: string | null;
  message: string;
  action_taken: string | null;
  is_active: boolean;
}

interface FCPOLatest {
  contract_month: string;
  settlement_myr: number | null;
  settlement_usd: number;
  prev_myr: number | null;
}

interface InventorySummaryItem {
  product: string;
  year: number;
  month: number;
  ending_stock: number;
  coverage_days: number;
}

interface BoxRangeItem {
  contract_month: string;
  zone: string;
  current_price: number;
}

interface RecentPurchaseItem {
  id: number;
  order_no: string | null;
  product: string;
  shipment_month: string;
  supplier: string | null;
  manufacturer: string | null;
  product_name: string | null;
  unit_price: number;
  qty_mt: number;
  amount_usd: number;
  incoterms: string | null;
  payment_terms: string | null;
  etd: string | null;
}

interface MpobSummaryRow {
  category: string;
  item_name: string;
  year: number;
  month: number;
  value: number | null;
  value_rm: number | null;
}

interface DashboardData {
  alerts: DashboardAlert[];
  fcpo_latest: FCPOLatest[];
  fcpo_latest_date: string;
  inventory_summary: InventorySummaryItem[];
  box_ranges: BoxRangeItem[];
  mpob_summary: MpobSummaryRow[];
  recent_purchases: RecentPurchaseItem[];
  recent_news: NewsItem[];
  ai_analysis: string | null;
  prebuy_effect: {
    months: Array<{
      shipment_month: string;
      rbd_qty: number; rbd_amount: number; rbd_effect_usd: number; rbd_effect_krw: number;
      rspo_qty: number; rspo_amount: number; rspo_effect_usd: number; rspo_effect_krw: number;
      managed_qty: number; managed_amount: number; managed_effect_usd: number; managed_effect_krw: number;
      total_qty: number; total_amount: number; effect_usd: number; effect_krw: number;
    }>;
    total_records: number;
  } | null;
  oil_spread?: {
    latest: OilSpreadPoint | null;
    prev: OilSpreadPoint | null;
    series: OilSpreadPoint[];
  } | null;
}

interface OilSpreadPoint {
  date: string;
  palm: number | null;
  sbo: number | null;
  spread: number | null;
}

interface FCPOData {
  data: Record<string, any>[];
  contract_months: string[];
}

interface InventoryItem {
  id: number;
  product: string;
  year: number;
  month: number;
  expected_usage: number;
  customs_volume: number;
  ending_stock: number;
  coverage_days: number;
  contract_price: string | number;
  contract_date: string;
  updated_at: string;
  updated_by: string;
}

interface InventoryResponse {
  data: InventoryItem[];
}

interface BoxRangeDetail {
  contract_month: string;
  current_price: number;
  mode: '일반' | '전쟁이슈';
  risk_premium: number;
  periods: Array<{
    days: number;
    high: number;
    low: number;
    average: number;
    stdev: number;
    range: number;
    volatility_pct: number;
  }>;
  zones: {
    full_buy_upper: number;
    active_buy_upper: number;
    monitoring_upper: number;
    min_buy_upper: number;
  };
  current_zone: string;
  zone_range: string;
  recommendation: string;
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
  trends: {
    short_term: string;
    mid_term: string;
    long_term: string;
    golden_cross_10_20: boolean;
    golden_cross_20_60: boolean;
    dead_cross_10_20: boolean;
    dead_cross_20_60: boolean;
  };
  volatility: {
    pct_20d: number;
    classification: string;
    market_status: string;
    strategy: string;
  };
  confidence: string;
}

interface PurchaseItem {
  id: number;
  order_no: string | null;
  product: string;
  shipment_month: string;
  supplier: string | null;
  manufacturer: string | null;
  product_name: string | null;
  unit_price: number;
  qty_mt: number;
  amount_usd: number;
  market_price_usd: number | null;
  incoterms: string | null;
  payment_terms: string | null;
  etd: string | null;
  contract_number: string | null;
  notes: string | null;
}

interface PurchasesRawResponse {
  data: PurchaseItem[];
  summary: {
    total_records: number;
    total_qty_mt: number;
    total_amount_usd: number;
  };
  supplier_summary: { supplier: string; record_count: number; total_qty_mt: number; total_amount_usd: number }[];
}

interface PrebuyPurchaseDetail {
  id: number;
  order_no: string | null;
  product: string;
  shipment_month: string;
  supplier: string | null;
  manufacturer: string | null;
  product_name: string | null;
  unit_price: number;
  qty_mt: number;
  amount_usd: number;
  market_price_usd: number | null;
  premium_usd?: number;                    // 자동 룩업 (RBD:0 / RSPO:25 / MANAGED:65)
  normalized_market_price?: number | null;
  exchange_rate: number;
  effect_usd: number;
  effect_krw: number;
}

interface PrebuyRow {
  shipment_month: string;
  purchases: PrebuyPurchaseDetail[];
  rbd_qty?: number;
  rbd_amount?: number;
  rbd_effect_usd?: number;
  rbd_effect_krw?: number;
  rspo_qty?: number;
  rspo_amount?: number;
  rspo_effect_usd?: number;
  rspo_effect_krw?: number;
  managed_qty?: number;
  managed_amount?: number;
  managed_effect_usd?: number;
  managed_effect_krw?: number;
  total_qty?: number;
  total_amount?: number;
  qty?: number;
  amount?: number;
  wavg_price: number;
  avg_market_price: number;
  market_price?: number;
  price_diff?: number;
  effect_usd: number;
  effect_krw: number;
  cumulative_effect_krw?: number;
  evaluation: string;
}

interface PrebuyProductData {
  rows: PrebuyRow[];
  total_effect_krw: number;
}

interface PrebuyResponse {
  data: PrebuyRow[];
  rbd: PrebuyProductData;
  rspo: PrebuyProductData;
  managed?: PrebuyProductData;
  summary: { total_effect_krw: number };
}

interface NewsItem {
  id: number;
  date: string;
  content: string;
  full_content?: string;
  sentiment: string;
  impact: string;
  created_by?: string;
}

interface NewsResponse {
  data: NewsItem[];
  sentiment_summary: Array<{ sentiment: string; cnt: number }>;
}

interface AlertsResponse {
  data: DashboardAlert[];
}

// ============ UTILITY ============

const formatNumber = (num: number | null | undefined, decimals: number = 0) => {
  if (num === null || num === undefined) return '-';
  return new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
};

const formatPrice = (num: number | null | undefined) => {
  if (num === null || num === undefined) return '-';
  return `$${new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(num)}`;
};

const formatKRW = (num: number | null | undefined) => {
  if (num === null || num === undefined) return '-';
  const abs = Math.abs(num);
  if (abs >= 100000000) return `${num < 0 ? '-' : ''}₩${(abs / 100000000).toFixed(1)}억`;
  return `${num < 0 ? '-' : ''}₩${(abs / 1000000).toFixed(1)}M`;
};

const Shimmer = ({ className = '' }: { className?: string }) => (
  <div className={`animate-shimmer rounded-2xl ${className}`} />
);

// ============ SHARED COMPONENTS ============

const AlertBanner = ({ alert, onAction, onDismiss }: { alert: DashboardAlert; onAction?: () => void; onDismiss?: () => void }) => {
  const [dismissed, setDismissed] = useState(false);
  const isCritical = alert.alert_level === 'critical';
  if (dismissed) return null;
  return (
    <div className={`card p-4 flex items-start gap-4 border-l-4 ${isCritical ? 'border-l-rose-500 bg-rose-50/50' : 'border-l-amber-400 bg-amber-50/40'}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isCritical ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
        <span className="text-base">{isCritical ? '!' : '⚠'}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isCritical ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
            {alert.alert_level.toUpperCase()}
          </span>
          <span className="text-sm font-semibold text-slate-800">{alert.product}</span>
        </div>
        <p className="text-slate-600 text-sm mt-1 leading-relaxed">{alert.message}</p>
        {alert.recommended_shipment && (
          <p className="text-slate-500 text-xs mt-1.5">
            권장 선적월: <span className="font-mono font-medium text-slate-700">{alert.recommended_shipment}</span>
          </p>
        )}
      </div>
      <div className="flex gap-2 flex-shrink-0">
        {onAction && (
          <button onClick={onAction} className="px-3.5 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-medium hover:bg-slate-700 transition-colors whitespace-nowrap shadow-sm">
            조치
          </button>
        )}
        <button onClick={() => { setDismissed(true); onDismiss?.(); }}
          className="px-2.5 py-1.5 bg-slate-200 text-slate-600 rounded-lg text-xs hover:bg-slate-300 transition-colors" title="닫기">
          ✕
        </button>
      </div>
    </div>
  );
};

const MetricCard = ({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: string }) => (
  <div className="card p-5 group">
    <p className="text-slate-500 text-xs font-medium tracking-wide uppercase">{label}</p>
    <div className="flex items-baseline gap-2 mt-2.5">
      <p className={`text-2xl font-bold tabular-nums ${accent || 'text-slate-900'}`}>{value}</p>
    </div>
    {unit && <p className="text-xs text-slate-400 mt-1.5">{unit}</p>}
  </div>
);

const BoxRangeGauge = ({ data }: { data: BoxRangeDetail }) => {
  if (!data?.zones || !data?.current_price) {
    return (
      <div className="card p-6 text-slate-500 text-sm">
        박스권 데이터를 불러올 수 없습니다. 해당 월물의 가격 데이터가 10일 이상 필요합니다.
      </div>
    );
  }

  const zones = data.zones;
  const current = data.current_price;
  const minPrice = zones.full_buy_upper * 0.95;
  const maxPrice = zones.min_buy_upper * 1.05;
  const range = (maxPrice - minPrice) || 1;
  const currentPercent = ((current - minPrice) / range) * 100;

  const zoneColors: Record<string, string> = {
    '전량구매': 'text-emerald-600 bg-emerald-50',
    '적극매수': 'text-blue-600 bg-blue-50',
    '모니터링': 'text-amber-600 bg-amber-50',
    '최소매수': 'text-orange-600 bg-orange-50',
    '구매대기': 'text-rose-600 bg-rose-50',
  };
  const zoneStyle = zoneColors[data.current_zone] || 'text-slate-600 bg-slate-50';

  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">
            {data.contract_month} 박스권 분석
            {(data as any).as_of_date && <span className="ml-2 text-xs font-normal text-slate-400">({(data as any).as_of_date} 기준)</span>}
          </h3>
          <span className={`inline-block mt-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${zoneStyle}`}>
            {data.current_zone}
          </span>
        </div>
        <p className="text-3xl font-bold text-slate-900 tabular-nums">{formatPrice(current)}</p>
      </div>

      {/* Zone labels + price thresholds */}
      <div className="grid grid-cols-4 gap-1 text-xs px-1">
        <div className="text-center">
          <span className="text-emerald-600 font-medium block">전량구매</span>
          <span className="text-emerald-500 tabular-nums text-[10px]">~${formatPrice(zones.full_buy_upper)}</span>
        </div>
        <div className="text-center">
          <span className="text-blue-600 font-medium block">적극매수</span>
          <span className="text-blue-500 tabular-nums text-[10px]">~${formatPrice(zones.active_buy_upper)}</span>
        </div>
        <div className="text-center">
          <span className="text-amber-600 font-medium block">모니터링</span>
          <span className="text-amber-500 tabular-nums text-[10px]">~${formatPrice(zones.monitoring_upper)}</span>
        </div>
        <div className="text-center">
          <span className="text-rose-600 font-medium block">최소매수</span>
          <span className="text-rose-500 tabular-nums text-[10px]">${formatPrice(zones.monitoring_upper)}~</span>
        </div>
      </div>

      {/* Gradient bar */}
      <div className="relative h-3 rounded-full overflow-hidden" style={{background: 'linear-gradient(to right, #10b981, #3b82f6, #f59e0b, #ef4444)'}}>
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
          style={{ left: `${Math.max(3, Math.min(97, currentPercent))}%` }}
        >
          <div className="w-5 h-5 bg-white rounded-full border-[3px] border-slate-800 shadow-lg" />
        </div>
      </div>
      <p className="text-xs text-slate-500 text-center">{data.zone_range}</p>

      {/* MA Stats */}
      <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-100">
        {[
          { label: '10일 이평', value: data.ma_positions.ma10, signal: data.ma_positions.ma10_signal },
          { label: '20일 이평', value: data.ma_positions.ma20, signal: data.ma_positions.ma20_signal },
          { label: '60일 이평', value: data.ma_positions.ma60, signal: data.ma_positions.ma60_signal },
        ].map((ma) => (
          <div key={ma.label}>
            <p className="text-xs text-slate-400 mb-1">{ma.label}</p>
            <p className="text-base font-bold text-slate-800 tabular-nums">{formatPrice(ma.value)}</p>
            <p className={`text-xs mt-0.5 ${ma.signal.includes('상회') ? 'text-emerald-500' : ma.signal.includes('하회') ? 'text-rose-500' : 'text-slate-400'}`}>
              {ma.signal}
            </p>
          </div>
        ))}
      </div>

      {/* Recommendation */}
      <div className="pt-4 border-t border-slate-100">
        <p className="text-xs text-slate-400 mb-1">권장사항</p>
        <p className="text-sm font-semibold text-slate-800">{data.recommendation}</p>
        <p className="text-xs text-slate-400 mt-1">신뢰도: {data.confidence}</p>
      </div>
    </div>
  );
};

const RecentPurchasesTable = ({ data, loading }: { data: (PurchaseItem | RecentPurchaseItem)[]; loading: boolean }) => {
  if (loading) return <Shimmer className="h-40" />;
  if (!data || data.length === 0) return <div className="card p-6 text-slate-500 text-sm">구매 데이터 없음</div>;

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">상품</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">선적월</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">공급사</th>
              <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">단가($/MT)</th>
              <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">수량(MT)</th>
              <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">금액(USD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                <td className="px-5 py-3.5 font-medium text-slate-800">{p.product}</td>
                <td className="px-5 py-3.5 tabular-nums text-slate-600">{p.shipment_month}</td>
                <td className="px-5 py-3.5 text-slate-600 text-xs">{p.supplier || '-'}</td>
                <td className="px-5 py-3.5 tabular-nums text-slate-800 text-right font-medium">{formatPrice(p.unit_price)}</td>
                <td className="px-5 py-3.5 tabular-nums text-slate-600 text-right">{formatNumber(p.qty_mt, 1)}</td>
                <td className="px-5 py-3.5 tabular-nums text-slate-700 text-right">{formatNumber(p.amount_usd, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const NewsCard = ({ news }: { news: NewsItem }) => {
  const colors: Record<string, string> = {
    '강세': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    '약세': 'bg-rose-50 text-rose-700 border-rose-200',
    '보합': 'bg-slate-50 text-slate-600 border-slate-200',
    '중립': 'bg-slate-50 text-slate-600 border-slate-200',
  };
  const style = colors[news.sentiment] || colors['중립'];

  return (
    <div className="card p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${style}`}>{news.sentiment}</span>
        <span className="text-xs text-slate-400">{new Date(news.date).toLocaleDateString('ko-KR')}</span>
      </div>
      <p className="text-sm text-slate-700 leading-relaxed line-clamp-3">{news.content}</p>
      <div className="flex items-center gap-2">
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          news.impact === 'High' ? 'bg-rose-50 text-rose-600' :
          news.impact === 'Medium' ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-500'
        }`}>
          영향: {news.impact}
        </span>
      </div>
    </div>
  );
};

// ============ EDITABLE CELL ============

const EditableCell = ({ value, onSave, format = 'number' }: {
  value: number;
  onSave: (newValue: number) => void;
  format?: 'number' | 'price';
}) => {
  const { canWrite } = useAuth();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    if (!canWrite) return;
    setEditValue(String(value));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 50);
  };

  const handleSave = () => {
    const parsed = parseFloat(editValue.replace(/,/g, ''));
    if (!isNaN(parsed) && parsed !== value) {
      onSave(parsed);
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className="w-full px-2 py-1 text-sm tabular-nums text-right border border-blue-300 rounded-lg bg-blue-50/50 text-slate-800"
        autoFocus
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      className="editable-cell inline-block w-full text-right tabular-nums cursor-pointer"
      title="클릭하여 편집"
    >
      {format === 'price' ? formatPrice(value) : formatNumber(value)}
    </span>
  );
};

// ============ TEXT EDITABLE CELL ============
const EditableTextCell = ({ value, onSave, placeholder = '' }: {
  value: string;
  onSave: (newValue: string) => void;
  placeholder?: string;
}) => {
  const { canWrite } = useAuth();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    if (!canWrite) return;
    setEditValue(value);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 50);
  };

  const handleSave = () => {
    if (editValue !== value) {
      onSave(editValue);
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-2 py-1 text-xs border border-blue-300 rounded-lg bg-blue-50/50 text-slate-800"
        autoFocus
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      className="editable-cell inline-block w-full text-xs text-slate-500 cursor-pointer"
      title="클릭하여 편집"
    >
      {value || <span className="text-slate-300">{placeholder || '—'}</span>}
    </span>
  );
};

// ============ DASHBOARD PREBUY TABLE ============

interface DashboardPrebuyMonth {
  shipment_month: string;
  rbd_qty: number; rbd_amount: number; rbd_effect_usd: number; rbd_effect_krw: number;
  rspo_qty: number; rspo_amount: number; rspo_effect_usd: number; rspo_effect_krw: number;
  managed_qty?: number; managed_amount?: number; managed_effect_usd?: number; managed_effect_krw?: number;
  total_qty: number; total_amount: number; effect_usd: number; effect_krw: number;
}

const DashboardPrebuyTable = ({ months, allMonths, defaultFrom, defaultTo, totalRecords }: {
  months: DashboardPrebuyMonth[]; allMonths: string[]; defaultFrom: string; defaultTo: string; totalRecords: number;
}) => {
  const [periodFrom, setPeriodFrom] = useState(defaultFrom);
  const [periodTo, setPeriodTo] = useState(defaultTo);

  const filtered = months.filter(m => m.shipment_month >= periodFrom && m.shipment_month <= periodTo);

  const rbdQty = filtered.reduce((s, m) => s + m.rbd_qty, 0);
  const rbdAmount = filtered.reduce((s, m) => s + m.rbd_amount, 0);
  const rbdEffectUsd = filtered.reduce((s, m) => s + m.rbd_effect_usd, 0);
  const rbdEffectKrw = filtered.reduce((s, m) => s + m.rbd_effect_krw, 0);

  const rspoQty = filtered.reduce((s, m) => s + m.rspo_qty, 0);
  const rspoAmount = filtered.reduce((s, m) => s + m.rspo_amount, 0);
  const rspoEffectUsd = filtered.reduce((s, m) => s + m.rspo_effect_usd, 0);
  const rspoEffectKrw = filtered.reduce((s, m) => s + m.rspo_effect_krw, 0);

  // 관리팜유 (Low 3-MCPD + Low GE + RSPO)
  const managedQty = filtered.reduce((s, m) => s + (m.managed_qty ?? 0), 0);
  const managedAmount = filtered.reduce((s, m) => s + (m.managed_amount ?? 0), 0);
  const managedEffectUsd = filtered.reduce((s, m) => s + (m.managed_effect_usd ?? 0), 0);
  const managedEffectKrw = filtered.reduce((s, m) => s + (m.managed_effect_krw ?? 0), 0);

  const totalQty = rbdQty + rspoQty + managedQty;
  const totalAmount = rbdAmount + rspoAmount + managedAmount;
  const totalEffectUsd = rbdEffectUsd + rspoEffectUsd + managedEffectUsd;
  const totalEffectKrw = rbdEffectKrw + rspoEffectKrw + managedEffectKrw;

  const fmtNum = (n: number) => n === 0 ? '-' : n.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  const fmtUsd = (n: number) => n === 0 ? '-' : `$${n.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
  const fmtKrw2 = (n: number) => {
    if (n === 0) return '-';
    const abs = Math.abs(n);
    if (abs >= 100000000) return `${n < 0 ? '-' : ''}₩${(abs / 100000000).toFixed(1)}억`;
    return `${n < 0 ? '-' : ''}₩${(abs / 1000000).toFixed(1)}M`;
  };

  const evalLabel = (usd: number) => usd > 0 ? '절감' : usd < 0 ? '초과' : '-';
  const evalColor = (usd: number) => usd > 0 ? 'text-emerald-600 font-semibold' : usd < 0 ? 'text-rose-500 font-semibold' : 'text-slate-400';

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">선구매 실적 ({periodFrom} ~ {periodTo})</h3>
        <div className="flex items-center gap-2 text-xs">
          <select value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} className="border border-slate-200 rounded px-2 py-1 text-xs">
            {allMonths.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="text-slate-400">~</span>
          <select value={periodTo} onChange={e => setPeriodTo(e.target.value)} className="border border-slate-200 rounded px-2 py-1 text-xs">
            {allMonths.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-3 py-2 text-left font-medium text-slate-500">구분</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">수량(MT)</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">계약금액(USD)</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">효과(USD)</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">효과(KRW)</th>
              <th className="px-3 py-2 text-center font-medium text-slate-500">평가</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-50 hover:bg-slate-50/50">
              <td className="px-3 py-2 font-medium text-slate-700">RBD Palm Oil</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(rbdQty)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(rbdAmount)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${evalColor(rbdEffectUsd)}`}>{fmtUsd(rbdEffectUsd)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${evalColor(rbdEffectUsd)}`}>{fmtKrw2(rbdEffectKrw)}</td>
              <td className={`px-3 py-2 text-center ${evalColor(rbdEffectUsd)}`}>{evalLabel(rbdEffectUsd)}</td>
            </tr>
            <tr className="border-b border-slate-50 hover:bg-slate-50/50">
              <td className="px-3 py-2 font-medium text-slate-700">RSPO(MB)</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(rspoQty)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(rspoAmount)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${evalColor(rspoEffectUsd)}`}>{fmtUsd(rspoEffectUsd)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${evalColor(rspoEffectUsd)}`}>{fmtKrw2(rspoEffectKrw)}</td>
              <td className={`px-3 py-2 text-center ${evalColor(rspoEffectUsd)}`}>{evalLabel(rspoEffectUsd)}</td>
            </tr>
            <tr className="border-b border-slate-50 hover:bg-slate-50/50">
              <td className="px-3 py-2 font-medium text-slate-700" title="Low 3-MCPD + Low GE + RSPO">
                관리팜유 <span className="text-[10px] text-slate-400">(Low 3-MCPD+GE+RSPO)</span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(managedQty)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(managedAmount)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${evalColor(managedEffectUsd)}`}>{fmtUsd(managedEffectUsd)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${evalColor(managedEffectUsd)}`}>{fmtKrw2(managedEffectKrw)}</td>
              <td className={`px-3 py-2 text-center ${evalColor(managedEffectUsd)}`}>{evalLabel(managedEffectUsd)}</td>
            </tr>
            <tr className="bg-slate-50/80 font-semibold">
              <td className="px-3 py-2 text-slate-800">합계</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(totalQty)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(totalAmount)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${evalColor(totalEffectUsd)}`}>{fmtUsd(totalEffectUsd)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${evalColor(totalEffectUsd)}`}>{fmtKrw2(totalEffectKrw)}</td>
              <td className={`px-3 py-2 text-center ${evalColor(totalEffectUsd)}`}>{evalLabel(totalEffectUsd)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-400 mt-1 text-right">총 {totalRecords}건 기준 · 건별 환율 적용 · 효과 = (시황가 × 물량 - 계약금액) × 환율</p>
    </div>
  );
};

// ============ TAB COMPONENTS ============

const DashboardTab = ({ data, loading, onNavigate }: { data: DashboardData | null; loading: boolean; onNavigate?: (tab: Tab) => void }) => {
  const [boxDetail, setBoxDetail] = useState<BoxRangeDetail | null>(null);
  const [selectedBoxMonth, setSelectedBoxMonth] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('dashboard_box_month') || '';
    return '';
  });
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  // Easter egg: AI 분석 숨김 (타이틀 5번 클릭 + 비밀번호)
  const [showAI, setShowAI] = useState(false);
  const [titleClicks, setTitleClicks] = useState(0);
  const [showPwModal, setShowPwModal] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const titleClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTitleClick = () => {
    const next = titleClicks + 1;
    setTitleClicks(next);
    if (titleClickTimer.current) clearTimeout(titleClickTimer.current);
    if (next >= 5) {
      setShowPwModal(true);
      setTitleClicks(0);
    } else {
      titleClickTimer.current = setTimeout(() => setTitleClicks(0), 2000);
    }
  };
  const handlePwSubmit = () => {
    if (pwInput === 'tlskqmfh12!@') {
      setShowAI(true);
      setShowPwModal(false);
      setPwInput('');
    } else {
      setPwInput('');
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalysisError('');
    try {
      const res = await fetch('/api/analyze', { method: 'POST' });
      const json = await res.json();
      if (json.error) {
        setAnalysisError(json.error);
      } else {
        setAnalysisResult(json);
      }
    } catch (err) {
      console.error('Analysis failed:', err);
      setAnalysisError('분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzing(false);
    }
  };

  // Set initial selected month from box_ranges (only if no saved preference)
  useEffect(() => {
    if (data?.box_ranges?.length && !selectedBoxMonth) {
      const saved = localStorage.getItem('dashboard_box_month');
      const validSaved = saved && data.box_ranges.some(b => b.contract_month === saved);
      setSelectedBoxMonth(validSaved ? saved : data.box_ranges[0].contract_month);
    }
  }, [data?.box_ranges]);

  // Save selection & fetch box detail when selected month changes
  useEffect(() => {
    if (!selectedBoxMonth) return;
    localStorage.setItem('dashboard_box_month', selectedBoxMonth);
    setBoxDetail(null);
    fetch(`/api/box-range?contract_month=${selectedBoxMonth}`)
      .then(r => r.json())
      .then(d => { if (d && !d.error) setBoxDetail(d); })
      .catch(() => {});
  }, [selectedBoxMonth]);

  const selectedBoxRange = data?.box_ranges?.find(b => b.contract_month === selectedBoxMonth) || data?.box_ranges?.[0];

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Shimmer className="h-20" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">{[...Array(4)].map((_, i) => <Shimmer key={i} className="h-28" />)}</div>
        <Shimmer className="h-80" />
      </div>
    );
  }

  if (!data) return <div className="text-slate-500 p-8 text-center">데이터를 불러오는 중입니다...</div>;

  const latestFCPO = data.fcpo_latest?.find(f => f.contract_month === '2026-04') || data.fcpo_latest?.[0];
  const rbd = data.inventory_summary?.find((x) => x.product === 'RBD');
  const rspo = data.inventory_summary?.find((x) => x.product === 'RSPO');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Password Modal for AI Easter Egg */}
      {showPwModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => { setShowPwModal(false); setPwInput(''); }}>
          <div className="bg-white rounded-xl p-6 shadow-xl w-80" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-slate-700 mb-3">🔐 인증이 필요합니다</p>
            <input
              type="password"
              value={pwInput}
              onChange={e => setPwInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePwSubmit()}
              placeholder="비밀번호 입력"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowPwModal(false); setPwInput(''); }} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700">취소</button>
              <button onClick={handlePwSubmit} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">확인</button>
            </div>
          </div>
        </div>
      )}

      {/* Alerts */}
      {data.alerts?.filter(a => a.alert_level !== 'normal').map((alert, idx) => (
        <AlertBanner key={idx} alert={alert}
          onAction={() => onNavigate?.(alert.product === 'RBD' || alert.product === 'RSPO' ? 'inventory' : 'purchases')}
        />
      ))}

      {/* Dashboard Title — 5 clicks triggers AI easter egg */}
      <p className="text-xs text-slate-400 select-none cursor-default" onClick={handleTitleClick}>
        대시보드
      </p>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <MetricCard label="FCPO 시황 (USD)" value={formatPrice(latestFCPO?.settlement_usd)} unit={`기준일: ${data.fcpo_latest_date || '-'}`} />
        <div className="card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-slate-500">박스권 위치</p>
            {data.box_ranges && data.box_ranges.length > 1 && (
              <select
                value={selectedBoxMonth}
                onChange={(e) => setSelectedBoxMonth(e.target.value)}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-200 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {data.box_ranges.map((br: any) => (
                  <option key={br.contract_month} value={br.contract_month}>
                    {br.contract_month}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className={`text-xl font-bold mt-1 ${
            selectedBoxRange?.zone === '전량구매' ? 'text-emerald-600' :
            selectedBoxRange?.zone === '적극구매' || selectedBoxRange?.zone === '적극매수' ? 'text-blue-600' :
            selectedBoxRange?.zone === '구매대기' ? 'text-rose-600' : 'text-slate-900'
          }`}>{selectedBoxRange?.zone || '-'}</p>
          <p className="text-[11px] text-slate-400 mt-1">{selectedBoxRange?.contract_month || ''} 기준</p>
        </div>
        <MetricCard label="RBD 재고" value={rbd ? `${(rbd.ending_stock / 1000).toFixed(0)}K` : '-'} unit={rbd ? `회전일 ${rbd.coverage_days}일` : ''} />
        <MetricCard label="RSPO 재고" value={rspo ? `${(rspo.ending_stock / 1000).toFixed(0)}K` : '-'} unit={rspo ? `회전일 ${rspo.coverage_days}일` : ''} />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 md:gap-6">
        <div className="lg:col-span-3">
          {boxDetail?.zones ? <BoxRangeGauge data={boxDetail} /> : <Shimmer className="h-80" />}
        </div>
        <div className="lg:col-span-2 space-y-5">
          {/* AI Analysis — hidden by default, unlocked via easter egg */}
          {showAI && <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full" />
                AI 시황 분석
              </h3>
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm flex items-center gap-1.5"
              >
                {analyzing && <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
                {analyzing ? '분석 중...' : '분석 실행'}
              </button>
            </div>

            {analysisError && (
              <div className="text-xs text-rose-500 bg-rose-50 rounded-lg p-2 mb-3">{analysisError}</div>
            )}

            {analysisResult ? (
              <div className="space-y-4 animate-fade-in">
                {/* Market Summary */}
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">시장 현황</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{analysisResult.market_summary}</p>
                </div>

                {/* Buy Recommendation */}
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs font-medium text-blue-600 mb-1">구매 의견</p>
                  <p className="text-sm text-blue-800 leading-relaxed">{analysisResult.buy_recommendation}</p>
                </div>

                {/* Monthly Strategy Table */}
                {analysisResult.monthly_strategy && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-2">월별 구매 전략</p>
                    <div className="space-y-2">
                      {analysisResult.monthly_strategy.map((m: any, i: number) => (
                        <div key={i} className={`rounded-lg p-3 border text-sm ${
                          m.action === '전량구매' ? 'bg-emerald-50 border-emerald-200' :
                          m.action === '적극매수' ? 'bg-blue-50 border-blue-200' :
                          m.action === '모니터링' ? 'bg-amber-50 border-amber-200' :
                          'bg-slate-50 border-slate-200'
                        }`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-slate-700">{m.month}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                              m.action === '전량구매' ? 'bg-emerald-100 text-emerald-700' :
                              m.action === '적극매수' ? 'bg-blue-100 text-blue-700' :
                              m.action === '모니터링' ? 'bg-amber-100 text-amber-700' :
                              'bg-slate-100 text-slate-600'
                            }`}>{m.action}</span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-slate-500">
                            <span>목표가: <b className="text-slate-700">${m.target_price}/MT</b></span>
                            <span>물량: <b className="text-slate-700">{m.volume_mt?.toLocaleString()}톤</b></span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">{m.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Risk Factors */}
                {analysisResult.risk_factors && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-1">리스크 요인</p>
                    <ul className="text-xs text-slate-600 space-y-1">
                      {analysisResult.risk_factors.map((r: string, i: number) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-rose-400 mt-0.5">⚠</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Action Items */}
                {analysisResult.action_items && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-1">조치사항</p>
                    <ul className="text-xs text-slate-600 space-y-1">
                      {analysisResult.action_items.map((a: string, i: number) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-blue-400 mt-0.5">→</span>
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Outlook */}
                {analysisResult.outlook && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs font-medium text-slate-500 mb-1">전망</p>
                    <p className="text-sm text-slate-600">{analysisResult.outlook}</p>
                  </div>
                )}
              </div>
            ) : !analyzing && (
              <p className="text-sm text-slate-400">상단의 &quot;분석 실행&quot; 버튼을 눌러 AI 시황 분석을 시작하세요.</p>
            )}
          </div>}

          {/* Recent News */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">최근 뉴스</h3>
            {data.recent_news?.length > 0 ? (
              data.recent_news.slice(0, 3).map((news) => <NewsCard key={news.id} news={news} />)
            ) : (
              <div className="card p-5 text-slate-400 text-sm text-center">
                뉴스 탭에서 시황 데이터를 입력하세요
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Prebuy Effect Summary — Table Format */}
      {data.prebuy_effect && data.prebuy_effect.months.length > 0 && (() => {
        const months = data.prebuy_effect!.months;
        const allMonths = months.map(m => m.shipment_month).sort();
        const defaultFrom = allMonths.length >= 3 ? allMonths[allMonths.length - 3] : allMonths[0];
        const defaultTo = allMonths[allMonths.length - 1];
        return <DashboardPrebuyTable months={months} allMonths={allMonths} defaultFrom={defaultFrom} defaultTo={defaultTo} totalRecords={data.prebuy_effect!.total_records} />;
      })()}

      {/* Recent Purchases */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">최근 구매 이력</h3>
        <RecentPurchasesTable data={data.recent_purchases || []} loading={false} />
      </div>

      {/* 팜유-대두유 스프레드 */}
      {data.oil_spread && <OilSpreadWidget data={data.oil_spread} onNavigate={onNavigate} />}

      {/* MPOB 시그널 — 재고/생산/수출 3 KPI 카드 + 자동 인사이트 */}
      {data.mpob_summary && data.mpob_summary.length > 0 && <MpobSignalCards rows={data.mpob_summary} onNavigate={onNavigate} />}
    </div>
  );
};

// ============ OIL SPREAD WIDGET ============
// 팜유(CPO) vs 대두유(SBO) 가격 비교 + 스프레드(대두유-팜유) 추이
const OilSpreadWidget = ({ data, onNavigate }: {
  data: { latest: OilSpreadPoint | null; prev: OilSpreadPoint | null; series: OilSpreadPoint[] };
  onNavigate?: (tab: Tab) => void;
}) => {
  const { latest, prev, series } = data;
  const fmt = (n: number | null | undefined) => n == null ? '—' : `$${Math.round(n).toLocaleString()}`;
  const spreadNow = latest?.spread ?? null;
  const spreadPrev = prev?.spread ?? null;
  const spreadChange = (spreadNow != null && spreadPrev != null) ? spreadNow - spreadPrev : null;

  // 차트용 데이터 (2025·2026 통합 날짜축, 최근 120포인트). 팜유·대두유는
  // 날짜가 안 맞아도 각자 있는 곳에 표시(점으로). 스프레드는 대두유 있는 날만.
  const chartData = series.slice(-120).map(p => ({
    date: p.date ?? '',
    팜유: p.palm,
    대두유: p.sbo,
    스프레드: p.spread,
  }));

  const signal = (() => {
    if (spreadNow == null) return '대두유 가격을 입력하면 스프레드가 계산됩니다.';
    if (spreadNow > 250) return `🔺 대두유 프리미엄 $${Math.round(spreadNow)} — 팜유 상대적 저평가, 팜유 수요 전환 유리`;
    if (spreadNow < 50) return `🔻 스프레드 $${Math.round(spreadNow)} 축소 — 팜유 가격 메리트 약화`;
    return `━ 스프레드 $${Math.round(spreadNow)} — 통상 범위`;
  })();

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <span className="w-2 h-2 bg-amber-500 rounded-full" />
          팜유 · 대두유 스프레드
        </h3>
        {onNavigate && <button onClick={() => onNavigate('fcpo')} className="text-xs text-blue-600 hover:underline">가격 입력 →</button>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
        <div className="card p-4">
          <div className="text-xs text-slate-500 mb-1" title="MYPO RBD PALM OIL ASK(USD/MT) 최근월. 대두유 날짜에 맞춰 as-of 매칭">팜유 (FCPO 최근월)</div>
          <div className="text-xl font-bold text-slate-800 tabular-nums">{fmt(latest?.palm)}<span className="text-xs font-normal text-slate-400 ml-1">/MT</span></div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500 mb-1">대두유 (CBOT)</div>
          <div className="text-xl font-bold text-slate-800 tabular-nums">{fmt(latest?.sbo)}<span className="text-xs font-normal text-slate-400 ml-1">/MT</span></div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500 mb-1">스프레드 (대두유-팜유)</div>
          <div className="text-xl font-bold text-amber-600 tabular-nums">{fmt(spreadNow)}
            {spreadChange != null && (
              <span className={`text-xs font-medium ml-1.5 ${spreadChange >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                {spreadChange >= 0 ? '▲' : '▼'}{Math.abs(Math.round(spreadChange))}
              </span>
            )}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500 mb-1">기준일</div>
          <div className="text-base font-semibold text-slate-700 tabular-nums">{latest?.date ?? '—'}</div>
        </div>
      </div>

      {chartData.length >= 2 && (
        <div className="card p-4">
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="price" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
              <YAxis yAxisId="spread" orientation="right" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="spread" dataKey="스프레드" fill="#fde68a" />
              <Line yAxisId="price" type="monotone" dataKey="팜유" stroke="#d97706" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              <Line yAxisId="price" type="monotone" dataKey="대두유" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card p-3 bg-amber-50/40 border-amber-100 mt-3">
        <div className="flex items-start gap-2">
          <span className="text-base">💡</span>
          <p className="text-xs text-slate-700 leading-relaxed">{signal}</p>
        </div>
      </div>
    </div>
  );
};

// ============ MPOB SIGNAL CARDS ============
// 재고/생산/수출 3개 카테고리의 RBD 3종 합계를 YoY 와 함께 표시 + 룰 기반 자동 시그널 메시지

const MpobSignalCards = ({ rows, onNavigate }: { rows: MpobSummaryRow[]; onNavigate?: (tab: Tab) => void }) => {
  // RBD 3종만 (RBD PALM OIL + OLEIN + STEARIN) 합산 — 말레이시아 정제팜유 합계로 시장 시그널 잡기
  const ITEMS = ['RBD PALM OIL', 'RBD PALM OLEIN', 'RBD PALM STEARIN'];

  // 카테고리별 최신월 합계 + 전년 동월 합계
  function aggregate(category: string) {
    const byYearMonth = new Map<string, number>(); // 'YYYY-MM' → sum of 3 items
    for (const r of rows) {
      if (r.category !== category || !ITEMS.includes(r.item_name) || r.value == null) continue;
      const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
      byYearMonth.set(key, (byYearMonth.get(key) || 0) + Number(r.value));
    }
    const keys = [...byYearMonth.keys()].sort();
    if (keys.length === 0) return null;
    const latestKey = keys[keys.length - 1];
    const [ly, lm] = latestKey.split('-').map(Number);
    const latestValue = byYearMonth.get(latestKey)!;
    const prevKey = `${ly - 1}-${String(lm).padStart(2, '0')}`;
    const prevValue = byYearMonth.get(prevKey) ?? null;
    const yoy = prevValue ? ((latestValue - prevValue) / prevValue) * 100 : null;
    return { latestKey, latestValue, prevValue, yoy };
  }

  const stock = aggregate('stock');
  const production = aggregate('production');
  // 수출은 'MALAYSIA' 단일 항목 (port 카테고리에서)
  const exportAgg = (() => {
    const byKey = new Map<string, number>();
    for (const r of rows) {
      if (r.category !== 'export_port' || r.item_name !== 'MALAYSIA' || r.value == null) continue;
      const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
      byKey.set(key, Number(r.value));
    }
    const keys = [...byKey.keys()].sort();
    if (keys.length === 0) return null;
    const latestKey = keys[keys.length - 1];
    const [ly, lm] = latestKey.split('-').map(Number);
    const latestValue = byKey.get(latestKey)!;
    const prevKey = `${ly - 1}-${String(lm).padStart(2, '0')}`;
    const prevValue = byKey.get(prevKey) ?? null;
    const yoy = prevValue ? ((latestValue - prevValue) / prevValue) * 100 : null;
    return { latestKey, latestValue, prevValue, yoy };
  })();

  const fmtT = (n: number | null | undefined) => n == null ? '—' : `${(n / 1000).toFixed(0)}K`;
  const fmtPct = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
  const arrow = (n: number | null) => {
    if (n == null) return '';
    if (n >= 15) return '↑↑';
    if (n >= 0) return '↑';
    if (n >= -15) return '↓';
    return '↓↓';
  };
  const colorClass = (n: number | null, inverse = false) => {
    if (n == null) return 'text-slate-400';
    // inverse=true: 재고는 늘면 약세(빨강), 줄면 강세(녹색)
    const isPositive = n >= 0;
    if (inverse) return isPositive ? 'text-rose-600' : 'text-emerald-600';
    return isPositive ? 'text-emerald-600' : 'text-rose-600';
  };
  const statusLabel = (yoy: number | null, type: 'stock' | 'production' | 'export') => {
    if (yoy == null) return '데이터 부족';
    if (type === 'stock') {
      if (yoy >= 15) return '높음 (약세 압력)';
      if (yoy >= 5) return '평년 수준';
      if (yoy >= -5) return '균형';
      return '낮음 (강세 압력)';
    }
    if (type === 'production') {
      if (yoy >= 10) return '증산 ↑';
      if (yoy >= -5) return '정상';
      return '감산 ↓';
    }
    // export
    if (yoy >= 5) return '견고';
    if (yoy >= -10) return '횡보';
    return '부진';
  };
  const monthLabel = (key: string | undefined) => {
    if (!key) return '';
    const [y, m] = key.split('-');
    return `${y}-${m}`;
  };

  // 자동 시그널 메시지 (룰 기반)
  function generateSignal(): string {
    const ss = stock?.yoy ?? null;
    const ee = exportAgg?.yoy ?? null;
    const pp = production?.yoy ?? null;
    const parts: string[] = [];

    if (ss != null && ee != null) {
      if (ss >= 10 && ee <= -5) parts.push('🔻 재고 증가 + 수출 부진 → 공급과잉 신호 (하방 압력)');
      else if (ss <= -10 && ee >= 5) parts.push('🔺 재고 감소 + 수출 견고 → 타이트 (상방 압력)');
      else if (Math.abs(ss) < 5 && Math.abs(ee) < 5) parts.push('━ 재고·수출 모두 안정 균형');
      else if (ss >= 10) parts.push('📦 재고 누적 — 단기 약세 압력');
      else if (ss <= -10) parts.push('📉 재고 감소 — 단기 강세 압력');
    } else if (ss != null) {
      if (ss >= 10) parts.push('📦 재고 누적 — 단기 약세 압력');
      else if (ss <= -10) parts.push('📉 재고 감소 — 단기 강세 압력');
    }
    if (pp != null) {
      if (pp >= 10) parts.push(`생산 +${pp.toFixed(0)}% (증산기)`);
      else if (pp <= -10) parts.push(`생산 ${pp.toFixed(0)}% (감산기)`);
    }
    return parts.length > 0 ? parts.join('. ') + '.' : '데이터 누적 중 — 추세 판단 보류.';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-500 rounded-full" />
          MPOB 시그널 (말레이시아 수급)
        </h3>
        {onNavigate && (
          <button onClick={() => onNavigate('mpob')} className="text-xs text-blue-600 hover:underline">
            상세 →
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        {/* 재고 카드 */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">📦 재고 ({monthLabel(stock?.latestKey)})</span>
            <span className={`text-xs font-semibold ${colorClass(stock?.yoy ?? null, true)}`}>
              {fmtPct(stock?.yoy ?? null)} {arrow(stock?.yoy ?? null)}
            </span>
          </div>
          <div className="text-2xl font-bold text-slate-800 tabular-nums">{fmtT(stock?.latestValue)}<span className="text-sm font-normal text-slate-400 ml-1">톤</span></div>
          <div className="text-[11px] text-slate-500 mt-1">RBD 3종 합계</div>
          <div className={`text-xs font-medium mt-2 ${colorClass(stock?.yoy ?? null, true)}`}>{statusLabel(stock?.yoy ?? null, 'stock')}</div>
        </div>

        {/* 생산 카드 */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">🏭 생산 ({monthLabel(production?.latestKey)})</span>
            <span className={`text-xs font-semibold ${colorClass(production?.yoy ?? null)}`}>
              {fmtPct(production?.yoy ?? null)} {arrow(production?.yoy ?? null)}
            </span>
          </div>
          <div className="text-2xl font-bold text-slate-800 tabular-nums">{fmtT(production?.latestValue)}<span className="text-sm font-normal text-slate-400 ml-1">톤</span></div>
          <div className="text-[11px] text-slate-500 mt-1">RBD 3종 합계</div>
          <div className={`text-xs font-medium mt-2 ${colorClass(production?.yoy ?? null)}`}>{statusLabel(production?.yoy ?? null, 'production')}</div>
        </div>

        {/* 수출 카드 */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">🚢 수출 ({monthLabel(exportAgg?.latestKey)})</span>
            <span className={`text-xs font-semibold ${colorClass(exportAgg?.yoy ?? null)}`}>
              {fmtPct(exportAgg?.yoy ?? null)} {arrow(exportAgg?.yoy ?? null)}
            </span>
          </div>
          <div className="text-2xl font-bold text-slate-800 tabular-nums">{fmtT(exportAgg?.latestValue)}<span className="text-sm font-normal text-slate-400 ml-1">톤</span></div>
          <div className="text-[11px] text-slate-500 mt-1">말레이시아 전체</div>
          <div className={`text-xs font-medium mt-2 ${colorClass(exportAgg?.yoy ?? null)}`}>{statusLabel(exportAgg?.yoy ?? null, 'export')}</div>
        </div>
      </div>

      {/* 자동 시그널 메시지 */}
      <div className="card p-3 bg-amber-50/40 border-amber-100">
        <div className="flex items-start gap-2">
          <span className="text-base">💡</span>
          <p className="text-xs text-slate-700 leading-relaxed">{generateSignal()}</p>
        </div>
      </div>
    </div>
  );
};

const FCPOTab = () => {
  const { canWrite } = useAuth();
  const [fcpoData, setFcpoData] = useState<any[]>([]);
  const [contractMonths, setContractMonths] = useState<string[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [localLoading, setLocalLoading] = useState(false);

  // Manual input state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPrice, setNewPrice] = useState({ date: '', contract_month: '', settlement_usd: '', settlement_myr: '', exchange_rate: '' });
  const [bmdBatchResults, setBmdBatchResults] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  // BMD 텍스트 일괄 입력 (5/20 형식 자동 매핑)
  const [showBmdText, setShowBmdText] = useState(false);
  const [bmdText, setBmdText] = useState('');
  const [bmdTextYear, setBmdTextYear] = useState<number>(new Date().getFullYear());
  const [bmdTextPreview, setBmdTextPreview] = useState<any>(null);
  const [bmdTextSaving, setBmdTextSaving] = useState(false);
  const [bmdTextMessage, setBmdTextMessage] = useState('');

  // 대두유/식물유 가격 입력
  const [showSbo, setShowSbo] = useState(false);
  const [sboDate, setSboDate] = useState('');
  const [sboPrice, setSboPrice] = useState('');
  const [sboUnit, setSboUnit] = useState<'cents/lb' | 'USD/MT'>('cents/lb');
  const [sboCommodity, setSboCommodity] = useState('SBO');
  const [sboMsg, setSboMsg] = useState('');
  const [sboSaving, setSboSaving] = useState(false);

  const handleSboSave = async () => {
    if (!sboDate || !sboPrice) return;
    setSboSaving(true); setSboMsg('');
    try {
      const res = await fetch('/api/oil-prices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: sboDate, commodity: sboCommodity, price_native: parseFloat(sboPrice), unit_native: sboUnit }),
      });
      const json = await res.json();
      if (json.success) { setSboMsg(`저장 완료 ($${Math.round(json.price_usd_mt)}/MT)`); setSboPrice(''); }
      else setSboMsg(`실패: ${json.error}`);
    } catch (e: any) { setSboMsg(`오류: ${e.message}`); }
    finally { setSboSaving(false); }
  };

  // BMD PDF upload state
  const [bmdUploading, setBmdUploading] = useState(false);
  const [bmdResult, setBmdResult] = useState<any>(null);
  const [bmdSaving, setBmdSaving] = useState(false);
  const [bmdMessage, setBmdMessage] = useState('');
  const bmdFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchFCPOData(); }, []);

  const fetchFCPOData = async () => {
    setLocalLoading(true);
    try {
      const res = await fetch('/api/fcpo');
      const json: FCPOData = await res.json();
      setFcpoData(json.data || []);
      const months = json.contract_months || [];
      // 2024년 이후 계약월 전체 표시 (2024-01 ~ 2026-12)
      const availableMonths = months.filter((m: string) => m >= '2024-01');
      setContractMonths(availableMonths);
      // 기본 선택: 2026년 전체 월 (1~12월)
      const defaultSelected = availableMonths.filter((m: string) => m >= '2026-01' && m <= '2026-12');
      setSelectedMonths(defaultSelected.length > 0 ? defaultSelected : availableMonths.slice(-6));
    } catch (error) {
      console.error('Failed to fetch FCPO data:', error);
    } finally {
      setLocalLoading(false);
    }
  };

  // BMD PDF 업로드 핸들러 (단일/대량 겸용)
  const handleBmdUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setBmdUploading(true);
    setBmdResult(null);
    setBmdBatchResults([]);
    setBmdMessage('');

    const results: any[] = [];
    let totalRecords = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setBmdMessage(`(${i + 1}/${files.length}) ${file.name} 분석 중...`);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/bmd/parse-pdf', { method: 'POST', body: formData });
        const json = await res.json();
        if (json.success) {
          results.push({ ...json, filename: file.name });
          totalRecords += json.rbd_palm_oil?.length || 0;
        } else {
          results.push({ success: false, filename: file.name, error: json.error });
          failCount++;
        }
      } catch {
        results.push({ success: false, filename: file.name, error: '업로드 오류' });
        failCount++;
      }
    }

    if (files.length === 1 && results[0]?.success) {
      // 단일 파일: 기존 미리보기 유지
      setBmdResult(results[0]);
      const warnSuffix = results[0].warnings?.length ? ` (경고 ${results[0].warnings.length}건)` : '';
      setBmdMessage(`${results[0].report_date} BMD 데이터: RBD Palm Oil ${results[0].rbd_palm_oil?.length || 0}건${warnSuffix}`);
    } else {
      // 대량: 배치 결과 리스트
      setBmdBatchResults(results);
      const successCount = results.length - failCount;
      setBmdMessage(`${results.length}개 파일 처리 완료: 성공 ${successCount}건 (${totalRecords}개 레코드)${failCount > 0 ? `, 실패 ${failCount}건` : ''}`);
    }

    setBmdUploading(false);
    if (bmdFileRef.current) bmdFileRef.current.value = '';
  };

  // BMD 데이터를 FCPO 테이블에 저장 (단일)
  const handleBmdSave = async () => {
    if (!bmdResult) return;
    setBmdSaving(true);
    try {
      const saved = await saveBmdParsedResult(bmdResult);
      setBmdMessage(`${saved}건 저장 완료`);
      setBmdResult(null);
      fetchFCPOData();
      setTimeout(() => setBmdMessage(''), 3000);
    } catch {
      setBmdMessage('저장 중 오류 발생');
    } finally {
      setBmdSaving(false);
    }
  };

  // BMD 대량 저장
  const handleBmdBatchSave = async () => {
    const successResults = bmdBatchResults.filter((r) => r.success);
    if (successResults.length === 0) return;
    setBmdSaving(true);
    let totalSaved = 0;
    try {
      for (const result of successResults) {
        const saved = await saveBmdParsedResult(result);
        totalSaved += saved;
      }
      setBmdMessage(`${successResults.length}개 파일, 총 ${totalSaved}건 저장 완료`);
      setBmdBatchResults([]);
      fetchFCPOData();
      setTimeout(() => setBmdMessage(''), 5000);
    } catch {
      setBmdMessage(`저장 중 오류 (${totalSaved}건까지 저장됨)`);
    } finally {
      setBmdSaving(false);
    }
  };

  // 공통: 파싱 결과 하나를 FCPO 테이블에 저장
  const saveBmdParsedResult = async (result: any): Promise<number> => {
    const date = result.report_date;
    const exchangeRate = result.exchange_rate;
    let saved = 0;
    for (const item of (result.rbd_palm_oil || [])) {
      await fetch('/api/fcpo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          contract_month: item.contract_month,
          settlement_usd: item.ask,
          settlement_myr: exchangeRate ? Math.round(item.ask * exchangeRate * 100) / 100 : null,
          exchange_rate: exchangeRate,
          source: 'bmd_pdf_rbd',
        }),
      });
      saved++;
    }
    return saved;
  };

  const handleAddPrice = async () => {
    if (!newPrice.date || !newPrice.contract_month || !newPrice.settlement_usd) return;
    setSaving(true);
    try {
      const res = await fetch('/api/fcpo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: newPrice.date,
          contract_month: newPrice.contract_month,
          settlement_usd: parseFloat(newPrice.settlement_usd),
          settlement_myr: newPrice.settlement_myr ? parseFloat(newPrice.settlement_myr) : null,
          exchange_rate: newPrice.exchange_rate ? parseFloat(newPrice.exchange_rate) : null,
          source: 'manual',
        }),
      });
      if (res.ok) {
        setShowAddForm(false);
        setNewPrice({ date: '', contract_month: '', settlement_usd: '', settlement_myr: '', exchange_rate: '' });
        fetchFCPOData();
      }
    } catch (error) {
      console.error('Failed to add price:', error);
    } finally {
      setSaving(false);
    }
  };

  // BMD 텍스트 → 파싱 미리보기
  const handleBmdTextPreview = async () => {
    if (!bmdText.trim()) return;
    setBmdTextMessage('');
    setBmdTextPreview(null);
    try {
      const res = await fetch('/api/fcpo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'bmd_text', text: bmdText, year_hint: bmdTextYear, preview: true }),
      });
      const json = await res.json();
      if (json.preview) {
        setBmdTextPreview(json);
        setBmdTextMessage(`${json.records.length}건 파싱됨 (${json.summary.days} 거래일${json.errors.length ? `, 경고 ${json.errors.length}건` : ''})`);
      } else {
        setBmdTextMessage(`파싱 실패: ${json.error || '알 수 없는 오류'}`);
      }
    } catch (e: any) {
      setBmdTextMessage(`오류: ${e.message}`);
    }
  };

  // BMD 텍스트 → 일괄 적용
  const handleBmdTextApply = async () => {
    if (!bmdText.trim()) return;
    setBmdTextSaving(true);
    try {
      const res = await fetch('/api/fcpo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'bmd_text', text: bmdText, year_hint: bmdTextYear }),
      });
      const json = await res.json();
      if (json.success) {
        setBmdTextMessage(`${json.applied}건 저장 완료${json.errors?.length ? ` (경고 ${json.errors.length}건)` : ''}`);
        setBmdText('');
        setBmdTextPreview(null);
        fetchFCPOData();
        setTimeout(() => {
          setShowBmdText(false);
          setBmdTextMessage('');
        }, 2000);
      } else {
        setBmdTextMessage(`저장 실패: ${json.error || '알 수 없는 오류'}`);
      }
    } catch (e: any) {
      setBmdTextMessage(`오류: ${e.message}`);
    } finally {
      setBmdTextSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-800">FCPO 가격 추이</h2>
          <div className="flex gap-2 flex-wrap">
            {canWrite && (
            <>
            <div className="relative">
              <input ref={bmdFileRef} type="file" accept=".pdf" multiple onChange={handleBmdUpload} className="hidden" />
              <button
                onClick={() => bmdFileRef.current?.click()}
                disabled={bmdUploading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                {bmdUploading ? 'BMD PDF 분석 중...' : 'BMD PDF 업로드 (복수 선택 가능)'}
              </button>
            </div>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm ${
                showAddForm ? 'bg-slate-200 text-slate-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              {showAddForm ? '취소' : '+ 수동 입력'}
            </button>
            <button
              onClick={() => { setShowBmdText(!showBmdText); setBmdTextPreview(null); setBmdTextMessage(''); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm ${
                showBmdText ? 'bg-slate-200 text-slate-700' : 'bg-amber-600 text-white hover:bg-amber-700'
              }`}
              title="거래일별 오전/오후 BMD 텍스트를 붙여넣어 자동 매핑"
            >
              {showBmdText ? '취소' : '+ BMD 텍스트 일괄'}
            </button>
            <button
              onClick={() => { setShowSbo(!showSbo); setSboMsg(''); if (!sboDate) setSboDate(new Date().toISOString().slice(0, 10)); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm ${
                showSbo ? 'bg-slate-200 text-slate-700' : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
              title="대두유 등 경쟁 식물유 가격 입력 (팜유 스프레드 자동 계산)"
            >
              {showSbo ? '취소' : '+ 대두유 가격'}
            </button>
            </>
            )}
            <button onClick={fetchFCPOData} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors">
              새로고침
            </button>
          </div>
        </div>

        {/* 대두유/식물유 가격 입력 */}
        {showSbo && (
          <div className="mb-4 p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 space-y-3 animate-fade-in">
            <p className="text-sm font-semibold text-slate-700">대두유 · 식물유 가격 입력</p>
            <p className="text-xs text-slate-500">KoreaPDS 등에서 본 대두유(CBOT) 종가를 입력하면 대시보드에 팜유-대두유 스프레드가 자동 계산됩니다.</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">날짜 *</label>
                <input type="date" value={sboDate} onChange={e => setSboDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">품목</label>
                <select value={sboCommodity} onChange={e => setSboCommodity(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                  <option value="SBO">대두유 (CBOT)</option>
                  <option value="SUN">해바라기유</option>
                  <option value="RAPE">유채유</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">가격 *</label>
                <input type="number" step="0.01" placeholder="74.28" value={sboPrice} onChange={e => setSboPrice(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">단위</label>
                <select value={sboUnit} onChange={e => setSboUnit(e.target.value as any)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                  <option value="cents/lb">¢/lb (CBOT)</option>
                  <option value="USD/MT">USD/MT</option>
                </select>
              </div>
              <div className="flex items-end">
                <button onClick={handleSboSave} disabled={sboSaving || !sboDate || !sboPrice} className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors">
                  {sboSaving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
            {sboMsg && <span className={`text-xs px-3 py-1.5 rounded-full ${sboMsg.includes('완료') ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{sboMsg}</span>}
            <p className="text-[11px] text-slate-400">예: 대두유 CBOT 74.28¢/lb → ${'{'}74.28 × 22.05{'}'} ≈ $1,638/MT 자동 환산</p>
          </div>
        )}

        {/* Manual Price Input Form */}
        {showAddForm && (
          <div className="mb-4 p-4 bg-blue-50/50 rounded-xl border border-blue-100 space-y-3 animate-fade-in">
            <p className="text-sm font-semibold text-slate-700">FCPO 가격 수동 입력</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">날짜 *</label>
                <input
                  type="date"
                  value={newPrice.date}
                  onChange={(e) => setNewPrice({ ...newPrice, date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">계약월 *</label>
                <input
                  type="month"
                  value={newPrice.contract_month}
                  onChange={(e) => setNewPrice({ ...newPrice, contract_month: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">ASK (USD/MT) *</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="1087.5"
                  value={newPrice.settlement_usd}
                  onChange={(e) => setNewPrice({ ...newPrice, settlement_usd: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">MYR (선택)</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="미입력 시 빈칸"
                  value={newPrice.settlement_myr}
                  onChange={(e) => setNewPrice({ ...newPrice, settlement_myr: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">환율 (선택)</label>
                <input
                  type="number"
                  step="0.001"
                  placeholder="4.29"
                  value={newPrice.exchange_rate}
                  onChange={(e) => setNewPrice({ ...newPrice, exchange_rate: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleAddPrice}
                disabled={saving || !newPrice.date || !newPrice.contract_month || !newPrice.settlement_usd}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        )}

        {/* BMD 텍스트 일괄 입력 (자동 매핑) */}
        {showBmdText && (
          <div className="mb-4 p-4 bg-amber-50/50 rounded-xl border border-amber-100 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">BMD 텍스트 일괄 입력</p>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">연도</label>
                <input
                  type="number"
                  value={bmdTextYear}
                  onChange={(e) => setBmdTextYear(parseInt(e.target.value) || 2026)}
                  className="w-20 px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              아래 형식 그대로 붙여넣으세요. 오전+오후가 모두 있으면 오후(마감가)가 우선 저장됩니다.
            </p>
            <pre className="text-[10px] bg-white border border-slate-200 rounded-lg p-2 overflow-x-auto text-slate-500">
{`5/20 (수)  오전: BMD +88 | Jun 1,207.50 / 4,628 / +88 | Jul 1,207.50 / 4,662 / +91 | Aug 1,207.50 / 4,673 / +88 오후: BMD -2 | Jun 1,190.00 / 4,515 / -25 | Jul 1,190.00 / 4,555 / -16 | Aug 1,190.00 / 4,583 / -2
5/21 (목)  오전: BMD -55 | Jun 1,175.00 / 4,465 / -50 | ... 오후: BMD -126 | Jun 1,162.50 / 4,403 / -112 | ...`}
            </pre>
            <textarea
              value={bmdText}
              onChange={(e) => { setBmdText(e.target.value); setBmdTextPreview(null); }}
              placeholder="5/20 (수)  오전: BMD +88 | Jun 1,207.50 / 4,628 / +88 ..."
              className="w-full h-40 px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-white resize-y"
            />
            <div className="flex justify-between items-center">
              <p className="text-xs text-amber-700">{bmdTextMessage}</p>
              <div className="flex gap-2">
                <button
                  onClick={handleBmdTextPreview}
                  disabled={!bmdText.trim() || bmdTextSaving}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 disabled:opacity-40 transition-colors"
                >
                  미리보기
                </button>
                <button
                  onClick={handleBmdTextApply}
                  disabled={!bmdText.trim() || bmdTextSaving}
                  className="px-5 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-40 transition-colors shadow-sm"
                >
                  {bmdTextSaving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
            {bmdTextPreview && bmdTextPreview.records && bmdTextPreview.records.length > 0 && (
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                  파싱 결과 미리보기 ({bmdTextPreview.records.length}건)
                </div>
                <div className="overflow-x-auto max-h-64">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-1.5 text-left text-slate-500">날짜</th>
                        <th className="px-3 py-1.5 text-left text-slate-500">월물</th>
                        <th className="px-3 py-1.5 text-right text-slate-500">USD</th>
                        <th className="px-3 py-1.5 text-right text-slate-500">MYR</th>
                        <th className="px-3 py-1.5 text-right text-slate-500">환율</th>
                        <th className="px-3 py-1.5 text-center text-slate-500">세션</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {bmdTextPreview.records.map((r: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50/60">
                          <td className="px-3 py-1.5 tabular-nums">{r.date}</td>
                          <td className="px-3 py-1.5">{r.contract_month}</td>
                          <td className="px-3 py-1.5 tabular-nums text-right">{r.settlement_usd}</td>
                          <td className="px-3 py-1.5 tabular-nums text-right">{r.settlement_myr}</td>
                          <td className="px-3 py-1.5 tabular-nums text-right">{r.exchange_rate}</td>
                          <td className="px-3 py-1.5 text-center">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.session === 'pm' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                              {r.session === 'pm' ? '오후(마감)' : '오전(장중)'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* BMD PDF 파싱 결과 미리보기 */}
        {bmdMessage && !bmdResult && (
          <div className={`text-xs px-3 py-2 rounded-lg ${bmdMessage.includes('실패') || bmdMessage.includes('오류') ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}>
            {bmdMessage}
          </div>
        )}

        {bmdResult && (
          <div className="card p-4 border-blue-200 bg-blue-50/30 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">BMD PDF 파싱 결과</p>
                <p className="text-xs text-slate-500">날짜: {bmdResult.report_date} · 환율: {bmdResult.exchange_rate} MYR/USD</p>
              </div>
              <div className="flex gap-2">
                <button onClick={handleBmdSave} disabled={bmdSaving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                  {bmdSaving && <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
                  FCPO 테이블에 저장
                </button>
                <button onClick={() => { setBmdResult(null); setBmdMessage(''); }}
                  className="px-3 py-2 bg-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-300">
                  취소
                </button>
              </div>
            </div>

            {/* 파싱 경고 (RIC 누락 등) */}
            {bmdResult.warnings?.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-2">
                {bmdResult.warnings.map((w: string, i: number) => (
                  <p key={i} className="text-xs text-amber-800">⚠ {w}</p>
                ))}
              </div>
            )}

            {/* RBD Palm Oil */}
            {bmdResult.rbd_palm_oil?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-blue-700 mb-1">
                  RBD PALM OIL (USD/MT) — ASK · {bmdResult.rbd_palm_oil.length}건
                </p>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {bmdResult.rbd_palm_oil.map((item: any, i: number) => (
                    <div key={i} className="bg-white rounded-lg p-2 border border-blue-200 text-center">
                      <p className="text-[10px] text-slate-500">{item.contract_month}</p>
                      <p className="text-sm font-bold text-blue-800">${item.ask}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {/* BMD 대량 업로드 결과 */}
        {bmdBatchResults.length > 0 && (
          <div className="card p-4 border-blue-200 bg-blue-50/30 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">BMD PDF 대량 파싱 결과</p>
                <p className="text-xs text-slate-500">
                  {bmdBatchResults.filter((r) => r.success).length}개 성공 ·{' '}
                  {bmdBatchResults.filter((r) => !r.success).length > 0 &&
                    <span className="text-rose-600">{bmdBatchResults.filter((r) => !r.success).length}개 실패 · </span>
                  }
                  총 {bmdBatchResults.filter((r) => r.success).reduce((sum: number, r: any) => sum + (r.rbd_palm_oil?.length || 0), 0)}개 레코드
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={handleBmdBatchSave} disabled={bmdSaving || bmdBatchResults.filter((r) => r.success).length === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                  {bmdSaving && <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
                  전체 저장 ({bmdBatchResults.filter((r) => r.success).reduce((sum: number, r: any) => sum + (r.rbd_palm_oil?.length || 0), 0)}건)
                </button>
                <button onClick={() => { setBmdBatchResults([]); setBmdMessage(''); }}
                  className="px-3 py-2 bg-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-300">
                  취소
                </button>
              </div>
            </div>

            {/* 파일별 결과 */}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {bmdBatchResults.map((r: any, idx: number) => (
                <div key={idx} className={`rounded-lg p-3 border ${r.success ? 'bg-white border-blue-200' : 'bg-rose-50 border-rose-200'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-slate-700">{r.filename}</p>
                    {r.success ? (
                      <span className="text-[10px] text-emerald-600 font-medium">
                        {r.report_date} · {r.rbd_palm_oil?.length || 0}건
                      </span>
                    ) : (
                      <span className="text-[10px] text-rose-600 font-medium">실패: {r.error}</span>
                    )}
                  </div>
                  {r.success && r.rbd_palm_oil?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.rbd_palm_oil.map((item: any, i: number) => (
                        <span key={i} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">
                          {item.contract_month} ${item.ask}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.warnings?.length > 0 && (
                    <p className="text-[10px] text-amber-700 mt-1">⚠ {r.warnings.join('; ')}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Month Selector */}
        <div className="flex flex-wrap gap-2">
          {contractMonths.map((month) => (
            <button
              key={month}
              onClick={() =>
                setSelectedMonths((prev) =>
                  prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month]
                )
              }
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                selectedMonths.includes(month)
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {month}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="card p-6">
        {localLoading ? <Shimmer className="h-80" /> : fcpoData.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-12">데이터 없음</p>
        ) : (
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={[...fcpoData].filter((row) => selectedMonths.some((month) => row[`${month}_usd`])).reverse()}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" stroke="#94a3b8" style={{ fontSize: '11px' }} />
              <YAxis stroke="#94a3b8" style={{ fontSize: '11px' }} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(255,255,255,0.96)',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              {selectedMonths.map((month, idx) => {
                const colors = ['#2563eb', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#d946ef', '#ea580c', '#65a30d', '#0891b2', '#7c3aed', '#be123c'];
                return (
                  <Line key={month} type="monotone" dataKey={`${month}_usd`} stroke={colors[idx % colors.length]} strokeWidth={2} dot={false} name={`${month} USD`} connectNulls />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Data Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">날짜</th>
                {selectedMonths.map((month) => (
                  <th key={month} className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">{month}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fcpoData
                .filter((row) => selectedMonths.some((month) => row[`${month}_usd`]))
                .map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3 font-medium text-slate-700 text-sm whitespace-nowrap">{row.date}</td>
                  {selectedMonths.map((month) => (
                    <td key={month} className="px-5 py-3 tabular-nums text-slate-600 text-right text-sm">
                      {row[`${month}_usd`] ? formatPrice(row[`${month}_usd`]) : '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

interface AutofillSuggestion {
  product: string;
  year: number;
  month: number;
  customs_volume: number;
  wavg_price: number;
  contract_price_text: string;
  shipment_month: string;
}

const InventoryTab = () => {
  const { canWrite } = useAuth();
  const [subTab, setSubTab] = useState<InventorySubTab>('rbd2026');
  const [inventoryData, setInventoryData] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [autofillData, setAutofillData] = useState<AutofillSuggestion[]>([]);
  const [autofillLoading, setAutofillLoading] = useState(false);
  const [autofillApplied, setAutofillApplied] = useState(false);
  const [contractPdfLoading, setContractPdfLoading] = useState(false);
  const [contractPdfResult, setContractPdfResult] = useState<string | null>(null);
  const contractPdfRef = useRef<HTMLInputElement>(null);

  const currentTab = INVENTORY_SUB_TABS.find(t => t.id === subTab) ?? INVENTORY_SUB_TABS[1];

  useEffect(() => { fetchInventory(); fetchAutofill(); }, [subTab]);

  const fetchInventory = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/inventory?product=${currentTab.product}&year=${currentTab.year}`);
      const json: InventoryResponse = await res.json();
      setInventoryData(json.data || []);
    } catch (error) {
      console.error('Failed to fetch inventory:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchAutofill = async () => {
    try {
      const res = await fetch(`/api/inventory?action=autofill&product=${currentTab.product}&year=${currentTab.year}`);
      const json = await res.json();
      setAutofillData(json.suggestions || []);
    } catch (e) {
      console.error('Failed to fetch autofill:', e);
    }
  };

  const applyAutofill = async () => {
    if (!canWrite) return;
    setAutofillLoading(true);
    try {
      for (const suggestion of autofillData) {
        const row = inventoryData.find(r => r.month === suggestion.month);
        if (!row) continue;
        // Update customs_volume
        if (suggestion.customs_volume > 0) {
          await handleCellSave(row.id, 'customs_volume', suggestion.customs_volume);
        }
        // Update contract_price
        if (suggestion.contract_price_text) {
          await fetch('/api/inventory', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: row.id, field: 'contract_price', value: suggestion.contract_price_text, edited_by: 'autofill' }),
          });
        }
        // Update contract_date (shipment_month)
        if (suggestion.shipment_month) {
          await fetch('/api/inventory', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: row.id, field: 'contract_date', value: suggestion.shipment_month, edited_by: 'autofill' }),
          });
        }
      }
      setAutofillApplied(true);
      await fetchInventory();
      setTimeout(() => setAutofillApplied(false), 3000);
    } catch (e) {
      console.error('Autofill apply failed:', e);
    } finally {
      setAutofillLoading(false);
    }
  };

  const handleCellSave = async (rowId: number, field: string, value: number) => {
    // 1) Optimistic update: recalculate locally for instant UI feedback
    setInventoryData(prev => {
      if (prev.length === 0) return prev;
      const rows = prev.map(r => ({ ...r }));
      const idx = rows.findIndex(r => r.id === rowId);
      if (idx === -1) return prev;
      (rows[idx] as any)[field] = value;

      // Derive prev-year ending stock from the first row's current values.
      // 처음 입력 시작인 신규 product(예: MANAGED)는 모든 필드가 null일 수 있으므로 null-safe.
      const first = prev[0];
      const prevYearEnd =
        (first.ending_stock ?? 0) + (first.expected_usage ?? 0) - (first.customs_volume ?? 0);

      // Recalculate ending_stock & coverage_days for all rows sequentially
      let prevStock = prevYearEnd;
      for (let i = 0; i < rows.length; i++) {
        const usage = rows[i].expected_usage ?? 0;
        const customs = rows[i].customs_volume ?? 0;
        rows[i].ending_stock = prevStock + customs - usage;
        rows[i].coverage_days = usage > 0 ? Math.round((rows[i].ending_stock / usage) * 10) / 10 : 0;
        prevStock = rows[i].ending_stock;
      }
      return rows;
    });

    // 2) Background server sync — user doesn't wait for this
    try {
      const res = await fetch('/api/inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rowId, field, value, updated_by: 'user' }),
      });
      if (res.ok) {
        const json = await res.json();
        // Apply server truth (corrects any rounding differences)
        if (json.data) setInventoryData(json.data);
      }
    } catch (error) {
      console.error('Failed to update inventory:', error);
      fetchInventory(true); // Rollback to server state on error
    }
  };

  const handleTextCellSave = async (rowId: number, field: string, value: string) => {
    // Optimistic update
    setInventoryData(prev => prev.map(r => r.id === rowId ? { ...r, [field]: value } : r));

    try {
      const res = await fetch('/api/inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rowId, field, value, updated_by: 'user' }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data) setInventoryData(json.data);
      }
    } catch (error) {
      console.error('Failed to update inventory:', error);
      fetchInventory(true);
    }
  };

  const handleContractPdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setContractPdfLoading(true);
    setContractPdfResult(null);

    try {
      const { product, year } = currentTab;

      // Map product code to full product name for PDF parsing.
      // MANAGED는 BMD PDF에 직접 매칭되는 항목이 없으므로 일단 RBD로 fallback.
      const productForPdf = product === 'RSPO' ? 'RBD Palm Oil RSPO MB' : 'RBD Palm Oil';

      const formData = new FormData();
      formData.append('file', file);
      formData.append('product', product);       // for DB query
      formData.append('product_pdf', productForPdf); // for Claude parsing hint
      formData.append('year', String(year));

      const res = await fetch('/api/inventory/upload-contracts', { method: 'POST', body: formData });
      const json = await res.json();

      if (json.success) {
        setContractPdfResult(`${json.parsed_contracts}건 파싱 → ${json.updated_months}개월 업데이트 완료`);
        if (json.data) setInventoryData(json.data);
      } else {
        setContractPdfResult(`오류: ${json.error}`);
      }
    } catch (err: any) {
      setContractPdfResult(`업로드 실패: ${err.message}`);
    } finally {
      setContractPdfLoading(false);
      if (contractPdfRef.current) contractPdfRef.current.value = '';
    }
  };

  const subTabs = INVENTORY_SUB_TABS;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Sub-tabs + Help text */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
          {subTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                subTab === tab.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {canWrite && autofillData.length > 0 && (
            <button
              onClick={applyAutofill}
              disabled={autofillLoading}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors shadow-sm flex items-center gap-1.5"
              title="구매이력 기반으로 통관수량, 계약단가를 자동 채우기 (선적월+1M=통관월)"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              {autofillLoading ? '적용 중...' : '구매이력 자동 채우기'}
            </button>
          )}
          {autofillApplied && (
            <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">적용 완료</span>
          )}
          {canWrite && (
            <>
              <input
                ref={contractPdfRef}
                type="file"
                accept=".pdf"
                onChange={handleContractPdfUpload}
                className="hidden"
              />
              <button
                onClick={() => contractPdfRef.current?.click()}
                disabled={contractPdfLoading}
                className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-medium transition-colors shadow-sm flex items-center gap-1.5"
                title="계약 PDF를 업로드하면 선적월별 가중평균 단가와 계약일을 자동 매칭합니다"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                {contractPdfLoading ? 'AI 분석 중...' : '계약 PDF 업로드'}
              </button>
            </>
          )}
          {contractPdfResult && (
            <span className={`text-xs px-2 py-1 rounded-lg ${contractPdfResult.startsWith('오류') || contractPdfResult.startsWith('업로드 실패') ? 'text-rose-600 bg-rose-50' : 'text-emerald-600 bg-emerald-50'}`}>
              {contractPdfResult}
            </span>
          )}
          <p className="text-xs text-slate-400">
            <span className="inline-block w-2 h-2 bg-blue-200 rounded mr-1" />
            셀을 클릭하면 편집할 수 있습니다
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-6"><Shimmer className="h-40" /></div>
        ) : inventoryData.length === 0 ? (
          <div className="p-6 text-slate-500 text-sm">데이터 없음</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">월</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    예상소요량(kg)
                    <span className="ml-1 text-blue-400">✎</span>
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    통관수량(kg)
                    <span className="ml-1 text-blue-400">✎</span>
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">기말재고(kg)</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">재고회전일</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    계약단가
                    <span className="ml-1 text-blue-400">✎</span>
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    계약일
                    <span className="ml-1 text-blue-400">✎</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inventoryData.map((row) => {
                  const af = autofillData.find(a => a.month === row.month);
                  return (
                  <tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3 font-semibold text-slate-800">{row.month}월</td>
                    <td className="px-5 py-3">
                      <EditableCell
                        value={row.expected_usage}
                        onSave={(val) => handleCellSave(row.id, 'expected_usage', val)}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <div className="relative">
                        <EditableCell
                          value={row.customs_volume}
                          onSave={(val) => handleCellSave(row.id, 'customs_volume', val)}
                        />
                        {af && af.customs_volume > 0 && row.customs_volume !== af.customs_volume && (
                          <span className="absolute -top-1 -right-1 text-[8px] text-blue-500" title={`구매이력 기준: ${formatNumber(af.customs_volume)} (선적월: ${af.shipment_month})`}>●</span>
                        )}
                      </div>
                    </td>
                    <td className={`px-5 py-3 tabular-nums font-semibold text-right ${
                      (row.ending_stock ?? 0) < 0 ? 'text-rose-600 bg-rose-50/50' :
                      (row.ending_stock ?? 0) < 2000000 ? 'text-amber-600 bg-amber-50/50' : 'text-slate-800'
                    }`}>
                      {formatNumber(row.ending_stock)}
                    </td>
                    <td className={`px-5 py-3 tabular-nums font-semibold text-center ${
                      (row.coverage_days ?? 0) < 1.5 ? 'text-rose-600' : (row.coverage_days ?? 0) < 2.5 ? 'text-amber-600' : 'text-emerald-600'
                    }`}>
                      {row.coverage_days != null ? row.coverage_days.toFixed(1) : '-'}
                    </td>
                    <td className="px-5 py-3">
                      {/* contract_price 는 텍스트 (예: '$1078.0/$1100.0', '1013.33 (wavg)') —
                          Number() 변환 시 NaN → 0 표시되는 버그 수정. EditableTextCell 사용. */}
                      <EditableTextCell
                        value={row.contract_price != null ? String(row.contract_price) : ''}
                        onSave={(val) => handleTextCellSave(row.id, 'contract_price', val)}
                        placeholder="예: $1078/$1100"
                      />
                      {af && af.contract_price_text && (
                        <span className="ml-1 text-[9px] text-blue-400" title={`구매이력: ${af.contract_price_text}`}>
                          ({af.contract_price_text})
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <EditableTextCell
                        value={row.contract_date || ''}
                        onSave={(val) => handleTextCellSave(row.id, 'contract_date', val)}
                        placeholder="예: 2026-04"
                      />
                      {af && af.shipment_month && (
                        <span className="ml-1 text-[9px] text-blue-400" title="구매이력 선적월">
                          [{af.shipment_month}]
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const BoxRangeTab = () => {
  const [contractMonth, setContractMonth] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('boxrange_contract_month') || '2026-04';
    return '2026-04';
  });
  const [asOfDate, setAsOfDate] = useState<string>('');
  const [mode, setMode] = useState<'일반' | '전쟁이슈'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('boxrange_mode');
      if (saved === '전쟁이슈') return '전쟁이슈';
    }
    return '일반';
  });
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [boxRangeData, setBoxRangeData] = useState<BoxRangeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [months, setMonths] = useState<string[]>([]);

  useEffect(() => {
    fetchAvailableMonths();
  }, []);

  useEffect(() => {
    localStorage.setItem('boxrange_contract_month', contractMonth);
    fetchAvailableDates();
    setAsOfDate(''); // reset date when month changes
  }, [contractMonth]);

  useEffect(() => {
    localStorage.setItem('boxrange_mode', mode);
  }, [mode]);

  useEffect(() => {
    fetchBoxRange();
  }, [contractMonth, asOfDate, mode]);

  const fetchBoxRange = async () => {
    setLoading(true);
    setBoxRangeData(null);
    try {
      let url = `/api/box-range?contract_month=${contractMonth}&mode=${encodeURIComponent(mode)}`;
      if (asOfDate) url += `&as_of_date=${asOfDate}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json && json.zones && !json.error) {
        setBoxRangeData(json as BoxRangeDetail);
      } else {
        setBoxRangeData(null);
      }
    } catch (error) {
      console.error('Failed to fetch box range:', error);
      setBoxRangeData(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableMonths = async () => {
    try {
      const res = await fetch('/api/fcpo');
      const json: FCPOData = await res.json();
      const recentMonths = (json.contract_months || []).filter((m: string) => m >= '2026-01');
      setMonths(recentMonths);
    } catch (error) {
      console.error('Failed to fetch months:', error);
    }
  };

  const fetchAvailableDates = async () => {
    try {
      const res = await fetch(`/api/fcpo?contract_month=${contractMonth}`);
      const json = await res.json();
      const dates = (json.data || []).map((r: any) => r.date).filter(Boolean).sort();
      setAvailableDates(dates);
    } catch (error) {
      console.error('Failed to fetch dates:', error);
      setAvailableDates([]);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Month & Date Selector */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">계약월 선택</h3>
          <p className="text-xs text-slate-400">FCPO 가격 탭에서 입력한 데이터를 기반으로 분석합니다</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {months.map((month) => (
            <button
              key={month}
              onClick={() => setContractMonth(month)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                contractMonth === month ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {month}
            </button>
          ))}
        </div>
        {/* Mode toggle: 일반 / 전쟁이슈 */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs font-medium text-slate-500 whitespace-nowrap">계산 모드</label>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              <button
                onClick={() => setMode('일반')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  mode === '일반' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                일반 (MA20 ± σ)
              </button>
              <button
                onClick={() => setMode('전쟁이슈')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  mode === '전쟁이슈' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                전쟁이슈 (현재가 ± σ×3.0)
              </button>
            </div>
            {boxRangeData && mode === '전쟁이슈' && (
              <p className="text-[11px] text-rose-600 font-medium">
                리스크 프리미엄 자동 가산: +${boxRangeData.risk_premium}/MT
              </p>
            )}
            {mode === '일반' && (
              <p className="text-[11px] text-slate-400 ml-auto">평시·안정시장 (변동률 &lt; 5%) 적용</p>
            )}
            {mode === '전쟁이슈' && (
              <p className="text-[11px] text-slate-400 ml-auto">변동률 &ge; 5% 시 자동 프리미엄 가산</p>
            )}
          </div>
        </div>
        {/* Date selector */}
        {availableDates.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-slate-500 whitespace-nowrap">기준일자</label>
              <select
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="flex-1 max-w-[200px] px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              >
                <option value="">최신 (전체 데이터)</option>
                {[...availableDates].reverse().map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {asOfDate && (
                <button
                  onClick={() => setAsOfDate('')}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  초기화
                </button>
              )}
              <p className="text-[11px] text-slate-400 ml-auto">
                {asOfDate ? `${asOfDate} 기준 10/20/60일 이평` : '최신 데이터 기준'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Box Range */}
      {loading ? <Shimmer className="h-80" /> : boxRangeData ? (
        <>
          <BoxRangeGauge data={boxRangeData} />

          {/* Additional Analysis Details */}
          {boxRangeData.volatility && (
            <div className="grid grid-cols-2 gap-4">
              <div className="card p-5">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">추세 분석</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">단기</span>
                    <span className="font-medium text-slate-700">{boxRangeData.trends.short_term}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">중기</span>
                    <span className="font-medium text-slate-700">{boxRangeData.trends.mid_term}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">장기</span>
                    <span className="font-medium text-slate-700">{boxRangeData.trends.long_term}</span>
                  </div>
                  {boxRangeData.trends.golden_cross_10_20 && (
                    <p className="text-xs text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg mt-2">골든크로스 (10/20일)</p>
                  )}
                  {boxRangeData.trends.dead_cross_10_20 && (
                    <p className="text-xs text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg mt-2">데드크로스 (10/20일)</p>
                  )}
                </div>
              </div>
              <div className="card p-5">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">변동성</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">20일 변동성</span>
                    <span className="font-medium text-slate-700">{boxRangeData.volatility.pct_20d.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">분류</span>
                    <span className="font-medium text-slate-700">{boxRangeData.volatility.classification}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">시장 상태</span>
                    <span className="font-medium text-slate-700">{boxRangeData.volatility.market_status}</span>
                  </div>
                  <div className="mt-2 p-2.5 bg-slate-50 rounded-lg">
                    <p className="text-xs text-slate-600">{boxRangeData.volatility.strategy}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Period Stats */}
          {boxRangeData.periods && boxRangeData.periods.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">기간별 통계</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="px-5 py-2.5 text-left text-xs text-slate-500">기간</th>
                      <th className="px-5 py-2.5 text-right text-xs text-slate-500">고가</th>
                      <th className="px-5 py-2.5 text-right text-xs text-slate-500">저가</th>
                      <th className="px-5 py-2.5 text-right text-xs text-slate-500">평균</th>
                      <th className="px-5 py-2.5 text-right text-xs text-slate-500">표준편차</th>
                      <th className="px-5 py-2.5 text-right text-xs text-slate-500">변동성</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {boxRangeData.periods.map((p) => (
                      <tr key={p.days} className="hover:bg-slate-50/50">
                        <td className="px-5 py-2.5 font-medium text-slate-700">{p.days}일</td>
                        <td className="px-5 py-2.5 tabular-nums text-right text-slate-600">{formatPrice(p.high)}</td>
                        <td className="px-5 py-2.5 tabular-nums text-right text-slate-600">{formatPrice(p.low)}</td>
                        <td className="px-5 py-2.5 tabular-nums text-right font-medium text-slate-800">{formatPrice(p.average)}</td>
                        <td className="px-5 py-2.5 tabular-nums text-right text-slate-600">{p.stdev.toFixed(1)}</td>
                        <td className="px-5 py-2.5 tabular-nums text-right text-slate-600">{p.volatility_pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card p-8 text-center">
          <p className="text-slate-500 text-sm">해당 월물에 대한 데이터가 부족합니다.</p>
          <p className="text-slate-400 text-xs mt-1">FCPO 가격 탭에서 10일 이상의 가격 데이터를 입력해 주세요.</p>
        </div>
      )}
    </div>
  );
};

const emptyPurchaseForm = {
  order_no: '', product: 'RBD', shipment_month: '', supplier: '', manufacturer: '',
  product_name: '', unit_price: '', qty_mt: '', amount_usd: '',
  incoterms: '', payment_terms: '', etd: '', contract_number: '', notes: '',
};

const PurchasesTab = () => {
  const { canWrite } = useAuth();
  const [subTab, setSubTab] = useState<'raw' | 'prebuy'>('raw');
  const [purchaseData, setPurchaseData] = useState<PurchaseItem[]>([]);
  const [rawSummary, setRawSummary] = useState<PurchasesRawResponse['summary'] | null>(null);
  const [prebuyData, setPrebuyData] = useState<PrebuyRow[]>([]);
  const [rbdPrebuy, setRbdPrebuy] = useState<PrebuyProductData | null>(null);
  const [rspoPrebuy, setRspoPrebuy] = useState<PrebuyProductData | null>(null);
  const [prebuySummary, setPrebuySummary] = useState<PrebuyResponse['summary'] | null>(null);
  const [loading, setLoading] = useState(false);

  // Add/Edit form
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyPurchaseForm);
  const [saving, setSaving] = useState(false);

  // Seed
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  // Expanded row
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Market price / exchange rate editing (per-purchase)
  const [editingMarketId, setEditingMarketId] = useState<number | null>(null);
  const [editingExRateId, setEditingExRateId] = useState<number | null>(null);
  const [marketInput, setMarketInput] = useState('');
  const [exRateInput, setExRateInput] = useState('');
  const [savingMarket, setSavingMarket] = useState(false);

  // Expanded month in prebuy detail (show individual purchases)
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // Bulk upload
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<any[] | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState<'text' | 'pdf'>('text');
  const [pdfRecords, setPdfRecords] = useState<any[]>([]);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfProgress, setPdfProgress] = useState('');
  const pdfBulkRef = useRef<HTMLInputElement>(null);

  // Prebuy sub-tab & excluded months & period filter
  const [prebuyView, setPrebuyView] = useState<'total' | 'rbd' | 'rspo'>('total');
  const [excludedMonths, setExcludedMonths] = useState<Set<string>>(new Set());
  const [periodFrom, setPeriodFrom] = useState<string>('');
  const [periodTo, setPeriodTo] = useState<string>('');
  const toggleExclude = (month: string) => {
    setExcludedMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month); else next.add(month);
      return next;
    });
  };

  useEffect(() => { fetchRaw(); fetchPrebuy(); }, []);

  const fetchRaw = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/purchases?view=raw');
      const json: PurchasesRawResponse = await res.json();
      setPurchaseData(json.data || []);
      setRawSummary(json.summary || null);
    } catch (error) {
      console.error('Failed to fetch purchases:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPrebuy = async () => {
    try {
      const res = await fetch('/api/purchases?view=prebuy');
      const json: PrebuyResponse = await res.json();
      setPrebuyData(json.data || []);
      setRbdPrebuy(json.rbd || null);
      setRspoPrebuy(json.rspo || null);
      setPrebuySummary(json.summary || null);
    } catch (error) {
      console.error('Failed to fetch prebuy:', error);
    }
  };

  const handleSeed = async () => {
    setSeeding(true); setSeedMsg(null);
    try {
      const res = await fetch('/api/purchases/seed', { method: 'POST' });
      const json = await res.json();
      setSeedMsg(json.message || 'Seed 완료');
      fetchRaw(); fetchPrebuy();
    } catch { setSeedMsg('Seed 실패'); }
    finally { setSeeding(false); }
  };

  const openAddForm = () => {
    setForm(emptyPurchaseForm);
    setFormMode('add');
    setEditId(null);
    setShowForm(true);
  };

  const openEditForm = (p: PurchaseItem) => {
    setForm({
      order_no: p.order_no || '',
      product: p.product || 'RBD',
      shipment_month: p.shipment_month || '',
      supplier: p.supplier || '',
      manufacturer: p.manufacturer || '',
      product_name: p.product_name || '',
      unit_price: p.unit_price?.toString() || '',
      qty_mt: p.qty_mt?.toString() || '',
      amount_usd: p.amount_usd?.toString() || '',
      incoterms: p.incoterms || '',
      payment_terms: p.payment_terms || '',
      etd: p.etd || '',
      contract_number: p.contract_number || '',
      notes: p.notes || '',
    });
    setFormMode('edit');
    setEditId(p.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.shipment_month || !form.unit_price || !form.qty_mt) return;
    setSaving(true);
    try {
      const unitPrice = parseFloat(form.unit_price);
      const qtyMt = parseFloat(form.qty_mt);
      const payload: any = {
        order_no: form.order_no || null,
        product: form.product,
        shipment_month: form.shipment_month,
        supplier: form.supplier || null,
        manufacturer: form.manufacturer || null,
        product_name: form.product_name || null,
        unit_price: unitPrice,
        qty_mt: qtyMt,
        amount_usd: form.amount_usd ? parseFloat(form.amount_usd) : unitPrice * qtyMt,
        incoterms: form.incoterms || null,
        payment_terms: form.payment_terms || null,
        etd: form.etd || null,
        contract_number: form.contract_number || null,
        notes: form.notes || null,
      };

      if (formMode === 'edit' && editId) {
        payload.id = editId;
        await fetch('/api/purchases', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } else {
        await fetch('/api/purchases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      setShowForm(false);
      setForm(emptyPurchaseForm);
      fetchRaw(); fetchPrebuy();
    } catch (error) {
      console.error('Failed to save purchase:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/purchases?id=${id}`, { method: 'DELETE' });
      setDeleteConfirm(null);
      fetchRaw(); fetchPrebuy();
    } catch (error) {
      console.error('Failed to delete purchase:', error);
    }
  };

  const handleBulkPreview = async () => {
    if (!bulkText.trim()) return;
    setBulkLoading(true); setBulkMsg(null); setBulkPreview(null);
    try {
      const res = await fetch('/api/purchases/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: bulkText, mode: 'preview' }),
      });
      const json = await res.json();
      if (json.success) {
        setBulkPreview(json.data);
        setBulkMsg(`${json.count}건 파싱 완료. 확인 후 저장하세요.`);
      } else {
        setBulkMsg(`파싱 실패: ${json.error}`);
      }
    } catch { setBulkMsg('파싱 중 오류 발생'); }
    finally { setBulkLoading(false); }
  };

  const handleBulkSave = async () => {
    if (!bulkText.trim()) return;
    setBulkLoading(true); setBulkMsg(null);
    try {
      const res = await fetch('/api/purchases/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: bulkText, mode: 'insert' }),
      });
      const json = await res.json();
      if (json.success) {
        setBulkMsg(`${json.count}건 저장 완료!`);
        setBulkText(''); setBulkPreview(null);
        setShowBulk(false);
        fetchRaw(); fetchPrebuy();
      } else {
        setBulkMsg(`저장 실패: ${json.error}`);
      }
    } catch { setBulkMsg('저장 중 오류 발생'); }
    finally { setBulkLoading(false); }
  };

  // PDF 여러 장 파싱 → 미리보기 records 수집
  const handlePdfBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setPdfParsing(true);
    setBulkMsg(null);
    const records: any[] = [];
    let fail = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setPdfProgress(`(${i + 1}/${files.length}) ${file.name} 분석 중...`);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/purchases/upload', { method: 'POST', body: fd });
        const json = await res.json();
        if (json.success && json.record) {
          records.push(json.record);
        } else { fail++; }
      } catch { fail++; }
    }
    setPdfRecords(prev => [...prev, ...records]);
    setPdfProgress('');
    setPdfParsing(false);
    setBulkMsg(`${records.length}건 파싱 완료${fail > 0 ? `, ${fail}건 실패` : ''}. 확인 후 저장하세요.`);
    if (pdfBulkRef.current) pdfBulkRef.current.value = '';
  };

  // PDF 파싱 records 일괄 저장 (각 건 POST /api/purchases)
  const handlePdfBulkSave = async () => {
    if (pdfRecords.length === 0) return;
    setBulkLoading(true); setBulkMsg(null);
    let saved = 0, skipped = 0, errored = 0;
    const errMsgs: string[] = [];
    for (const r of pdfRecords) {
      if (!r.product || !r.shipment_month || !r.unit_price || !r.qty_mt) { skipped++; continue; }
      // 계약일을 notes 에 합쳐 보존 (purchases 에 contract_date 컬럼 없음)
      const notes = [r.notes, r.contract_date ? `계약일:${r.contract_date}` : '', r.payment_terms ? `결제:${r.payment_terms}` : '']
        .filter(Boolean).join(' | ');
      const payload = {
        order_no: r.contract_number ? `SC-${r.contract_number}` : null,
        product: r.product,
        shipment_month: r.shipment_month,
        supplier: r.supplier,
        unit_price: Number(r.unit_price),
        qty_mt: Number(r.qty_mt),
        amount_usd: r.amount_usd ?? Number(r.unit_price) * Number(r.qty_mt),
        incoterms: r.incoterms,
        contract_number: r.contract_number,
        notes,
      };
      try {
        const res = await fetch('/api/purchases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) { saved++; }
        else { errored++; const j = await res.json().catch(() => ({})); errMsgs.push(`${r.source_file}: ${j.error || res.status}`); }
      } catch (e: any) { errored++; errMsgs.push(`${r.source_file}: ${e.message}`); }
    }
    const parts = [`${saved}건 저장 완료`];
    if (skipped) parts.push(`${skipped}건 필수값 누락 제외`);
    if (errored) parts.push(`${errored}건 오류`);
    setBulkMsg(parts.join(', ') + (errMsgs.length ? ` — ${errMsgs[0]}` : '') + '!');
    if (saved > 0) {
      setPdfRecords(prev => prev.filter(r => !r.product || !r.shipment_month || !r.unit_price || !r.qty_mt)); // 저장된 건 제거, 누락건만 남김
      fetchRaw(); fetchPrebuy();
    }
    setBulkLoading(false);
  };

  const updatePdfRecord = (idx: number, field: string, value: any) => {
    setPdfRecords(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  // Save market price for a single purchase
  const handlePurchaseMarketPriceSave = async (purchaseId: number) => {
    if (!marketInput) return;
    setSavingMarket(true);
    try {
      await fetch('/api/purchases', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_purchase_market_price', id: purchaseId, market_price_usd: parseFloat(marketInput) }),
      });
      setEditingMarketId(null);
      fetchPrebuy();
    } catch (error) {
      console.error('Failed to update market price:', error);
    } finally {
      setSavingMarket(false);
    }
  };

  // Bulk set market price for all purchases in a month (optionally filtered by product)
  const handleMonthMarketPriceSave = async (shipmentMonth: string, product?: string) => {
    if (!marketInput) return;
    setSavingMarket(true);
    try {
      await fetch('/api/purchases', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_month_market_price', shipment_month: shipmentMonth, product: product || null, market_price_usd: parseFloat(marketInput) }),
      });
      setEditingMarketId(null);
      fetchPrebuy();
    } catch (error) {
      console.error('Failed to update market price:', error);
    } finally {
      setSavingMarket(false);
    }
  };

  // Save exchange rate for a single purchase
  const handlePurchaseExRateSave = async (purchaseId: number) => {
    if (!exRateInput) return;
    setSavingMarket(true);
    try {
      await fetch('/api/purchases', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_purchase_exchange_rate', id: purchaseId, exchange_rate: parseFloat(exRateInput) }),
      });
      setEditingExRateId(null);
      fetchPrebuy();
    } catch (error) {
      console.error('Failed to update exchange rate:', error);
    } finally {
      setSavingMarket(false);
    }
  };

  const setField = (key: string, val: string) => setForm(prev => ({ ...prev, [key]: val }));

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Sub-tab selector */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-1">
        <button onClick={() => setSubTab('raw')} className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${subTab === 'raw' ? 'bg-white text-blue-600 border border-b-0 border-slate-200 -mb-[1px]' : 'text-slate-500 hover:text-slate-700'}`}>
          구매현황 RAW
        </button>
        <button onClick={() => setSubTab('prebuy')} className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${subTab === 'prebuy' ? 'bg-white text-blue-600 border border-b-0 border-slate-200 -mb-[1px]' : 'text-slate-500 hover:text-slate-700'}`}>
          선구매 효과 분석
        </button>
      </div>

      {/* ===== RAW VIEW ===== */}
      {subTab === 'raw' && (
        <>
          {/* Summary Cards */}
          {rawSummary && (
            <div className="grid grid-cols-3 gap-3 md:gap-4">
              <MetricCard label="총 구매 건수" value={formatNumber(rawSummary.total_records)} />
              <MetricCard label="총 수량" value={formatNumber(rawSummary.total_qty_mt, 1)} unit="MT" />
              <MetricCard label="총 금액" value={`$${formatNumber(rawSummary.total_amount_usd, 0)}`} />
            </div>
          )}

          {/* Action Bar */}
          {canWrite && (
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={openAddForm} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm">
              + 구매 추가
            </button>
            <button onClick={() => { setShowBulk(!showBulk); setBulkPreview(null); setBulkMsg(null); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm">
              대량 업로드
            </button>
            <button onClick={handleSeed} disabled={seeding} className="px-4 py-2 bg-slate-500 text-white rounded-lg text-sm font-medium hover:bg-slate-600 disabled:opacity-50 transition-colors shadow-sm text-xs">
              {seeding ? 'Seed 중...' : 'Seed (초기화)'}
            </button>
            {seedMsg && <span className="text-xs px-3 py-1.5 rounded-full bg-amber-50 text-amber-700">{seedMsg}</span>}
          </div>
          )}

          {/* Bulk Upload Panel */}
          {showBulk && (
            <div className="card p-5 border-blue-100 bg-blue-50/30 space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">대량 업로드</p>
                <button onClick={() => { setShowBulk(false); setBulkPreview(null); setPdfRecords([]); }} className="text-slate-400 hover:text-slate-600 text-sm">닫기</button>
              </div>

              {/* 모드 토글 */}
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                <button onClick={() => setBulkMode('text')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${bulkMode === 'text' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
                  엑셀 붙여넣기
                </button>
                <button onClick={() => setBulkMode('pdf')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${bulkMode === 'pdf' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
                  PDF 계약서 첨부
                </button>
              </div>

              {/* ── 엑셀 텍스트 모드 ── */}
              {bulkMode === 'text' && (<>
                <p className="text-xs text-slate-500">엑셀에서 데이터 행을 복사하여 아래에 붙여넣기 하세요. 헤더 행은 자동 무시됩니다.</p>
                <textarea
                  value={bulkText}
                  onChange={(e) => { setBulkText(e.target.value); setBulkPreview(null); }}
                  placeholder="엑셀에서 복사한 데이터를 여기에 붙여넣기..."
                  className="w-full h-40 px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-white resize-y"
                />
                <div className="flex items-center gap-3">
                  <button onClick={handleBulkPreview} disabled={bulkLoading || !bulkText.trim()} className="px-4 py-2 bg-slate-600 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors">
                    {bulkLoading ? '파싱 중...' : '미리보기'}
                  </button>
                  {bulkPreview && bulkPreview.length > 0 && (
                    <button onClick={handleBulkSave} disabled={bulkLoading} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors">
                      {bulkLoading ? '저장 중...' : `${bulkPreview.length}건 저장`}
                    </button>
                  )}
                  {bulkMsg && <span className={`text-xs px-3 py-1.5 rounded-full ${bulkMsg.includes('완료') ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{bulkMsg}</span>}
                </div>
                {bulkPreview && bulkPreview.length > 0 && (
                  <div className="overflow-x-auto max-h-60 overflow-y-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0">
                        <tr className="bg-slate-100 border-b border-slate-200">
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-500">No</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-500">상품</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-500">선적월</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-500">공급사</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-slate-500">단가</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-slate-500">수량</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-slate-500">금액</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-500">Incoterms</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bulkPreview.map((p: any, i: number) => (
                          <tr key={i} className="hover:bg-slate-50/60">
                            <td className="px-2 py-1.5 text-slate-400">{p.order_no || i + 1}</td>
                            <td className="px-2 py-1.5"><span className={`font-medium px-1.5 py-0.5 rounded ${p.product === 'RBD' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>{p.product}</span></td>
                            <td className="px-2 py-1.5 tabular-nums">{p.shipment_month}</td>
                            <td className="px-2 py-1.5 text-slate-600">{p.supplier || '-'}</td>
                            <td className="px-2 py-1.5 tabular-nums text-right">${formatNumber(p.unit_price, 1)}</td>
                            <td className="px-2 py-1.5 tabular-nums text-right">{formatNumber(p.qty_mt, 1)}</td>
                            <td className="px-2 py-1.5 tabular-nums text-right">${formatNumber(p.amount_usd, 0)}</td>
                            <td className="px-2 py-1.5 text-slate-500">{p.incoterms || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>)}

              {/* ── PDF 모드 ── */}
              {bulkMode === 'pdf' && (<>
                <p className="text-xs text-slate-500">매매계약서(SC) PDF를 여러 장 첨부하면 AI가 자동으로 상품·단가·수량·계약번호를 추출합니다. 관리팜유(3-MCPD+GE+RSPO)도 자동 분류됩니다.</p>
                <input ref={pdfBulkRef} type="file" accept=".pdf" multiple onChange={handlePdfBulkUpload} className="hidden" />
                <div className="flex items-center gap-3">
                  <button onClick={() => pdfBulkRef.current?.click()} disabled={pdfParsing} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-40 transition-colors shadow-sm flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    {pdfParsing ? '분석 중...' : 'PDF 첨부 (여러 장 가능)'}
                  </button>
                  {pdfRecords.length > 0 && (
                    <button onClick={handlePdfBulkSave} disabled={bulkLoading} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors">
                      {bulkLoading ? '저장 중...' : `${pdfRecords.length}건 저장`}
                    </button>
                  )}
                  {pdfRecords.length > 0 && (
                    <button onClick={() => setPdfRecords([])} className="text-xs text-slate-400 hover:text-slate-600">초기화</button>
                  )}
                  {pdfProgress && <span className="text-xs text-amber-700">{pdfProgress}</span>}
                  {bulkMsg && <span className={`text-xs px-3 py-1.5 rounded-full ${bulkMsg.includes('완료') ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{bulkMsg}</span>}
                </div>

                {/* PDF 파싱 결과 — 편집 가능한 미리보기 */}
                {pdfRecords.length > 0 && (
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100 border-b border-slate-200">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-500">파일</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-500">상품</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-500">선적월</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-500">공급사</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-500">계약번호</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-slate-500">단가</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-slate-500">수량</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pdfRecords.map((r: any, i: number) => {
                          const missing = !r.product || !r.shipment_month || !r.unit_price || !r.qty_mt;
                          return (
                          <tr key={i} className={missing ? 'bg-rose-50/40' : 'hover:bg-slate-50/60'}>
                            <td className="px-2 py-1.5 text-slate-400 max-w-[110px] truncate" title={r.source_file}>{r.source_file}</td>
                            <td className="px-2 py-1.5">
                              <select value={r.product || ''} onChange={e => updatePdfRecord(i, 'product', e.target.value)} className="text-xs border border-slate-200 rounded px-1 py-0.5 bg-white">
                                <option value="RBD">RBD</option>
                                <option value="RSPO">RSPO</option>
                                <option value="MANAGED">관리팜유</option>
                              </select>
                            </td>
                            <td className="px-2 py-1.5"><input value={r.shipment_month || ''} onChange={e => updatePdfRecord(i, 'shipment_month', e.target.value)} placeholder="2026-06" className="w-20 text-xs border border-slate-200 rounded px-1 py-0.5 bg-white" /></td>
                            <td className="px-2 py-1.5 text-slate-600 max-w-[120px] truncate" title={r.supplier}>{r.supplier || '-'}</td>
                            <td className="px-2 py-1.5 text-slate-500">{r.contract_number || '-'}</td>
                            <td className="px-2 py-1.5 text-right"><input type="number" value={r.unit_price ?? ''} onChange={e => updatePdfRecord(i, 'unit_price', parseFloat(e.target.value) || null)} className="w-16 text-xs border border-slate-200 rounded px-1 py-0.5 bg-white text-right" /></td>
                            <td className="px-2 py-1.5 text-right"><input type="number" value={r.qty_mt ?? ''} onChange={e => updatePdfRecord(i, 'qty_mt', parseFloat(e.target.value) || null)} className="w-16 text-xs border border-slate-200 rounded px-1 py-0.5 bg-white text-right" /></td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {pdfRecords.some((r: any) => !r.product || !r.shipment_month || !r.unit_price || !r.qty_mt) && (
                  <p className="text-[11px] text-rose-600">⚠️ 붉은 행은 필수값(상품/선적월/단가/수량)이 비어 저장에서 제외됩니다. 직접 채워주세요.</p>
                )}
              </>)}
            </div>
          )}

          {/* Add/Edit Form */}
          {showForm && (
            <div className="card p-5 border-blue-100 bg-blue-50/30 space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">
                  {formMode === 'edit' ? '구매 이력 수정' : '새 구매 등록'}
                </p>
                <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 text-sm">닫기</button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Order No</label>
                  <input type="text" value={form.order_no} onChange={(e) => setField('order_no', e.target.value)} placeholder="PO-001" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">상품 *</label>
                  <select value={form.product} onChange={(e) => setField('product', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                    <option value="RBD">RBD</option>
                    <option value="RSPO">RSPO</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">선적월 *</label>
                  <input type="month" value={form.shipment_month} onChange={(e) => setField('shipment_month', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">단가 ($/MT) *</label>
                  <input type="number" step="0.1" value={form.unit_price} onChange={(e) => setField('unit_price', e.target.value)} placeholder="1010.0" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">수량 (MT) *</label>
                  <input type="number" step="0.1" value={form.qty_mt} onChange={(e) => setField('qty_mt', e.target.value)} placeholder="500" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">금액 (USD)</label>
                  <input type="number" step="0.01" value={form.amount_usd} onChange={(e) => setField('amount_usd', e.target.value)} placeholder="자동계산" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">공급사</label>
                  <input type="text" value={form.supplier} onChange={(e) => setField('supplier', e.target.value)} placeholder="Wilmar" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">제조사</label>
                  <input type="text" value={form.manufacturer} onChange={(e) => setField('manufacturer', e.target.value)} placeholder="Sime Darby" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">품명</label>
                  <input type="text" value={form.product_name} onChange={(e) => setField('product_name', e.target.value)} placeholder="RBD Palm Olein" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Incoterms</label>
                  <select value={form.incoterms} onChange={(e) => setField('incoterms', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                    <option value="">선택</option>
                    <option value="CIF">CIF</option>
                    <option value="CFR">CFR</option>
                    <option value="FOB">FOB</option>
                    <option value="DAP">DAP</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">결제조건</label>
                  <input type="text" value={form.payment_terms} onChange={(e) => setField('payment_terms', e.target.value)} placeholder="CAD" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">ETD</label>
                  <input type="date" value={form.etd} onChange={(e) => setField('etd', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">계약번호</label>
                  <input type="text" value={form.contract_number} onChange={(e) => setField('contract_number', e.target.value)} placeholder="SC-2026-001" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">비고</label>
                  <input type="text" value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="메모" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200">취소</button>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.shipment_month || !form.unit_price || !form.qty_mt}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  {saving ? '저장 중...' : formMode === 'edit' ? '수정 저장' : '등록'}
                </button>
              </div>
            </div>
          )}

          {/* RAW Table */}
          {loading ? <Shimmer className="h-60" /> : purchaseData.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-slate-500 text-sm">등록된 구매 데이터가 없습니다</p>
              <p className="text-slate-400 text-xs mt-1">&quot;Seed&quot; 버튼으로 초기 데이터를 투입하거나 &quot;+ 구매 추가&quot;로 등록하세요</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">No</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">상품</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">선적월</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">공급사</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">단가</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">수량(MT)</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">금액(USD)</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Incoterms</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider w-20">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {purchaseData.map((p) => {
                      const isExpanded = expandedId === p.id;
                      return (
                        <React.Fragment key={p.id}>
                          <tr className="hover:bg-slate-50/60 transition-colors group">
                            <td className="px-3 py-2.5 text-xs text-slate-400">{p.order_no || p.id}</td>
                            <td className="px-3 py-2.5 font-medium text-slate-800">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.product === 'RBD' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>{p.product}</span>
                            </td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-600">{p.shipment_month}</td>
                            <td className="px-3 py-2.5 text-slate-600 text-xs">{p.supplier || '-'}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-800 text-right font-medium">${formatNumber(p.unit_price, 2)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-600 text-right">{formatNumber(p.qty_mt, 1)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-700 text-right">${formatNumber(p.amount_usd, 0)}</td>
                            <td className="px-3 py-2.5 text-xs text-slate-500">{p.incoterms || '-'}</td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => setExpandedId(isExpanded ? null : p.id)} className="p-1 text-slate-400 hover:text-blue-600" title="상세보기">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isExpanded ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} /></svg>
                                </button>
                                {canWrite && (
                                <button onClick={() => openEditForm(p)} className="p-1 text-slate-400 hover:text-amber-600" title="수정">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                </button>
                                )}
                                {canWrite && (deleteConfirm === p.id ? (
                                  <button onClick={() => handleDelete(p.id)} className="p-1 text-rose-600 font-medium text-xs">확인</button>
                                ) : (
                                  <button onClick={() => setDeleteConfirm(p.id)} className="p-1 text-slate-400 hover:text-rose-600" title="삭제">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                  </button>
                                ))}
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50/50">
                              <td colSpan={9} className="px-4 py-3">
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 text-xs">
                                  <div><span className="text-slate-400 block">제조사</span><span className="text-slate-700 font-medium">{p.manufacturer || '-'}</span></div>
                                  <div><span className="text-slate-400 block">품명</span><span className="text-slate-700 font-medium">{p.product_name || '-'}</span></div>
                                  <div><span className="text-slate-400 block">결제조건</span><span className="text-slate-700 font-medium">{p.payment_terms || '-'}</span></div>
                                  <div><span className="text-slate-400 block">ETD</span><span className="text-slate-700 font-medium">{p.etd || '-'}</span></div>
                                  <div><span className="text-slate-400 block">계약번호</span><span className="text-slate-700 font-medium">{p.contract_number || '-'}</span></div>
                                  <div><span className="text-slate-400 block">비고</span><span className="text-slate-700 font-medium">{p.notes || '-'}</span></div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ===== PREBUY VIEW ===== */}
      {subTab === 'prebuy' && (() => {
        const allMonths = prebuyData.map(r => r.shipment_month).sort();
        const pFrom = periodFrom || allMonths[0] || '';
        const pTo = periodTo || allMonths[allMonths.length - 1] || '';
        const inPeriod = (m: string) => m >= pFrom && m <= pTo;

        // Source rows for current view
        const sourceRows: PrebuyRow[] =
          prebuyView === 'rbd' ? (rbdPrebuy?.rows || []) :
          prebuyView === 'rspo' ? (rspoPrebuy?.rows || []) :
          prebuyData;
        const periodRows = sourceRows.filter(r => inPeriod(r.shipment_month));

        // Recalculate cumulative with exclusions (KRW-based, per-purchase exchange rates already applied)
        let recalcCumKrw = 0;
        const displayRows = periodRows.map(r => {
          const excluded = excludedMonths.has(r.shipment_month);
          if (!excluded) recalcCumKrw += (r.effect_krw ?? 0);
          return { ...r, _excluded: excluded, _cumulativeKrw: excluded ? null : recalcCumKrw };
        });

        // Summary aggregation
        const rbdRows = (rbdPrebuy?.rows || []).filter(r => inPeriod(r.shipment_month) && !excludedMonths.has(r.shipment_month));
        const rspoRows = (rspoPrebuy?.rows || []).filter(r => inPeriod(r.shipment_month) && !excludedMonths.has(r.shipment_month));
        const combinedRows = prebuyData.filter(r => inPeriod(r.shipment_month) && !excludedMonths.has(r.shipment_month));

        const sumUp = (rows: PrebuyRow[]) => ({
          qty: rows.reduce((s, r) => s + (r.qty ?? r.total_qty ?? 0), 0),
          amount: rows.reduce((s, r) => s + (r.amount ?? r.total_amount ?? 0), 0),
          effectUsd: rows.reduce((s, r) => s + r.effect_usd, 0),
          effectKrw: rows.reduce((s, r) => s + (r.effect_krw ?? 0), 0),
          months: rows.length,
          success: rows.filter(r => r.effect_usd > 0).length,
        });
        const rbdSum = sumUp(rbdRows);
        const rspoSum = sumUp(rspoRows);
        const totalSum = sumUp(combinedRows);

        // Helper: color based on USD effect (positive = 절감)
        const eColor = (usd: number) => usd > 0 ? 'text-emerald-600' : usd < 0 ? 'text-rose-500' : 'text-slate-400';
        const eLabel = (usd: number) => usd > 0 ? '절감' : usd < 0 ? '초과' : '-';
        const eBadge = (usd: number) => usd > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700';

        // Render expandable purchase sub-rows (with per-purchase market price + exchange rate)
        const renderPurchaseSubRows = (purchases: PrebuyPurchaseDetail[]) => (
          purchases.map(p => {
            const isEditingMp = editingMarketId === p.id;
            const isEditingEr = editingExRateId === p.id;
            return (
              <tr key={`sub-${p.id}`} className="bg-blue-50/30 border-b border-blue-100/50">
                <td className="px-2 py-1.5"></td>
                <td className="px-3 py-1.5 text-[10px] text-slate-500 pl-8">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${p.product === 'RBD' ? 'bg-blue-400' : 'bg-emerald-400'}`}></span>
                  {p.order_no || '-'}
                </td>
                <td className="px-3 py-1.5 tabular-nums text-[10px] text-slate-600 text-right">{formatNumber(p.qty_mt, 0)}</td>
                <td className="px-3 py-1.5 tabular-nums text-[10px] text-slate-600 text-right">${formatNumber(p.unit_price, 2)}</td>
                <td className="px-3 py-1.5 tabular-nums text-[10px] text-right" onClick={e => e.stopPropagation()}>
                  {isEditingMp ? (
                    <div className="flex items-center gap-1 justify-end">
                      <input type="number" step="0.1" value={marketInput}
                        onChange={(e) => setMarketInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handlePurchaseMarketPriceSave(p.id); if (e.key === 'Escape') setEditingMarketId(null); }}
                        className="w-20 px-1 py-0.5 border border-blue-300 rounded text-[10px] text-right bg-white" autoFocus />
                      <button onClick={() => handlePurchaseMarketPriceSave(p.id)} disabled={savingMarket} className="text-blue-600 text-[9px] font-medium">{savingMarket ? '...' : '저장'}</button>
                    </div>
                  ) : (
                    <span className="cursor-pointer text-blue-600 hover:underline"
                      onClick={() => { setEditingMarketId(p.id); setEditingExRateId(null); setMarketInput(p.market_price_usd?.toString() || ''); }}>
                      {p.market_price_usd != null ? `$${formatNumber(p.market_price_usd, 2)}` : <span className="text-slate-300 italic">미입력</span>}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 tabular-nums text-[10px] text-right" onClick={e => e.stopPropagation()}>
                  {isEditingEr ? (
                    <div className="flex items-center gap-1 justify-end">
                      <input type="number" step="1" value={exRateInput}
                        onChange={(e) => setExRateInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handlePurchaseExRateSave(p.id); if (e.key === 'Escape') setEditingExRateId(null); }}
                        className="w-16 px-1 py-0.5 border border-amber-300 rounded text-[10px] text-right bg-white" autoFocus />
                      <button onClick={() => handlePurchaseExRateSave(p.id)} disabled={savingMarket} className="text-amber-600 text-[9px] font-medium">{savingMarket ? '...' : '저장'}</button>
                    </div>
                  ) : (
                    <span className="cursor-pointer text-amber-600 hover:underline"
                      onClick={() => { setEditingExRateId(p.id); setEditingMarketId(null); setExRateInput(p.exchange_rate?.toString() || '1450'); }}>
                      {p.exchange_rate?.toLocaleString() || '1,450'}
                    </span>
                  )}
                </td>
                <td className={`px-3 py-1.5 tabular-nums text-[10px] font-medium text-right ${eColor(p.effect_usd)}`}>
                  {p.market_price_usd != null ? `$${formatNumber(p.effect_usd, 0)}` : '-'}
                </td>
                <td className={`px-3 py-1.5 tabular-nums text-[10px] font-medium text-right ${eColor(p.effect_usd)}`}>
                  {p.market_price_usd != null ? formatKRW(p.effect_krw) : '-'}
                </td>
                <td className="px-3 py-1.5"></td>
              </tr>
            );
          })
        );

        return (
        <>
          {/* Prebuy sub-tabs + exchange rate + period */}
          <div className="flex items-center gap-2 flex-wrap">
            {(['total', 'rbd', 'rspo'] as const).map(v => (
              <button key={v} onClick={() => setPrebuyView(v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  prebuyView === v ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}>
                {v === 'total' ? '총 효과 분석' : v === 'rbd' ? 'RBD Palm Oil' : 'RSPO(MB)'}
              </button>
            ))}
            {excludedMonths.size > 0 && (
              <button onClick={() => setExcludedMonths(new Set())} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors">
                제외 초기화 ({excludedMonths.size})
              </button>
            )}

            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className="text-slate-500">기간:</span>
              <select value={pFrom} onChange={e => setPeriodFrom(e.target.value)}
                className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                {allMonths.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <span className="text-slate-400">~</span>
              <select value={pTo} onChange={e => setPeriodTo(e.target.value)}
                className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                {allMonths.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* ===== 총 효과 분석 — Summary Table ===== */}
          {prebuyView === 'total' && (
            <>
              <div className="card overflow-hidden">
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                  <p className="text-sm font-semibold text-slate-700">선구매 실적 요약 ({pFrom} ~ {pTo})</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-slate-200">
                        <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">구분</th>
                        <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">수량(MT)</th>
                        <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">계약금액(USD)</th>
                        <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">효과(USD)</th>
                        <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">효과(KRW)</th>
                        <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">대상월</th>
                        <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">성공률</th>
                        <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">평가</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[
                        { label: 'RBD Palm Oil', badge: 'bg-blue-50 text-blue-700', sum: rbdSum },
                        { label: 'RSPO(MB)', badge: 'bg-emerald-50 text-emerald-700', sum: rspoSum },
                      ].map(({ label, badge, sum }) => (
                        <tr key={label} className="hover:bg-slate-50/60">
                          <td className="px-5 py-3.5 font-medium text-slate-800">
                            <span className={`${badge} px-2.5 py-0.5 rounded-full text-xs font-medium`}>{label}</span>
                          </td>
                          <td className="px-5 py-3.5 tabular-nums text-slate-700 text-right">{formatNumber(sum.qty, 0)}</td>
                          <td className="px-5 py-3.5 tabular-nums text-slate-700 text-right">${formatNumber(sum.amount, 0)}</td>
                          <td className={`px-5 py-3.5 tabular-nums font-semibold text-right ${eColor(sum.effectUsd)}`}>${formatNumber(sum.effectUsd, 0)}</td>
                          <td className={`px-5 py-3.5 tabular-nums font-semibold text-right ${eColor(sum.effectUsd)}`}>{formatKRW(sum.effectKrw)}</td>
                          <td className="px-5 py-3.5 tabular-nums text-slate-600 text-center">{sum.months}개월</td>
                          <td className="px-5 py-3.5 tabular-nums text-center">{sum.months > 0 ? `${Math.round(sum.success / sum.months * 100)}%` : '-'}</td>
                          <td className="px-5 py-3.5 text-center">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${eBadge(sum.effectUsd)}`}>{eLabel(sum.effectUsd)}</span>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-semibold">
                        <td className="px-5 py-3.5 text-slate-800">합계</td>
                        <td className="px-5 py-3.5 tabular-nums text-slate-800 text-right">{formatNumber(totalSum.qty, 0)}</td>
                        <td className="px-5 py-3.5 tabular-nums text-slate-800 text-right">${formatNumber(totalSum.amount, 0)}</td>
                        <td className={`px-5 py-3.5 tabular-nums text-right ${eColor(totalSum.effectUsd)}`}>${formatNumber(totalSum.effectUsd, 0)}</td>
                        <td className={`px-5 py-3.5 tabular-nums text-right ${eColor(totalSum.effectUsd)}`}>{formatKRW(totalSum.effectKrw)}</td>
                        <td className="px-5 py-3.5 tabular-nums text-slate-600 text-center">{totalSum.months}개월</td>
                        <td className="px-5 py-3.5 tabular-nums text-center">{totalSum.months > 0 ? `${Math.round(totalSum.success / totalSum.months * 100)}%` : '-'}</td>
                        <td className="px-5 py-3.5 text-center"><span className={`text-xs font-medium px-2.5 py-1 rounded-full ${eBadge(totalSum.effectUsd)}`}>{eLabel(totalSum.effectUsd)}</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Monthly Detail Table with expandable purchase sub-rows */}
              {periodRows.length > 0 && (
                <div className="card overflow-hidden">
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                    <p className="text-xs font-semibold text-slate-600">월별 상세 <span className="font-normal text-slate-400">(행 클릭 시 건별 시황가 입력)</span></p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-200">
                          <th className="px-2 py-2.5 text-center font-semibold text-slate-400 w-8"></th>
                          <th className="px-3 py-2.5 text-left font-semibold text-slate-500">선적월</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-slate-500">RBD(MT)</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-slate-500">RSPO(MT)</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-slate-500">합계(MT)</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-slate-500">가중평균가</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-slate-500">효과(USD)</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-slate-500">효과(KRW)</th>
                          <th className="px-3 py-2.5 text-center font-semibold text-slate-500">평가</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {displayRows.map(row => {
                          const excluded = (row as any)._excluded;
                          const cumKrw = (row as any)._cumulativeKrw;
                          const isExpanded = expandedMonth === row.shipment_month;
                          return (
                            <React.Fragment key={row.shipment_month}>
                              <tr className={`${excluded ? 'opacity-40 bg-slate-50' : 'hover:bg-slate-50/60'} transition-colors cursor-pointer`}
                                onClick={() => setExpandedMonth(isExpanded ? null : row.shipment_month)}>
                                <td className="px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
                                  <input type="checkbox" checked={!excluded} onChange={() => toggleExclude(row.shipment_month)}
                                    className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                                </td>
                                <td className="px-3 py-2 font-medium text-slate-700">
                                  <span className={`mr-1 text-[10px] transition-transform inline-block ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                  {row.shipment_month}
                                  {row.purchases && <span className="text-slate-400 ml-1 text-[10px]">({row.purchases.length}건)</span>}
                                </td>
                                <td className="px-3 py-2 tabular-nums text-slate-600 text-right">{formatNumber(row.rbd_qty ?? 0, 0)}</td>
                                <td className="px-3 py-2 tabular-nums text-slate-600 text-right">{formatNumber(row.rspo_qty ?? 0, 0)}</td>
                                <td className="px-3 py-2 tabular-nums text-slate-800 text-right font-medium">{formatNumber(row.total_qty ?? 0, 0)}</td>
                                <td className="px-3 py-2 tabular-nums text-slate-800 text-right">${formatNumber(row.wavg_price, 2)}</td>
                                <td className={`px-3 py-2 tabular-nums font-semibold text-right ${eColor(row.effect_usd)}`}>${formatNumber(row.effect_usd, 0)}</td>
                                <td className={`px-3 py-2 tabular-nums font-semibold text-right ${eColor(row.effect_usd)}`}>{formatKRW(row.effect_krw)}</td>
                                <td className="px-3 py-2 text-center">
                                  {!excluded && <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${eBadge(row.effect_usd)}`}>{eLabel(row.effect_usd)}</span>}
                                </td>
                              </tr>
                              {/* Expanded: individual purchase rows */}
                              {isExpanded && row.purchases && (
                                <>
                                  <tr className="bg-blue-50/50">
                                    <td></td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 pl-8">주문번호</td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 text-right">수량(MT)</td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 text-right">단가(USD)</td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 text-right">시황가(USD)</td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 text-right">환율</td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 text-right">효과(USD)</td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 text-right">효과(KRW)</td>
                                    <td></td>
                                  </tr>
                                  {renderPurchaseSubRows(row.purchases)}
                                </>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ===== RBD / RSPO 개별 탭 ===== */}
          {(prebuyView === 'rbd' || prebuyView === 'rspo') && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <MetricCard
                  label={`${prebuyView === 'rbd' ? 'RBD' : 'RSPO(MB)'} 선구매 효과`}
                  value={formatKRW(prebuyView === 'rbd' ? rbdSum.effectKrw : rspoSum.effectKrw)}
                  accent={(prebuyView === 'rbd' ? rbdSum.effectUsd : rspoSum.effectUsd) > 0 ? 'text-emerald-600' : 'text-rose-500'}
                />
                <MetricCard label="수량" value={`${formatNumber(prebuyView === 'rbd' ? rbdSum.qty : rspoSum.qty, 0)} MT`} />
                <MetricCard label="성공률" value={(() => {
                  const s = prebuyView === 'rbd' ? rbdSum : rspoSum;
                  return s.months > 0 ? `${Math.round(s.success / s.months * 100)}%` : '-';
                })()} accent="text-emerald-600" />
              </div>

              {periodRows.length === 0 ? (
                <div className="card p-8 text-center">
                  <p className="text-slate-500 text-sm">{prebuyView === 'rbd' ? 'RBD' : 'RSPO(MB)'} 데이터가 없습니다</p>
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-2 py-2.5 text-center font-semibold text-slate-400 w-8"></th>
                          <th className="px-3 py-2.5 text-left font-semibold text-slate-500">선적월</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-slate-500">수량(MT)</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-slate-500">가중평균가</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-slate-500">효과(USD)</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-slate-500">효과(KRW)</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-slate-500">누적(KRW)</th>
                          <th className="px-3 py-2.5 text-center font-semibold text-slate-500">평가</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {displayRows.map(row => {
                          const excluded = (row as any)._excluded;
                          const cumKrw = (row as any)._cumulativeKrw;
                          const isExpanded = expandedMonth === row.shipment_month;
                          return (
                            <React.Fragment key={row.shipment_month}>
                              <tr className={`${excluded ? 'opacity-40 bg-slate-50' : 'hover:bg-slate-50/60'} transition-colors cursor-pointer`}
                                onClick={() => setExpandedMonth(isExpanded ? null : row.shipment_month)}>
                                <td className="px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
                                  <input type="checkbox" checked={!excluded} onChange={() => toggleExclude(row.shipment_month)}
                                    className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                                </td>
                                <td className="px-3 py-2 font-medium text-slate-700">
                                  <span className={`mr-1 text-[10px] transition-transform inline-block ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                  {row.shipment_month}
                                  {row.purchases && <span className="text-slate-400 ml-1 text-[10px]">({row.purchases.length}건)</span>}
                                </td>
                                <td className="px-3 py-2 tabular-nums text-slate-800 text-right font-medium">{formatNumber(row.qty ?? 0, 0)}</td>
                                <td className="px-3 py-2 tabular-nums text-slate-800 text-right">${formatNumber(row.wavg_price, 2)}</td>
                                <td className={`px-3 py-2 tabular-nums font-semibold text-right ${eColor(row.effect_usd)}`}>${formatNumber(row.effect_usd, 0)}</td>
                                <td className={`px-3 py-2 tabular-nums font-semibold text-right ${eColor(row.effect_usd)}`}>{formatKRW(row.effect_krw)}</td>
                                <td className={`px-3 py-2 tabular-nums font-semibold text-right ${excluded ? 'text-slate-400' : eColor(cumKrw ?? 0)}`}>
                                  {excluded ? '-' : formatKRW(cumKrw ?? 0)}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {!excluded && <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${eBadge(row.effect_usd)}`}>{eLabel(row.effect_usd)}</span>}
                                </td>
                              </tr>
                              {isExpanded && row.purchases && (
                                <>
                                  <tr className="bg-blue-50/50">
                                    <td></td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 pl-8">주문번호</td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 text-right">수량(MT)</td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 text-right">단가(USD)</td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 text-right">시황가(USD)</td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 text-right">환율</td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 text-right">효과(USD)</td>
                                    <td className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 text-right">효과(KRW)</td>
                                  </tr>
                                  {renderPurchaseSubRows(row.purchases)}
                                </>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          <p className="text-xs text-slate-400">* 월별 행 클릭 → 건별 시황가·환율 입력 가능. 체크 해제 시 해당 월 제외. 환율 기본값 1,450원</p>
        </>
        );
      })()}
    </div>
  );
};

const NewsTab = () => {
  const { canWrite } = useAuth();
  const [newsData, setNewsData] = useState<NewsItem[]>([]);
  const [sentimentSummary, setSentimentSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Input form
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [newNews, setNewNews] = useState({ date: '', content: '' });
  const [saving, setSaving] = useState(false);
  const [aiResult, setAiResult] = useState<{ sentiment: string; impact: string } | null>(null);

  // Bulk upload
  const [bulkText, setBulkText] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResults, setBulkResults] = useState<any[] | null>(null);

  // One-click import (clipboard)
  const [oneClickLoading, setOneClickLoading] = useState(false);
  const [oneClickMsg, setOneClickMsg] = useState<{ type: 'ok' | 'err' | 'info'; text: string } | null>(null);

  // Detail/Delete
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Bulk select/delete
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => { fetchNews(); }, []);

  const fetchNews = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/news');
      const json: NewsResponse = await res.json();
      setNewsData(json.data || []);
      setSentimentSummary(json.sentiment_summary || null);
    } catch (error) {
      console.error('Failed to fetch news:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNews = async (id: number) => {
    setDeleteError(null);
    try {
      const res = await fetch(`/api/news?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `삭제 실패 (${res.status})`);
      }
      setDeleteConfirm(null);
      setExpandedId(null);
      fetchNews();
    } catch (error: any) {
      console.error('Failed to delete news:', error);
      setDeleteError(error.message || '삭제에 실패했습니다.');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setDeleteError(null);
    try {
      const idsStr = Array.from(selectedIds).join(',');
      const res = await fetch(`/api/news?ids=${idsStr}`, { method: 'DELETE' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `대량 삭제 실패 (${res.status})`);
      }
      setSelectedIds(new Set());
      setBulkDeleteConfirm(false);
      setExpandedId(null);
      fetchNews();
    } catch (error: any) {
      console.error('Failed to bulk delete news:', error);
      setDeleteError(error.message || '대량 삭제에 실패했습니다.');
    }
  };

  const toggleSelectNews = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === newsData.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(newsData.map(n => n.id)));
    }
  };

  // 단건 뉴스 저장 — AI가 자동으로 sentiment/impact 판단
  const handleAddNews = async () => {
    if (!newNews.content) return;
    setSaving(true);
    setAiResult(null);
    try {
      const res = await fetch('/api/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: newNews.date || new Date().toISOString().slice(0, 10),
          content: newNews.content,
          auto_analyze: true,
          created_by: 'user',
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setAiResult({ sentiment: json.sentiment, impact: json.impact });
        setTimeout(() => {
          setShowAddForm(false);
          setNewNews({ date: '', content: '' });
          setAiResult(null);
          fetchNews();
        }, 1500);
      }
    } catch (error) {
      console.error('Failed to add news:', error);
    } finally {
      setSaving(false);
    }
  };

  // 대량 텍스트 업로드 — Claude API가 기사 단위로 파싱 + 시황/영향도 분석
  const handleBulkUpload = async () => {
    if (!bulkText.trim()) return;
    setBulkSaving(true);
    setBulkResults(null);
    try {
      const res = await fetch('/api/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulk_text: bulkText }),
      });

      const json = await res.json();
      if (res.ok) {
        setBulkResults(json.results || []);
        setTimeout(() => {
          setShowBulkForm(false);
          setBulkText('');
          setBulkResults(null);
          fetchNews();
        }, 5000);
      } else {
        alert(`업로드 실패: ${json.error || '알 수 없는 오류'}`);
      }
    } catch (error) {
      console.error('Bulk upload failed:', error);
      alert('업로드 중 오류가 발생했습니다.');
    } finally {
      setBulkSaving(false);
    }
  };

  // 원클릭 가져오기 — 클립보드의 시황 페이지 내용을 읽어 AI가 기사 단위로 파싱·저장.
  // KoreaPDS 등에서 본인이 보던 페이지를 Ctrl+A → Ctrl+C 한 뒤 버튼 한 번이면 됨.
  // (본인 열람의 연장이므로 ToS 안전, 자동 반복 크롤링 아님)
  const handleOneClickImport = async () => {
    setOneClickMsg(null);
    let clip = '';
    try {
      clip = await navigator.clipboard.readText();
    } catch {
      // 클립보드 권한 거부 / 비-HTTPS / 포커스 없음 → 수동 붙여넣기로 폴백
      setShowBulkForm(true);
      setShowAddForm(false);
      setOneClickMsg({ type: 'info', text: '클립보드를 읽을 수 없어요. 아래 칸에 붙여넣기(Ctrl+V) 후 업로드하세요.' });
      return;
    }

    if (!clip || clip.trim().length < 20) {
      setShowBulkForm(true);
      setOneClickMsg({ type: 'err', text: '클립보드가 비어있거나 너무 짧습니다. 시황 페이지를 전체선택(Ctrl+A) → 복사(Ctrl+C) 후 다시 누르세요.' });
      return;
    }

    setOneClickLoading(true);
    try {
      const res = await fetch('/api/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulk_text: clip }),
      });
      const json = await res.json();
      if (res.ok) {
        setOneClickMsg({ type: 'ok', text: `클립보드에서 ${json.count ?? json.results?.length ?? 0}건 가져와 저장했습니다.` });
        setShowBulkForm(false);
        fetchNews();
        setTimeout(() => setOneClickMsg(null), 6000);
      } else {
        setOneClickMsg({ type: 'err', text: `가져오기 실패: ${json.error || '알 수 없는 오류'}` });
      }
    } catch (err: any) {
      setOneClickMsg({ type: 'err', text: `가져오기 중 오류: ${err.message || err}` });
    } finally {
      setOneClickLoading(false);
    }
  };

  const sentimentCounts = sentimentSummary
    ? {
        강세: sentimentSummary.find((s: any) => s.sentiment === '강세')?.cnt || 0,
        약세: sentimentSummary.find((s: any) => s.sentiment === '약세')?.cnt || 0,
        중립: sentimentSummary.find((s: any) => s.sentiment === '중립' || s.sentiment === '보합')?.cnt || 0,
      }
    : { 강세: 0, 약세: 0, 중립: 0 };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header with Add Button */}
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-3 gap-2 md:gap-4 flex-1 mr-4">
          <div className="card p-4 bg-emerald-50/50 border-emerald-200/50">
            <p className="text-emerald-600 text-xs font-medium mb-1">강세</p>
            <p className="text-2xl font-bold text-emerald-600 tabular-nums">{sentimentCounts.강세}</p>
          </div>
          <div className="card p-4 bg-slate-50 border-slate-200/50">
            <p className="text-slate-500 text-xs font-medium mb-1">중립/보합</p>
            <p className="text-2xl font-bold text-slate-600 tabular-nums">{sentimentCounts.중립}</p>
          </div>
          <div className="card p-4 bg-rose-50/50 border-rose-200/50">
            <p className="text-rose-600 text-xs font-medium mb-1">약세</p>
            <p className="text-2xl font-bold text-rose-600 tabular-nums">{sentimentCounts.약세}</p>
          </div>
        </div>
        {canWrite && (
        <div className="flex flex-col gap-2">
          <button
            onClick={handleOneClickImport}
            disabled={oneClickLoading}
            title="시황 페이지(KoreaPDS 등)에서 Ctrl+A → Ctrl+C 한 뒤 누르면, 클립보드 내용을 AI가 기사별로 분리·분석해 저장합니다"
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm whitespace-nowrap bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {oneClickLoading ? (
              <><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>가져오는 중...</>
            ) : '📋 원클릭 가져오기'}
          </button>
          <button
            onClick={() => { setShowAddForm(!showAddForm); setShowBulkForm(false); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm whitespace-nowrap ${
              showAddForm ? 'bg-slate-200 text-slate-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {showAddForm ? '취소' : '+ 뉴스 입력'}
          </button>
          <button
            onClick={() => { setShowBulkForm(!showBulkForm); setShowAddForm(false); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm whitespace-nowrap ${
              showBulkForm ? 'bg-slate-200 text-slate-700' : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {showBulkForm ? '취소' : '대량 업로드'}
          </button>
        </div>
        )}
      </div>

      {/* 원클릭 가져오기 결과/안내 */}
      {oneClickMsg && (
        <div className={`px-4 py-2.5 rounded-lg text-sm animate-fade-in border ${
          oneClickMsg.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
          oneClickMsg.type === 'err' ? 'bg-rose-50 text-rose-700 border-rose-200' :
          'bg-blue-50 text-blue-700 border-blue-200'
        }`}>
          {oneClickMsg.text}
        </div>
      )}

      {/* 원클릭 사용법 (canWrite 사용자에게만) */}
      {canWrite && (
        <p className="text-xs text-slate-400 -mt-2">
          💡 <span className="font-medium text-violet-500">원클릭 가져오기</span> = KoreaPDS 등 시황 페이지에서 <b>Ctrl+A → Ctrl+C</b> 한 뒤 버튼을 누르면 끝. AI가 기사 분리·날짜·시황/영향도를 자동 분석합니다. (본인 열람의 연장이라 안전 — 자동 반복 크롤링 아님)
        </p>
      )}

      {/* Single News Add Form — AI 자동 판단 */}
      {showAddForm && (
        <div className="card p-5 border-emerald-100 bg-emerald-50/30 space-y-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-700">뉴스 입력</p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 font-medium">AI 자동 분석</span>
          </div>
          <p className="text-xs text-slate-400">내용만 입력하면 AI가 시황 전망/영향도를 자동으로 판단합니다.</p>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">날짜 (미입력 시 오늘)</label>
            <input
              type="date"
              value={newNews.date}
              onChange={(e) => setNewNews({ ...newNews, date: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">뉴스 내용 *</label>
            <textarea
              value={newNews.content}
              onChange={(e) => setNewNews({ ...newNews, content: e.target.value })}
              placeholder="시황 뉴스 내용을 입력하세요... (예: 말레이시아 팜유 생산량 전월 대비 5% 감소)"
              rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white resize-none"
            />
          </div>
          {aiResult && (
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white border border-slate-200 animate-fade-in">
              <span className="text-xs text-slate-500">AI 판단 결과:</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                aiResult.sentiment === '강세' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                aiResult.sentiment === '약세' ? 'bg-rose-50 text-rose-600 border-rose-200' :
                'bg-slate-50 text-slate-600 border-slate-200'
              }`}>{aiResult.sentiment}</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                aiResult.impact === 'High' ? 'bg-rose-50 text-rose-600' :
                aiResult.impact === 'Medium' ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-500'
              }`}>영향: {aiResult.impact}</span>
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={handleAddNews}
              disabled={saving || !newNews.content}
              className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm flex items-center gap-2"
            >
              {saving ? (
                <><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>AI 분석 중...</>
              ) : '저장 (AI 자동 분석)'}
            </button>
          </div>
        </div>
      )}

      {/* Bulk Upload Form */}
      {showBulkForm && (
        <div className="card p-5 border-blue-100 bg-blue-50/30 space-y-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-700">뉴스 대량 업로드</p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 font-medium">AI 자동 분석</span>
          </div>
          <div className="text-xs text-slate-400 space-y-1">
            <p>시황 뉴스 전체 내용을 그대로 붙여넣으세요. AI가 기사를 자동 분리하고, 날짜 추출 + 시황/영향도를 분석합니다.</p>
            <p className="text-violet-500">여러 기사를 한번에 붙여넣어도 자동으로 분리됩니다.</p>
          </div>
          <div>
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder="시황 뉴스 전체 내용을 그대로 붙여넣으세요... (예: [03/31] 인도네시아 B50 재도입 기대감에 팜유 상승...)"
              rows={12}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white resize-none font-mono"
            />
          </div>
          {bulkResults && (
            <div className="bg-white rounded-lg border border-slate-200 p-3 max-h-40 overflow-y-auto animate-fade-in">
              <p className="text-xs font-semibold text-emerald-600 mb-2">{bulkResults.length}개 뉴스 업로드 완료!</p>
              {bulkResults.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-slate-100 last:border-0">
                  <span className={`px-1.5 py-0.5 rounded text-white text-[10px] font-bold ${
                    r.sentiment === '강세' ? 'bg-emerald-500' : r.sentiment === '약세' ? 'bg-rose-500' : 'bg-slate-400'
                  }`}>{r.sentiment}</span>
                  <span className="text-slate-400">{r.impact}</span>
                  <span className="text-slate-400">{r.date}</span>
                  <span className="text-slate-600 truncate flex-1">{r.content}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <span className="text-xs text-slate-400 self-center">
              AI가 기사를 자동 분리합니다
            </span>
            <button
              onClick={handleBulkUpload}
              disabled={bulkSaving || !bulkText.trim()}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm flex items-center gap-2"
            >
              {bulkSaving ? (
                <><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>AI 분석 + 저장 중...</>
              ) : '전체 업로드 (AI 분석)'}
            </button>
          </div>
        </div>
      )}

      {/* Delete Error Toast */}
      {deleteError && (
        <div className="mb-3 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between">
          <span className="text-sm text-rose-700">{deleteError}</span>
          <button onClick={() => setDeleteError(null)} className="text-rose-400 hover:text-rose-600 text-xs ml-3">✕</button>
        </div>
      )}

      {/* News List — 날짜별 그룹핑 */}
      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Shimmer key={i} className="h-20" />)}</div>
      ) : newsData.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-slate-500 text-sm">등록된 뉴스가 없습니다</p>
          <p className="text-slate-400 text-xs mt-1">상단의 &quot;+ 뉴스 입력&quot; 버튼으로 시황 데이터를 추가하세요</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 대량 선택/삭제 컨트롤 */}
          <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-4 py-2.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.size === newsData.length && newsData.length > 0}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-600">
                {selectedIds.size > 0 ? `${selectedIds.size}개 선택됨` : '전체 선택'}
              </span>
            </label>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                {bulkDeleteConfirm ? (
                  <>
                    <span className="text-xs text-rose-500">{selectedIds.size}개를 삭제하시겠습니까?</span>
                    <button onClick={handleBulkDelete} className="px-3 py-1 bg-rose-500 text-white text-xs rounded-lg hover:bg-rose-600">삭제</button>
                    <button onClick={() => setBulkDeleteConfirm(false)} className="px-3 py-1 bg-slate-200 text-slate-600 text-xs rounded-lg hover:bg-slate-300">취소</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded-lg">선택 해제</button>
                    <button onClick={() => setBulkDeleteConfirm(true)} className="px-3 py-1 bg-rose-500 text-white text-xs rounded-lg hover:bg-rose-600">선택 삭제</button>
                  </>
                )}
              </div>
            )}
          </div>
          {(() => {
            // 날짜별 그룹핑
            const grouped: Record<string, NewsItem[]> = {};
            newsData.forEach(n => {
              const d = n.date || 'unknown';
              if (!grouped[d]) grouped[d] = [];
              grouped[d].push(n);
            });
            const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

            return sortedDates.map(dateKey => {
              const items = grouped[dateKey];
              const dateLabel = dateKey !== 'unknown'
                ? new Date(dateKey + 'T00:00:00').toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
                : '날짜 미지정';

              return (
                <div key={dateKey}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-px flex-1 bg-slate-200" />
                    <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">{dateLabel}</span>
                    <span className="text-xs text-slate-400">{items.length}건</span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>
                  <div className="space-y-2">
                    {items.map(news => {
                      const isExpanded = expandedId === news.id;
                      const sentimentColors: Record<string, string> = {
                        '강세': 'bg-emerald-50 text-emerald-700 border-emerald-200',
                        '약세': 'bg-rose-50 text-rose-700 border-rose-200',
                        '보합': 'bg-slate-50 text-slate-600 border-slate-200',
                      };
                      const sStyle = sentimentColors[news.sentiment] || sentimentColors['보합'];

                      return (
                        <div key={news.id} className={`card overflow-hidden transition-all ${isExpanded ? 'ring-2 ring-blue-200' : ''}`}>
                          {/* 요약 행 — 클릭 시 확장 */}
                          <div
                            className="p-3.5 flex items-center gap-3 cursor-pointer hover:bg-slate-50/50 transition-colors"
                            onClick={() => setExpandedId(isExpanded ? null : news.id)}
                          >
                            <input
                              type="checkbox"
                              checked={selectedIds.has(news.id)}
                              onChange={() => toggleSelectNews(news.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                            />
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${sStyle}`}>
                              {news.sentiment}
                            </span>
                            <p className={`text-sm text-slate-700 flex-1 ${isExpanded ? '' : 'line-clamp-1'}`}>
                              {news.content}
                            </p>
                            <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                              news.impact === 'High' ? 'bg-rose-50 text-rose-600' :
                              news.impact === 'Medium' ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-500'
                            }`}>
                              {news.impact}
                            </span>
                            <svg className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>

                          {/* 확장 상세 보기 */}
                          {isExpanded && (
                            <div className="border-t border-slate-100 bg-slate-50/30 p-4 space-y-3 animate-fade-in">
                              <div>
                                <p className="text-xs font-medium text-slate-500 mb-1">전체 내용</p>
                                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{news.full_content || news.content}</p>
                              </div>
                              <div className="grid grid-cols-3 gap-3">
                                <div>
                                  <p className="text-xs text-slate-400 mb-0.5">시황 전망</p>
                                  <span className={`text-sm font-semibold px-2.5 py-1 rounded-lg border inline-block ${sStyle}`}>
                                    {news.sentiment}
                                  </span>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-400 mb-0.5">영향도</p>
                                  <span className={`text-sm font-medium px-2.5 py-1 rounded-lg inline-block ${
                                    news.impact === 'High' ? 'bg-rose-100 text-rose-700' :
                                    news.impact === 'Medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                                  }`}>{news.impact}</span>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-400 mb-0.5">작성자</p>
                                  <span className="text-sm text-slate-600">{news.created_by || '-'}</span>
                                </div>
                              </div>
                              <div className="flex justify-end pt-1">
                                {deleteConfirm === news.id ? (
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-rose-500">삭제하시겠습니까?</span>
                                    <button onClick={() => handleDeleteNews(news.id)} className="px-3 py-1 bg-rose-500 text-white text-xs rounded-lg hover:bg-rose-600">삭제</button>
                                    <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1 bg-slate-200 text-slate-600 text-xs rounded-lg hover:bg-slate-300">취소</button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(news.id); }}
                                    className="px-3 py-1 text-xs text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                  >
                                    삭제
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
};

const AlertsTab = () => {
  const [alertData, setAlertData] = useState<DashboardAlert[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchAlerts(); }, []);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/alerts');
      const json: AlertsResponse = await res.json();
      setAlertData(json.data || []);
    } catch (error) {
      console.error('Failed to fetch alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const criticalCount = alertData.filter((a) => a.alert_level === 'critical').length;
  const warningCount = alertData.filter((a) => a.alert_level === 'warning').length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-5 bg-rose-50/50 border-rose-200/50">
          <p className="text-rose-600 text-xs font-medium mb-1">긴급</p>
          <p className="text-2xl font-bold text-rose-600 tabular-nums">{criticalCount}</p>
        </div>
        <div className="card p-5 bg-amber-50/50 border-amber-200/50">
          <p className="text-amber-600 text-xs font-medium mb-1">경고</p>
          <p className="text-2xl font-bold text-amber-600 tabular-nums">{warningCount}</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Shimmer key={i} className="h-20" />)}</div>
      ) : alertData.length === 0 ? (
        <div className="card p-8 text-center text-slate-500 text-sm">활성 알림 없음</div>
      ) : (
        <div className="space-y-3">
          {alertData.map((alert, idx) => <AlertBanner key={idx} alert={alert} />)}
        </div>
      )}
    </div>
  );
};

// ============ LC TAB ============

const LCTab = () => {
  const [purchaseData, setPurchaseData] = useState<PurchaseItem[]>([]);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<number | null>(null);
  const [lcFields, setLcFields] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => { fetchPurchases(); }, []);

  const fetchPurchases = async () => {
    try {
      const res = await fetch('/api/purchases');
      const json = await res.json();
      setPurchaseData(json.data || []);
    } catch (error) {
      console.error('Failed to fetch purchases:', error);
    }
  };

  const handleGenerateLC = async () => {
    if (!selectedPurchaseId) return;
    const purchase = purchaseData.find(p => p.id === selectedPurchaseId);
    if (!purchase) return;

    setLoading(true);
    try {
      const res = await fetch('/api/lc/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchase_id: selectedPurchaseId,
          product: purchase.product,
          quantity_mt: purchase.qty_mt,
          contract_price: purchase.unit_price,
          shipment_month: purchase.shipment_month,
          supplier: purchase.supplier,
          incoterms: purchase.incoterms,
          payment_terms: purchase.payment_terms,
          loading_port: null,
          discharge_port: null,
        }),
      });
      const json = await res.json();
      if (json.lc_fields) {
        setLcFields(json.lc_fields);
      }
    } catch (error) {
      console.error('Failed to generate LC:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (field: string, value: string) => {
    setLcFields(prev => prev ? { ...prev, [field]: value } : null);
  };

  const handleExportXml = async () => {
    if (!lcFields) return;
    try {
      const res = await fetch('/api/lc/export-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lcFields),
      });
      const json = await res.json();
      if (json.xml) {
        // Trigger download
        const blob = new Blob([json.xml], { type: 'application/xml' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = json.download_filename || 'lc.xml';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Failed to export LC:', error);
    }
  };

  const lcFieldLabels: Record<string, string> = {
    '40A': 'Form of Documentary Credit',
    '20': 'Documentary Credit Number',
    '31C': 'Date of Issue',
    '31D': 'Date and Place of Expiry',
    '50': 'Applicant',
    '59': 'Beneficiary',
    '32B': 'Currency Code, Amount',
    '39A': 'Percentage Credit Amount Tolerance',
    '41D': 'Available with...by...Negotiation',
    '42C': 'Drafts at...Sight/Usance',
    '43P': 'Partial Shipments',
    '43T': 'Transshipment',
    '44A': 'Port of Loading',
    '44B': 'Port of Discharge',
    '44C': 'Latest Date of Shipment',
    '44D': 'Shipment Period',
    '45A': 'Description of Goods/Services',
    '46A': 'Documents Required',
    '47A': 'Additional Conditions',
    '71D': 'Charges',
    '48': 'Period for Presentation',
    '49': 'Confirmation Instructions',
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Selection Section */}
      <div className="card p-5 space-y-4">
        <div>
          <label className="text-xs text-slate-500 mb-2 block font-medium">구매 이력 선택</label>
          <select
            value={selectedPurchaseId || ''}
            onChange={(e) => { setSelectedPurchaseId(e.target.value ? parseInt(e.target.value) : null); setLcFields(null); }}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
          >
            <option value="">-- 구매 이력을 선택하세요 --</option>
            {purchaseData.map(p => (
              <option key={p.id} value={p.id}>
                {p.product} | {p.shipment_month} | ${p.unit_price}/MT | {p.qty_mt}MT
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleGenerateLC}
          disabled={!selectedPurchaseId || loading}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'LC 생성 중...' : 'LC 생성'}
        </button>
      </div>

      {/* LC Fields Table */}
      {lcFields && (
        <>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-20">필드</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-40">레이블</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">값</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(lcFields).map(([field, value]) => (
                  <tr key={field} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{field}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{lcFieldLabels[field] || field}</td>
                    <td className="px-4 py-3 text-sm">
                      {editingField === field ? (
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => { handleFieldChange(field, editValue); setEditingField(null); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { handleFieldChange(field, editValue); setEditingField(null); }
                            if (e.key === 'Escape') setEditingField(null);
                          }}
                          className="w-full px-2 py-1 border border-blue-300 rounded-lg bg-blue-50 text-slate-800 text-xs"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => { setEditingField(field); setEditValue(value); }}
                          className="inline-block w-full text-slate-700 cursor-pointer hover:bg-blue-50/50 px-2 py-1 rounded break-words max-h-20 overflow-y-auto"
                        >
                          {value || '-'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleExportXml}
            className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            XML 내보내기
          </button>
        </>
      )}
    </div>
  );
};

// ============ DOC VERIFY TAB ============

const DocVerifyTab = () => {
  const [lcData, setLcData] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [verification, setVerification] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleVerify = async () => {
    if (!file || !lcData) return;

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('lc_data', lcData);

      const res = await fetch('/api/doc-verify', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (json.verification) {
        setVerification(json.verification);
      }
    } catch (error) {
      console.error('Failed to verify document:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Input Section */}
      <div className="card p-5 space-y-4">
        <div>
          <label className="text-xs text-slate-500 mb-2 block font-medium">LC 데이터 (JSON)</label>
          <textarea
            value={lcData}
            onChange={(e) => setLcData(e.target.value)}
            placeholder='{"45A": "...", "46A": "...", "47A": "..."}'
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white font-mono h-24"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-2 block font-medium">서류 PDF 업로드</label>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
            >
              파일 선택
            </button>
            <span className="text-sm text-slate-600">{file?.name || '선택된 파일 없음'}</span>
          </div>
        </div>

        <button
          onClick={handleVerify}
          disabled={!file || !lcData || loading}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '검증 중...' : '서류 검증'}
        </button>
      </div>

      {/* Results Section */}
      {verification && (
        <>
          {/* Document Type */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">서류 유형</h3>
            <p className="text-lg font-bold text-slate-800">{verification.document_type}</p>
          </div>

          {/* Summary */}
          <div className={`card p-5 border-l-4 ${verification.summary.includes('discrepanc') ? 'border-l-amber-400 bg-amber-50/40' : 'border-l-emerald-400 bg-emerald-50/40'}`}>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">검증 결과</h3>
            <p className="text-sm text-slate-700">{verification.summary}</p>
          </div>

          {/* Extracted Fields */}
          {verification.extracted_fields && Object.keys(verification.extracted_fields).length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">추출된 항목</h3>
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(verification.extracted_fields).map(([key, value]) => (
                  <div key={key}>
                    <p className="text-xs text-slate-500 mb-1 font-medium">{key}</p>
                    <p className="text-sm text-slate-700">{String(value) || '-'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Discrepancies */}
          {verification.discrepancies && verification.discrepancies.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">불일치 사항</h3>
              <div className="space-y-3">
                {verification.discrepancies.map((disc: any, idx: number) => {
                  const severityColor = disc.severity === 'error' ? 'bg-rose-50 border-l-rose-400 text-rose-700' :
                    disc.severity === 'warning' ? 'bg-amber-50 border-l-amber-400 text-amber-700' : 'bg-blue-50 border-l-blue-400 text-blue-700';
                  return (
                    <div key={idx} className={`border-l-4 p-3 rounded ${severityColor}`}>
                      <p className="text-xs font-semibold mb-1">{disc.field}</p>
                      <p className="text-xs">LC 요구: {disc.lc_value}</p>
                      <p className="text-xs">서류: {disc.doc_value}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ============ MPOB TAB ============

type MpobSubTab = 'stock' | 'production' | 'export_port' | 'export_product' | 'all';

const MPOB_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const MPOB_CATEGORIES: { id: MpobSubTab; label: string; aggType: 'average' | 'total' }[] = [
  { id: 'stock', label: 'Stock (재고)', aggType: 'average' },
  { id: 'production', label: 'Production (생산)', aggType: 'total' },
  { id: 'export_port', label: 'Export by Port', aggType: 'total' },
  { id: 'export_product', label: 'Export by Product', aggType: 'total' },
  { id: 'all', label: '전체 보기', aggType: 'total' },
];

interface MpobRow {
  item_name: string;
  parent_group: string | null;
  sort_order: number;
  months: { [month: number]: { value: number | null; value_rm: number | null } };
  prevYear: { [month: number]: { value: number | null; value_rm: number | null } };
}

const MPOBTab = () => {
  const { canWrite } = useAuth();
  const [subTab, setSubTab] = useState<MpobSubTab>('stock');
  const [year, setYear] = useState(2026);
  const [availableYears, setAvailableYears] = useState<number[]>([2025, 2026]);
  const [data, setData] = useState<Record<string, MpobRow[]>>({});
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editCell, setEditCell] = useState<{ cat: string; item: string; month: number; field: 'value' | 'value_rm' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const editRef = useRef<HTMLInputElement>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkCategory, setBulkCategory] = useState<string>('stock');

  const categoriesToFetch = subTab === 'all'
    ? ['stock', 'production', 'export_port', 'export_product']
    : [subTab];

  useEffect(() => {
    fetchData();
    fetchYears();
  }, [year, subTab]);

  const fetchYears = async () => {
    try {
      const res = await fetch('/api/mpob');
      const json = await res.json();
      if (json.years?.length) setAvailableYears(json.years);
    } catch {}
  };

  const parseMpobRows = (rows: any[], prevRows: any[]): MpobRow[] => {
    const itemMap = new Map<string, MpobRow>();
    for (const r of rows) {
      if (!itemMap.has(r.item_name)) {
        itemMap.set(r.item_name, {
          item_name: r.item_name, parent_group: r.parent_group,
          sort_order: r.sort_order, months: {}, prevYear: {},
        });
      }
      itemMap.get(r.item_name)!.months[r.month] = {
        value: r.value != null ? Number(r.value) : null,
        value_rm: r.value_rm != null ? Number(r.value_rm) : null,
      };
    }
    for (const r of prevRows) {
      if (!itemMap.has(r.item_name)) continue;
      itemMap.get(r.item_name)!.prevYear[r.month] = {
        value: r.value != null ? Number(r.value) : null,
        value_rm: r.value_rm != null ? Number(r.value_rm) : null,
      };
    }
    return Array.from(itemMap.values()).sort((a, b) => a.sort_order - b.sort_order);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const prevYear = year - 1;
      // Fetch all categories in parallel (current year + previous year)
      const fetches = categoriesToFetch.flatMap(cat => [
        fetch(`/api/mpob?category=${cat}&year=${year}`).then(r => r.json()).then(j => ({ cat, year: year, data: j.data || [] })),
        fetch(`/api/mpob?category=${cat}&year=${prevYear}`).then(r => r.json()).then(j => ({ cat, year: prevYear, data: j.data || [] })),
      ]);
      const allResults = await Promise.all(fetches);

      const results: Record<string, MpobRow[]> = {};
      for (const cat of categoriesToFetch) {
        const curData = allResults.find(r => r.cat === cat && r.year === year)?.data || [];
        const prevData = allResults.find(r => r.cat === cat && r.year !== year)?.data || [];
        results[cat] = parseMpobRows(curData, prevData);
      }
      setData(results);
    } catch (err) {
      console.error('MPOB fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch('/api/mpob/seed', { method: 'POST' });
      const json = await res.json();
      if (json.error) {
        alert(`Seed 실패: ${json.error}`);
      } else {
        alert(json.message || `Seed 완료: ${json.count}건`);
        fetchData();
        fetchYears();
      }
    } catch (err) {
      alert('Seed 실패 — 먼저 Supabase에서 mpob_data 테이블을 생성해주세요.');
    } finally {
      setSeeding(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/mpob/sync', { method: 'POST' });
      const json = await res.json();
      if (json.error) {
        alert(`MPOB 자동 동기화 실패: ${json.error}`);
      } else {
        alert(json.message || `동기화 완료: ${json.count}건`);
        fetchData();
        fetchYears();
      }
    } catch (err) {
      alert('MPOB 자동 동기화 실패 — 네트워크 또는 MPOB 로그인 정보를 확인하세요.');
    } finally {
      setSyncing(false);
    }
  };

  const handleCellClick = (cat: string, item: string, month: number, field: 'value' | 'value_rm', currentVal: number | null) => {
    if (!canWrite) return;
    setEditCell({ cat, item, month, field });
    setEditValue(currentVal != null ? String(currentVal) : '');
    setTimeout(() => editRef.current?.select(), 50);
  };

  const handleCellSave = async () => {
    if (!editCell) return;
    const parsed = editValue.trim() === '' ? null : parseFloat(editValue.replace(/,/g, ''));
    const { cat, item, month, field } = editCell;

    // Find current values
    const row = data[cat]?.find(r => r.item_name === item);
    const cur = row?.months[month] || { value: null, value_rm: null };

    try {
      await fetch('/api/mpob', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: cat,
          item_name: item,
          year,
          month,
          value: field === 'value' ? parsed : cur.value,
          value_rm: field === 'value_rm' ? parsed : cur.value_rm,
        }),
      });
      fetchData();
    } catch {}
    setEditCell(null);
  };

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCellSave();
    if (e.key === 'Escape') setEditCell(null);
  };

  const handleBulkPaste = async () => {
    if (!bulkText.trim()) return;
    // Parse tab/space separated data: item_name, jan, feb, mar, ..., dec
    const lines = bulkText.trim().split('\n');
    const records: any[] = [];
    for (const line of lines) {
      const parts = line.split(/\t/).map(s => s.trim());
      if (parts.length < 2) continue;
      const itemName = parts[0];
      for (let m = 1; m < parts.length && m <= 12; m++) {
        const raw = parts[m].replace(/,/g, '');
        const val = raw === '' || raw === '-' ? null : parseFloat(raw);
        if (val == null && raw !== '' && raw !== '-') continue;
        records.push({
          category: bulkCategory,
          item_name: itemName,
          year,
          month: m,
          value: val,
          value_rm: null,
          sort_order: 0,
        });
      }
    }
    if (records.length === 0) { alert('파싱할 데이터가 없습니다.'); return; }
    try {
      const res = await fetch('/api/mpob', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      });
      const json = await res.json();
      alert(`${json.count || records.length}건 업데이트 완료`);
      setBulkOpen(false);
      setBulkText('');
      fetchData();
    } catch (err) {
      alert('Bulk 업데이트 실패');
    }
  };

  const addYear = () => {
    const maxYear = Math.max(...availableYears, year);
    const newYear = maxYear + 1;
    setAvailableYears(prev => [...prev, newYear]);
    setYear(newYear);
  };

  // Calculate aggregate (average or total) for filled months
  const calcAggregate = (row: MpobRow, aggType: 'average' | 'total', field: 'value' | 'value_rm' = 'value') => {
    const filled = Object.entries(row.months)
      .filter(([_, v]) => v[field] != null)
      .map(([_, v]) => v[field] as number);
    if (filled.length === 0) return null;
    const sum = filled.reduce((a, b) => a + b, 0);
    return aggType === 'average' ? Math.round(sum / filled.length) : sum;
  };

  const getAggLabel = (rows: MpobRow[], aggType: 'average' | 'total') => {
    // Find max filled month across all rows
    let maxMonth = 0;
    for (const row of rows) {
      for (const m of Object.keys(row.months)) {
        const mi = parseInt(m);
        if (row.months[mi]?.value != null && mi > maxMonth) maxMonth = mi;
      }
    }
    if (maxMonth === 0) return aggType === 'average' ? 'Average' : 'Total';
    const from = MPOB_MONTHS[0];
    const to = MPOB_MONTHS[maxMonth - 1];
    return `${from}-${to} ${aggType === 'average' ? 'Avg' : 'Total'}`;
  };

  const yoyPct = (cur: number | null, prev: number | null) => {
    if (cur == null || prev == null || prev === 0) return null;
    return ((cur - prev) / prev) * 100;
  };

  const YoyBadge = ({ cur, prev }: { cur: number | null; prev: number | null }) => {
    const pct = yoyPct(cur, prev);
    if (pct == null) return null;
    const color = pct > 0 ? 'text-emerald-600' : pct < 0 ? 'text-rose-600' : 'text-slate-400';
    return <span className={`block text-[9px] ${color} leading-tight`}>{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</span>;
  };

  const isHighlight = (name: string) => name === 'RBD PALM OIL';

  const renderTable = (cat: string, rows: MpobRow[], aggType: 'average' | 'total', showRm: boolean = false) => {
    const isSubtotal = (name: string) =>
      ['PEN. MALAYSIA', 'SABAH/SARAWAK', 'MALAYSIA', 'PALM OIL', 'PALM KERNEL OIL', 'TOTAL'].includes(name);

    return (
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 sticky left-0 bg-slate-50 min-w-[160px] z-10">Products</th>
                {MPOB_MONTHS.map(m => (
                  <th key={m} className="px-2 py-2.5 text-right font-semibold text-slate-600 min-w-[80px]">{m}</th>
                ))}
                <th className="px-3 py-2.5 text-right font-semibold text-blue-700 min-w-[100px] bg-blue-50/50">{getAggLabel(rows, aggType)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((row) => {
                const isSub = isSubtotal(row.item_name);
                const hl = isHighlight(row.item_name);
                const rowBg = hl ? 'bg-amber-50/60' : isSub ? 'bg-slate-100/60 font-semibold' : '';
                const stickyBg = hl ? 'bg-amber-50/60' : isSub ? 'bg-slate-100/60 font-semibold' : 'bg-white';
                return (
                  <React.Fragment key={row.item_name}>
                    {/* Tonnes row */}
                    <tr className={`hover:bg-slate-50/80 ${rowBg}`}>
                      <td className={`px-3 py-2 sticky left-0 z-10 ${stickyBg} ${hl ? 'font-semibold text-amber-800' : 'text-slate-700'}`}>
                        {hl && <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full mr-1.5 align-middle" />}
                        {row.item_name}
                        {showRm && <span className="ml-1 text-[10px] text-slate-400">(T)</span>}
                      </td>
                      {MPOB_MONTHS.map((_, mi) => {
                        const m = mi + 1;
                        const val = row.months[m]?.value ?? null;
                        const prevVal = row.prevYear?.[m]?.value ?? null;
                        const isEditing = editCell?.cat === cat && editCell?.item === row.item_name && editCell?.month === m && editCell?.field === 'value';
                        return (
                          <td key={m} className={`px-2 py-1.5 text-right tabular-nums ${hl ? 'font-medium' : ''}`}
                            onClick={() => !isSub && handleCellClick(cat, row.item_name, m, 'value', val)}
                          >
                            {isEditing ? (
                              <input ref={editRef} type="text" value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={handleCellSave} onKeyDown={handleCellKeyDown}
                                className="w-full px-1 py-0.5 text-right text-xs border border-blue-300 rounded bg-blue-50/50"
                              />
                            ) : val != null ? (
                              <div className={`${!isSub ? 'cursor-pointer hover:text-blue-600' : ''}`}>
                                <span>{val.toLocaleString()}</span>
                                <YoyBadge cur={val} prev={prevVal} />
                              </div>
                            ) : !isSub ? (
                              <span className="text-slate-300 cursor-pointer hover:text-blue-400">—</span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                        );
                      })}
                      <td className={`px-3 py-1.5 text-right tabular-nums font-medium bg-blue-50/30 ${hl ? 'text-amber-700' : 'text-blue-700'}`}>
                        {calcAggregate(row, aggType, 'value')?.toLocaleString() ?? '—'}
                      </td>
                    </tr>
                    {/* RM row (export_product only) */}
                    {showRm && (
                      <tr className={`hover:bg-slate-50/80 ${isSub ? 'bg-slate-100/60' : hl ? 'bg-amber-50/40' : ''}`}>
                        <td className={`px-3 py-1.5 text-slate-400 text-[10px] sticky left-0 z-10 ${isSub ? 'bg-slate-100/60' : hl ? 'bg-amber-50/40' : 'bg-white'}`}>
                          <span className="ml-3">RM Mil</span>
                        </td>
                        {MPOB_MONTHS.map((_, mi) => {
                          const m = mi + 1;
                          const val = row.months[m]?.value_rm ?? null;
                          const prevVal = row.prevYear?.[m]?.value_rm ?? null;
                          const isEditing = editCell?.cat === cat && editCell?.item === row.item_name && editCell?.month === m && editCell?.field === 'value_rm';
                          return (
                            <td key={m} className="px-2 py-1.5 text-right tabular-nums text-slate-500"
                              onClick={() => !isSub && handleCellClick(cat, row.item_name, m, 'value_rm', val)}
                            >
                              {isEditing ? (
                                <input ref={editRef} type="text" value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onBlur={handleCellSave} onKeyDown={handleCellKeyDown}
                                  className="w-full px-1 py-0.5 text-right text-xs border border-blue-300 rounded bg-blue-50/50"
                                />
                              ) : val != null ? (
                                <div className={`${!isSub ? 'cursor-pointer hover:text-blue-600' : ''}`}>
                                  <span>{val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                  <YoyBadge cur={val} prev={prevVal} />
                                </div>
                              ) : !isSub ? (
                                <span className="text-slate-300 cursor-pointer hover:text-blue-400">—</span>
                              ) : <span className="text-slate-300">—</span>}
                            </td>
                          );
                        })}
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-blue-600 bg-blue-50/30 text-[11px]">
                          {calcAggregate(row, aggType, 'value_rm')?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-slate-800">MPOB 데이터</h2>
          <div className="flex items-center gap-1.5">
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={addYear} className="px-2 py-1.5 text-xs bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200" title="새 연도 추가">+</button>
          </div>
        </div>
        {canWrite && (
        <div className="flex gap-2">
          <button onClick={handleSync} disabled={syncing} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50" title="MPOB BEPI에 로그인해 재고·생산·수출(항구/품목) 최신 수치를 자동으로 가져옵니다">
            {syncing ? 'MPOB 가져오는 중...' : '🔄 MPOB 자동 가져오기'}
          </button>
          <button onClick={() => setBulkOpen(true)} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium">
            Bulk 붙여넣기
          </button>
          <button onClick={handleSeed} disabled={seeding} className="px-3 py-1.5 text-xs bg-slate-600 text-white rounded-lg hover:bg-slate-700 font-medium disabled:opacity-50">
            {seeding ? 'Seeding...' : '초기 데이터 Seed'}
          </button>
        </div>
        )}
      </div>

      {/* Sub Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
        {MPOB_CATEGORIES.map(c => (
          <button key={c.id} onClick={() => setSubTab(c.id)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              subTab === c.id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-4">{[...Array(2)].map((_, i) => <Shimmer key={i} className="h-60" />)}</div>
      ) : (
        <>
          {categoriesToFetch.map(cat => {
            const rows = data[cat] || [];
            if (rows.length === 0 && subTab !== 'all') {
              return (
                <div key={cat} className="card p-8 text-center">
                  <p className="text-slate-500 text-sm">{year}년 데이터가 없습니다.</p>
                  <p className="text-slate-400 text-xs mt-1">초기 데이터 Seed 버튼을 눌러 데이터를 생성하거나 Bulk 붙여넣기로 입력하세요.</p>
                </div>
              );
            }
            if (rows.length === 0) return null;
            const catInfo = MPOB_CATEGORIES.find(c => c.id === cat) || MPOB_CATEGORIES[0];
            return (
              <div key={cat}>
                {subTab === 'all' && (
                  <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                    {catInfo.label} <span className="text-xs font-normal text-slate-400">({year})</span>
                  </h3>
                )}
                {renderTable(cat, rows, catInfo.aggType, cat === 'export_product')}
              </div>
            );
          })}
        </>
      )}

      {/* Bulk Paste Modal */}
      {bulkOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setBulkOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-800">MPOB Bulk 데이터 붙여넣기</h3>
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-500">카테고리:</label>
              <select value={bulkCategory} onChange={e => setBulkCategory(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg">
                <option value="stock">Stock (재고)</option>
                <option value="production">Production (생산)</option>
                <option value="export_port">Export by Port</option>
                <option value="export_product">Export by Product</option>
              </select>
              <span className="text-xs text-slate-400">연도: {year}</span>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 mb-2">
                탭으로 구분된 데이터를 붙여넣으세요. 형식: 항목명 → Jan → Feb → ... → Dec
              </p>
              <textarea value={bulkText} onChange={e => setBulkText(e.target.value)}
                placeholder={"RBD PALM OIL\t110706\t153472\t105394\t\t\t\t\t\t\t\t\t"}
                className="w-full h-48 px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setBulkOpen(false)} className="px-4 py-2 text-xs text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">취소</button>
              <button onClick={handleBulkPaste} className="px-4 py-2 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 font-medium">업데이트</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============ ADMIN TAB ============

interface AdminUser {
  id: number;
  username: string;
  role: string;
  can_write: boolean;
  approved: boolean;
  terms_agreed: boolean;
  terms_agreed_at: string | null;
  created_at: string;
}

const AdminTab = () => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (data.users) setUsers(data.users);
    } catch (e) {
      console.error('Failed to fetch users:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleApprove = async (userId: number, approve: boolean) => {
    setActionLoading(userId);
    try {
      await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: approve ? 'approve' : 'revoke_approval', userId }),
      });
      await fetchUsers();
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleWrite = async (userId: number, currentValue: boolean) => {
    setActionLoading(userId);
    try {
      await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_write', userId, canWrite: !currentValue }),
      });
      await fetchUsers();
    } finally {
      setActionLoading(null);
    }
  };

  const handleResetPassword = async (userId: number, username: string) => {
    if (!confirm(`${username}의 비밀번호를 초기화하시겠습니까?\n(초기화 비밀번호: samyang789987!!!)`)) return;
    setActionLoading(userId);
    try {
      await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_password', userId }),
      });
      alert('비밀번호가 초기화되었습니다.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteUser = async (userId: number, username: string) => {
    if (!confirm(`정말 ${username} 계정을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    setActionLoading(userId);
    try {
      await fetch(`/api/admin/users?userId=${userId}`, { method: 'DELETE' });
      await fetchUsers();
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <Shimmer key={i} className="h-16" />)}</div>;

  const pendingUsers = users.filter(u => !u.approved && u.role !== 'master');

  return (
    <div className="space-y-6">
      {/* Pending approval alert */}
      {pendingUsers.length > 0 && (
        <div className="card p-4 border-l-4 border-l-amber-500 bg-amber-50/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-100 text-amber-600">
              <span className="text-base">⏳</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">승인 대기중 사용자: {pendingUsers.length}명</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {pendingUsers.map(u => u.username).join(', ')} — 아래 테이블에서 승인/거부할 수 있습니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="전체 사용자" value={String(users.length)} unit="명" />
        <MetricCard label="마스터 계정" value={String(users.filter(u => u.role === 'master').length)} unit="명" accent="text-blue-600" />
        <MetricCard label="승인 대기" value={String(pendingUsers.length)} unit="명" accent="text-amber-600" />
        <MetricCard label="쓰기 권한 보유" value={String(users.filter(u => u.can_write).length)} unit="명" accent="text-emerald-600" />
      </div>

      {/* Users Table */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800">사용자 관리</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">회원 목록 조회, 권한 변경, 비밀번호 초기화, 계정 삭제</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-3 font-semibold text-slate-500">아이디</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-500">역할</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-500">승인 상태</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-500">쓰기 권한</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-500">약관 동의</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-500">가입일</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-500">관리</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const isPending = !user.approved && user.role !== 'master';
                return (
                <tr key={user.id} className={`border-b border-slate-50 hover:bg-slate-50/50 ${isPending ? 'bg-amber-50/30' : ''}`}>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {user.username}
                    {user.role === 'master' && (
                      <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">MASTER</span>
                    )}
                    {isPending && (
                      <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">대기</span>
                    )}
                  </td>
                  <td className="text-center px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${user.role === 'master' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="text-center px-4 py-3">
                    {user.role === 'master' ? (
                      <span className="text-[10px] text-blue-500 font-medium">자동 승인</span>
                    ) : user.approved ? (
                      <button
                        onClick={() => handleApprove(user.id, false)}
                        disabled={actionLoading === user.id}
                        className="text-[10px] px-3 py-1 rounded-full font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
                        title="승인 취소"
                      >
                        승인됨
                      </button>
                    ) : (
                      <button
                        onClick={() => handleApprove(user.id, true)}
                        disabled={actionLoading === user.id}
                        className="text-[10px] px-3 py-1 rounded-full font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm"
                      >
                        승인하기
                      </button>
                    )}
                  </td>
                  <td className="text-center px-4 py-3">
                    {user.role === 'master' ? (
                      <span className="text-[10px] text-blue-500 font-medium">항상 허용</span>
                    ) : (
                      <button
                        onClick={() => handleToggleWrite(user.id, user.can_write)}
                        disabled={actionLoading === user.id || !user.approved}
                        className={`text-[10px] px-3 py-1 rounded-full font-medium transition-colors ${
                          !user.approved ? 'bg-slate-50 text-slate-300 cursor-not-allowed' :
                          user.can_write
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                        }`}
                      >
                        {user.can_write ? '허용' : '거부'}
                      </button>
                    )}
                  </td>
                  <td className="text-center px-4 py-3">
                    <span className={`text-[10px] ${user.terms_agreed ? 'text-emerald-500' : 'text-slate-300'}`}>
                      {user.terms_agreed ? '동의' : '미동의'}
                    </span>
                  </td>
                  <td className="text-center px-4 py-3 text-slate-400 tabular-nums">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString('ko-KR') : '-'}
                  </td>
                  <td className="text-center px-4 py-3">
                    {user.role !== 'master' ? (
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handleResetPassword(user.id, user.username)}
                          disabled={actionLoading === user.id}
                          className="px-2 py-1 text-[10px] bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition-colors font-medium"
                          title="비밀번호 초기화"
                        >
                          PW초기화
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id, user.username)}
                          disabled={actionLoading === user.id}
                          className="px-2 py-1 text-[10px] bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition-colors font-medium"
                          title="계정 삭제"
                        >
                          삭제
                        </button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-300">—</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info */}
      <div className="card p-4 bg-blue-50/50">
        <p className="text-xs text-blue-700 font-medium">관리자 안내</p>
        <ul className="mt-2 space-y-1 text-[11px] text-blue-600">
          <li>• 일반 회원은 기본적으로 읽기 전용 권한으로 가입됩니다.</li>
          <li>• 쓰기 권한을 부여하면 데이터 수정, 추가, 삭제가 가능합니다.</li>
          <li>• 비밀번호 초기화 시 기본 비밀번호: <span className="font-mono font-semibold">samyang789987!!!</span></li>
          <li>• 마스터 계정은 삭제할 수 없습니다.</li>
        </ul>
      </div>
    </div>
  );
};

// ============ NAV ICON (Tabler-style outline SVG) ============
const NavIcon = ({ name, className = 'w-[18px] h-[18px]' }: { name: string; className?: string }) => {
  const paths: Record<string, React.ReactNode> = {
    dashboard: <><path d="M4 4h6v8H4z" /><path d="M4 16h6v4H4z" /><path d="M14 12h6v8h-6z" /><path d="M14 4h6v4h-6z" /></>,
    'trending-up': <><path d="M3 17l6-6l4 4l8-8" /><path d="M14 7h7v7" /></>,
    ruler: <><path d="M5 4h14a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1z" /><path d="M4 8l2 0M8 4l0 2M12 8l0 -2M16 8l2 0M8 11l0 -2" /></>,
    bank: <><path d="M3 21l18 0" /><path d="M3 10l18 0" /><path d="M5 6l7 -3l7 3" /><path d="M4 10l0 11M20 10l0 11M8 14l0 3M12 14l0 3M16 14l0 3" /></>,
    news: <><path d="M16 6h3a1 1 0 0 1 1 1v11a2 2 0 0 1 -4 0v-13a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1v12a3 3 0 0 0 3 3h11" /><path d="M8 8l4 0M8 12l4 0M8 16l4 0" /></>,
    cash: <><path d="M7 9m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z" /><path d="M14 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M17 9v-2a2 2 0 0 0 -2 -2h-10a2 2 0 0 0 -2 2v6a2 2 0 0 0 2 2h2" /></>,
    package: <><path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5" /><path d="M12 12l8 -4.5M12 12l0 9M12 12l-8 -4.5" /></>,
    'file-text': <><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" /><path d="M9 9l1 0M9 13l6 0M9 17l6 0" /></>,
    'file-check': <><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" /><path d="M9 15l2 2l4 -4" /></>,
    bell: <><path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6" /><path d="M9 17v1a3 3 0 0 0 6 0v-1" /></>,
    settings: <><path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z" /><path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /></>,
  };
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.dashboard}
    </svg>
  );
};

// ============ MAIN COMPONENT ============

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userRole, setUserRole] = useState<string>('user');
  const [userName, setUserName] = useState<string>('');
  const [canWrite, setCanWrite] = useState(false);
  // 헤더 새로고침 트리거: 증가 시 활성 탭 컴포넌트가 재마운트되어 자체 fetch가 재실행됨
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshSpinning, setRefreshSpinning] = useState(false);

  const handleHeaderRefresh = () => {
    setRefreshSpinning(true);
    fetchDashboardData(); // 대시보드 데이터는 항상 함께 갱신
    setRefreshTick(t => t + 1); // 활성 탭 컴포넌트 재마운트 (key 변경)
    setTimeout(() => setRefreshSpinning(false), 600);
  };

  useEffect(() => {
    fetchDashboardData();
    fetchUserInfo();
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchUserInfo = async () => {
    try {
      const res = await fetch('/api/auth/check');
      const data = await res.json();
      if (data.authenticated) {
        setUserName(data.user || '');
        setUserRole(data.role || 'user');
        setCanWrite(data.canWrite || data.role === 'master');
      }
    } catch (e) {
      console.error('Failed to fetch user info:', e);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const res = await fetch('/api/dashboard');
      const json: DashboardData = await res.json();
      setDashboardData(json);
      setLastSyncTime(new Date().toLocaleTimeString('ko-KR'));
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  type NavItem = { id: Tab; label: string; icon: string; masterOnly?: boolean };
  const navSections: { title: string | null; divider?: boolean; items: NavItem[] }[] = [
    { title: null, items: [
      { id: 'dashboard', label: '대시보드', icon: 'dashboard' },
    ]},
    { title: '시황 분석', items: [
      { id: 'fcpo', label: 'FCPO 가격', icon: 'trending-up' },
      { id: 'box-range', label: '박스권 분석', icon: 'ruler' },
      { id: 'mpob', label: 'MPOB 수급', icon: 'bank' },
      { id: 'news', label: '뉴스', icon: 'news' },
    ]},
    { title: '구매 · 재고', items: [
      { id: 'purchases', label: '구매 이력', icon: 'cash' },
      { id: 'inventory', label: '재고 관리', icon: 'package' },
    ]},
    { title: '무역 실무', items: [
      { id: 'lc', label: 'LC 개설', icon: 'file-text' },
      { id: 'doc-verify', label: '서류 검증', icon: 'file-check' },
    ]},
    { title: null, divider: true, items: [
      { id: 'alerts', label: '알림', icon: 'bell' },
      { id: 'admin', label: '관리자', icon: 'settings', masterOnly: true },
    ]},
  ];
  const allNavItems: NavItem[] = navSections.flatMap(s => s.items);

  const alertCount = dashboardData?.alerts?.filter(a => a.alert_level !== 'normal').length || 0;

  return (
    <AuthContext.Provider value={{ canWrite, role: userRole }}>
    <div className="flex h-screen bg-slate-100">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* SIDEBAR */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-60 bg-white border-r border-slate-200 flex flex-col shadow-sm transform transition-transform duration-200 lg:relative lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-white text-sm">🌴</span>
            </div>
            <div>
              <h1 className="text-slate-800 font-bold text-sm tracking-tight">Palm Oil Manager</h1>
              <p className="text-slate-400 text-[10px]">삼양식품 기초원료구매팀</p>
            </div>
          </div>
        </div>

        {/* Navigation — 섹션 그룹 + 왼쪽 액센트바 */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto">
          {navSections.map((section, si) => {
            const visible = section.items.filter(item => !item.masterOnly || userRole === 'master');
            if (visible.length === 0) return null;
            return (
              <div key={si} className={section.divider ? 'mt-3 pt-3 border-t border-slate-100' : si > 0 ? 'mt-4' : ''}>
                {section.title && (
                  <p className="px-3 mb-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">{section.title}</p>
                )}
                <div className="space-y-0.5">
                  {visible.map((item) => {
                    const active = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
                        className={`relative w-full flex items-center gap-3 pl-3 pr-3 py-2 rounded-lg transition-all duration-150 ${
                          active ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-blue-600 rounded-r-full" />}
                        <NavIcon name={item.icon} className={`w-[18px] h-[18px] ${active ? 'text-blue-600' : 'text-slate-400'}`} />
                        <span className="text-sm">{item.label}</span>
                        {item.id === 'alerts' && alertCount > 0 && (
                          <span className="ml-auto text-[10px] font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                            {alertCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="px-4 py-3 border-t border-slate-100 space-y-2.5">
          <div className="text-xs text-slate-400">
            <p className="text-[10px] uppercase tracking-wider font-medium text-slate-300 mb-0.5">마지막 동기화</p>
            <p className="tabular-nums">{lastSyncTime || '대기 중'}</p>
          </div>
          <div className="flex items-center gap-2.5 pt-2 border-t border-slate-100">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${userRole === 'master' ? 'bg-gradient-to-br from-blue-500 to-indigo-600' : 'bg-gradient-to-br from-slate-400 to-slate-500'}`}>
              <span className="text-white text-[10px] font-bold">{userName ? userName[0].toUpperCase() : '?'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-700 truncate">{userName || '사용자'}</p>
              <p className="text-[10px] text-slate-400 truncate">
                {userRole === 'master' ? 'Master' : (canWrite ? '읽기/쓰기' : '읽기 전용')}
              </p>
            </div>
            <button
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.href = '/login';
              }}
              className="p-1.5 text-slate-300 hover:text-slate-500 transition-colors"
              title="로그아웃"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-auto min-w-0">
        <div className="p-3 md:p-6 max-w-7xl">
          {/* Header */}
          <div className="mb-4 md:mb-6 flex items-center justify-between">
            {/* Mobile hamburger */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden mr-3 p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
              aria-label="메뉴 열기"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              {(() => {
                const sec = navSections.find(s => s.items.some(i => i.id === activeTab));
                return (
                  <>
                    <h2 className="text-xl font-bold text-slate-800">
                      {sec?.title && <span className="text-slate-400 font-medium">{sec.title} › </span>}
                      {allNavItems.find((item) => item.id === activeTab)?.label}
                    </h2>
                    <p className="text-slate-400 text-xs mt-0.5">팜유 수급 관리 시스템</p>
                  </>
                );
              })()}
            </div>
            <button
              onClick={handleHeaderRefresh}
              disabled={refreshSpinning}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm flex items-center gap-2"
              title="현재 탭 데이터를 다시 불러옵니다"
            >
              <svg className={`w-4 h-4 ${refreshSpinning ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {refreshSpinning ? '새로고침 중...' : '새로고침'}
            </button>
          </div>

          {/* Tab Content — key에 refreshTick 포함하여 헤더 새로고침 시 자동 재마운트 (자체 fetch 재실행) */}
          {activeTab === 'dashboard' && <DashboardTab data={dashboardData} loading={loading} onNavigate={setActiveTab} />}
          {activeTab === 'fcpo' && <FCPOTab key={`fcpo-${refreshTick}`} />}
          {activeTab === 'inventory' && <InventoryTab key={`inv-${refreshTick}`} />}
          {activeTab === 'box-range' && <BoxRangeTab key={`br-${refreshTick}`} />}
          {activeTab === 'purchases' && <PurchasesTab key={`pur-${refreshTick}`} />}
          {activeTab === 'news' && <NewsTab key={`news-${refreshTick}`} />}
          {activeTab === 'alerts' && <AlertsTab key={`alerts-${refreshTick}`} />}
          {activeTab === 'mpob' && <MPOBTab key={`mpob-${refreshTick}`} />}
          {activeTab === 'lc' && <LCTab key={`lc-${refreshTick}`} />}
          {activeTab === 'doc-verify' && <DocVerifyTab key={`dv-${refreshTick}`} />}
          {activeTab === 'admin' && userRole === 'master' && <AdminTab key={`adm-${refreshTick}`} />}
        </div>
      </main>
    </div>
    </AuthContext.Provider>
  );
}
