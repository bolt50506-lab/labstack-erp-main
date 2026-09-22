'use client';

/**
 * Opens a dedicated, professionally-styled print window and triggers the
 * browser print dialog. When the user selects "Save as PDF" (the default on
 * most modern browsers), the result is a clean PDF without any app chrome.
 */

export type PrintOptions = {
  title: string;
  bodyHtml: string;
  styles?: string;
};

export const basePrintStyles = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #0f172a;
    background: #ffffff;
    padding: 32px;
    font-size: 13px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
  h2 { font-size: 18px; font-weight: 600; }
  h3 { font-size: 15px; font-weight: 600; }
  h4 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #475569; }
  p { margin: 2px 0; }
  .text-muted { color: #64748b; }
  .font-mono { font-family: 'SF Mono', 'Menlo', 'Consolas', monospace; font-variant-numeric: tabular-nums; }
  .font-semibold { font-weight: 600; }
  .font-bold { font-weight: 700; }
  .report-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #0f172a;
    padding-bottom: 16px;
    margin-bottom: 20px;
  }
  .report-header .company { font-size: 22px; font-weight: 700; }
  .report-header .subtitle { font-size: 12px; color: #64748b; margin-top: 2px; }
  .report-header .doc-title { font-size: 16px; font-weight: 600; text-align: right; }
  .patient-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 24px;
    padding: 12px 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    margin-bottom: 20px;
  }
  .patient-grid .label { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .patient-grid .value { font-weight: 600; }
  .section { margin-bottom: 18px; }
  .section-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin-top: 8px; }
  .findings-content { line-height: 1.6; }
  .findings-content b, .findings-content strong { font-weight: 600; }
  .sign-block { margin-top: 48px; display: flex; justify-content: space-between; }
  .sign-line { border-bottom: 1px solid #0f172a; width: 200px; margin-bottom: 4px; }
  .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 10px; color: #94a3b8; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; background: #e0f2fe; color: #0369a1; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; padding: 8px 6px; border-bottom: 2px solid #e2e8f0; }
  td { padding: 8px 6px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
  @page { margin: 16mm; }
  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
  }
`;

export function printToPdf({ title, bodyHtml, styles = '' }: PrintOptions) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    alert('Please allow pop-ups to generate the PDF.');
    return;
  }
  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${basePrintStyles}${styles}</style>
</head>
<body>
  ${bodyHtml}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 250);
    };
  </script>
</body>
</html>`);
  win.document.close();
}

