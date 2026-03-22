import { useState, useMemo } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ComposedChart, Area } from "recharts";

// ==================== MOCK DATA ====================
const FCPO_PRICES = [
  { date: "03/02", "2026-03": 4720, "2026-04": 4680, "2026-05": 4610, "2026-06": 4560 },
  { date: "03/03", "2026-03": 4700, "2026-04": 4665, "2026-05": 4595, "2026-06": 4545 },
  { date: "03/04", "2026-03": 4685, "2026-04": 4650, "2026-05": 4580, "2026-06": 4530 },
  { date: "03/05", "2026-03": 4710, "2026-04": 4670, "2026-05": 4600, "2026-06": 4550 },
  { date: "03/06", "2026-03": 4690, "2026-04": 4655, "2026-05": 4585, "2026-06": 4535 },
  { date: "03/09", "2026-03": 4675, "2026-04": 4640, "2026-05": 4570, "2026-06": 4520 },
  { date: "03/10", "2026-03": 4660, "2026-04": 4625, "2026-05": 4555, "2026-06": 4505 },
  { date: "03/11", "2026-03": 4640, "2026-04": 4605, "2026-05": 4535, "2026-06": 4485 },
  { date: "03/12", "2026-03": 4650, "2026-04": 4615, "2026-05": 4545, "2026-06": 4495 },
  { date: "03/13", "2026-03": 4635, "2026-04": 4600, "2026-05": 4530, "2026-06": 4480 },
  { date: "03/16", "2026-03": 4625, "2026-04": 4590, "2026-05": 4520, "2026-06": 4470 },
  { date: "03/17", "2026-03": 4610, "2026-04": 4575, "2026-05": 4505, "2026-06": 4455 },
  { date: "03/18", "2026-03": 4605, "2026-04": 4570, "2026-05": 4500, "2026-06": 4450 },
];

const INVENTORY_DATA = {
  "RBD 2026": {
    months: ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"],
    expected: [2159,2807,2611,2611,2611,2611,2611,2611,2611,2611,2611,2611],
    customs: [5400,3000,2000,2600,null,null,null,null,null,null,null,null],
    ending: [10250,10443,9831,9820,7208,4597,1985,-626,-3238,-5849,-8461,-11072],
    coverage: [4.7,3.7,3.8,3.8,2.8,1.8,0.8,-0.2,-1.2,-2.2,-3.2,-4.2],
    price: ["1,013","1,015","—","—","—","—","—","—","—","—","—","—"],
    contract: ["11/18,21","11/21","—","—","—","—","—","—","—","—","—","—"],
  },
  "RSPO 2026": {
    months: ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"],
    expected: [340,312,284,347,283,323,259,244,304,329,257,354],
    customs: [400,400,null,null,null,null,null,null,null,null,null,null],
    ending: [1060,1148,864,517,234,-89,-348,-592,-896,-1225,-1482,-1836],
    coverage: [3.1,3.7,3.0,1.5,0.8,-0.3,-1.3,-2.4,-2.9,-3.7,-5.8,-5.2],
    price: ["1,015","—","—","—","—","—","—","—","—","—","—","—"],
    contract: ["11/21","—","—","—","—","—","—","—","—","—","—","—"],
  },
};

const PURCHASES = [
  { shipment: "25년 7월", date: "25.06.26", price: 965, market: 1100, diff: -135, effect: -392, eval: "성공" },
  { shipment: "25년 8월", date: "25.08.06", price: 1028, market: 1080, diff: -52, effect: -151, eval: "성공" },
  { shipment: "25년 9월", date: "25.08.08", price: 1033, market: 1080, diff: -47, effect: -137, eval: "성공" },
  { shipment: "25년 10월", date: "25.09.17", price: 1080, market: 1065, diff: 15, effect: 44, eval: "실패" },
  { shipment: "26년 1월", date: "25.11.18", price: 1013, market: 1080, diff: -67, effect: -362, eval: "성공" },
  { shipment: "26년 2월", date: "25.11.21", price: 1015, market: 1085, diff: -70, effect: -203, eval: "성공" },
];

const NEWS_DATA = [
  { date: "03/18", content: "인도 수입관세 인상 검토 → 인도향 팜유 수요 감소 우려", tag: "약세", impact: "High" },
  { date: "03/17", content: "말레이시아 2월 재고 280만톤 유지, 수출 소폭 회복", tag: "보합", impact: "Medium" },
  { date: "03/16", content: "인니 B50 시행 6월 확정 → 장기 공급 감소 기대", tag: "강세", impact: "High" },
  { date: "03/13", content: "中 대두 수요 우려 → 대두유 약세 동조", tag: "약세", impact: "Medium" },
  { date: "03/12", content: "라니냐 전환 가능성 → 동남아 강수량 증가 전망", tag: "강세", impact: "Low" },
  { date: "03/11", content: "유럽 EUDR 규제 재연기 가능성 보도", tag: "약세", impact: "Medium" },
  { date: "03/10", content: "CBOT 대두유 50¢/lb 하회 → 식물유 전반 약세", tag: "약세", impact: "High" },
];

