'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, AlertTriangle, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

type BatchRow = {
  id: string;
  batch_number: string | null;
  expiry_date: string | null;
  quantity_remaining: number;
  item: { name: string; item_code: string; item_type: string } | null;
};

const urgency = (expiryDate: string | null): { label: string; variant: 'destructive' | 'default' | 'secondary'; days: number } => {
  if (!expiryDate) return { label: 'No expiry set', variant: 'secondary', days: Infinity };
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: 'Expired', variant: 'destructive', days };
  if (days <= 30) return { label: `${days}d left`, variant: 'destructive', days };
  if (days <= 90) return { label: `${days}d left`, variant: 'default', days };
  return { label: `${days}d left`, variant: 'secondary', days };
};

export default function ExpiryTrackingPage() {
  const supabase = getSupabaseClient();
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const ninetyDaysOut = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('inventory_batches')
      .select('id, batch_number, expiry_date, quantity_remaining, item:inventory_items(name, item_code, item_type)')
      .gt('quantity_remaining', 0)
      .lte('expiry_date', ninetyDaysOut)
      .order('expiry_date', { ascending: true, nullsFirst: false });
    if (error) toast.error(getFriendlyErrorMessage(error));
    setBatches((data as any) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const expiredCount = batches.filter(b => urgency(b.expiry_date).days < 0).length;
  const within30 = batches.filter(b => { const d = urgency(b.expiry_date).days; return d >= 0 && d <= 30; }).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Expiry Tracking</h1>
        <p className="text-muted-foreground">Reagents and consumables with stock still remaining, expiring within 90 days</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 pt-6"><AlertTriangle className="h-5 w-5 text-destructive" /><div><p className="text-xs text-muted-foreground">Already Expired</p><p className="text-xl font-bold text-destructive">{expiredCount}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 pt-6"><CalendarClock className="h-5 w-5 text-amber-600" /><div><p className="text-xs text-muted-foreground">Expiring in 30 Days</p><p className="text-xl font-bold text-amber-600">{within30}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 pt-6"><CalendarClock className="h-5 w-5 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">Tracked Batches (90d)</p><p className="text-xl font-bold">{batches.length}</p></div></CardContent></Card>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : batches.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nothing expiring in the next 90 days.</CardContent></Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Batch #</TableHead>
                <TableHead className="text-right">Qty Remaining</TableHead>
                <TableHead>Expiry Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => {
                const u = urgency(b.expiry_date);
                return (
                  <TableRow key={b.id} className={u.days < 0 ? 'bg-red-50' : u.days <= 30 ? 'bg-amber-50' : ''}>
                    <TableCell className="font-medium">{b.item?.name ?? 'Unknown'} <span className="text-xs text-muted-foreground">({b.item?.item_code})</span></TableCell>
                    <TableCell className="capitalize text-muted-foreground">{b.item?.item_type ?? '-'}</TableCell>
                    <TableCell className="font-mono text-xs">{b.batch_number ?? '-'}</TableCell>
                    <TableCell className="text-right">{b.quantity_remaining}</TableCell>
                    <TableCell>{b.expiry_date ? new Date(b.expiry_date).toLocaleDateString('en-GB') : '-'}</TableCell>
                    <TableCell><Badge variant={u.variant}>{u.label}</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
