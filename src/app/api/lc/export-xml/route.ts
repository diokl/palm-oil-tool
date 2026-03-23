import { NextRequest, NextResponse } from 'next/server';

interface LCFields {
  '40A'?: string;
  '20'?: string;
  '31C'?: string;
  '31D'?: string;
  '50'?: string;
  '59'?: string;
  '32B'?: string;
  '39A'?: string;
  '41D'?: string;
  '42C'?: string;
  '43P'?: string;
  '43T'?: string;
  '44A'?: string;
  '44B'?: string;
  '44C'?: string;
  '44D'?: string;
  '45A'?: string;
  '46A'?: string;
  '47A'?: string;
  '71D'?: string;
  '48'?: string;
  '49'?: string;
  [key: string]: string | undefined;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const lcFields: LCFields = body;

    if (!lcFields || typeof lcFields !== 'object') {
      return NextResponse.json({ error: 'LC fields required' }, { status: 400 });
    }

    // Build SWIFT MT700 XML
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MT700>
  <MessageType>MT700</MessageType>
  <Function>DOCUMENTARY CREDIT</Function>

  <Fields>
    <Field tag="40A">
      <Name>Form of Documentary Credit</Name>
      <Value>${escapeXml(lcFields['40A'] || 'IRREVOCABLE')}</Value>
    </Field>

    <Field tag="20">
      <Name>Documentary Credit Number</Name>
      <Value>${escapeXml(lcFields['20'] || '')}</Value>
    </Field>

    <Field tag="31C">
      <Name>Date of Issue</Name>
      <Value>${escapeXml(lcFields['31C'] || '')}</Value>
    </Field>

    <Field tag="31D">
      <Name>Date and Place of Expiry</Name>
      <Value>${escapeXml(lcFields['31D'] || '')}</Value>
    </Field>

    <Field tag="50">
      <Name>Applicant</Name>
      <Value>${escapeXml(lcFields['50'] || '')}</Value>
    </Field>

    <Field tag="59">
      <Name>Beneficiary</Name>
      <Value>${escapeXml(lcFields['59'] || '')}</Value>
    </Field>

    <Field tag="32B">
      <Name>Currency Code, Amount</Name>
      <Value>${escapeXml(lcFields['32B'] || '')}</Value>
    </Field>

    <Field tag="39A">
      <Name>Percentage Credit Amount Tolerance</Name>
      <Value>${escapeXml(lcFields['39A'] || '+/- 5 PERCENT')}</Value>
    </Field>

    <Field tag="41D">
      <Name>Available with...by...Negotiation</Name>
      <Value>${escapeXml(lcFields['41D'] || 'ANY BANK')}</Value>
    </Field>

    <Field tag="42C">
      <Name>Drafts at...Sight/Usance</Name>
      <Value>${escapeXml(lcFields['42C'] || 'SIGHT')}</Value>
    </Field>

    <Field tag="43P">
      <Name>Partial Shipments</Name>
      <Value>${escapeXml(lcFields['43P'] || 'NOT ALLOWED')}</Value>
    </Field>

    <Field tag="43T">
      <Name>Transshipment</Name>
      <Value>${escapeXml(lcFields['43T'] || 'NOT ALLOWED')}</Value>
    </Field>

    <Field tag="44A">
      <Name>Port of Loading/Airport of Departure</Name>
      <Value>${escapeXml(lcFields['44A'] || '')}</Value>
    </Field>

    <Field tag="44B">
      <Name>Port of Discharge/Airport of Destination</Name>
      <Value>${escapeXml(lcFields['44B'] || '')}</Value>
    </Field>

    <Field tag="44C">
      <Name>Latest Date of Shipment</Name>
      <Value>${escapeXml(lcFields['44C'] || '')}</Value>
    </Field>

    <Field tag="44D">
      <Name>Shipment Period</Name>
      <Value>${escapeXml(lcFields['44D'] || '')}</Value>
    </Field>

    <Field tag="45A">
      <Name>Description of Goods/Services</Name>
      <Value>${escapeXml(lcFields['45A'] || '')}</Value>
    </Field>

    <Field tag="46A">
      <Name>Documents Required</Name>
      <Value>${escapeXml(lcFields['46A'] || '')}</Value>
    </Field>

    <Field tag="47A">
      <Name>Additional Conditions</Name>
      <Value>${escapeXml(lcFields['47A'] || '')}</Value>
    </Field>

    <Field tag="71D">
      <Name>Charges</Name>
      <Value>${escapeXml(lcFields['71D'] || '')}</Value>
    </Field>

    <Field tag="48">
      <Name>Period for Presentation</Name>
      <Value>${escapeXml(lcFields['48'] || '21 DAYS')}</Value>
    </Field>

    <Field tag="49">
      <Name>Confirmation Instructions</Name>
      <Value>${escapeXml(lcFields['49'] || 'WITHOUT')}</Value>
    </Field>
  </Fields>
</MT700>`;

    return NextResponse.json({
      success: true,
      xml: xml,
      download_filename: `LC_${lcFields['20'] || 'DRAFT'}_${new Date().toISOString().split('T')[0]}.xml`,
    });
  } catch (error: any) {
    console.error('LC export error:', error);
    return NextResponse.json({ error: `LC 내보내기 실패: ${error.message}` }, { status: 500 });
  }
}
