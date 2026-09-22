'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { FileText, Search, Loader2, Printer, CheckCircle2, Eye, Filter } from 'lucide-react';
import { printToPdf, formatDate, sanitizeReportHtml } from '@/lib/utils/pdf';
import type { LabOrder, LabOrderItem, LabResult, Patient, Doctor, Company, Service } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

type ItemWithRelations = LabOrderItem & {
  order?: LabOrder & { patient?: Patient; doctor?: Doctor | null };
  service?: Service;
  results?: LabResult[];
  radiology_report?: any[];
};

const STATUS_FLOW = ['pending', 'sample_collected', 'processing', 'result_entered', 'verified', 'approved', 'printed'] as const;
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  sample_collected: 'Sample Collected',
  processing: 'Processing',
  result_entered: 'Result Entered',
  verified: 'Verified',
  approved: 'Approved',
  printed: 'Printed',
};

const statusVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'approved' || status === 'printed') return 'default';
  if (status === 'result_entered' || status === 'verified') return 'secondary';
  if (status === 'pending') return 'outline';
  return 'secondary';
};

export default function RadiologyReportsPage() {
  const supabase = getSupabaseClient();
  const [items, setItems] = useState<ItemWithRelations[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [printing, setPrinting] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [itemsRes, docsRes] = await Promise.all([
      supabase
        .from('lab_order_items')
        .select('*, order:lab_orders(*, patient:patients(*), doctor:doctors(*)), service:services(*), radiology_report:radiology_reports(*)')
        .order('created_at', { ascending: false }),
      supabase.from('doctors').select('*').eq('is_active', true).order('full_name'),
    ]);
    if (itemsRes.error) {
      toast.error('Failed to load: ' + getFriendlyErrorMessage(itemsRes.error));
      setLoading(false);
      return;
    }
    const all = (itemsRes.data as any) || [];
    const radio = all.filter((i: any) => i.service?.category === 'radiology');
    setItems(radio);
    setDoctors((docsRes.data as Doctor[]) || []);

    if (radio.length > 0 && radio[0].order?.company_id) {
      const { data: co } = await supabase.from('companies').select('*').eq('id', radio[0].order.company_id).maybeSingle();
      if (co) setCompany(co as Company);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    const matchSearch =
      item.order?.order_code?.toLowerCase().includes(q) ||
      item.order?.patient?.full_name?.toLowerCase().includes(q) ||
      item.service_name?.toLowerCase().includes(q) ||
      item.order?.patient?.patient_code?.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || item.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const counts = STATUS_FLOW.reduce((acc, s) => {
    acc[s] = items.filter((i) => i.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  const handleMarkPrinted = async (item: ItemWithRelations) => {
    setPrinting(item.id);
    const { error } = await supabase.from('lab_order_items').update({ status: 'printed' }).eq('id', item.id);
    if (error) toast.error('Failed to update: ' + getFriendlyErrorMessage(error));
    else { toast.success('Marked as printed'); loadData(); }
    setPrinting(null);
  };

  const handlePrintPdf = async (item: ItemWithRelations) => {
    if (!item.order) return;
    setPrinting(item.id);
    let verifyingDoctorName = 'Radiologist';
    if (item.verified_by_doctor_id) {
      const { data: doc } = await supabase.from('doctors').select('full_name').eq('id', item.verified_by_doctor_id).maybeSingle();
      if (doc) verifyingDoctorName = (doc as any).full_name;
    }
    const result = item.radiology_report?.[0];
    const patient = item.order.patient;
    const order = item.order;

    const signatureUrl = item.verified_by_doctor_id ? (await supabase.from('doctors').select('signature_url').eq('id', item.verified_by_doctor_id).maybeSingle()).data?.signature_url : null;

    const bodyHtml = `
      <div class="report-header">
        <div>
          <div class="company">${company?.name ?? 'Healthcare ERP'}</div>
          ${company?.address ? `<div class="subtitle">${company.address}</div>` : ''}
          <div class="subtitle">${company?.city ?? ''} ${company?.phone ? `| Tel: ${company.phone}` : ''}${company?.email ? ` | ${company.email}` : ''}</div>
        </div>
        <div>
          <div class="doc-title">RADIOLOGY REPORT</div>
          <div class="subtitle font-mono">${order.order_code}</div>
        </div>
      </div>

      <div class="patient-grid">
        <div><div class="label">Patient</div><div class="value">${patient?.full_name ?? '-'}</div></div>
        <div><div class="label">MRN</div><div class="value font-mono">${patient?.patient_code ?? '-'}</div></div>
        <div><div class="label">Gender / Age</div><div class="value">${patient?.gender ?? '-'} / ${patient?.age ?? '-'}</div></div>
        <div><div class="label">Date</div><div class="value">${formatDate(order.created_at)}</div></div>
        <div><div class="label">Referring Doctor</div><div class="value">${order.doctor?.full_name ?? '-'}</div></div>
        <div><div class="label">Phone</div><div class="value">${patient?.phone ?? '-'}</div></div>
      </div>

      <div class="section">
        <h3>${item.service_name}</h3>
        <div class="section-box">
          <h4>Findings</h4>
          <div class="findings-content" style="margin-top:8px;">
            ${result?.findings ? sanitizeReportHtml(result.result_value) : '<p class="text-muted">No findings recorded.</p>'}
          </div>
        </div>
        <div class="section-box">
          <h4>Impression</h4>
          <p style="margin-top:8px;white-space:pre-wrap;">${result?.impression ?? 'No impression recorded.'}</p>
        </div>
      </div>

      <div class="sign-block">
        <div>
          <p class="text-muted" style="font-size:10px;">Report generated on ${formatDate(new Date().toISOString())}</p>
          <p class="text-muted" style="font-size:10px;margin-top:2px;">Computer-generated report — no physical signature required.</p>
        </div>
        <div style="text-align:right;">
          ${signatureUrl ? `<img src="${signatureUrl}" style="max-width:180px;max-height:55px;object-fit:contain;margin-left:auto;margin-bottom:4px;" />` : `<div class="sign-line"></div>`}
          <p class="font-semibold">${verifyingDoctorName}</p>
          <p class="text-muted" style="font-size:10px;">Radiologist</p>
        </div>
      </div>

      <div class="footer">
        ${company?.name ?? 'Healthcare ERP'} | ${company?.phone ?? ''} | ${company?.email ?? ''}
      </div>
    `;

    printToPdf({
      title: `Radiology Report - ${order.order_code}`,
      bodyHtml,
    });

    if (item.status === 'approved') {
      await handleMarkPrinted(item);
    }
    setPrinting(null);
  };

  const canPrint = (status: string) => status === 'approved' || status === 'printed' || status === 'verified';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Radiology Reports</h1>
          <p className="text-muted-foreground">Track report status and print professional PDF reports</p>
        </div>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1"><Filter className="h-3.5 w-3.5" /> Status:</div>
        <Button variant={statusFilter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter('all')}>
          All ({items.length})
        </Button>
        {STATUS_FLOW.map((s) => (
          <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)}>
            {STATUS_LABELS[s]} ({counts[s] ?? 0})
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by patient, MRN, order, exam..." className="pl-9" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading reports...
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No radiology reports found
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base">Reports ({filtered.length})</CardTitle>
            <CardDescription>Click "Print PDF" to generate a professional PDF document</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Examination</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-sm">{item.order?.order_code}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{item.order?.patient?.full_name ?? 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground font-mono">{item.order?.patient?.patient_code}</p>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{item.service_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(item.order?.created_at ?? item.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(item.status)}>{STATUS_LABELS[item.status] || item.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canPrint(item.status) ? (
                          <Button size="sm" onClick={() => handlePrintPdf(item)} disabled={printing === item.id}>
                            {printing === item.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Printer className="mr-1 h-3 w-3" />}
                            Print PDF
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground px-2 py-1">Awaiting approval</span>
                        )}
                        {item.status === 'approved' && (
                          <Button variant="ghost" size="sm" onClick={() => handleMarkPrinted(item)} disabled={printing === item.id}>
                            <CheckCircle2 className="mr-1 h-3 w-3" /> Mark Printed
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
