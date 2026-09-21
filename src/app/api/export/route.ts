import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { buildPrebuy, buildPurchases, buildInventory, buildFcpo, buildBoxRange, buildMpob, buildMacro, buildBacktest, buildAlerts, buildNews, buildGlossary, buildDashboard, toBuffer } from '@/lib/export-xlsx';
import { EXPORT_TARGETS } from '@/lib/export-targets';
import { GET as purchasesGET } from '../purchases/route';
import { GET as dashboardGET } from '../dashboard/route';

// GET /api/export?target=prebuy|purchases|inventory|fcpo|box-range|mpob|macro|backtest|alerts|news|glossary|dashboard|all
// → .xlsx 다운로드 (데이터 시트 + 계산방식 시트, 계산 표는 엑셀 수식)
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function build(target: string): Promise<XLSX.WorkBook> {
  const wb = XLSX.utils.book_new();
  switch (target) {
    case 'prebuy': { const j = await (await purchasesGET(new NextRequest('http://local/api/purchases?view=prebuy'))).json(); return buildPrebuy(j, wb); }
    case 'purchases': return buildPurchases(wb);
    case 'inventory': return buildInventory(wb);
    case 'fcpo': return buildFcpo(wb);
    case 'box-range': return buildBoxRange(wb);
    case 'mpob': return buildMpob(wb);
    case 'macro': return buildMacro(wb);
    case 'backtest': return buildBacktest(wb);
    case 'alerts': return buildAlerts(wb);
    case 'news': return buildNews(wb);
    case 'glossary': return buildGlossary(wb);
    case 'dashboard': { const j = await (await dashboardGET()).json(); return buildDashboard(j, wb); }
    default: throw new Error(`unknown target: ${target}`);
  }
}

export async function GET(request: NextRequest) {
  try {
    const target = new URL(request.url).searchParams.get('target') || 'prebuy';
    const stamp = new Date().toISOString().slice(0, 10);
    let wb: XLSX.WorkBook; let name: string;
    if (target === 'all') {
      // 전체: 워크북 하나에 탭별 시트를 접두어로 모음 (시트명 31자 제한)
      wb = XLSX.utils.book_new();
      for (const t of EXPORT_TARGETS) {
        try {
          const sub = await build(t.id);
          for (const sn of sub.SheetNames) {
            const nm = `${t.label.slice(0, 8)}|${sn}`.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ');
            let final = nm, k = 2; while (wb.SheetNames.includes(final)) final = `${nm.slice(0, 28)}(${k++})`;
            XLSX.utils.book_append_sheet(wb, sub.Sheets[sn], final);
          }
        } catch (e: any) { console.warn(`export ${t.id} skipped:`, e.message); }
      }
      name = `PalmOil_전체_${stamp}.xlsx`;
    } else {
      wb = await build(target);
      const label = EXPORT_TARGETS.find(t => t.id === target)?.label ?? target;
      name = `PalmOil_${label.replace(/[\s/·]/g, '_')}_${stamp}.xlsx`;
    }
    const buf = toBuffer(wb);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
