import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import postgres from 'postgres';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname,'..','.env.migration.local'),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const eq=t.indexOf('='); if(eq<0)continue;
  if(!(t.slice(0,eq).trim() in process.env)) process.env[t.slice(0,eq).trim()]=t.slice(eq+1).trim();
}
const sql = postgres(process.env.DATABASE_URL,{prepare:false,ssl:'require',max:1});
try {
  const [{c}] = await sql`SELECT COUNT(*)::int c FROM news`;
  const [{dmin,dmax}] = await sql`SELECT MIN(date) dmin, MAX(date) dmax FROM news`;
  console.log(`news 총 ${c}건, 범위 ${dmin} ~ ${dmax}`);
  const src = await sql`SELECT created_by, COUNT(*)::int c, MAX(date) latest FROM news GROUP BY created_by ORDER BY c DESC`;
  for (const s of src) console.log(`  ${s.created_by}: ${s.c}건 (최신 ${s.latest})`);
  // 컬럼 확인
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='news' ORDER BY ordinal_position`;
  console.log('컬럼:', cols.map(c=>c.column_name).join(', '));
} finally { await sql.end({timeout:5}); }
