import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import postgres from 'postgres';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname,'..','.env.migration.local'),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const eq=t.indexOf('='); if(eq<0)continue;
  if(!(t.slice(0,eq).trim() in process.env)) process.env[t.slice(0,eq).trim()]=t.slice(eq+1).trim();
}
const DRY = process.argv.includes('--dry-run');
const sql = postgres(process.env.DATABASE_URL,{prepare:false,ssl:'require',max:1});
const MKT = 1177.5; // 6월 RBD 시황가 (엑셀 J20, BE1868)
try {
  // 1) 기존 2건 보강 (계약번호 + 판매사)
  console.log('1) 기존 2건 보강:');
  if (!DRY) {
    await sql`UPDATE purchases SET contract_number='S55273/2606', supplier='IOI GLOBAL SERVICES SDN. BHD.', notes=COALESCE(notes,'')||' | 계약일:2026-04-24 / 1차 / SC S55273/2606 (IOI)' WHERE id=105`;
    await sql`UPDATE purchases SET contract_number='40409698', supplier='WILMAR TRADING PTE LTD', notes=COALESCE(notes,'')||' | 계약일:2026-04-24 / 2차 / SC 40409698 (Wilmar)' WHERE id=106`;
  }
  console.log('   id=105 → S55273/2606 (IOI)');
  console.log('   id=106 → 40409698 (Wilmar)');

  // 2) 신규 2건 INSERT
  const NEW = [
    // [contract, supplier, unit, qty, trade_date, lot]
    ['S55634/2606', 'IOI GLOBAL SERVICES SDN. BHD.', 1215.0, 2500, '2026-05-28', '3차'],
    ['40411165',    'WILMAR TRADING PTE LTD',         1218.0, 2000, '2026-05-28', '4차'],
  ];
  console.log('\n2) 신규 2건 INSERT:');
  for (const [cn, sup, unit, qty, td, lot] of NEW) {
    console.log(`   ${cn} ${sup.split(' ')[0]} $${unit}×${qty}MT (${td}, ${lot})`);
    if (!DRY) {
      const orderNo = `MGD-202606-${cn.replace(/[^0-9]/g,'').slice(-4)}`;
      await sql`INSERT INTO purchases (order_no, product, shipment_month, unit_price, qty_mt, amount_usd, market_price_usd, exchange_rate, supplier, contract_number, notes, created_at)
        VALUES (${orderNo}, 'MANAGED', '2026-06', ${unit}, ${qty}, ${unit*qty}, ${MKT}, 1450, ${sup}, ${cn}, ${'PDF 계약서 / 계약일:'+td+' / '+lot+' / 3-MCPD+GE+RSPO'}, NOW())`;
    }
  }

  // 3) 검증
  if (!DRY) {
    const rows = await sql`SELECT id, product, unit_price, qty_mt, supplier, contract_number FROM purchases WHERE shipment_month='2026-06' ORDER BY unit_price`;
    console.log(`\n3) 26-06 관리팜유 최종 (${rows.length}건):`);
    let totQty=0, totAmt=0;
    for (const r of rows) { console.log(`   $${r.unit_price}×${r.qty_mt}MT ${r.supplier?.split(' ')[0]??'-'} [${r.contract_number??'-'}]`); totQty+=Number(r.qty_mt); totAmt+=Number(r.unit_price)*Number(r.qty_mt); }
    console.log(`   ── 총 ${totQty.toLocaleString()}MT, $${totAmt.toLocaleString()}`);
    // 선구매효과 (양수=절감)
    const PREM=65;
    let savings=0;
    for (const r of rows) savings += (MKT+PREM-Number(r.unit_price))*Number(r.qty_mt)*1450;
    console.log(`   선구매효과(savings_krw): ${savings.toLocaleString()}원`);
  }
} finally { await sql.end({timeout:5}); }
