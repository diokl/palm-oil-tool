import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun } from '@/lib/db';

// GET: fetch MPOB data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const year = searchParams.get('year');

    if (!category) {
      // Return available categories and years
      const years = await dbAll(
        `SELECT DISTINCT year FROM mpob_data ORDER BY year`
      );
      const categories = await dbAll(
        `SELECT DISTINCT category FROM mpob_data ORDER BY category`
      );
      // 마지막 동기화 시각 (수동/자동 공통 — UPSERT 시 updated_at 갱신)
      const last = await dbAll(`SELECT MAX(updated_at) AS last_synced_at FROM mpob_data`);
      return NextResponse.json({
        years: years.map((y: any) => y.year),
        categories: categories.map((c: any) => c.category),
        last_synced_at: last[0]?.last_synced_at ?? null,
      });
    }

    let query = `SELECT * FROM mpob_data WHERE category = $1`;
    const params: any[] = [category];

    if (year) {
      query += ` AND year = $2`;
      params.push(parseInt(year));
    }

    query += ` ORDER BY sort_order, item_name, month`;

    const data = await dbAll(query, params);
    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: upsert single cell or bulk data
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Bulk mode (화면의 'Bulk 붙여넣기'): 붙여넣은 값(value)만 바꾼다.
    // 이전: 모든 칸에 value_rm=null, sort_order=0 을 함께 덮어써서 RM 금액 행이 지워지고 붙여넣은 항목이 맨 위로 올라감.
    // 새 항목은 value_rm·parent_group 없이 목록 끝(sort_order 999)에 추가. 숫자가 아닌 값은 거부.
    if (Array.isArray(body.records)) {
      const rows = body.records.map((r: any) => ({
        category: String(r.category ?? ''), item_name: String(r.item_name ?? '').trim(),
        year: Number(r.year), month: Number(r.month), value: r.value === null || r.value === '' ? null : Number(r.value),
      }));
      const bad = rows.find((r: any) => !r.category || !r.item_name || !Number.isInteger(r.year) || !(r.month >= 1 && r.month <= 12) || (r.value !== null && !Number.isFinite(r.value)));
      if (bad) return NextResponse.json({ error: `잘못된 행: ${bad.item_name || '(항목명 없음)'} ${bad.year}-${bad.month} 값 ${String(bad.value)}` }, { status: 400 });
      // 같은 (분류, 항목, 연, 월) 이 두 번이면 마지막 값만 (일괄 upsert 충돌 방지)
      const uniq = [...new Map(rows.map((r: any) => [`${r.category}|${r.item_name}|${r.year}|${r.month}`, r])).values()];
      if (uniq.length) {
        await dbRun(
          `INSERT INTO mpob_data (category, item_name, year, month, value, value_rm, parent_group, sort_order)
           SELECT category, item_name, year, month, value, NULL, NULL, 999
           FROM jsonb_to_recordset(?::text::jsonb) AS t(category text, item_name text, year int, month int, value numeric)
           ON CONFLICT (category, item_name, year, month) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify(uniq)],
        );
      }
      return NextResponse.json({ success: true, count: uniq.length });
    }

    // Single cell update
    const { category, item_name, year, month, value, value_rm } = body;

    await dbRun(
      `INSERT INTO mpob_data (category, item_name, year, month, value, value_rm)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (category, item_name, year, month) DO UPDATE SET
         value = EXCLUDED.value,
         value_rm = EXCLUDED.value_rm,
         updated_at = NOW()`,
      [category, item_name, year, month, value ?? null, value_rm ?? null]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
