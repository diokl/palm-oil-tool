import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import postgres from 'postgres';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname,'..','.env.migration.local'),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const eq=t.indexOf('='); if(eq<0)continue;
  if(!(t.slice(0,eq).trim() in process.env)) process.env[t.slice(0,eq).trim()]=t.slice(eq+1).trim();
}
const sql = postgres(process.env.DATABASE_URL,{prepare:false,ssl:'require',max:1});
try {
  console.log('=== 26-06 선적 모든 purchases ===');
  const rows = await sql`SELECT id, order_no, product, shipment_month, unit_price, qty_mt, supplier, contract_number, notes FROM purchases WHERE shipment_month='2026-06' ORDER BY product, unit_price`;
  for (const r of rows) console.log(`  id=${r.id} ${r.product} $${r.unit_price}×${r.qty_mt}MT sup=${r.supplier??'-'} order=${r.order_no??'-'} cnum=${r.contract_number??'-'}`);
  console.log(`\n총 ${rows.length}건`);
  // 계약번호로 검색
  console.log('\n=== 계약번호 매칭 검색 (S55634, S55273, 40409698, 40411165) ===');
  for (const cn of ['S55634','S55273','40409698','40411165','55634','55273']) {
    const m = await sql`SELECT id, product, unit_price, qty_mt FROM purchases WHERE contract_number ILIKE ${'%'+cn+'%'} OR order_no ILIKE ${'%'+cn+'%'} OR notes ILIKE ${'%'+cn+'%'}`;
    console.log(`  ${cn}: ${m.length}건 ${m.map(x=>`(id${x.id} $${x.unit_price}×${x.qty_mt})`).join(' ')}`);
  }
} finally { await sql.end({timeout:5}); }
