import { NextRequest, NextResponse } from 'next/server';
import { dbRun } from '@/lib/db';
import {
  listInflectionPoints,
  upsertInflectionPoint,
  refreshSentimentForMonth,
  deriveInflectionFields,
  classifySentiment,
} from '@/lib/inflection-points';

// GET /api/inflection-points?contract_month=2026-06&limit=50
// GET /api/inflection-points?preview=1&date=2026-05-13&contract_month=2026-06&price_usd=1212.5
//   → 저장하지 않고 자동 산출 결과 미리보기 (sentiment / change_pct / prev / bmd_change)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const contractMonth = searchParams.get('contract_month') || undefined;
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    if (searchParams.get('preview') === '1') {
      const date = searchParams.get('date');
      const cm = searchParams.get('contract_month');
      const priceStr = searchParams.get('price_usd');
      if (!date || !cm) {
        return NextResponse.json({ error: 'preview requires date & contract_month' }, { status: 400 });
      }
      const result = await deriveInflectionFields({
        date,
        contract_month: cm,
        price_usd: priceStr ? parseFloat(priceStr) : undefined,
      });
      return NextResponse.json(result);
    }

    const data = await listInflectionPoints(contractMonth, limit);
    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/inflection-points
// body: { date, contract_month, price_usd?, news_summary?, sentiment?, note?, bmd_change? }
//   - price_usd 미입력 시 fcpo_settlement에서 자동 조회
//   - sentiment 미입력 시 자동분류
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.date || !body.contract_month) {
      return NextResponse.json({ error: 'Required: date, contract_month' }, { status: 400 });
    }
    await upsertInflectionPoint({
      date: body.date,
      contract_month: body.contract_month,
      price_usd: body.price_usd ?? null,
      news_summary: body.news_summary ?? null,
      sentiment: body.sentiment ?? null,
      note: body.note ?? null,
      bmd_change: body.bmd_change ?? null,
      created_by: body.created_by ?? 'user',
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/inflection-points
// body: { action: 'refresh_sentiment', contract_month } → 해당 월 자동분류 전체 재계산
// body: { action: 'classify', change_pct } → 단순 분류 결과만 반환 (DB 안 만짐)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action === 'refresh_sentiment') {
      if (!body.contract_month) {
        return NextResponse.json({ error: 'contract_month required' }, { status: 400 });
      }
      const updated = await refreshSentimentForMonth(body.contract_month);
      return NextResponse.json({ success: true, updated });
    }
    if (body.action === 'classify') {
      const sentiment = classifySentiment(body.change_pct);
      return NextResponse.json({ sentiment });
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/inflection-points?id=123
export async function DELETE(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await dbRun('DELETE FROM inflection_points WHERE id = ?', [parseInt(id, 10)]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
