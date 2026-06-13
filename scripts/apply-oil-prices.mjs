import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import postgres from 'postgres';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname,'..','.env.migration.local'),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const eq=t.indexOf('='); if(eq<0)continue;
  if(!(t.slice(0,eq).trim() in process.env)) process.env[t.slice(0,eq).trim()]=t.slice(eq+1).trim();
}
const sql = postgres(process.env.DATABASE_URL,{prepare:false,ssl:'require',max:1});
const C = 22.046226; // 1 cent/lb = $22.0462/MT
try {
  await sql.unsafe(fs.readFileSync(path.join(__dirname,'..','sql','add_oil_prices.sql'),'utf8'));
  console.log('oil_prices 테이블 생성 완료');
  // 초기 대두유 시드 (오늘 확인값 + 약간의 과거 — 참고용 최소)
  const seed = [
    ['2026-06-12', 'SBO', 74.28, 'cents/lb'],
  ];
  for (const [d, c, pn, u] of seed) {
    const usd = u === 'cents/lb' ? pn * C : pn;
    await sql`INSERT INTO oil_prices (date, commodity, price_native, unit_native, price_usd_mt, source)
      VALUES (${d},${c},${pn},${u},${Math.round(usd*100)/100},'koreapds_ref')
      ON CONFLICT (date,commodity) DO UPDATE SET price_native=EXCLUDED.price_native, price_usd_mt=EXCLUDED.price_usd_mt`;
    console.log(`  ${d} ${c} ${pn}${u} → $${Math.round(usd)}/MT`);
  }
  const [{c}] = await sql`SELECT COUNT(*)::int c FROM oil_prices`;
  console.log(`총 ${c}건`);
} finally { await sql.end({timeout:5}); }