export function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function sanitizeReportHtml(value: string): string {
  if (typeof window === 'undefined') return value.replace(/<[^>]*>/g, '');
  const doc = new DOMParser().parseFromString(value, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, link, img').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.toLowerCase().startsWith('on') || attr.name.toLowerCase() === 'style') {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}

/**
 * Builds the report body HTML shared by the internal print/PDF view and
 * the public shareable-link portal, so there is exactly one place that
 * knows how a lab/radiology report is laid out. Takes a loosely-typed
 * shape (matches both the internal Supabase query result and the
 * get_public_report() RPC's JSON shape) rather than importing the app's
 * full DB types, since the public portal has no authenticated session to
 * fetch full typed rows with.
 */
export function buildLabReportHtml(input: {
  order: { order_code: string; created_at: string };
  company: { name?: string; address?: string; city?: string; phone?: string; email?: string } | null;
  patient: { full_name?: string; patient_code?: string; gender?: string; age?: number; phone?: string } | null;
  doctor: { full_name?: string } | null;
  items: { service_name: string; category?: string; result_value?: string | null; unit?: string | null; normal_range?: string | null; flag?: string | null; remarks?: string | null; verifying_doctor?: string | null }[];
}): { title: string; bodyHtml: string } {
  const { order, company, patient, doctor, items } = input;
  const isRadiologyReport = items.some((item) => item.category === 'radiology');
  const verifyingDoctorName = items.find((i) => i.verifying_doctor)?.verifying_doctor ?? null;

  const sectionsHtml = items.map((item) => {
    if (isRadiologyReport) {
      return `<section style="border-top:1px solid #e2e8f0;padding-top:16px;margin-top:16px;">
        <h3 style="font-size:15px;font-weight:600;">${item.service_name}</h3>
        <div class="section-box"><h4>Findings</h4>
          <div class="findings-content" style="margin-top:8px;">
            ${item.result_value ? sanitizeReportHtml(item.result_value) : '<p class="text-muted">No findings recorded.</p>'}
          </div>
        </div>
        <div class="section-box"><h4>Impression</h4>
          <p style="margin-top:8px;white-space:pre-wrap;">${item.remarks ?? 'No impression recorded.'}</p>
        </div>
      </section>`;
    }
    return `<tr>
      <td style="font-weight:600;">${item.service_name}</td>
      <td>${item.result_value ?? '-'}</td>
      <td style="color:#64748b;">${item.unit ?? '-'}</td>
      <td style="color:#64748b;">${item.normal_range ?? '-'}</td>
      <td>${item.flag && item.flag !== 'normal' ? `<span class="badge" style="background:#fee2e2;color:#dc2626;">${item.flag}</span>` : '<span class="badge">Normal</span>'}</td>
    </tr>`;
  }).join('');

  const bodyHtml = `
    <div class="report-header">
      <div>
        <div class="company">${company?.name ?? 'Healthcare ERP'}</div>
        ${company?.address ? `<div class="subtitle">${company.address}</div>` : ''}
        <div class="subtitle">${company?.city ?? ''} ${company?.phone ? `| Tel: ${company.phone}` : ''}${company?.email ? ` | ${company.email}` : ''}</div>
      </div>
      <div>
        <div class="doc-title">${isRadiologyReport ? 'RADIOLOGY REPORT' : 'LABORATORY REPORT'}</div>
        <div class="subtitle font-mono">${order.order_code}</div>
      </div>
    </div>
    <div class="patient-grid">
      <div><div class="label">Patient</div><div class="value">${patient?.full_name ?? '-'}</div></div>
      <div><div class="label">MRN</div><div class="value font-mono">${patient?.patient_code ?? '-'}</div></div>
      <div><div class="label">Gender / Age</div><div class="value">${patient?.gender ?? '-'} / ${patient?.age ?? '-'}</div></div>
      <div><div class="label">Date</div><div class="value">${formatDate(order.created_at)}</div></div>
      <div><div class="label">Referring Doctor</div><div class="value">${doctor?.full_name ?? '-'}</div></div>
      <div><div class="label">Phone</div><div class="value">${patient?.phone ?? '-'}</div></div>
    </div>
    ${isRadiologyReport
      ? `<div style="margin-bottom:18px;">${sectionsHtml}</div>`
      : `<table><thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference Range</th><th>Flag</th></tr></thead><tbody>${sectionsHtml}</tbody></table>`
    }
    <div class="sign-block">
      <div>
        <p class="text-muted" style="font-size:10px;">Report generated on ${formatDate(new Date().toISOString())}</p>
        <p class="text-muted" style="font-size:10px;margin-top:2px;">Computer-generated report — no physical signature required.</p>
      </div>
      <div style="text-align:right;">
        <div class="sign-line"></div>
        <p class="font-semibold">${verifyingDoctorName ?? 'Lab Technician'}</p>
        <p class="text-muted" style="font-size:10px;">${isRadiologyReport ? 'Radiologist' : 'Lab Technician'}</p>
      </div>
    </div>
    <div class="footer">${company?.name ?? 'Healthcare ERP'} | ${company?.phone ?? ''} | ${company?.email ?? ''}</div>
  `;

  return { title: `${isRadiologyReport ? 'Radiology' : 'Lab'} Report - ${order.order_code}`, bodyHtml };
}
