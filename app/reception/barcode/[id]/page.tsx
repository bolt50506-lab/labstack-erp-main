'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Printer, ArrowLeft, Loader2 } from 'lucide-react';
import { printToPdf, formatDate } from '@/lib/utils/pdf';
import { generateBarcodeDataUrl } from '@/lib/utils/barcode';
import type { LabOrder, LabOrderItem, Patient, Company } from '@/lib/types';

type OrderWithRelations = LabOrder & {
  patient?: Patient;
  lab_order_items?: LabOrderItem[];
};

export default function BarcodePrintPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;
  const supabase = getSupabaseClient();

  const [order, setOrder] = useState<OrderWithRelations | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [barcodeUrls, setBarcodeUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('lab_orders')
      .select('*, patient:patients(*), lab_order_items:lab_order_items(*)')
      .eq('id', orderId)
      .maybeSingle();
    if (!data) { setLoading(false); return; }

    const orderData = data as OrderWithRelations;
    let items = orderData.lab_order_items || [];

    // A real, stable sample ID is assigned here — the same value gets
    // printed on the label AND matched against later at Scan to Collect,
    // instead of the label showing one string and collection generating
    // an unrelated one (which is what happened before this fix).
    const missingIds = items.filter(i => !i.sample_id);
    if (missingIds.length > 0) {
      for (let i = 0; i < missingIds.length; i++) {
        const item = missingIds[i];
        const sampleId = `${orderData.order_code}-S${String(items.indexOf(item) + 1).padStart(2, '0')}`;
        await supabase.from('lab_order_items').update({ sample_id: sampleId }).eq('id', item.id);
        item.sample_id = sampleId;
      }
      items = [...items];
    }

    setOrder({ ...orderData, lab_order_items: items });
    if (orderData.company_id) {
      const { data: co } = await supabase.from('companies').select('*').eq('id', orderData.company_id).maybeSingle();
      if (co) setCompany(co as Company);
    }

    const urls: Record<string, string> = {};
    items.forEach((item) => {
      if (item.sample_id) urls[item.id] = generateBarcodeDataUrl(item.sample_id);
    });
    setBarcodeUrls(urls);
    setLoading(false);
  }, [supabase, orderId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handlePrintPdf = () => {
    if (!order) return;
    const items = order.lab_order_items || [];
    const cardsHtml = items.map((item) => `<div style="text-align:center;border:1px solid #e2e8f0;border-radius:8px;padding:12px;break-inside:avoid;">
        <div style="font-weight:700;font-size:12px;">${company?.name ?? 'Lab'}</div>
        <div style="font-size:10px;color:#64748b;font-family:monospace;">${order.patient?.patient_code}</div>
        <div style="margin:8px 0;">
          <img src="${barcodeUrls[item.id] ?? ''}" style="max-width:100%;" />
        </div>
        <div style="font-size:10px;font-weight:600;">${item.service_name}</div>
        <div style="font-size:10px;color:#64748b;">${order.patient?.full_name}</div>
        <div style="font-size:10px;color:#64748b;">${formatDate(order.created_at)}</div>
      </div>`).join('');

    const bodyHtml = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">${cardsHtml}</div>`;
    printToPdf({ title: `Barcodes - ${order.order_code}`, bodyHtml });
  };

  if (loading) return <div className="flex items-center justify-center p-8 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating barcodes...</div>;
  if (!order) return <div className="p-8 text-center text-muted-foreground">Order not found</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between print:hidden">
        <Button variant="outline" onClick={() => router.push('/reception')}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
        <Button onClick={handlePrintPdf}><Printer className="mr-2 h-4 w-4" /> Print PDF</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 print:grid-cols-3 md:grid-cols-3 lg:grid-cols-4">
        {(order.lab_order_items || []).map((item) => (
          <Card key={item.id} className="p-3 print:border-0 print:shadow-none">
            <div className="text-center">
              <p className="text-xs font-bold">{company?.name ?? 'Lab'}</p>
              <p className="text-[10px] text-muted-foreground data-mono">{order.patient?.patient_code}</p>
              <div className="my-2 flex justify-center">
                {barcodeUrls[item.id] && <img src={barcodeUrls[item.id]} alt={item.sample_id ?? ''} className="max-w-full" />}
              </div>
              <p className="text-[10px] font-medium">{item.service_name}</p>
              <p className="text-[10px] text-muted-foreground">{order.patient?.full_name}</p>
              <p className="text-[10px] text-muted-foreground">{formatDate(order.created_at)}</p>
            </div>
          </Card>
        ))}
      </div>

      {(order.lab_order_items || []).length === 0 && (
        <Card className="p-8 text-center text-muted-foreground">No tests in this order</Card>
      )}
    </div>
  );
}
