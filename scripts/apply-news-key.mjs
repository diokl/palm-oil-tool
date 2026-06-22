import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import postgres from 'postgres';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname,'..','.env.migration.local'),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const eq=t.indexOf('='); if(eq<0)continue;
  if(!(t.slice(0,eq).trim() in process.env)) process.env[t.slice(0,eq).trim()]=t.slice(eq+1).trim();
}
const sql = postgres(process.env.DATABASE_URL,{prepare:false,ssl:'require',max:1});
try {
  await sql.unsafe(fs.readFileSync(path.join(__dirname,'..','sql','add_news_key.sql'),'utf8'));
  console.log('news.is_key 컬럼 추가');
  await sql`UPDATE news SET is_key=0 WHERE is_key IS NULL`;
  // 최근 High impact 뉴스 일부를 핵심 이슈로 자동 핀 (초기 시드)
  const r = await sql`UPDATE news SET is_key=1 WHERE impact='High' AND date >= '2026-05-01' RETURNING id`;
  console.log(`High impact 최근 뉴스 ${r.length}건 핵심 이슈로 자동 핀`);
} finally { await sql.end({timeout:5}); }
