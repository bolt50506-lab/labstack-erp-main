'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { Printer, ArrowLeft, Share2, Link as LinkIcon, Mail } from 'lucide-react';
import { printToPdf, formatDate, sanitizeReportHtml, buildLabReportHtml } from '@/lib/utils/pdf';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { LabOrder, LabOrderItem, LabResult, Patient, Company } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

type OrderWithRelations = LabOrder & {
  patient?: Patient;
  doctor?: any;
  lab_order_items?: (LabOrderItem & { results?: LabResult[]; service?: { category?: string } })[];
};

export default function PrintableReportPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;
  const supabase = getSupabaseClient();

  const [order, setOrder] = useState<OrderWithRelations | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [verifyingDoctorName, setVerifyingDoctorName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('lab_orders')
      .select('*, patient:patients(*), doctor:doctors(*), lab_order_items:lab_order_items(*, results:lab_results(*), service:services(category))')
      .eq('id', orderId)
      .maybeSingle();
    if (error) {
      toast.error('Failed to load report: ' + getFriendlyErrorMessage(error));
    } else if (data) {
      setOrder(data as any);
      if ((data as any).company_id) {
        const { data: co } = await supabase.from('companies').select('*').eq('id', (data as any).company_id).maybeSingle();
        if (co) setCompany(co as Company);
      }
      const approvedItem = (data as any).lab_order_items?.find(
        (i: any) => i.status === 'approved' || i.status === 'printed'
      );
      if (approvedItem?.verified_by_doctor_id) {
        const { data: doc } = await supabase.from('doctors').select('full_name').eq('id', approvedItem.verified_by_doctor_id).maybeSingle();
        if (doc) setVerifyingDoctorName((doc as any).full_name);
      }
    }
    setLoading(false);
  }, [supabase, orderId]);

  useEffect(() => { loadData(); }, [loadData]);

  const getApprovedItems = () => order?.lab_order_items?.filter(
    (item) => item.status === 'approved' || item.status === 'printed'
  ) || [];

  const buildReportInput = () => {
    const approvedItems = getApprovedItems();
    return {
      order: { order_code: order!.order_code, created_at: order!.created_at },
      company: company ? { name: company.name, address: company.address ?? undefined, city: company.city ?? undefined, phone: company.phone ?? undefined, email: company.email ?? undefined } : null,
      patient: order!.patient ? { full_name: order!.patient.full_name, patient_code: order!.patient.patient_code, gender: order!.patient.gender, age: order!.patient.age ?? undefined, phone: order!.patient.phone ?? undefined } : null,
      doctor: order!.doctor ? { full_name: order!.doctor.full_name } : null,
      items: approvedItems.map((item) => ({
        service_name: item.service_name,
        category: item.service?.category,
        result_value: item.results?.[0]?.result_value,
        unit: item.results?.[0]?.unit,
        normal_range: item.results?.[0]?.normal_range,
        flag: item.results?.[0]?.flag,
        remarks: item.results?.[0]?.remarks,
        verifying_doctor: verifyingDoctorName,
      })),
    };
  };

  const handlePrintPdf = () => {
    if (!order) return;
    const { title, bodyHtml } = buildLabReportHtml(buildReportInput());
    printToPdf({ title, bodyHtml });
  };

  const [sharing, setSharing] = useState(false);

  const getOrCreatePublicLink = async (): Promise<string | null> => {
    if (!order) return null;
    setSharing(true);
    try {
      let token = order.public_token;
      if (!token) {
        token = crypto.randomUUID();
        const { error } = await supabase.from('lab_orders').update({ public_token: token }).eq('id', order.id);
        if (error) { toast.error('Failed to create share link: ' + getFriendlyErrorMessage(error)); return null; }
        setOrder({ ...order, public_token: token });
      }
      return `${window.location.origin}/portal/report/${token}`;
    } finally {
      setSharing(false);
    }
  };

  const handleShareWhatsApp = async () => {
    const link = await getOrCreatePublicLink();
    if (!link) return;
    const phone = (order?.patient?.phone ?? '').replace(/[^0-9]/g, '');
    const message = `Hello ${order?.patient?.full_name ?? ''}, your report from ${company?.name ?? 'our lab'} is ready. View it here: ${link}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleCopyLink = async () => {
    const link = await getOrCreatePublicLink();
    if (!link) return;
    await navigator.clipboard.writeText(link);
    toast.success('Report link copied');
  };

  const handleEmailShare = async () => {
    const link = await getOrCreatePublicLink();
    if (!link) return;
    const subject = `Your report from ${company?.name ?? 'our lab'}`;
    const body = `Hello ${order?.patient?.full_name ?? ''},\n\nYour report is ready. View it here: ${link}\n\n${company?.name ?? ''}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  if (loading) return <div className="flex items-center justify-center p-8 text-muted-foreground">Loading report...</div>;
  if (!order) return <div className="p-8 text-center text-muted-foreground">Report not found</div>;

  const approvedItems = order.lab_order_items?.filter(
    (item) => item.status === 'approved' || item.status === 'printed'
  ) || [];
  const isRadiologyReport = approvedItems.some((item) => item.service?.category === 'radiology');

  if (approvedItems.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">This report has no approved results yet.</p>
        <p className="text-sm text-muted-foreground mt-2">Results must be approved before printing.</p>
        <Button className="mt-4" variant="outline" onClick={() => router.push('/lab/reports')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Reports
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between print:hidden">
        <Button variant="outline" onClick={() => router.push('/lab/reports')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button onClick={handlePrintPdf}>
          <Printer className="mr-2 h-4 w-4" /> Print PDF
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={sharing}>
              <Share2 className="mr-2 h-4 w-4" /> Send Report
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleShareWhatsApp}>
              <Share2 className="mr-2 h-4 w-4" /> Share via WhatsApp
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleEmailShare}>
              <Mail className="mr-2 h-4 w-4" /> Share via Email
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCopyLink}>
              <LinkIcon className="mr-2 h-4 w-4" /> Copy Report Link
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Card className="mx-auto max-w-3xl p-8 print:border-0 print:shadow-none print:max-w-none">
        <div className="flex items-center justify-between border-b-2 pb-4">
          <div>
            <h1 className="text-2xl font-bold">{company?.name ?? 'Healthcare ERP'}</h1>
            {company?.address && <p className="text-sm text-muted-foreground">{company.address}</p>}
            <p className="text-sm text-muted-foreground">{company?.city ?? ''} {company?.phone ? `| Tel: ${company.phone}` : ''}</p>
            {company?.email && <p className="text-sm text-muted-foreground">{company.email}</p>}
          </div>
          <div className="text-right">
            <h2 className="text-xl font-semibold">{isRadiologyReport ? 'RADIOLOGY REPORT' : 'LABORATORY REPORT'}</h2>
            <p className="text-sm text-muted-foreground">{order.order_code}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p><span className="font-medium">Patient:</span> {order.patient?.full_name}</p>
            <p><span className="font-medium">MRN:</span> <span className="data-mono">{order.patient?.patient_code}</span></p>
            <p><span className="font-medium">Gender:</span> {order.patient?.gender} | <span className="font-medium">Age:</span> {order.patient?.age ?? '-'}</p>
          </div>
          <div>
            <p><span className="font-medium">Date:</span> {formatDate(order.created_at)}</p>
            <p><span className="font-medium">Phone:</span> {order.patient?.phone ?? '-'}</p>
            {order.doctor && <p><span className="font-medium">Referring Doctor:</span> {order.doctor.full_name}</p>}
          </div>
        </div>

        {isRadiologyReport ? (
          <div className="mt-6 space-y-6 text-sm">
            {approvedItems.map((item) => {
              const result = item.results?.[0];
              return (
                <section key={item.id} className="border-t pt-4 first:border-t-0 first:pt-0">
                  <h3 className="text-base font-semibold">{item.service_name}</h3>
                  <div className="mt-4 rounded-md border p-4">
                    <h4 className="font-semibold uppercase tracking-wide">Findings</h4>
                    {result?.result_value ? (
                      <div className="prose prose-sm mt-2 max-w-none leading-6" dangerouslySetInnerHTML={{ __html: sanitizeReportHtml(result.result_value) }} />
                    ) : <p className="mt-2 text-muted-foreground">No findings recorded.</p>}
                  </div>
                  <div className="mt-4 rounded-md border p-4">
                    <h4 className="font-semibold uppercase tracking-wide">Impression</h4>
                    {result?.remarks ? <p className="mt-2 whitespace-pre-wrap leading-6">{result.remarks}</p> : <p className="mt-2 text-muted-foreground">No impression recorded.</p>}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <table className="mt-6 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2">
                <th className="py-2 text-left font-semibold">Test</th>
                <th className="py-2 text-left font-semibold">Result</th>
                <th className="py-2 text-left font-semibold">Unit</th>
                <th className="py-2 text-left font-semibold">Reference Range</th>
                <th className="py-2 text-left font-semibold">Flag</th>
              </tr>
            </thead>
            <tbody>
              {approvedItems.map((item) => {
                const result = item.results?.[0];
                return (
                  <tr key={item.id} className="border-b">
                    <td className="py-2 font-medium">{item.service_name}</td>
                    <td className="py-2">{result?.result_value ?? '-'}</td>
                    <td className="py-2 text-muted-foreground">{result?.unit ?? '-'}</td>
                    <td className="py-2 text-muted-foreground">{result?.normal_range ?? '-'}</td>
                    <td className="py-2">
                      {result?.flag === 'high' && <span className="flag-pill flag-high">H</span>}
                      {result?.flag === 'low' && <span className="flag-pill flag-low">L</span>}
                      {result?.flag === 'critical' && <span className="flag-pill flag-critical">C</span>}
                      {(!result?.flag || result.flag === 'normal') && <span className="text-muted-foreground">-</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="mt-12 flex justify-between text-sm">
          <div>
            <p className="text-muted-foreground">Report generated on {formatDate(new Date().toISOString())}</p>
            <p className="text-xs text-muted-foreground mt-1">This is a computer-generated report and does not require a physical signature.</p>
          </div>
          <div className="text-right">
            <div className="mb-1 h-12 w-32 border-b" />
            <p className="text-sm">{verifyingDoctorName ?? 'Lab Technician'}</p>
          </div>
        </div>

        <div className="mt-4 border-t pt-2 text-center text-xs text-muted-foreground">
          {company?.name ?? 'Healthcare ERP'} | {company?.phone ?? ''} | {company?.email ?? ''}
        </div>
      </Card>
    </div>
  );
}
