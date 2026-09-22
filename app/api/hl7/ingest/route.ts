import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { parseHL7Message, mapAbnormalFlag, type ParsedHL7Message } from '@/lib/utils/hl7';

/**
 * Machine-to-machine ingestion endpoint. Authenticated by a per-analyzer
 * API key (X-Api-Key header), not a user session — see the 0030 migration
 * for why: this is meant to be called by an on-site HL7-to-HTTP bridge
 * relaying a lab machine's raw ORU^R01 output, not by a logged-in user.
 */
export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) return NextResponse.json({ error: 'Missing X-Api-Key header' }, { status: 401 });

  const rest = (path: string, init?: RequestInit) =>
    fetch(`${supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });

  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  const analyzerRes = await rest(`analyzers?api_key_hash=eq.${keyHash}&is_active=eq.true&select=id,company_id,branch_id,name`);
  const analyzers = await analyzerRes.json();
  const analyzer = Array.isArray(analyzers) ? analyzers[0] : null;
  if (!analyzer) return NextResponse.json({ error: 'Invalid or inactive analyzer API key' }, { status: 401 });

  const rawMessage = await req.text();
  if (!rawMessage.trim()) return NextResponse.json({ error: 'Empty message body' }, { status: 400 });

  const logResult = async (status: 'matched' | 'unmatched' | 'error', extra: { matched_lab_order_item_id?: string; error_message?: string } = {}) => {
    await rest('analyzer_result_logs', {
      method: 'POST',
      body: JSON.stringify({ analyzer_id: analyzer.id, company_id: analyzer.company_id, raw_message: rawMessage, status, ...extra }),
    });
  };

  let parsed: ParsedHL7Message;
  try {
    parsed = parseHL7Message(rawMessage);
  } catch (err: any) {
    await logResult('error', { error_message: 'Parse error: ' + err.message });
    return NextResponse.json({ error: 'Failed to parse HL7 message: ' + err.message }, { status: 400 });
  }

  // Match the order by its placer order number (OBR-2) against our
  // order_code or sample_id — whichever the analyzer was given at
  // sample collection time.
  const orderRes = await rest(`lab_orders?company_id=eq.${analyzer.company_id}&order_code=eq.${encodeURIComponent(parsed.orderControlId)}&select=id`);
  const orders = await orderRes.json();
  const order = Array.isArray(orders) ? orders[0] : null;
  if (!order) {
    await logResult('unmatched', { error_message: `No order found matching "${parsed.orderControlId}"` });
    return NextResponse.json({ error: `No matching order for "${parsed.orderControlId}"` }, { status: 404 });
  }

  const itemsRes = await rest(`lab_order_items?lab_order_id=eq.${order.id}&select=id,service_id,service_name,status,service:services(category,analyzer_code)`);
  const items = (await itemsRes.json()) as any[];

  // Only lab items are analyzer candidates — a radiology item on the
  // same order must never be matched against an incoming lab result.
  // 'sample_collected' is the actual status set by /lab/collection;
  // 'processing' is set by /lab/processing — a result can legitimately
  // arrive at either point, since the analyzer completing the test IS
  // the processing step for many labs.
  const labItems = items.filter(i => i.service?.category === 'lab');
  const inProgressItems = labItems.filter(i => i.status === 'sample_collected' || i.status === 'processing');

  // Prefer an exact analyzer_code match against the incoming panel
  // identifier (OBR-4) over just grabbing whichever item is in progress
  // — this is what actually prevents a mismatch when a patient has more
  // than one lab test in progress on the same order at once.
  const codeMatch = inProgressItems.find(i => i.service?.analyzer_code && i.service.analyzer_code.toUpperCase() === parsed.universalServiceId.toUpperCase());
  const matchedItem = codeMatch ?? (inProgressItems.length === 1 ? inProgressItems[0] : null);

  if (!matchedItem) {
    const reason = inProgressItems.length > 1
      ? `Order "${parsed.orderControlId}" has ${inProgressItems.length} lab items in progress and none match analyzer code "${parsed.universalServiceId}" — set Analyzer Code on the service to disambiguate`
      : `Order "${parsed.orderControlId}" has no in-progress lab item to attach results to`;
    await logResult('unmatched', { error_message: reason });
    return NextResponse.json({ error: reason }, { status: 404 });
  }

  const paramsRes = await rest(`test_parameters?service_id=eq.${matchedItem.service_id}&is_active=eq.true&select=id,name,analyzer_code,unit,normal_range`);
  const testParams = await paramsRes.json();

  const existingResultRes = await rest(`lab_results?lab_order_item_id=eq.${matchedItem.id}&select=id`);
  const existingResults = await existingResultRes.json();
  let resultId = Array.isArray(existingResults) && existingResults[0] ? existingResults[0].id : null;

  if (!resultId) {
    const created = await rest('lab_results', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ lab_order_item_id: matchedItem.id, service_id: matchedItem.service_id, result_value: '', flag: 'normal' }),
    });
    const createdData = await created.json();
    resultId = createdData[0]?.id;
  }

  const paramInserts = parsed.results.map(obx => {
    const matchedParam = (testParams as any[]).find(p => p.analyzer_code && p.analyzer_code.toUpperCase() === obx.identifier.toUpperCase());
    return {
      lab_result_id: resultId,
      test_parameter_id: matchedParam?.id ?? null,
      parameter_name: matchedParam?.name ?? obx.identifierText ?? obx.identifier,
      result_value: obx.value,
      unit: obx.units || matchedParam?.unit || '',
      normal_range: obx.referenceRange || matchedParam?.normal_range || '',
      flag: mapAbnormalFlag(obx.abnormalFlag),
    };
  });

  await rest(`lab_result_parameters?lab_result_id=eq.${resultId}`, { method: 'DELETE' });
  if (paramInserts.length > 0) {
    await rest('lab_result_parameters', { method: 'POST', body: JSON.stringify(paramInserts) });
  }

  // Advance sample_collected -> processing so the item actually shows up
  // in Pathology Reports' work queue (which only looks at 'processing'
  // and 'result_entered') instead of silently sitting invisible until a
  // technician manually clicks Start Processing on /lab/processing.
  if (matchedItem.status === 'sample_collected') {
    await rest(`lab_order_items?id=eq.${matchedItem.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'processing' }) });
  }

  await rest(`analyzers?id=eq.${analyzer.id}`, { method: 'PATCH', body: JSON.stringify({ last_seen_at: new Date().toISOString() }) });
  await logResult('matched', { matched_lab_order_item_id: matchedItem.id });

  return NextResponse.json({
    success: true,
    matched_order_code: parsed.orderControlId,
    matched_item: matchedItem.service_name,
    parameters_written: paramInserts.length,
    note: 'Result saved as a draft in Pathology Reports — a technician still needs to review and Submit for Verification.',
  });
}
