// 텍스트 파서 검증 — 사용자 입력 5거래일 텍스트로 파서가 정확히 15 records 추출하는지.
// 이 스크립트는 src/lib/parse-bmd-text.ts와 동일 로직을 ESM JS로 임시 복제 (Node에서 .ts 직접 실행 불가).
// 진짜 검증은 도구 빌드 시 TypeScript가 잡아준다.

const MONTH_ABBR = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };

function parseDate(text, yearHint) {
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`;
  const md = text.match(/^\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (md) return `${yearHint}-${md[1].padStart(2,'0')}-${md[2].padStart(2,'0')}`;
  return null;
}
function resolveCM(abbr, inputDate) {
  const m = MONTH_ABBR[abbr]; if (!m) return null;
  const [yy, mm] = inputDate.split('-').map(Number);
  const cy = m >= mm ? yy : yy + 1;
  return `${cy}-${String(m).padStart(2,'0')}`;
}
const ENTRY_RE = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+([\d,.]+)\s*\/\s*([\d,.]+)\s*\/\s*([+-]?\d+(?:\.\d+)?)/g;
const BMD_TOTAL_RE = /BMD\s*([+-]?\d+(?:\.\d+)?)/;
const num = s => Number(s.replace(/,/g,''));

function parseBmdText(text, yearHint = 2026) {
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const days = [];
  let cur = null;
  for (let i=0; i<lines.length; i++) {
    const date = parseDate(lines[i], yearHint);
    if (date && /^\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s*\/\s*\d{1,2})/.test(lines[i])) {
      if (cur) days.push(cur);
      cur = { date, am: lines[i], pm: lines[i] };
    } else if (cur) {
      cur.am += ' ' + lines[i]; cur.pm += ' ' + lines[i];
    }
  }
  if (cur) days.push(cur);

  const records = [];
  for (const day of days) {
    const hay = day.am || '';
    const amIdx = hay.search(/오전\s*:/);
    const pmIdx = hay.search(/오후\s*:/);
    const chunks = [];
    if (amIdx >= 0) chunks.push({ s:'am', t: hay.slice(amIdx, pmIdx > amIdx ? pmIdx : hay.length) });
    if (pmIdx >= 0) chunks.push({ s:'pm', t: hay.slice(pmIdx) });
    const chosen = {};
    for (const sess of ['pm','am']) {
      const c = chunks.find(x => x.s === sess); if (!c) continue;
      let m; ENTRY_RE.lastIndex = 0;
      while ((m = ENTRY_RE.exec(c.t)) !== null) {
        const cm = resolveCM(m[1], day.date); if (!cm) continue;
        if (sess === 'am' && chosen[cm]) continue;
        chosen[cm] = { s:sess, usd:num(m[2]), myr:num(m[3]), ch:Number(m[4]) };
      }
    }
    for (const [cm,v] of Object.entries(chosen)) {
      records.push({ date: day.date, cm, usd: v.usd, myr: v.myr, ch: v.ch, sess: v.s });
    }
  }
  return records;
}

// 사용자 입력 텍스트 그대로
const INPUT = `5/20 (수)  오전: BMD +88 | Jun 1,207.50 / 4,628 / +88 | Jul 1,207.50 / 4,662 / +91 | Aug 1,207.50 / 4,673 / +88 오후: BMD -2 | Jun 1,190.00 / 4,515 / -25 | Jul 1,190.00 / 4,555 / -16 | Aug 1,190.00 / 4,583 / -2
5/21 (목)  오전: BMD -55 | Jun 1,175.00 / 4,465 / -50 | Jul 1,175.00 / 4,501 / -55 | Aug 1,175.00 / 4,528 / -55 오후: BMD -126 | Jun 1,162.50 / 4,403 / -112 | Jul 1,162.50 / 4,434 / -122 | Aug 1,162.50 / 4,457 / -126
5/22 (금)  오전: BMD +40 | Jun 1,170.00 / 4,447 / +44 | Jul 1,170.00 / 4,475 / +42 | Aug 1,170.00 / 4,498 / +40 오후: BMD +27 | Jun 1,162.50 / 4,428 / +25 | Jul 1,162.50 / 4,461 / +28 | Aug 1,162.50 / 4,485 / +27
5/25 (월)  오전: BMD -48 | Jun 1,157.50 / 4,385 / -45 | Jul 1,157.50 / 4,414 / -49 | Aug 1,157.50 / 4,438 / -48 오후: BMD -14 | Jun 1,162.50 / 4,408 / -22 | Jul 1,162.50 / 4,445 / -18 | Aug 1,162.50 / 4,472 / -14
5/26 (화)  오전: BMD +21 | Jun 1,167.50 / 4,429 / +19 | Jul 1,167.50 / 4,462 / +16 | Aug 1,167.50 / 4,494 / +21`;

const recs = parseBmdText(INPUT, 2026);
console.log(`Parsed ${recs.length} records:`);
for (const r of recs) console.log(`  ${r.date} ${r.cm}  USD ${r.usd}  MYR ${r.myr}  Δ ${r.ch>0?'+':''}${r.ch}  (${r.sess})`);

const expected = 15;
console.log(`\nExpected ${expected}, got ${recs.length} — ${recs.length === expected ? '✓' : '✗'}`);
// PM 우선 검증: 5/20 Jun pm USD 1190
const sample = recs.find(r => r.date==='2026-05-20' && r.cm==='2026-06');
console.log(`5/20 2026-06 (PM=1190 기대): USD ${sample?.usd} ${sample?.usd===1190?'✓':'✗'}`);
// AM only 검증: 5/26 Jun am USD 1167.5
const am = recs.find(r => r.date==='2026-05-26' && r.cm==='2026-06');
console.log(`5/26 2026-06 (AM only=1167.5 기대): USD ${am?.usd} sess=${am?.sess} ${am?.usd===1167.5 && am?.sess==='am'?'✓':'✗'}`);
