'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Printer, ArrowLeft } from 'lucide-react';
import { printToPdf, formatDate } from '@/lib/utils/pdf';
import type { PharmacySale, PharmacySaleItem, Company } from '@/lib/types';

type SaleWithItems = PharmacySale & { items?: PharmacySaleItem[] };

export default function PharmacySaleReceiptPage() {
  const params = useParams();
  const router = useRouter();
  const saleId = params.id as string;
  const supabase = getSupabaseClient();

  const [sale, setSale] = useState<SaleWithItems | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('pharmacy_sales')
      .select('*, items:pharmacy_sale_items(*)')
      .eq('id', saleId)
      .maybeSingle();
    if (error) { console.error(error); }
    else if (data) {
      setSale(data as any);
      if ((data as any).company_id) {
        const { data: co } = await supabase.from('companies').select('*').eq('id', (data as any).company_id).maybeSingle();
        if (co) setCompany(co as Company);
      }
    }
    setLoading(false);
  }, [supabase, saleId]);

  useEffect(() => { loadData(); }, [loadData]);

  const formatTime = (d: string) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const handlePrintPdf = () => {
    if (!sale) return;
    const balance = Number(sale.net_amount) - Number(sale.paid_amount);

    const itemsRows = (sale.items || []).map((item) => `<tr><td>${item.item_name}</td><td style="text-align:center;">${Number(item.quantity)}</td><td style="text-align:right;">Rs ${Number(item.unit_price).toLocaleString()}</td><td style="text-align:right;">Rs ${Number(item.line_total).toLocaleString()}</td></tr>`).join('');

    const bodyHtml = `
      <div style="max-width:500px;margin:0 auto;">
        <div style="text-align:center;border-bottom:2px solid #0f172a;padding-bottom:12px;">
          <div style="font-weight:700;font-size:20px;">${company?.name ?? 'Healthcare ERP'}</div>
          ${company?.address ? `<div style="font-size:11px;color:#64748b;">${company.address}</div>` : ''}
          <div style="font-size:11px;color:#64748b;">${company?.city ?? ''} ${company?.phone ? `| ${company.phone}` : ''}</div>
        </div>
        <div style="margin-top:12px;display:flex;justify-content:space-between;font-size:13px;">
          <div><div style="font-weight:700;">PHARMACY SALE</div><div style="font-size:11px;color:#64748b;font-family:monospace;">${sale.sale_number}</div></div>
          <div style="text-align:right;"><div style="font-size:11px;color:#64748b;">${formatDate(sale.sale_date)}</div><div style="font-size:11px;color:#64748b;">${formatTime(sale.sale_date)}</div></div>
        </div>
        <div style="margin-top:12px;border-top:1px solid #e2e8f0;padding-top:12px;font-size:13px;">
          <div style="display:flex;justify-content:space-between;"><span style="color:#64748b;">Customer:</span><span style="font-weight:600;">${sale.customer_name ?? 'Walk-in Customer'}</span></div>
          ${sale.customer_phone ? `<div style="display:flex;justify-content:space-between;"><span style="color:#64748b;">Phone:</span><span>${sale.customer_phone}</span></div>` : ''}
        </div>
        <table style="margin-top:12px;width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="border-bottom:2px solid #e2e8f0;"><th style="text-align:left;padding:4px 0;">Item</th><th style="text-align:center;padding:4px 0;">Qty</th><th style="text-align:right;padding:4px 0;">Price</th><th style="text-align:right;padding:4px 0;">Total</th></tr></thead>
          <tbody>${itemsRows}</tbody>
        </table>
        <div style="margin-top:12px;font-size:13px;border-top:1px solid #e2e8f0;padding-top:8px;">
          <div style="display:flex;justify-content:space-between;"><span style="color:#64748b;">Subtotal:</span><span>Rs ${Number(sale.subtotal).toLocaleString()}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:#64748b;">Discount:</span><span>Rs ${Number(sale.discount_amount).toLocaleString()}</span></div>
          <div style="display:flex;justify-content:space-between;font-weight:700;"><span>Net Amount:</span><span>Rs ${Number(sale.net_amount).toLocaleString()}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:#64748b;">Paid (${sale.payment_mode}):</span><span>Rs ${Number(sale.paid_amount).toLocaleString()}</span></div>
          ${balance > 0 ? `<div style="display:flex;justify-content:space-between;font-weight:700;color:#dc2626;"><span>Balance:</span><span>Rs ${balance.toLocaleString()}</span></div>` : ''}
        </div>
        <div style="margin-top:24px;border-top:1px solid #e2e8f0;padding-top:8px;text-align:center;font-size:10px;color:#94a3b8;">
          <p>Thank you for your purchase</p>
          <p style="margin-top:4px;">This is a computer-generated receipt.</p>
        </div>
      </div>
    `;

    printToPdf({ title: `Pharmacy Receipt - ${sale.sale_number}`, bodyHtml });
  };

  if (loading) return <div className="flex items-center justify-center p-8 text-muted-foreground">Loading receipt...</div>;
  if (!sale) return <div className="p-8 text-center text-muted-foreground">Sale not found</div>;

  const balance = Number(sale.net_amount) - Number(sale.paid_amount);

  return (
    <div className="space-y-4">
      <div className="flex justify-between print:hidden">
        <Button variant="outline" onClick={() => router.push('/pharmacy/sale')}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
        <Button onClick={handlePrintPdf}><Printer className="mr-2 h-4 w-4" /> Print PDF</Button>
      </div>

      <Card className="mx-auto max-w-md p-6 print:border-0 print:shadow-none print:max-w-none">
        <div className="text-center border-b-2 pb-3">
          <h1 className="text-xl font-bold">{company?.name ?? 'Healthcare ERP'}</h1>
          {company?.address && <p className="text-xs text-muted-foreground">{company.address}</p>}
          <p className="text-xs text-muted-foreground">{company?.city ?? ''} {company?.phone ? `| ${company.phone}` : ''}</p>
        </div>

        <div className="mt-3 flex justify-between text-sm">
          <div><p className="font-bold">PHARMACY SALE</p><p className="text-xs text-muted-foreground data-mono">{sale.sale_number}</p></div>
          <div className="text-right"><p className="text-xs text-muted-foreground">{formatDate(sale.sale_date)}</p><p className="text-xs text-muted-foreground">{formatTime(sale.sale_date)}</p></div>
        </div>

        <div className="mt-3 border-t pt-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Customer:</span><span className="font-medium">{sale.customer_name ?? 'Walk-in Customer'}</span></div>
          {sale.customer_phone && <div className="flex justify-between"><span className="text-muted-foreground">Phone:</span><span>{sale.customer_phone}</span></div>}
        </div>

        <table className="mt-3 w-full border-collapse text-xs">
          <thead><tr className="border-b-2"><th className="py-1 text-left">Item</th><th className="py-1 text-center">Qty</th><th className="py-1 text-right">Price</th><th className="py-1 text-right">Total</th></tr></thead>
          <tbody>
            {(sale.items || []).map((item) => (<tr key={item.id} className="border-b"><td className="py-1">{item.item_name}</td><td className="py-1 text-center">{Number(item.quantity)}</td><td className="py-1 text-right">Rs {Number(item.unit_price).toLocaleString()}</td><td className="py-1 text-right">Rs {Number(item.line_total).toLocaleString()}</td></tr>))}
          </tbody>
        </table>

        <div className="mt-3 space-y-1 text-sm border-t pt-2">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal:</span><span>Rs {Number(sale.subtotal).toLocaleString()}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Discount:</span><span>Rs {Number(sale.discount_amount).toLocaleString()}</span></div>
          <div className="flex justify-between font-bold"><span>Net Amount:</span><span>Rs {Number(sale.net_amount).toLocaleString()}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Paid ({sale.payment_mode}):</span><span>Rs {Number(sale.paid_amount).toLocaleString()}</span></div>
          {balance > 0 && <div className="flex justify-between font-bold text-destructive"><span>Balance:</span><span>Rs {balance.toLocaleString()}</span></div>}
        </div>

        <div className="mt-6 border-t pt-2 text-center text-xs text-muted-foreground">
          <p>Thank you for your purchase</p>
          <p className="mt-1">This is a computer-generated receipt.</p>
        </div>
      </Card>
    </div>
  );
}
