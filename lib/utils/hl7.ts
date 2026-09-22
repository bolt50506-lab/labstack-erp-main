/**
 * Minimal HL7 v2.x parser scoped to what an ORU^R01 (observation result)
 * message needs: MSH (message header), PID (patient), OBR (order), and
 * OBX (individual result) segments. HL7 v2 uses | as the field separator
 * and ^ as the component separator within a field, with segments
 * separated by CR (\r) — real messages from an MLLP bridge will use \r,
 * but \n and \r\n are also accepted since bridges vary.
 */

export type HL7ObxResult = {
  setId: string;
  valueType: string;
  identifier: string; // OBX-3.1 — the code we match against analyzer_code
  identifierText: string; // OBX-3.2 — human-readable name, for logging/fallback
  value: string;
  units: string;
  referenceRange: string;
  abnormalFlag: string; // H, L, LL, HH, N, A
};

export type ParsedHL7Message = {
  messageType: string; // e.g. "ORU^R01"
  sendingApplication: string;
  patientId: string; // PID-3, if present
  patientName: string;
  orderControlId: string; // OBR-2 (placer order number) — matched against order_code or sample_id
  fillerOrderId: string; // OBR-3 (filler order number)
  universalServiceId: string; // OBR-4.1 — the overall test/panel code
  results: HL7ObxResult[];
};

function splitSegments(raw: string): string[] {
  return raw.split(/\r\n|\r|\n/).map(s => s.trim()).filter(Boolean);
}

function fields(segment: string): string[] {
  return segment.split('|');
}

function component(field: string | undefined, index: number): string {
  if (!field) return '';
  return field.split('^')[index] ?? '';
}

export function parseHL7Message(raw: string): ParsedHL7Message {
  const segments = splitSegments(raw);
  const msh = segments.find(s => s.startsWith('MSH'));
  const pid = segments.find(s => s.startsWith('PID'));
  const obr = segments.find(s => s.startsWith('OBR'));
  const obxSegments = segments.filter(s => s.startsWith('OBX'));

  if (!msh) throw new Error('Not a valid HL7 message: missing MSH segment');

  const mshFields = fields(msh);
  // MSH-1 is the field separator itself, so MSH-2 (encoding chars) is
  // index 1, and every subsequent field is offset by one vs. the spec's
  // 1-based numbering once you split on '|'.
  const messageType = mshFields[8] ? `${component(mshFields[8], 0)}^${component(mshFields[8], 1)}` : '';
  const sendingApplication = mshFields[2] ?? '';

  const pidFields = pid ? fields(pid) : [];
  const patientId = component(pidFields[3], 0) || component(pidFields[2], 0);
  const patientName = pidFields[5] ? pidFields[5].replace(/\^/g, ' ').trim() : '';

  const obrFields = obr ? fields(obr) : [];
  const orderControlId = obrFields[2] ?? '';
  const fillerOrderId = obrFields[3] ?? '';
  const universalServiceId = component(obrFields[4], 0);

  const results: HL7ObxResult[] = obxSegments.map(seg => {
    const f = fields(seg);
    return {
      setId: f[1] ?? '',
      valueType: f[2] ?? '',
      identifier: component(f[3], 0),
      identifierText: component(f[3], 1),
      value: f[5] ?? '',
      units: f[6] ?? '',
      referenceRange: f[7] ?? '',
      abnormalFlag: (f[8] ?? '').toUpperCase(),
    };
  });

  return { messageType, sendingApplication, patientId, patientName, orderControlId, fillerOrderId, universalServiceId, results };
}

/** Maps an HL7 abnormal flag to this app's flag vocabulary. */
export function mapAbnormalFlag(hl7Flag: string): 'normal' | 'low' | 'high' | 'critical' {
  const f = hl7Flag.toUpperCase();
  if (f === 'LL' || f === 'HH' || f === 'AA') return 'critical';
  if (f === 'L') return 'low';
  if (f === 'H') return 'high';
  return 'normal';
}
