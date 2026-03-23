import { NextRequest, NextResponse } from 'next/server';

async function parsePdf(buffer: Buffer): Promise<string> {
  const mod = await import('pdf-parse');

  // pdf-parse v1 style: default export is a function
  if (typeof (mod as any).default === 'function') {
    const pdfParse = (mod as any).default;
    const data = await pdfParse(buffer);
    return data.text;
  }

  // pdf-parse v2 style: PDFParse class
  if ((mod as any).PDFParse) {
    const { PDFParse } = mod as any;
    const uint8 = new Uint8Array(buffer);
    const pdf = new PDFParse(uint8);
    await pdf.load();
    const result = await pdf.getText();
    const text = typeof result === 'string' ? result : (result?.text || '');
    pdf.destroy();
    // If page-based, concat page texts
    if (!text && result?.pages) {
      let allText = '';
      for (let i = 1; i <= (result.total || 0); i++) {
        try { allText += await pdf.getPageText(i) + '\n'; } catch {}
      }
      return allText;
    }
    return text;
  }

  // Fallback: try calling the module itself
  const pdfParse = (mod as any).default || mod;
  const data = await pdfParse(buffer);
  return data.text || '';
}

// 월물 이름을 YYYY-MM 형식으로 변환
function monthToYYYYMM(monthName: string, baseYear: number): string {
  const monthMap: Record<string, string> = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'april': '04',
    'may': '05', 'jun': '06', 'june': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
  };
  const lower = monthName.toLowerCase().trim();

  // 분기물: Jul/Aug/Sep, Oct/Nov/Dec, Jan/Feb/Mar
  if (lower.includes('/')) {
    const firstMonth = lower.split('/')[0].trim();
    const mm = monthMap[firstMonth];
    if (mm) {
      // Jan/Feb/Mar인 경우 다음 해
      const year = parseInt(mm) <= 3 ? baseYear + 1 : baseYear;
      return `${year}-${mm}`;
    }
  }

  const mm = monthMap[lower];
  if (mm) {
    const year = parseInt(mm) < 3 ? baseYear + 1 : baseYear;
    return `${baseYear}-${mm}`;
  }

  return monthName;
}

interface ParsedBMDData {
  report_date: string;
  exchange_rate: number | null;
  rbd_palm_oil: Array<{ month: string; contract_month: string; ask: number }>;
  rbd_palm_olein: Array<{ month: string; contract_month: string; ask: number; bid: number | null; values: number | null }>;
  fcpo_usd: Array<{ month: string; contract_month: string; last_done_trade: number }>;
  cpo_myr: Array<{ month: string; contract_month: string; ask: number; bid: number | null }>;
}

function parseBMDText(text: string): ParsedBMDData {
  const result: ParsedBMDData = {
    report_date: '',
    exchange_rate: null,
    rbd_palm_oil: [],
    rbd_palm_olein: [],
    fcpo_usd: [],
    cpo_myr: [],
  };

  // 날짜 추출: "19 Mar 2026" 또는 "March 19 (Close)"
  const dateMatch = text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
  if (dateMatch) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mm = months[dateMatch[2].toLowerCase().substring(0, 3)] || '01';
    result.report_date = `${dateMatch[3]}-${mm}-${dateMatch[1].padStart(2, '0')}`;
  }

  // 기준 연도
  const baseYear = result.report_date ? parseInt(result.report_date.substring(0, 4)) : new Date().getFullYear();

  // 환율 추출
  const fxMatch = text.match(/Ringgit\/USD\s*=\s*([\d.]+)/i);
  if (fxMatch) {
    result.exchange_rate = parseFloat(fxMatch[1]);
  }

  const lines = text.split('\n').map(l => l.trim());

  // 섹션 파싱 함수
  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 섹션 감지
    if (/RBD PALM OIL\s*$/i.test(line) && !/OLEIN|KERNEL|STEARIN/i.test(line)) {
      currentSection = 'RBD_PALM_OIL';
      continue;
    }
    if (/RBD PALM OLEIN/i.test(line)) {
      currentSection = 'RBD_PALM_OLEIN';
      continue;
    }
    if (/Bursa Malaysia Crude Palm Oil.*USD/i.test(line) || /FCPO.*USD/i.test(line)) {
      currentSection = 'FCPO_USD';
      continue;
    }
    if (/MALAYSIAN CRUDE PALM OIL in ringgit/i.test(line)) {
      currentSection = 'CPO_MYR';
      continue;
    }
    if (/={5,}/.test(line) || /OTHER REFINED/i.test(line) || /REFINED PALM OIL PRODUCTS/i.test(line)) {
      if (!/RBD PALM OIL/i.test(lines[i + 1] || '')) {
        // Don't reset if next line starts our target section
      }
      continue;
    }
    if (/BID\s+ASK|ASK\s+VALUES|LAST DONE TRADE|ASK\s+RIC/i.test(line)) {
      continue; // header line
    }

    // 데이터 행 파싱
    const monthMatch = line.match(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\/\w+)*(?:uary|ruary|ch|il|e|y|ust|tember|ober|ember)?)\s+/i);
    if (!monthMatch) continue;

    const monthName = monthMatch[1];
    const rest = line.substring(monthMatch[0].length).trim();
    const nums = rest.match(/[\d,.]+/g)?.map(n => parseFloat(n.replace(/,/g, ''))) || [];

    const contractMonth = monthToYYYYMM(monthName, baseYear);

    if (currentSection === 'RBD_PALM_OIL') {
      // Format: [BID(N/A)] ASK [VALUES(N/A)] [RIC]
      // We mainly want ASK
      const askVal = nums.find(n => n > 500 && n < 3000);
      if (askVal) {
        result.rbd_palm_oil.push({ month: monthName, contract_month: contractMonth, ask: askVal });
      }
    } else if (currentSection === 'RBD_PALM_OLEIN') {
      // BID ASK VALUES
      if (nums.length >= 2) {
        const ask = nums.length >= 3 ? nums[1] : nums[0];
        const values = nums.length >= 3 ? nums[2] : nums[1];
        const bid = nums.length >= 3 ? nums[0] : null;
        result.rbd_palm_olein.push({ month: monthName, contract_month: contractMonth, ask, bid, values });
      } else if (nums.length === 1) {
        result.rbd_palm_olein.push({ month: monthName, contract_month: contractMonth, ask: nums[0], bid: null, values: null });
      }
    } else if (currentSection === 'FCPO_USD') {
      const val = nums.find(n => n > 500 && n < 3000);
      if (val) {
        result.fcpo_usd.push({ month: monthName, contract_month: contractMonth, last_done_trade: val });
      }
    } else if (currentSection === 'CPO_MYR') {
      if (nums.length >= 2) {
        result.cpo_myr.push({ month: monthName, contract_month: contractMonth, bid: nums[0], ask: nums[1] });
      }
    }
  }

  return result;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'PDF 파일만 업로드 가능합니다' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const text = await parsePdf(buffer);

    const parsed = parseBMDText(text);

    return NextResponse.json({
      success: true,
      ...parsed,
      raw_text: text.substring(0, 3000),
    });
  } catch (error: any) {
    console.error('BMD PDF parse error:', error);
    return NextResponse.json({ error: `PDF 파싱 실패: ${error.message}` }, { status: 500 });
  }
}
