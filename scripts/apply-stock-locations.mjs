import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import postgres from 'postgres';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname,'..','.env.migration.local'),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const eq=t.indexOf('='); if(eq<0)continue;
  if(!(t.slice(0,eq).trim() in process.env)) process.env[t.slice(0,eq).trim()]=t.slice(eq+1).trim();
}
const sql = postgres(process.env.DATABASE_URL,{prepare:false,ssl:'require',max:1});
const SEED = [
  // [location, product, qty_kg, as_of, sort]
  ['삼양베이커터미널','RPO',8713670,'2026-06-01',1], ['삼양베이커터미널','RSPO',1418720,'2026-06-01',1],
  ['삼양제분','RPO',246000,'2026-06-15',2],          ['삼양제분','RSPO',32000,'2026-06-15',2],
  ['삼양사','RPO',169657,'2026-06-15',3],            ['삼양사','RSPO',5501,'2026-06-15',3],
  ['원주공장','RPO',0,'2026-06-15',4],               ['원주공장','RSPO',0,'2026-06-15',4],
  ['익산공장','RPO',0,'2026-06-15',5],               ['익산공장','RSPO',0,'2026-06-15',5],
  ['밀양공장','RPO',0,'2026-06-15',6],               ['밀양공장','RSPO',0,'2026-06-15',6],
];
try {
  await sql.unsafe(fs.readFileSync(path.join(__dirname,'..','sql','add_stock_locations.sql'),'utf8'));
  console.log('stock_locations 테이블 생성');
  for (const [loc,prod,qty,asof,so] of SEED) {
    await sql`INSERT INTO stock_locations (location,product,qty_kg,as_of_date,sort_order)
      VALUES (${loc},${prod},${qty},${asof},${so})
      ON CONFLICT (location,product) DO UPDATE SET qty_kg=EXCLUDED.qty_kg, as_of_date=EXCLUDED.as_of_date, sort_order=EXCLUDED.sort_order`;
  }
  const rpo = await sql`SELECT COALESCE(SUM(qty_kg),0) s FROM stock_locations WHERE product='RPO'`;
  const rspo = await sql`SELECT COALESCE(SUM(qty_kg),0) s FROM stock_locations WHERE product='RSPO'`;
  console.log(`시드 완료. RPO 합계 ${Number(rpo[0].s).toLocaleString()} (엑셀 9,129,327), RSPO 합계 ${Number(rspo[0].s).toLocaleString()} (엑셀 1,456,221)`);
} finally { await sql.end({timeout:5}); }
