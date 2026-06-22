import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import postgres from 'postgres';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname,'..','.env.migration.local'),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const eq=t.indexOf('='); if(eq<0)continue;
  if(!(t.slice(0,eq).trim() in process.env)) process.env[t.slice(0,eq).trim()]=t.slice(eq+1).trim();
}
const sql = postgres(process.env.DATABASE_URL,{prepare:false,ssl:'require',max:1});
// 엑셀 6/7/8 + 9~12월(8월 연장)
const RPO  = {'2026-06':2703297.5,'2026-07':3130781.6,'2026-08':2772958.3};
const RSPO = {'2026-06':659648.9,'2026-07':338544.2,'2026-08':201103.4};
try {
  await sql.unsafe(fs.readFileSync(path.join(__dirname,'..','sql','add_demand_config.sql'),'utf8'));
  console.log('demand_config + daily_adjustments 테이블 생성');
  for (const m of ['2026-06','2026-07','2026-08','2026-09','2026-10','2026-11','2026-12']) {
    const rpo = RPO[m] ?? RPO['2026-08'];
    const rspo = RSPO[m] ?? RSPO['2026-08'];
    await sql`INSERT INTO demand_config (product,month,monthly_kg) VALUES ('RPO',${m},${rpo}) ON CONFLICT (product,month) DO UPDATE SET monthly_kg=EXCLUDED.monthly_kg`;
    await sql`INSERT INTO demand_config (product,month,monthly_kg) VALUES ('RSPO',${m},${rspo}) ON CONFLICT (product,month) DO UPDATE SET monthly_kg=EXCLUDED.monthly_kg`;
  }
  const c = await sql`SELECT COUNT(*)::int c FROM demand_config`;
  console.log(`demand_config 시드 ${c[0].c}건 (RPO/RSPO × 6~12월)`);
} finally { await sql.end({timeout:5}); }
