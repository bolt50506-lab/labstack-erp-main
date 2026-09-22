'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Printer, FileText, CheckCircle2, Search, Loader2, Filter } from 'lucide-react';
import { printToPdf, formatDate, sanitizeReportHtml } from '@/lib/utils/pdf';
import type { LabOrder, LabOrderItem, LabResult, Patient, Doctor, Company, Service } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

type OrderWithRelations = LabOrder & {
  patient?: Patient;
  doctor?: Doctor | null;
  lab_order_items?: (LabOrderItem & { results?: LabResult[]; service?: Service })[];
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

const statusVariant = (status: string): 'default' | 'secondary' | 'outline' => {
  if (status === 'approved' || status === 'printed') return 'default';
  if (status === 'result_entered' || status === 'verified') return 'secondary';
  return 'outline';
};

export default function LabReportsPage() {
  const supabase = getSupabaseClient();
  const [orders, setOrders] = useState<OrderWithRelations[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [printing, setPrinting] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('lab_orders')
      .select('*, patient:patients(*), doctor:doctors(*), lab_order_items:lab_order_items(*, results:lab_results(*), service:services(*))')
      .order('created_at', { ascending: false });
    if (error) {
      toast.error('Failed to load: ' + getFriendlyErrorMessage(error));
    } else {
      const allOrders = (data as any) || [];
      const labOnly = allOrders
        .map((o: any) => ({
          ...o,
          lab_order_items: (o.lab_order_items || []).filter((item: any) => item.service?.category === 'lab'),
        }))
        .filter((o: any) => o.lab_order_items.length > 0);
      setOrders(labOnly as any);
      if (labOnly.length > 0 && labOnly[0].company_id) {
        const { data: co } = await supabase.from('companies').select('*').eq('id', labOnly[0].company_id).maybeSingle();
        if (co) setCompany(co as Company);
      }
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleMarkPrinted = async (item: LabOrderItem) => {
    setPrinting(item.id);
    const { error } = await supabase.from('lab_order_items').update({ status: 'printed' }).eq('id', item.id);
    if (error) toast.error('Failed: ' + getFriendlyErrorMessage(error));
    else { toast.success('Marked as printed'); loadData(); }
    setPrinting(null);
  };

  const handlePrintPdf = async (order: OrderWithRelations) => {
    setPrinting(order.id);
    const approvedItems = order.lab_order_items?.filter((i) => i.status === 'approved' || i.status === 'printed') ?? [];
    if (approvedItems.length === 0) { toast.error('No approved items to print'); setPrinting(null); return; }

    let verifyingDoctorName = 'Lab Technician';
    const approvedItem = approvedItems[0];
    if (approvedItem.verified_by_doctor_id) {
      const { data: doc } = await supabase.from('doctors').select('full_name').eq('id', approvedItem.verified_by_doctor_id).maybeSingle();
      if (doc) verifyingDoctorName = (doc as any).full_name;
    }

    const rowsHtml = approvedItems.map((item) => {
      const result = item.results?.[0];
      const flagBadge = result?.flag && result.flag !== 'normal'
        ? `<span class="badge" style="background:#fee2e2;color:#dc2626;">${result.flag}</span>`
        : '<span class="badge">Normal</span>';
      return `<tr>
        <td style="font-weight:600;">${item.service_name}</td>
        <td>${result?.result_value ?? '-'}</td>
        <td style="color:#64748b;">${result?.unit ?? '-'}</td>
        <td style="color:#64748b;">${result?.normal_range ?? '-'}</td>
        <td>${flagBadge}</td>
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
          <div class="doc-title">LABORATORY REPORT</div>
          <div class="subtitle font-mono">${order.order_code}</div>
        </div>
      </div>
      <div class="patient-grid">
        <div><div class="label">Patient</div><div class="value">${order.patient?.full_name ?? '-'}</div></div>
        <div><div class="label">MRN</div><div class="value font-mono">${order.patient?.patient_code ?? '-'}</div></div>
        <div><div class="label">Gender / Age</div><div class="value">${order.patient?.gender ?? '-'} / ${order.patient?.age ?? '-'}</div></div>
        <div><div class="label">Date</div><div class="value">${formatDate(order.created_at)}</div></div>
        <div><div class="label">Referring Doctor</div><div class="value">${order.doctor?.full_name ?? '-'}</div></div>
        <div><div class="label">Phone</div><div class="value">${order.patient?.phone ?? '-'}</div></div>
      </div>
      <table>
        <thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference Range</th><th>Flag</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="sign-block">
        <div>
          <p class="text-muted" style="font-size:10px;">Report generated on ${formatDate(new Date().toISOString())}</p>
          <p class="text-muted" style="font-size:10px;margin-top:2px;">Computer-generated report.</p>
        </div>
        <div style="text-align:right;">
          <div class="sign-line"></div>
          <p class="font-semibold">${verifyingDoctorName}</p>
          <p class="text-muted" style="font-size:10px;">Lab Technician</p>
        </div>
      </div>
      <div class="footer">${company?.name ?? 'Healthcare ERP'} | ${company?.phone ?? ''} | ${company?.email ?? ''}</div>
    `;

    printToPdf({ title: `Lab Report - ${order.order_code}`, bodyHtml });

    for (const item of approvedItems) {
      if (item.status === 'approved') {
        await supabase.from('lab_order_items').update({ status: 'printed' }).eq('id', item.id);
      }
    }
    loadData();
    setPrinting(null);
  };

  const filtered = orders.filter((o) => {
    const q = search.toLowerCase();
    const matchSearch =
      o.order_code?.toLowerCase().includes(q) ||
      o.patient?.full_name?.toLowerCase().includes(q) ||
      o.patient?.patient_code?.toLowerCase().includes(q) ||
      o.lab_order_items?.some((i) => i.service_name.toLowerCase().includes(q));
    const matchStatus = statusFilter === 'all' || o.lab_order_items?.some((i) => i.status === statusFilter);
    return matchSearch && matchStatus;
  });

  const allApproved = (order: OrderWithRelations) =>
    order.lab_order_items?.every((item) => item.status === 'approved' || item.status === 'printed') && (order.lab_order_items?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Lab Reports</h1>
        <p className="text-muted-foreground">Track report status and print professional PDF reports</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1"><Filter className="h-3.5 w-3.5" /> Status:</div>
        <Button variant={statusFilter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter('all')}>All ({orders.length})</Button>
        {STATUS_FLOW.map((s) => (
          <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)}>
            {STATUS_LABELS[s]}
          </Button>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by patient, MRN, order, test..." className="pl-9" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading reports...</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No lab orders found</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((order) => (
            <Card key={order.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{order.order_code}</CardTitle>
                    <CardDescription>{order.patient?.full_name} | <span className="data-mono">{order.patient?.patient_code}</span> | {formatDate(order.created_at)}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={order.status === 'completed' ? 'default' : 'secondary'}>{order.status.replace('_', ' ')}</Badge>
                    {allApproved(order) && (
                      <Button size="sm" onClick={() => handlePrintPdf(order)} disabled={printing === order.id}>
                        {printing === order.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Printer className="mr-1 h-3 w-3" />}
                        Print PDF
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Test</TableHead><TableHead>Result</TableHead><TableHead>Unit</TableHead><TableHead>Range</TableHead><TableHead>Flag</TableHead><TableHead>Status</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.lab_order_items?.map((item) => {
                      const result = item.results?.[0];
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.service_name}</TableCell>
                          <TableCell>{result?.result_value ?? '-'}</TableCell>
                          <TableCell>{result?.unit ?? '-'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{result?.normal_range ?? '-'}</TableCell>
                          <TableCell>
                            {result?.flag && result.flag !== 'normal' ? <Badge variant="destructive">{result.flag}</Badge> : <Badge variant="secondary">normal</Badge>}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge variant={statusVariant(item.status)}>{STATUS_LABELS[item.status] || item.status}</Badge>
                              {item.status === 'approved' && (
                                <Button variant="ghost" size="sm" onClick={() => handleMarkPrinted(item)} disabled={printing === item.id}>
                                  <CheckCircle2 className="mr-1 h-3 w-3" /> Mark Printed
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
