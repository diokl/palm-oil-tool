import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import postgres from 'postgres';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname,'..','.env.migration.local'),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const eq=t.indexOf('='); if(eq<0)continue;
  if(!(t.slice(0,eq).trim() in process.env)) process.env[t.slice(0,eq).trim()]=t.slice(eq+1).trim();
}
const sql = postgres(process.env.DATABASE_URL,{prepare:false,ssl:'require',max:1});
try {
  // 1) 컬럼 추가
  await sql.unsafe(fs.readFileSync(path.join(__dirname,'..','sql','add_inventory_sales.sql'),'utf8'));
  console.log('1) sales_volume 컬럼 추가 완료');
  // 기존 NULL → 0
  await sql`UPDATE inventory SET sales_volume = 0 WHERE sales_volume IS NULL`;

  // 2) RBD 2026-06 에 4,000톤(=4,000,000 kg) 판매 입력
  await sql`UPDATE inventory SET sales_volume = 4000000, updated_by='sales_jun_rbd_4000t', updated_at=NOW()
            WHERE product='RBD' AND year=2026 AND month=6`;
  console.log('2) RBD 2026-06 판매량 4,000,000 kg 입력');

  // 3) RBD 2026 기말재고 재계산 (prev = 2025-12 기말)
  const prev = await sql`SELECT ending_stock FROM inventory WHERE product='RBD' AND year=2025 AND month=12`;
  let prevStock = Number(prev[0]?.ending_stock ?? 0);
  const rows = await sql`SELECT id, month, expected_usage, customs_volume, sales_volume FROM inventory WHERE product='RBD' AND year=2026 ORDER BY month`;
  console.log('\n3) RBD 2026 기말재고 재계산 (prev 25-12 =', prevStock.toLocaleString(), '):');
  for (const r of rows) {
    const u = Number(r.expected_usage ?? 0), c = Number(r.customs_volume ?? 0), s = Number(r.sales_volume ?? 0);
    const end = prevStock + c - u - s;
    const cov = u > 0 ? Math.round((end/u)*10)/10 : 0;
    await sql`UPDATE inventory SET ending_stock=${end}, coverage_days=${cov} WHERE id=${r.id}`;
    const mark = r.month===6 ? '  ← 판매 4,000톤 반영' : '';
    console.log(`   ${r.month}월: 통관 ${c.toLocaleString()} 소요 ${Math.round(u).toLocaleString()} 판매 ${s.toLocaleString()} → 기말 ${Math.round(end).toLocaleString()} (회전 ${cov}일)${mark}`);
    prevStock = end;
  }
} finally { await sql.end({timeout:5}); }