// ==================== COMPONENTS ====================
const Badge = ({ children, variant = "default" }) => {
  const styles = {
    success: "bg-emerald-100 text-emerald-800",
    danger: "bg-red-100 text-red-800",
    warning: "bg-amber-100 text-amber-800",
    info: "bg-blue-100 text-blue-800",
    default: "bg-gray-100 text-gray-700",
    강세: "bg-red-100 text-red-700",
    약세: "bg-blue-100 text-blue-700",
    보합: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[variant] || styles.default}`}>
      {children}
    </span>
  );
};

const Card = ({ title, children, className = "", headerRight = null }) => (
  <div className={`bg-white rounded-lg border border-gray-200 shadow-sm ${className}`}>
    {title && (
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        {headerRight}
      </div>
    )}
    <div className="p-4">{children}</div>
  </div>
);

// ==================== TAB: DASHBOARD ====================
const Dashboard = () => {
  const boxRange = { fullBuy: 1018, activeBuy: 1025, monitoring: 1038, minBuy: 1058, current: 1010 };
  const currentPct = Math.max(0, Math.min(100, ((boxRange.current - 1000) / (1070 - 1000)) * 100));

  return (
    <div className="space-y-4">
      {/* Alert Banner */}
      <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg">
        <div className="flex items-start">
          <div className="flex-shrink-0 text-2xl mr-3">🔴</div>
          <div>
            <h3 className="text-sm font-bold text-red-800">긴급: RBD PALM OIL 2026년 8월 재고 소진 예상</h3>
            <p className="text-sm text-red-700 mt-1">5월 선적물 2,600톤 구매 필요 · 현재 FCPO 5월물 4,500 MYR (≈$1,012/MT) · 박스권: <span className="font-bold">전량구매</span> 구간</p>
          </div>
        </div>
      </div>
      <div className="bg-amber-50 border-l-4 border-amber-500 p-3 rounded-r-lg">
        <div className="flex items-start">
          <div className="flex-shrink-0 text-xl mr-3">🟡</div>
          <div>
            <h3 className="text-sm font-bold text-amber-800">경고: RSPO PALM OIL 2026년 6월 재고 소진 예상</h3>
            <p className="text-sm text-amber-700 mt-1">4월 선적물 400톤 구매 필요 · 재고회전일 0.8일</p>
          </div>
        </div>
      </div>

      {/* Market + Inventory Cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="col-span-1">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">FCPO 4월물</p>
            <p className="text-2xl font-bold text-gray-900">4,570</p>
            <p className="text-xs text-gray-500">MYR/톤</p>
            <p className="text-sm text-red-500 mt-1">▼ 30 (-0.65%)</p>
          </div>
        </Card>
        <Card className="col-span-1">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">FCPO 4월물 (USD)</p>
            <p className="text-2xl font-bold text-gray-900">$1,012</p>
            <p className="text-xs text-gray-500">USD/MT 환산</p>
            <p className="text-sm text-red-500 mt-1">▼ 5 (-0.49%)</p>
          </div>
        </Card>
        <Card className="col-span-1">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">RBD 재고</p>
            <p className="text-2xl font-bold text-emerald-600">9,820K</p>
            <p className="text-xs text-gray-500">kg · 회전일 3.8</p>
            <Badge variant="success">정상</Badge>
          </div>
        </Card>
        <Card className="col-span-1">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">RSPO 재고</p>
            <p className="text-2xl font-bold text-amber-600">517K</p>
            <p className="text-xs text-gray-500">kg · 회전일 1.5</p>
            <Badge variant="warning">경고</Badge>
          </div>
        </Card>
      </div>

      {/* Box Range Gauge + AI Analysis */}
      <div className="grid grid-cols-5 gap-4">
        <Card title="박스권 분석 (4월물 · 20일 기준)" className="col-span-2">
          <div className="mb-3">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>$1,010</span><span>$1,018</span><span>$1,025</span><span>$1,038</span><span>$1,058</span>
            </div>
            <div className="flex h-8 rounded-lg overflow-hidden text-xs font-medium">
              <div className="bg-emerald-500 text-white flex items-center justify-center" style={{ width: "25%" }}>전량구매</div>
              <div className="bg-blue-500 text-white flex items-center justify-center" style={{ width: "12%" }}>적극</div>
              <div className="bg-amber-400 text-white flex items-center justify-center" style={{ width: "25%" }}>모니터링</div>
              <div className="bg-red-400 text-white flex items-center justify-center" style={{ width: "38%" }}>최소/대기</div>
            </div>
            <div className="relative h-4 mt-1">
              <div className="absolute text-lg" style={{ left: `${currentPct}%`, transform: "translateX(-50%)" }}>▲</div>
            </div>
            <p className="text-center text-sm font-bold text-emerald-600 mt-2">현재가 $1,010 → 전량구매 구간</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs border-t pt-3">
            <div><span className="text-gray-500">10일 이평</span><br/><span className="font-semibold">$1,031</span></div>
            <div><span className="text-gray-500">20일 이평</span><br/><span className="font-semibold">$1,034</span></div>
            <div><span className="text-gray-500">60일 이평</span><br/><span className="font-semibold">$1,063</span></div>
            <div><span className="text-gray-500">추세</span><br/><span className="font-semibold text-red-500">▼ 하락</span></div>
            <div><span className="text-gray-500">변동률</span><br/><span className="font-semibold">4.8%</span></div>
            <div><span className="text-gray-500">신호</span><br/><span className="font-semibold text-red-500">데드크로스</span></div>
          </div>
        </Card>

        <Card title="AI 시황 분석" className="col-span-3" headerRight={<span className="text-xs text-gray-400">2026.03.18 21:15 갱신</span>}>
          <div className="text-sm text-gray-700 space-y-3">
            <div>
              <p className="font-semibold text-gray-800 mb-1">종합 판단: <span className="text-emerald-600">매수 적기 (신뢰도 높음)</span></p>
              <p>현재 팜유 시장은 <span className="font-medium">단기 약세</span> 국면입니다. 말레이시아 재고 280만톤 수준 유지와 인도 수입관세 인상 검토가 하방 압력을 가하고 있으나, 인도네시아 B50 시행(6월 확정)에 따른 장기 공급 감소 기대가 하단을 지지하고 있습니다.</p>
            </div>
            <div>
              <p className="font-semibold text-gray-800 mb-1">구매 관점</p>
              <p>현재가 $1,010은 20일 이평선($1,034) 대비 2.3% 하회하는 수준으로, 박스권 <span className="text-emerald-600 font-medium">전량구매 구간</span>에 해당합니다. 데드크로스가 발생한 상태이나 이는 오히려 저가 매수 기회로 판단됩니다. RBD 8월 재고 소진이 예상되므로 5월 선적물 확보가 시급합니다.</p>
            </div>
            <div className="bg-gray-50 rounded p-2 text-xs">
              <span className="text-gray-500">분석 기반:</span> 최근 뉴스 7건 · FCPO 30일 가격추이 · RBD/RSPO 재고현황
            </div>
          </div>
        </Card>
      </div>

      {/* Price Chart */}
      <Card title="FCPO 가격 추이 (최근 30일)">
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={FCPO_PRICES} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis domain={[4400, 4750]} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="2026-04" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} name="4월물" />
            <Line type="monotone" dataKey="2026-05" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} name="5월물" />
            <Line type="monotone" dataKey="2026-06" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 2 }} name="6월물" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Recent Purchases */}
      <Card title="최근 구매 이력" headerRight={<span className="text-xs text-blue-500 cursor-pointer">전체 보기 →</span>}>
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 border-b">
            <th className="text-left py-2">선적물</th><th className="text-right">계약가</th><th className="text-right">시장가</th><th className="text-right">차이</th><th className="text-center">평가</th>
          </tr></thead>
          <tbody>
            {PURCHASES.slice(-3).map((p, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="py-2">{p.shipment}</td>
                <td className="text-right">${p.price}</td>
                <td className="text-right">${p.market}</td>
                <td className={`text-right font-medium ${p.diff < 0 ? "text-emerald-600" : "text-red-500"}`}>{p.diff < 0 ? "" : "+"}{p.diff}</td>
                <td className="text-center"><Badge variant={p.eval === "성공" ? "success" : "danger"}>{p.eval}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

// ==================== TAB: FCPO PRICE DB ====================
const FcpoPriceDb = () => {
  const [unit, setUnit] = useState("MYR");
  const rate = 4.52;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800">FCPO Settlement 가격 DB</h2>
          <p className="text-sm text-gray-500">매일 KST 21:00 자동 수집 · 마지막 수집: 2026-03-18 21:00</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setUnit("MYR")} className={`px-3 py-1.5 rounded text-sm font-medium ${unit === "MYR" ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600"}`}>MYR</button>
          <button onClick={() => setUnit("USD")} className={`px-3 py-1.5 rounded text-sm font-medium ${unit === "USD" ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600"}`}>USD</button>
          <button className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded text-sm">Excel 다운로드</button>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-800 text-white text-xs">
              <th className="px-3 py-2 text-left">날짜</th>
              {["2026-03","2026-04","2026-05","2026-06","2026-07","2026-08","2026-09"].map(m => (
                <th key={m} className="px-3 py-2 text-right">{m}</th>
              ))}
            </tr></thead>
            <tbody>
              {FCPO_PRICES.slice().reverse().map((row, i) => (
                <tr key={i} className={`border-b border-gray-50 ${i === 0 ? "bg-blue-50" : ""}`}>
                  <td className="px-3 py-2 text-gray-600">{row.date}</td>
                  {["2026-03","2026-04","2026-05","2026-06"].map(m => (
                    <td key={m} className="px-3 py-2 text-right font-mono">
                      {unit === "MYR" ? row[m]?.toLocaleString() : (row[m] ? `$${(row[m]/rate).toFixed(1)}` : "—")}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono text-gray-400">{unit === "MYR" ? "4,390" : "$971.2"}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-400">{unit === "MYR" ? "4,340" : "$960.2"}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-400">{unit === "MYR" ? "4,300" : "$951.3"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="가격 추이 차트">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={FCPO_PRICES} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis domain={[4400, 4750]} tick={{ fontSize: 11 }} tickFormatter={v => unit === "MYR" ? v : `$${(v/rate).toFixed(0)}`} />
            <Tooltip formatter={v => unit === "MYR" ? `${v} MYR` : `$${(v/rate).toFixed(1)}`} />
            <Legend />
            <Line type="monotone" dataKey="2026-03" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} name="3월물" />
            <Line type="monotone" dataKey="2026-04" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} name="4월물" />
            <Line type="monotone" dataKey="2026-05" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} name="5월물" />
            <Line type="monotone" dataKey="2026-06" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 2 }} name="6월물" />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
};

// ==================== TAB: INVENTORY ====================
const Inventory = () => {
  const [selected, setSelected] = useState("RBD 2026");
  const data = INVENTORY_DATA[selected];
  const rows = [
    { label: "예상소요량(kg)", key: "expected", format: v => v ? `${(v/1000).toFixed(0)}K` : "—" },
    { label: "통관수량(kg)", key: "customs", format: v => v ? `${(v/1000).toFixed(0)}K` : "—" },
    { label: "기말재고(kg)", key: "ending", format: v => v !== null ? `${(v/1000).toFixed(0)}K` : "—" },
    { label: "재고회전일", key: "coverage", format: v => v !== null ? v.toFixed(1) : "—" },
    { label: "계약단가($/톤)", key: "price", format: v => v },
    { label: "계약월", key: "contract", format: v => v },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800">재고현황</h2>
          <p className="text-sm text-gray-500">셀을 클릭하여 직접 수정 · 기말재고/재고회전일 자동 계산</p>
        </div>
        <div className="flex gap-2">
          {Object.keys(INVENTORY_DATA).map(k => (
            <button key={k} onClick={() => setSelected(k)} className={`px-3 py-1.5 rounded text-sm font-medium ${selected === k ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600"}`}>{k}</button>
          ))}
          <button className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded text-sm">RBD 2025</button>
          <button className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded text-sm">RSPO 2025</button>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-800 text-white text-xs">
              <th className="px-3 py-2 text-left sticky left-0 bg-gray-800 z-10 min-w-32">{selected}</th>
              {data.months.map(m => <th key={m} className="px-3 py-2 text-right min-w-20">{m}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-700 bg-gray-50 sticky left-0 z-10 text-xs">{row.label}</td>
                  {data[row.key].map((v, ci) => {
                    const isNegative = row.key === "ending" && v !== null && v < 0;
                    const isLowCoverage = row.key === "coverage" && v !== null && v < 1.5;
                    return (
                      <td key={ci} className={`px-3 py-2 text-right font-mono text-xs cursor-pointer hover:bg-blue-50 ${isNegative ? "bg-red-100 text-red-700 font-bold" : isLowCoverage ? "bg-amber-50 text-amber-700 font-bold" : ""}`}>
                        {row.format(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-sm font-bold text-red-800 mb-2">⚠ 재고 소진 경고</h3>
        <div className="text-sm text-red-700 space-y-1">
          <p>• <span className="font-medium">RBD 2026:</span> 8월부터 기말재고 마이너스 전환 (−626K kg). 5월 선적분부터 추가 구매 필요.</p>
          <p>• <span className="font-medium">RSPO 2026:</span> 6월부터 기말재고 마이너스 전환 (−89K kg). 4월 선적분부터 추가 구매 필요.</p>
        </div>
      </div>
    </div>
  );
};

// ==================== TAB: BOX RANGE ====================
const BoxRange = () => {
  const [month, setMonth] = useState("2026-04");
  const priceData = FCPO_PRICES.map((p, i) => {
    const prices = FCPO_PRICES.slice(0, i + 1).map(pp => pp[month]).filter(Boolean);
    const ma10 = prices.length >= 10 ? prices.slice(-10).reduce((a,b) => a+b, 0) / 10 : null;
    const ma20 = prices.length >= 13 ? prices.slice(-13).reduce((a,b) => a+b, 0) / Math.min(13, prices.length) : null;
    return { ...p, price: p[month], ma10, ma20 };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800">박스권 분석</h2>
          <p className="text-sm text-gray-500">엑셀 V3 로직 기반 · 20일 이동평균선 + 표준편차</p>
        </div>
        <select value={month} onChange={e => setMonth(e.target.value)} className="px-3 py-1.5 border rounded text-sm">
          <option value="2026-03">2026년 3월물</option>
          <option value="2026-04">2026년 4월물</option>
          <option value="2026-05">2026년 5월물</option>
          <option value="2026-06">2026년 6월물</option>
        </select>
      </div>

      {/* Summary Card */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-5">
        <div className="grid grid-cols-6 gap-4 text-center">
          <div><p className="text-xs text-gray-500">월물</p><p className="text-lg font-bold">{month.replace("2026-","26년 ")}월</p></div>
          <div><p className="text-xs text-gray-500">현재가</p><p className="text-lg font-bold">$1,012</p></div>
          <div><p className="text-xs text-gray-500">추천 행동</p><p className="text-lg font-bold text-emerald-600">전량구매</p></div>
          <div><p className="text-xs text-gray-500">해당 구간</p><p className="text-lg font-bold">$1,010~$1,020</p></div>
          <div><p className="text-xs text-gray-500">추세 방향</p><p className="text-lg font-bold text-red-500">▼ 하락 (매수기회)</p></div>
          <div><p className="text-xs text-gray-500">신뢰도</p><p className="text-lg font-bold text-amber-500">●●●● 높음</p></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Box Range Boundaries */}
        <Card title="박스권 경계값 (20일 기준)">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b">
              <th className="text-left py-2">구간</th><th className="text-left">계산식</th><th className="text-right">경계값</th><th className="text-center">현재가</th>
            </tr></thead>
            <tbody>
              {[
                { zone: "전량구매", formula: "이평−σ", val: "$1,020", active: true, color: "bg-emerald-500" },
                { zone: "적극구매", formula: "이평−0.5σ", val: "$1,027", active: false, color: "bg-blue-500" },
                { zone: "모니터링", formula: "이평+0.5σ", val: "$1,041", active: false, color: "bg-amber-400" },
                { zone: "최소구매", formula: "최고가", val: "$1,060", active: false, color: "bg-red-400" },
              ].map((r, i) => (
                <tr key={i} className={`border-b ${r.active ? "bg-emerald-50" : ""}`}>
                  <td className="py-2 flex items-center gap-2"><div className={`w-3 h-3 rounded ${r.color}`}/>{r.zone}</td>
                  <td className="text-gray-500">{r.formula}</td>
                  <td className="text-right font-mono">{r.val}</td>
                  <td className="text-center">{r.active ? <Badge variant="success">● 해당</Badge> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Moving Average Analysis */}
        <Card title="이평선 위치 분석">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b">
              <th className="text-left py-2">구분</th><th className="text-right">값</th><th className="text-right">현재가 대비</th><th className="text-left pl-3">판정</th>
            </tr></thead>
            <tbody>
              {[
                { name: "현재가", val: "$1,012", diff: "—", verdict: "기준" },
                { name: "10일 이평선", val: "$1,031", diff: "−19", verdict: "▼ 이평선 하회 (매수신호)" },
                { name: "20일 이평선", val: "$1,034", diff: "−22", verdict: "▼ 이평선 하회 (매수신호)" },
                { name: "60일 이평선", val: "$1,063", diff: "−51", verdict: "▼ 이평선 하회 (매수신호)" },
              ].map((r, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2 font-medium">{r.name}</td>
                  <td className="text-right font-mono">{r.val}</td>
                  <td className="text-right text-red-500 font-mono">{r.diff}</td>
                  <td className="pl-3 text-xs text-red-600">{r.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Trend Signals */}
        <Card title="추세 신호 분석">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b">
              <th className="text-left py-2">신호</th><th className="text-left">조건</th><th className="text-left">판정</th><th className="text-left">의미</th>
            </tr></thead>
            <tbody>
              {[
                { signal: "단기 추세", cond: "현재가 vs 10일선", result: "▼ 단기 하락", meaning: "진입 타이밍" },
                { signal: "중기 추세", cond: "현재가 vs 20일선", result: "▼ 중기 하락", meaning: "기준 판단" },
                { signal: "장기 추세", cond: "현재가 vs 60일선", result: "▼ 장기 하락", meaning: "방향성 확인" },
                { signal: "골든크로스", cond: "10일선 > 20일선", result: "○ 미발생", meaning: "상승 전환" },
                { signal: "데드크로스", cond: "10일선 < 20일선", result: "● 발생", meaning: "하락 전환" },
              ].map((r, i) => (
                <tr key={i} className="border-b text-xs">
                  <td className="py-1.5 font-medium">{r.signal}</td>
                  <td className="text-gray-500">{r.cond}</td>
                  <td className={r.result.includes("▼") || r.result.includes("●") ? "text-red-600 font-medium" : "text-gray-400"}>{r.result}</td>
                  <td className="text-gray-500">{r.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Volatility */}
        <Card title="변동성 분석">
          <div className="space-y-3">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">현재 20일 변동률</p>
              <p className="text-3xl font-bold text-gray-800">4.84%</p>
              <p className="text-sm text-gray-600">보통 → 분할 매수 권장</p>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {[
                  { range: "< 2%", grade: "매우 낮음", action: "정상 구매" },
                  { range: "2~3%", grade: "낮음", action: "정상 구매" },
                  { range: "3~5%", grade: "보통", action: "분할 매수", active: true },
                  { range: "5~7%", grade: "높음", action: "분할 매수" },
                  { range: "7~10%", grade: "매우 높음", action: "소량 분할" },
                  { range: "> 10%", grade: "극단적", action: "구매 보류" },
                ].map((r, i) => (
                  <tr key={i} className={`border-b ${r.active ? "bg-blue-50 font-medium" : ""}`}>
                    <td className="py-1">{r.range}</td><td>{r.grade}</td><td>{r.action}</td>{r.active && <td><Badge variant="info">현재</Badge></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Price Chart with Box Range Lines */}
      <Card title="가격 차트 + 박스권 경계선">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={priceData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis domain={[4500, 4750]} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <ReferenceLine y={4605} stroke="#10b981" strokeDasharray="5 5" label={{ value: "전량구매 $1,018", fill: "#10b981", fontSize: 10 }} />
            <ReferenceLine y={4630} stroke="#3b82f6" strokeDasharray="5 5" label={{ value: "적극매수 $1,025", fill: "#3b82f6", fontSize: 10 }} />
            <ReferenceLine y={4695} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: "모니터링 $1,038", fill: "#f59e0b", fontSize: 10 }} />
            <Line type="monotone" dataKey="price" stroke="#1e293b" strokeWidth={2} dot={{ r: 3 }} name="종가" />
            <Line type="monotone" dataKey="ma10" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="10일 이평" />
            <Line type="monotone" dataKey="ma20" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="20일 이평" />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
};

// ==================== TAB: PURCHASES ====================
const PurchaseHistory = () => (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-bold text-gray-800">구매 이력</h2>
        <p className="text-sm text-gray-500">계약 기록 및 선구매 성과 평가</p>
      </div>
      <button className="px-4 py-2 bg-blue-500 text-white rounded text-sm font-medium">+ 새 계약 등록</button>
    </div>

    <div className="grid grid-cols-4 gap-3">
      <Card><div className="text-center"><p className="text-xs text-gray-500">총 계약 건수</p><p className="text-2xl font-bold">6건</p></div></Card>
      <Card><div className="text-center"><p className="text-xs text-gray-500">성공률</p><p className="text-2xl font-bold text-emerald-600">83.3%</p></div></Card>
      <Card><div className="text-center"><p className="text-xs text-gray-500">총 선구매 효과</p><p className="text-2xl font-bold text-emerald-600">−1,201백만</p><p className="text-xs text-gray-500">= 12억원 절감</p></div></Card>
      <Card><div className="text-center"><p className="text-xs text-gray-500">평균 가격차이</p><p className="text-2xl font-bold text-emerald-600">−$59/MT</p></div></Card>
    </div>

    <Card>
      <table className="w-full text-sm">
        <thead><tr className="bg-gray-800 text-white text-xs">
          <th className="px-3 py-2 text-left">선적물</th><th className="px-3 py-2">계약일</th><th className="px-3 py-2 text-right">계약가($/MT)</th>
          <th className="px-3 py-2 text-right">시장가</th><th className="px-3 py-2 text-right">차이</th><th className="px-3 py-2 text-right">효과(백만원)</th><th className="px-3 py-2 text-center">평가</th>
        </tr></thead>
        <tbody>
          {PURCHASES.map((p, i) => (
            <tr key={i} className="border-b hover:bg-gray-50">
              <td className="px-3 py-2 font-medium">{p.shipment}</td>
              <td className="px-3 py-2 text-center text-gray-600">{p.date}</td>
              <td className="px-3 py-2 text-right font-mono">${p.price}</td>
              <td className="px-3 py-2 text-right font-mono">${p.market}</td>
              <td className={`px-3 py-2 text-right font-mono font-bold ${p.diff < 0 ? "text-emerald-600" : "text-red-500"}`}>{p.diff < 0 ? "" : "+"}{p.diff}</td>
              <td className={`px-3 py-2 text-right font-mono ${p.effect < 0 ? "text-emerald-600" : "text-red-500"}`}>{p.effect}</td>
              <td className="px-3 py-2 text-center"><Badge variant={p.eval === "성공" ? "success" : "danger"}>{p.eval}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>

    <Card title="시황가격 vs 계약단가 추이">
      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={PURCHASES} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="shipment" tick={{ fontSize: 10 }} />
          <YAxis domain={[900, 1150]} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          <Bar dataKey="market" fill="#94a3b8" name="시장가" barSize={30} />
          <Line type="monotone" dataKey="price" stroke="#ef4444" strokeWidth={2} dot={{ r: 5, fill: "#ef4444" }} name="계약가" />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  </div>
);

// ==================== TAB: NEWS ====================
const NewsTab = () => (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-bold text-gray-800">뉴스 / 시황 메모</h2>
        <p className="text-sm text-gray-500">수동 입력 · AI 분석 연동</p>
      </div>
      <button className="px-4 py-2 bg-blue-500 text-white rounded text-sm font-medium">+ 새 시황 입력</button>
    </div>

    <div className="grid grid-cols-3 gap-3 mb-2">
      <Card><div className="text-center"><p className="text-xs text-gray-500">최근 7일 강세 요인</p><p className="text-2xl font-bold text-red-500">2건</p></div></Card>
      <Card><div className="text-center"><p className="text-xs text-gray-500">최근 7일 약세 요인</p><p className="text-2xl font-bold text-blue-500">4건</p></div></Card>
      <Card><div className="text-center"><p className="text-xs text-gray-500">종합 판단</p><p className="text-2xl font-bold text-blue-600">약세 우위</p></div></Card>
    </div>

    <Card>
      <div className="space-y-3">
        {NEWS_DATA.map((n, i) => (
          <div key={i} className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 border-b border-gray-100">
            <div className="flex-shrink-0 text-sm text-gray-400 w-12 pt-0.5">{n.date}</div>
            <div className="flex-grow">
              <p className="text-sm text-gray-800">{n.content}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Badge variant={n.tag}>{n.tag}</Badge>
              <Badge variant={n.impact === "High" ? "danger" : n.impact === "Medium" ? "warning" : "default"}>{n.impact}</Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>

    {/* Input form preview */}
    <Card title="새 시황 입력">
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">날짜</label>
            <input type="date" className="w-full px-3 py-2 border rounded text-sm" defaultValue="2026-03-18" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">태그</label>
            <select className="w-full px-3 py-2 border rounded text-sm">
              <option>강세</option><option>약세</option><option>보합</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">영향도</label>
            <select className="w-full px-3 py-2 border rounded text-sm">
              <option>High</option><option>Medium</option><option>Low</option>
            </select>
          </div>
          <div className="flex items-end">
            <button className="w-full px-4 py-2 bg-blue-500 text-white rounded text-sm">저장</button>
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">시황 내용</label>
          <textarea className="w-full px-3 py-2 border rounded text-sm" rows={2} placeholder="예: 인도 수입관세 인상 검토 → 인도향 팜유 수요 감소 우려" />
        </div>
      </div>
    </Card>
  </div>
);

// ==================== TAB: ALERTS ====================
const AlertsTab = () => (
  <div className="space-y-4">
    <div>
      <h2 className="text-lg font-bold text-gray-800">구매 알람</h2>
      <p className="text-sm text-gray-500">재고 소진 예측 + FCPO 가격 + 박스권 분석 결합</p>
    </div>

    {/* Active alerts */}
    <div className="space-y-3">
      <div className="border-2 border-red-300 rounded-xl p-5 bg-red-50">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">🔴</span>
              <h3 className="text-base font-bold text-red-800">긴급: RBD PALM OIL 2026년 8월 재고 소진</h3>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-red-700">
              <p>• 예상 소진 시점: <span className="font-bold">2026년 8월</span></p>
              <p>• 현재 기말재고: <span className="font-bold">9,820K kg</span> (4월 기준)</p>
              <p>• 필요 구매량: <span className="font-bold">최소 2,600K kg</span> (5월 선적)</p>
              <p>• 현재 FCPO 5월물: <span className="font-bold">4,500 MYR ≈ $1,012/MT</span></p>
              <p>• 박스권 위치: <span className="font-bold text-emerald-700">전량구매 구간 ($1,010~$1,018)</span></p>
              <p>• 추세: <span className="font-bold">▼ 하락 (매수기회)</span></p>
            </div>
          </div>
          <button className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium">구매 검토 →</button>
        </div>
        <div className="mt-3 pt-3 border-t border-red-200 text-sm text-red-600 font-medium">
          💡 추천: 현재 가격이 전량구매 구간에 있고 하락 추세이므로, 5월 선적물 2,600K kg 전량 계약을 권장합니다.
        </div>
      </div>

      <div className="border-2 border-amber-300 rounded-xl p-5 bg-amber-50">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">🟡</span>
              <h3 className="text-base font-bold text-amber-800">경고: RSPO PALM OIL 2026년 6월 재고 소진</h3>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-amber-700">
              <p>• 예상 소진 시점: <span className="font-bold">2026년 6월</span></p>
              <p>• 현재 기말재고: <span className="font-bold">517K kg</span> (4월 기준)</p>
              <p>• 필요 구매량: <span className="font-bold">최소 400K kg</span> (4월 선적)</p>
              <p>• 재고회전일: <span className="font-bold">1.5일</span></p>
            </div>
          </div>
          <button className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium">구매 검토 →</button>
        </div>
      </div>

      <div className="border border-emerald-200 rounded-xl p-5 bg-emerald-50">
        <div className="flex items-center gap-2">
          <span className="text-xl">🟢</span>
          <h3 className="text-base font-bold text-emerald-800">정상: RBD 2025 / RSPO 2025 재고 충분</h3>
          <span className="text-sm text-emerald-600">— 모니터링 유지</span>
        </div>
      </div>
    </div>

    {/* Alert History */}
    <Card title="알람 이력">
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-gray-500 border-b">
          <th className="text-left py-2">일시</th><th className="text-left">레벨</th><th className="text-left">내용</th><th className="text-left">조치</th>
        </tr></thead>
        <tbody>
          <tr className="border-b"><td className="py-2 text-gray-500">03/18 21:10</td><td><Badge variant="danger">긴급</Badge></td><td>RBD 8월 소진 예상</td><td className="text-gray-400">대기 중</td></tr>
          <tr className="border-b"><td className="py-2 text-gray-500">03/15 21:10</td><td><Badge variant="warning">경고</Badge></td><td>RSPO 6월 소진 예상</td><td className="text-gray-400">대기 중</td></tr>
          <tr className="border-b"><td className="py-2 text-gray-500">03/01 21:10</td><td><Badge variant="warning">경고</Badge></td><td>RBD 재고회전일 2.3일</td><td className="text-emerald-600">3월 통관 2,000톤 확인</td></tr>
        </tbody>
      </table>
    </Card>
  </div>
);

// ==================== MAIN APP ====================
const TABS = [
  { id: "dashboard", label: "대시보드", icon: "📊" },
  { id: "fcpo", label: "FCPO 가격DB", icon: "📈" },
  { id: "inventory", label: "재고현황", icon: "📦" },
  { id: "boxrange", label: "박스권 분석", icon: "📐" },
  { id: "purchases", label: "구매 이력", icon: "🛒" },
  { id: "news", label: "뉴스/시황", icon: "📰" },
  { id: "alerts", label: "구매 알람", icon: "🔔" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard": return <Dashboard />;
      case "fcpo": return <FcpoPriceDb />;
      case "inventory": return <Inventory />;
      case "boxrange": return <BoxRange />;
      case "purchases": return <PurchaseHistory />;
      case "news": return <NewsTab />;
      case "alerts": return <AlertsTab />;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-56 bg-gray-900 text-white flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-base font-bold">Palm Oil Manager</h1>
          <p className="text-xs text-gray-400 mt-0.5">삼양식품 기초원료구매팀</p>
        </div>
        <nav className="flex-1 py-2">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${activeTab === tab.id ? "bg-gray-700 text-white font-medium" : "text-gray-300 hover:bg-gray-800 hover:text-white"}`}>
              <span className="text-base">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.id === "alerts" && (
                <span className="ml-auto bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">2</span>
              )}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
          <p>고봉주 매니저</p>
          <p className="mt-0.5">마지막 동기화: 21:15</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
