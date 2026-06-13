import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';

// 북마클릿(KoreaPDS 등 본인 로그인 세션)에서 수집한 기사들을 받아 중복을 거르고 저장.
// - 인증: 토큰(?token= 또는 x-ingest-token 헤더) === NEWS_INGEST_TOKEN
// - 중복: (date, title) 이 이미 있으면 스킵
// - 새 기사만 AI 시황(강세/약세/보합) + 영향도 판정 후 INSERT
//
// 크로스 오리진(북마클릿이 koreapds 도메인에서 fetch)이므로 CORS 허용.
// (미들웨어 PUBLIC_PATHS 에 /api/news/ingest 등록됨 — 세션 쿠키 없이 토큰으로만 통과)

export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ingest-token',
  'Access-Control-Max-Age': '86400',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// 'YYYY.MM.DD' / 'YYYY/MM/DD' / 'YYYY-M-D' → 'YYYY-MM-DD'
function normalizeDate(raw: string): string {
  if (!raw) return '';
  const m = String(raw).match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return String(raw).trim();
}

async function analyzeSentiment(text: string): Promise<{ sentiment: string; impact: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !text) return { sentiment: '보합', impact: 'Medium' };
  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `당신은 팜유 시장 전문 분석가입니다. 다음 뉴스의 팜유 가격 전망과 영향도를 판단하세요.

뉴스: "${text.slice(0, 4000)}"

반드시 아래 JSON만 반환 (다른 텍스트 없이):
{"sentiment": "강세 또는 약세 또는 보합", "impact": "High 또는 Medium 또는 Low"}`,
      }],
    });
    const t = res.content[0].type === 'text' ? res.content[0].text : '';
    const j = t.match(/\{[\s\S]*\}/);
    if (j) {
      const p = JSON.parse(j[0]);
      const vs = ['강세', '약세', '보합'];
      const vi = ['High', 'Medium', 'Low'];
      return {
        sentiment: vs.includes(p.sentiment) ? p.sentiment : '보합',
        impact: vi.includes(p.impact) ? p.impact : 'Medium',
      };
    }
  } catch (e) {
    console.warn('ingest sentiment failed:', (e as Error).message);
  }
  return { sentiment: '보합', impact: 'Medium' };
}

// news.category 컬럼 보장 (인스턴스당 1회). IF NOT EXISTS라 멱등.
let categoryEnsured = false;
async function ensureCategoryColumn() {
  if (categoryEnsured) return;
  try { await dbRun(`ALTER TABLE news ADD COLUMN IF NOT EXISTS category TEXT`); } catch (e) { /* noop */ }
  categoryEnsured = true;
}

export async function POST(request: NextRequest) {
  try {
    // 토큰 검증
    const expected = process.env.NEWS_INGEST_TOKEN;
    const token = new URL(request.url).searchParams.get('token') || request.headers.get('x-ingest-token') || '';
    if (!expected || token !== expected) {
      return NextResponse.json({ error: 'invalid token' }, { status: 401, headers: CORS });
    }

    await ensureCategoryColumn();

    const body = await request.json();
    const category = (body.category || '기타').toString().trim() || '기타';
    const articles: Array<{ date?: string; title?: string; content?: string }> = Array.isArray(body.articles) ? body.articles : [];
    if (articles.length === 0) {
      return NextResponse.json({ error: 'articles 배열이 비었습니다' }, { status: 400, headers: CORS });
    }

    let added = 0;
    let updated = 0;
    const results: Array<{ date: string; title: string; status: 'added' | 'updated'; sentiment?: string; impact?: string }> = [];

    // 제목 정규화: 앞의 "[06/12] " 같은 날짜접두어 제거 → 옛 bulk_upload건과 매칭용
    const stripPrefix = (t: string) => (t || '').replace(/^\[[^\]]*\]\s*/, '').trim();

    for (const a of articles) {
      const date = normalizeDate(a.date || '');
      const title = (a.title || '').trim();
      const full = (a.content || '').trim();
      if (!date || !title) { continue; }
      const normT = stripPrefix(title);

      // 같은 날짜의 기존 뉴스 중, 접두어 무시 제목이 같은 항목 찾기(소스 무관 중복 방지)
      const existing = await dbAll(
        `SELECT id, content, sentiment FROM news WHERE date = ?`,
        [date],
      ) as { id: number; content: string; sentiment: string | null }[];
      const match = existing.find((e) => stripPrefix(e.content) === normT);

      if (match) {
        // 기존 항목 갱신: 제목 통일 + 본문 정리 + 카테고리 부여. 시황은 기존 유지(있으면).
        await dbRun(
          `UPDATE news SET content = ?, full_content = COALESCE(?, full_content), category = ? WHERE id = ?`,
          [title, full || null, category, match.id],
        );
        updated++;
        results.push({ date, title, status: 'updated' });
        continue;
      }

      const { sentiment, impact } = await analyzeSentiment(full || title);
      await dbRun(
        `INSERT INTO news (date, content, full_content, sentiment, impact, created_by, category) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [date, title, full || null, sentiment, impact, 'bookmarklet', category],
      );
      added++;
      results.push({ date, title, status: 'added', sentiment, impact });
    }

    return NextResponse.json(
      { success: true, added, updated, total: articles.length, results },
      { headers: CORS },
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }
}
