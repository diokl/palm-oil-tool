import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import postgres from 'postgres';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname,'..','.env.migration.local'),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const eq=t.indexOf('='); if(eq<0)continue;
  if(!(t.slice(0,eq).trim() in process.env)) process.env[t.slice(0,eq).trim()]=t.slice(eq+1).trim();
}
const sql = postgres(process.env.DATABASE_URL,{prepare:false,ssl:'require',max:1});
try {
  const rows = await sql`SELECT date, sentiment, impact, LEFT(content,60) content, LEFT(full_content,40) fc FROM news WHERE created_by='bulk_upload' ORDER BY date DESC`;
  console.log('bulk_upload 뉴스 19건:');
  for (const r of rows) console.log(`  ${r.date} [${r.sentiment}/${r.impact}] ${r.content}`);
} finally { await sql.end({timeout:5}); }
