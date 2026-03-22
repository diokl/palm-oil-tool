'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Bar
} from 'recharts';

type Tab = 'dashboard' | 'fcpo' | 'inventory' | 'box-range' | 'purchases' | 'news' | 'alerts';
type InventorySubTab = 'rbd2025' | 'rbd2026' | 'rspo2025' | 'rspo2026';

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
  shipment_month: string;
  contract_date: string;
  contract_price: number;
  quantity_mt: number | null;
  supplier: string | null;
  market_price: number;
  price_diff: number;
  prebuy_effect_krw: number;
  evaluation: string;
  product: string;
  notes: string;
}

interface DashboardData {
  alerts: DashboardAlert[];
  fcpo_latest: FCPOLatest[];
  fcpo_latest_date: string;
  inventory_summary: InventorySummaryItem[];
  box_ranges: BoxRangeItem[];
  recent_purchases: RecentPurchaseItem[];
  recent_news: NewsItem[];
  ai_analysis: string | null;
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
  shipment_month: string;
  contract_date: string;
  contract_price: number;
  quantity_mt: number | null;
  supplier: string | null;
  market_price: number;
  price_diff: number;
  prebuy_effect_krw: number;
  evaluation: string;
  product: string;
  notes: string;
  incoterms: string | null;
  payment_terms: string | null;
  loading_port: string | null;
  discharge_port: string | null;
  contract_number: string | null;
}

interface PurchasesResponse {
  data: PurchaseItem[];
  summary: {
    total: number;
    successful: number;
    success_rate: string;
    total_effect: number;
    avg_diff: number;
  };
}

interface NewsItem {
  id: number;
  date: string;
  content: string;
  sentiment: string;
  impact: string;
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

const AlertBanner = ({ alert }: { alert: DashboardAlert }) => {
  const isCritical = alert.alert_level === 'critical';
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
      <button className="px-3.5 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-medium hover:bg-slate-700 transition-colors whitespace-nowrap shadow-sm">
        조치
      </button>
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
          <h3 className="text-sm font-semibold text-slate-700">{data.contract_month} 박스권 분석</h3>
          <span className={`inline-block mt-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${zoneStyle}`}>
            {data.current_zone}
          </span>
        </div>
        <p className="text-3xl font-bold text-slate-900 tabular-nums">{formatPrice(current)}</p>
      </div>

      {/* Zone labels */}
      <div className="flex justify-between text-xs px-1">
        <span className="text-emerald-600 font-medium">전량구매</span>
        <span className="text-blue-600 font-medium">적극매수</span>
        <span className="text-amber-600 font-medium">모니터링</span>
        <span className="text-rose-600 font-medium">최소매수</span>
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
              <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">계약가</th>
              <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">시장가</th>
              <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">가격차</th>
              <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">효과</th>
              <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">평가</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((p) => {
              const lower = p.price_diff < 0;
              return (
                <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-slate-800">{p.product}</td>
                  <td className="px-5 py-3.5 tabular-nums text-slate-600">{p.shipment_month}</td>
                  <td className="px-5 py-3.5 tabular-nums text-slate-800 text-right">{formatPrice(p.contract_price)}</td>
                  <td className="px-5 py-3.5 tabular-nums text-slate-500 text-right">{formatPrice(p.market_price)}</td>
                  <td className={`px-5 py-3.5 tabular-nums font-semibold text-right ${lower ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {lower ? '▼' : '▲'} {formatPrice(Math.abs(p.price_diff))}
                  </td>
                  <td className={`px-5 py-3.5 tabular-nums font-semibold text-right ${p.prebuy_effect_krw < 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {formatKRW(p.prebuy_effect_krw)}
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      p.evaluation === '성공' ? 'bg-emerald-50 text-emerald-700' :
                      p.evaluation === '실패' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {p.evaluation}
                    </span>
                  </td>
                </tr>
              );
            })}
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
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
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

// ============ TAB COMPONENTS ============

const DashboardTab = ({ data, loading }: { data: DashboardData | null; loading: boolean }) => {
  const [boxDetail, setBoxDetail] = useState<BoxRangeDetail | null>(null);

  useEffect(() => {
    if (data?.box_ranges?.[0]?.contract_month) {
      fetch(`/api/box-range?contract_month=${data.box_ranges[0].contract_month}`)
        .then(r => r.json())
        .then(d => { if (d && !d.error) setBoxDetail(d); })
        .catch(() => {});
    }
  }, [data?.box_ranges]);

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Shimmer className="h-20" />
        <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <Shimmer key={i} className="h-28" />)}</div>
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
      {/* Alerts */}
      {data.alerts?.filter(a => a.alert_level !== 'normal').map((alert, idx) => (
        <AlertBanner key={idx} alert={alert} />
      ))}

      {/* Metric Cards */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="FCPO 근월물 (USD)" value={formatPrice(latestFCPO?.settlement_usd)} unit={`기준일: ${data.fcpo_latest_date || '-'}`} />
        <MetricCard
          label="박스권 위치"
          value={data.box_ranges?.[0]?.zone || '-'}
          unit={`${data.box_ranges?.[0]?.contract_month || ''} 기준`}
          accent={
            data.box_ranges?.[0]?.zone === '전량구매' ? 'text-emerald-600' :
            data.box_ranges?.[0]?.zone === '적극매수' ? 'text-blue-600' :
            data.box_ranges?.[0]?.zone === '구매대기' ? 'text-rose-600' : 'text-slate-900'
          }
        />
        <MetricCard label="RBD 재고" value={rbd ? `${(rbd.ending_stock / 1000).toFixed(0)}K` : '-'} unit={rbd ? `회전일 ${rbd.coverage_days}일` : ''} />
        <MetricCard label="RSPO 재고" value={rspo ? `${(rspo.ending_stock / 1000).toFixed(0)}K` : '-'} unit={rspo ? `회전일 ${rspo.coverage_days}일` : ''} />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-3">
          {boxDetail?.zones ? <BoxRangeGauge data={boxDetail} /> : <Shimmer className="h-80" />}
        </div>
        <div className="col-span-2 space-y-5">
          {/* AI Analysis */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full" />
              AI 시황 분석
            </h3>
            {data.ai_analysis ? (
              <p className="text-sm text-slate-600 leading-relaxed">{typeof data.ai_analysis === 'object' ? JSON.stringify(data.ai_analysis) : data.ai_analysis}</p>
            ) : (
              <div className="text-sm text-slate-500">
                <p className="mb-3">뉴스/시황 데이터를 입력한 후 AI 분석을 실행하세요.</p>
                <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors shadow-sm">
                  분석 실행
                </button>
              </div>
            )}
          </div>

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

      {/* Recent Purchases */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">최근 구매 이력</h3>
        <RecentPurchasesTable data={data.recent_purchases || []} loading={false} />
      </div>
    </div>
  );
};

const FCPOTab = () => {
  const [fcpoData, setFcpoData] = useState<any[]>([]);
  const [contractMonths, setContractMonths] = useState<string[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [localLoading, setLocalLoading] = useState(false);

  // Manual input state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPrice, setNewPrice] = useState({ date: '', contract_month: '', settlement_usd: '', settlement_myr: '', exchange_rate: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchFCPOData(); }, []);

  const fetchFCPOData = async () => {
    setLocalLoading(true);
    try {
      const res = await fetch('/api/fcpo');
      const json: FCPOData = await res.json();
      setFcpoData(json.data || []);
      const months = json.contract_months || [];
      const recentMonths = months.filter((m: string) => m >= '2025-01');
      setContractMonths(recentMonths);
      const defaultSelected = recentMonths.filter((m: string) => m >= '2026-01' && m <= '2026-06').slice(0, 4);
      setSelectedMonths(defaultSelected.length > 0 ? defaultSelected : recentMonths.slice(-4));
    } catch (error) {
      console.error('Failed to fetch FCPO data:', error);
    } finally {
      setLocalLoading(false);
    }
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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-800">FCPO 가격 추이</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm ${
                showAddForm ? 'bg-slate-200 text-slate-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              {showAddForm ? '취소' : '+ 가격 입력'}
            </button>
            <button onClick={fetchFCPOData} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors">
              새로고침
            </button>
          </div>
        </div>

        {/* Manual Price Input Form */}
        {showAddForm && (
          <div className="mb-4 p-4 bg-blue-50/50 rounded-xl border border-blue-100 space-y-3 animate-fade-in">
            <p className="text-sm font-semibold text-slate-700">FCPO 가격 수동 입력</p>
            <div className="grid grid-cols-5 gap-3">
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
                <label className="text-xs text-slate-500 mb-1 block">정산가 (USD) *</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="1067.5"
                  value={newPrice.settlement_usd}
                  onChange={(e) => setNewPrice({ ...newPrice, settlement_usd: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">정산가 (MYR)</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="4580"
                  value={newPrice.settlement_myr}
                  onChange={(e) => setNewPrice({ ...newPrice, settlement_myr: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">환율 (MYR/USD)</label>
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
            <ComposedChart data={fcpoData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" stroke="#94a3b8" style={{ fontSize: '11px' }} />
              <YAxis stroke="#94a3b8" style={{ fontSize: '11px' }} />
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
                const colors = ['#2563eb', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4'];
                return (
                  <Line key={month} type="monotone" dataKey={`${month}_usd`} stroke={colors[idx % colors.length]} strokeWidth={2} dot={{ r: 2 }} name={`${month} USD`} />
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
              {fcpoData.slice(-20).map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3 font-medium text-slate-700 text-sm">{row.date}</td>
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

const InventoryTab = () => {
  const [subTab, setSubTab] = useState<InventorySubTab>('rbd2026');
  const [inventoryData, setInventoryData] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingCell, setEditingCell] = useState<string | null>(null);

  useEffect(() => { fetchInventory(); }, [subTab]);

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const [product, year] = subTab.includes('rbd')
        ? ['RBD', parseInt(subTab.slice(3))]
        : ['RSPO', parseInt(subTab.slice(4))];
      const res = await fetch(`/api/inventory?product=${product}&year=${year}`);
      const json: InventoryResponse = await res.json();
      setInventoryData(json.data || []);
    } catch (error) {
      console.error('Failed to fetch inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCellSave = async (rowId: number, field: string, value: number) => {
    try {
      const res = await fetch('/api/inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rowId, field, value, updated_by: 'user' }),
      });
      if (res.ok) {
        // Refresh data to get recalculated values
        fetchInventory();
      }
    } catch (error) {
      console.error('Failed to update inventory:', error);
    }
  };

  const subTabs: { id: InventorySubTab; label: string }[] = [
    { id: 'rbd2025', label: 'RBD 2025' },
    { id: 'rbd2026', label: 'RBD 2026' },
    { id: 'rspo2025', label: 'RSPO 2025' },
    { id: 'rspo2026', label: 'RSPO 2026' },
  ];

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
        <p className="text-xs text-slate-400">
          <span className="inline-block w-2 h-2 bg-blue-200 rounded mr-1" />
          셀을 클릭하면 편집할 수 있습니다
        </p>
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
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">계약단가</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">계약월</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inventoryData.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3 font-semibold text-slate-800">{row.month}월</td>
                    <td className="px-5 py-3">
                      <EditableCell
                        value={row.expected_usage}
                        onSave={(val) => handleCellSave(row.id, 'expected_usage', val)}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <EditableCell
                        value={row.customs_volume}
                        onSave={(val) => handleCellSave(row.id, 'customs_volume', val)}
                      />
                    </td>
                    <td className={`px-5 py-3 tabular-nums font-semibold text-right ${
                      row.ending_stock < 0 ? 'text-rose-600 bg-rose-50/50' :
                      row.ending_stock < 2000000 ? 'text-amber-600 bg-amber-50/50' : 'text-slate-800'
                    }`}>
                      {formatNumber(row.ending_stock)}
                    </td>
                    <td className={`px-5 py-3 tabular-nums font-semibold text-center ${
                      row.coverage_days < 1.5 ? 'text-rose-600' : row.coverage_days < 2.5 ? 'text-amber-600' : 'text-emerald-600'
                    }`}>
                      {row.coverage_days.toFixed(1)}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-slate-600 text-right">{formatPrice(Number(row.contract_price))}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{row.contract_date?.split('\n')[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const BoxRangeTab = () => {
  const [contractMonth, setContractMonth] = useState('2026-04');
  const [boxRangeData, setBoxRangeData] = useState<BoxRangeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [months, setMonths] = useState<string[]>([]);

  useEffect(() => {
    fetchBoxRange();
    fetchAvailableMonths();
  }, [contractMonth]);

  const fetchBoxRange = async () => {
    setLoading(true);
    setBoxRangeData(null);
    try {
      const res = await fetch(`/api/box-range?contract_month=${contractMonth}`);
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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Month Selector */}
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
  product: 'RBD', shipment_month: '', contract_date: '', contract_price: '',
  quantity_mt: '', supplier: '', market_price: '', notes: '',
  incoterms: '', payment_terms: '', loading_port: '', discharge_port: '', contract_number: '',
};

const PurchasesTab = () => {
  const [purchaseData, setPurchaseData] = useState<PurchaseItem[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Add/Edit form
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyPurchaseForm);
  const [saving, setSaving] = useState(false);

  // PDF upload
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Expanded row
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  useEffect(() => { fetchPurchases(); }, []);

  const fetchPurchases = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/purchases');
      const json: PurchasesResponse = await res.json();
      setPurchaseData(json.data || []);
      setSummary(json.summary || null);
    } catch (error) {
      console.error('Failed to fetch purchases:', error);
    } finally {
      setLoading(false);
    }
  };

  const openAddForm = () => {
    setForm(emptyPurchaseForm);
    setFormMode('add');
    setEditId(null);
    setShowForm(true);
  };

  const openEditForm = (p: PurchaseItem) => {
    setForm({
      product: p.product || 'RBD',
      shipment_month: p.shipment_month || '',
      contract_date: p.contract_date || '',
      contract_price: p.contract_price?.toString() || '',
      quantity_mt: p.quantity_mt?.toString() || '',
      supplier: p.supplier || '',
      market_price: p.market_price?.toString() || '',
      notes: p.notes || '',
      incoterms: p.incoterms || '',
      payment_terms: p.payment_terms || '',
      loading_port: p.loading_port || '',
      discharge_port: p.discharge_port || '',
      contract_number: p.contract_number || '',
    });
    setFormMode('edit');
    setEditId(p.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.shipment_month || !form.contract_price) return;
    setSaving(true);
    try {
      const payload: any = {
        product: form.product,
        shipment_month: form.shipment_month,
        contract_date: form.contract_date || null,
        contract_price: parseFloat(form.contract_price),
        quantity_mt: form.quantity_mt ? parseFloat(form.quantity_mt) : null,
        supplier: form.supplier || null,
        market_price: form.market_price ? parseFloat(form.market_price) : null,
        notes: form.notes || null,
        incoterms: form.incoterms || null,
        payment_terms: form.payment_terms || null,
        loading_port: form.loading_port || null,
        discharge_port: form.discharge_port || null,
        contract_number: form.contract_number || null,
      };

      if (formMode === 'edit' && editId) {
        payload.id = editId;
        await fetch('/api/purchases', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } else {
        await fetch('/api/purchases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      setShowForm(false);
      setForm(emptyPurchaseForm);
      fetchPurchases();
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
      fetchPurchases();
    } catch (error) {
      console.error('Failed to delete purchase:', error);
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/purchases/upload', { method: 'POST', body: formData });
      const json = await res.json();
      if (json.success && json.extracted) {
        const ext = json.extracted;
        setForm({
          product: ext.product || 'RBD',
          shipment_month: ext.shipment_month || '',
          contract_date: ext.contract_date || '',
          contract_price: ext.contract_price?.toString() || '',
          quantity_mt: ext.quantity_mt?.toString() || '',
          supplier: ext.supplier || '',
          market_price: '',
          notes: '',
          incoterms: ext.incoterms || '',
          payment_terms: ext.payment_terms || '',
          loading_port: ext.loading_port || '',
          discharge_port: ext.discharge_port || '',
          contract_number: ext.contract_number || '',
        });
        setFormMode('add');
        setEditId(null);
        setShowForm(true);
        setUploadResult(`PDF에서 ${Object.keys(ext).length}개 항목 추출 완료. 내용을 확인 후 저장하세요.`);
      } else {
        setUploadResult(`추출 실패: ${json.error || '알 수 없는 오류'}`);
      }
    } catch (error) {
      setUploadResult('PDF 업로드 중 오류 발생');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const setField = (key: string, val: string) => setForm(prev => ({ ...prev, [key]: val }));

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label="총 구매 건수" value={formatNumber(summary.total)} />
          <MetricCard label="성공 거래" value={`${summary.successful}건`} unit={`성공률 ${summary.success_rate}`} />
          <MetricCard label="평균 절감가" value={formatPrice(Math.abs(summary.avg_diff))} accent="text-emerald-600" />
          <MetricCard label="총 절감효과" value={formatKRW(summary.total_effect)} accent={summary.total_effect < 0 ? 'text-emerald-600' : 'text-rose-500'} />
        </div>
      )}

      {/* Action Bar */}
      <div className="flex items-center gap-3">
        <button onClick={openAddForm} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm">
          + 구매 이력 추가
        </button>
        <div className="relative">
          <input ref={fileInputRef} type="file" accept=".pdf" onChange={handlePdfUpload} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            {uploading ? 'SC PDF 분석 중...' : 'SC PDF 업로드'}
          </button>
        </div>
        {uploadResult && (
          <span className={`text-xs px-3 py-1.5 rounded-full ${uploadResult.includes('완료') ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
            {uploadResult}
          </span>
        )}
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="card p-5 border-blue-100 bg-blue-50/30 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              {formMode === 'edit' ? '구매 이력 수정' : '새 구매 이력 등록'}
            </p>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 text-sm">닫기</button>
          </div>

          {/* Row 1: Core fields */}
          <div className="grid grid-cols-6 gap-3">
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
              <label className="text-xs text-slate-500 mb-1 block">계약일</label>
              <input type="date" value={form.contract_date} onChange={(e) => setField('contract_date', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">계약가 ($/MT) *</label>
              <input type="number" step="0.1" value={form.contract_price} onChange={(e) => setField('contract_price', e.target.value)} placeholder="1010.0" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">수량 (MT)</label>
              <input type="number" step="0.1" value={form.quantity_mt} onChange={(e) => setField('quantity_mt', e.target.value)} placeholder="500" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">
                시장가 ($/MT)
                <span className="text-blue-400 ml-1" title="비워두면 계약일 기준 FCPO에서 자동 매칭">자동</span>
              </label>
              <input type="number" step="0.1" value={form.market_price} onChange={(e) => setField('market_price', e.target.value)} placeholder="자동 매칭" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
            </div>
          </div>

          {/* Row 2: Detail fields */}
          <div className="grid grid-cols-6 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">공급사</label>
              <input type="text" value={form.supplier} onChange={(e) => setField('supplier', e.target.value)} placeholder="Wilmar" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
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
              <label className="text-xs text-slate-500 mb-1 block">선적항</label>
              <input type="text" value={form.loading_port} onChange={(e) => setField('loading_port', e.target.value)} placeholder="Port Klang" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">도착항</label>
              <input type="text" value={form.discharge_port} onChange={(e) => setField('discharge_port', e.target.value)} placeholder="Incheon" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">계약번호</label>
              <input type="text" value={form.contract_number} onChange={(e) => setField('contract_number', e.target.value)} placeholder="SC-2026-001" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
            </div>
          </div>

          {/* Row 3: Notes */}
          <div>
            <label className="text-xs text-slate-500 mb-1 block">비고</label>
            <input type="text" value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="메모 사항" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200">
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.shipment_month || !form.contract_price}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {saving ? '저장 중...' : formMode === 'edit' ? '수정 저장' : '등록'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? <Shimmer className="h-60" /> : purchaseData.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-slate-500 text-sm">등록된 구매 이력이 없습니다</p>
          <p className="text-slate-400 text-xs mt-1">상단의 &quot;+ 구매 이력 추가&quot; 버튼이나 SC PDF 업로드로 추가하세요</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">상품</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">선적월</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">계약일</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">계약가</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">수량(MT)</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">공급사</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">시장가</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">가격차</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">절감효과</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">평가</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {purchaseData.map((p) => {
                  const lower = p.price_diff < 0;
                  const isExpanded = expandedId === p.id;
                  return (
                    <React.Fragment key={p.id}>
                      <tr className="hover:bg-slate-50/60 transition-colors group">
                        <td className="px-4 py-3 font-medium text-slate-800">{p.product}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-600">{p.shipment_month}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{p.contract_date}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-800 text-right font-medium">{formatPrice(p.contract_price)}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-600 text-right">{p.quantity_mt ? formatNumber(p.quantity_mt, 1) : '-'}</td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{p.supplier || '-'}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-500 text-right">{formatPrice(p.market_price)}</td>
                        <td className={`px-4 py-3 tabular-nums font-semibold text-right ${lower ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {p.price_diff != null ? `${lower ? '▼' : '▲'} ${formatPrice(Math.abs(p.price_diff))}` : '-'}
                        </td>
                        <td className={`px-4 py-3 tabular-nums font-semibold text-right ${(p.prebuy_effect_krw || 0) < 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {p.prebuy_effect_krw != null ? formatKRW(p.prebuy_effect_krw) : '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {p.evaluation ? (
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                              p.evaluation === '성공' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                            }`}>{p.evaluation}</span>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setExpandedId(isExpanded ? null : p.id)} className="p-1 text-slate-400 hover:text-blue-600" title="상세보기">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isExpanded ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} /></svg>
                            </button>
                            <button onClick={() => openEditForm(p)} className="p-1 text-slate-400 hover:text-amber-600" title="수정">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                            {deleteConfirm === p.id ? (
                              <button onClick={() => handleDelete(p.id)} className="p-1 text-rose-600 font-medium text-xs">확인</button>
                            ) : (
                              <button onClick={() => setDeleteConfirm(p.id)} className="p-1 text-slate-400 hover:text-rose-600" title="삭제">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Expanded Detail Row */}
                      {isExpanded && (
                        <tr className="bg-slate-50/50">
                          <td colSpan={11} className="px-4 py-3">
                            <div className="grid grid-cols-6 gap-4 text-xs">
                              <div>
                                <span className="text-slate-400 block">계약번호</span>
                                <span className="text-slate-700 font-medium">{p.contract_number || '-'}</span>
                              </div>
                              <div>
                                <span className="text-slate-400 block">Incoterms</span>
                                <span className="text-slate-700 font-medium">{p.incoterms || '-'}</span>
                              </div>
                              <div>
                                <span className="text-slate-400 block">결제조건</span>
                                <span className="text-slate-700 font-medium">{p.payment_terms || '-'}</span>
                              </div>
                              <div>
                                <span className="text-slate-400 block">선적항</span>
                                <span className="text-slate-700 font-medium">{p.loading_port || '-'}</span>
                              </div>
                              <div>
                                <span className="text-slate-400 block">도착항</span>
                                <span className="text-slate-700 font-medium">{p.discharge_port || '-'}</span>
                              </div>
                              <div>
                                <span className="text-slate-400 block">비고</span>
                                <span className="text-slate-700 font-medium">{p.notes || '-'}</span>
                              </div>
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
    </div>
  );
};

const NewsTab = () => {
  const [newsData, setNewsData] = useState<NewsItem[]>([]);
  const [sentimentSummary, setSentimentSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Input form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newNews, setNewNews] = useState({ date: '', content: '', sentiment: '보합', impact: 'Medium' });
  const [saving, setSaving] = useState(false);

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

  const handleAddNews = async () => {
    if (!newNews.content) return;
    setSaving(true);
    try {
      const res = await fetch('/api/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: newNews.date || new Date().toISOString().slice(0, 10),
          content: newNews.content,
          sentiment: newNews.sentiment,
          impact: newNews.impact,
          created_by: 'user',
        }),
      });
      if (res.ok) {
        setShowAddForm(false);
        setNewNews({ date: '', content: '', sentiment: '보합', impact: 'Medium' });
        fetchNews();
      }
    } catch (error) {
      console.error('Failed to add news:', error);
    } finally {
      setSaving(false);
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
        <div className="grid grid-cols-3 gap-4 flex-1 mr-4">
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
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all shadow-sm whitespace-nowrap ${
            showAddForm ? 'bg-slate-200 text-slate-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          {showAddForm ? '취소' : '+ 뉴스 입력'}
        </button>
      </div>

      {/* Add News Form */}
      {showAddForm && (
        <div className="card p-5 border-blue-100 bg-blue-50/30 space-y-3 animate-fade-in">
          <p className="text-sm font-semibold text-slate-700">시황/뉴스 수동 입력</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">날짜</label>
              <input
                type="date"
                value={newNews.date}
                onChange={(e) => setNewNews({ ...newNews, date: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">시황 전망</label>
              <select
                value={newNews.sentiment}
                onChange={(e) => setNewNews({ ...newNews, sentiment: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
              >
                <option value="강세">강세</option>
                <option value="보합">보합</option>
                <option value="약세">약세</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">영향도</label>
              <select
                value={newNews.impact}
                onChange={(e) => setNewNews({ ...newNews, impact: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
              >
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">내용 *</label>
            <textarea
              value={newNews.content}
              onChange={(e) => setNewNews({ ...newNews, content: e.target.value })}
              placeholder="시황 뉴스 내용을 입력하세요... (예: 말레이시아 팜유 생산량 전월 대비 5% 감소)"
              rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white resize-none"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleAddNews}
              disabled={saving || !newNews.content}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      {/* News Grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4">{[...Array(4)].map((_, i) => <Shimmer key={i} className="h-32" />)}</div>
      ) : newsData.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-slate-500 text-sm">등록된 뉴스가 없습니다</p>
          <p className="text-slate-400 text-xs mt-1">상단의 &quot;+ 뉴스 입력&quot; 버튼으로 시황 데이터를 추가하세요</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {newsData.map((news) => <NewsCard key={news.id} news={news} />)}
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

// ============ MAIN COMPONENT ============

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

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

  const navItems: { id: Tab; label: string; icon: string }[] = [
    { id: 'dashboard', label: '대시보드', icon: '📊' },
    { id: 'fcpo', label: 'FCPO 가격', icon: '📈' },
    { id: 'inventory', label: '재고 관리', icon: '📦' },
    { id: 'box-range', label: '박스권 분석', icon: '📏' },
    { id: 'purchases', label: '구매 이력', icon: '💰' },
    { id: 'news', label: '뉴스', icon: '📰' },
    { id: 'alerts', label: '알림', icon: '🔔' },
  ];

  const alertCount = dashboardData?.alerts?.filter(a => a.alert_level !== 'normal').length || 0;

  return (
    <div className="flex h-screen bg-slate-100">
      {/* SIDEBAR */}
      <aside className="w-60 bg-white border-r border-slate-200 flex flex-col shadow-sm">
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

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 ${
                activeTab === item.id
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span className="text-sm font-medium">{item.label}</span>
              {item.id === 'alerts' && alertCount > 0 && (
                <span className="ml-auto text-[10px] font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {alertCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Bottom */}
        <div className="px-4 py-3 border-t border-slate-100 space-y-2.5">
          <div className="text-xs text-slate-400">
            <p className="text-[10px] uppercase tracking-wider font-medium text-slate-300 mb-0.5">마지막 동기화</p>
            <p className="tabular-nums">{lastSyncTime || '대기 중'}</p>
          </div>
          <div className="flex items-center gap-2.5 pt-2 border-t border-slate-100">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-[10px] font-bold">봉</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-700 truncate">고봉주 매니저</p>
              <p className="text-[10px] text-slate-400 truncate">기초소재구매파트</p>
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
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                {navItems.find((item) => item.id === activeTab)?.label}
              </h2>
              <p className="text-slate-400 text-xs mt-0.5">팜유 수급 관리 시스템</p>
            </div>
            <button
              onClick={fetchDashboardData}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              새로고침
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'dashboard' && <DashboardTab data={dashboardData} loading={loading} />}
          {activeTab === 'fcpo' && <FCPOTab />}
          {activeTab === 'inventory' && <InventoryTab />}
          {activeTab === 'box-range' && <BoxRangeTab />}
          {activeTab === 'purchases' && <PurchasesTab />}
          {activeTab === 'news' && <NewsTab />}
          {activeTab === 'alerts' && <AlertsTab />}
        </div>
      </main>
    </div>
  );
}
