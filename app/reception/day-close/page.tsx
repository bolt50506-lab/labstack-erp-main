'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Lock, CheckCircle2, DollarSign, CreditCard, Wallet, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { postJournalEntry } from '@/lib/utils/accounting';
import type { DayClosing } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function DayClosePage() {
  const supabase = getSupabaseClient();
  const { appUser } = useAuth();
  const [date, setDate] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [existingClose, setExistingClose] = useState<DayClosing | null>(null);
  const [summary, setSummary] = useState({ invoiceCount: 0, gross: 0, discount: 0, net: 0, cash: 0, card: 0, online: 0, receivable: 0, overpaid: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const branchId = appUser?.branch_id;
    const startOfDay = date + 'T00:00:00';
    const endOfDay = date + 'T23:59:59';

    let closeQuery = supabase.from('day_closings').select('*').eq('closing_date', date);
    closeQuery = branchId ? closeQuery.eq('branch_id', branchId) : closeQuery.is('branch_id', null);
    const { data: closeData } = await closeQuery.maybeSingle();
    setExistingClose((closeData as DayClosing) ?? null);

    let ordersQuery = supabase.from('lab_orders').select('id, total_amount, discount_amount, net_amount, paid_amount').gte('created_at', startOfDay).lte('created_at', endOfDay);
    if (branchId) ordersQuery = ordersQuery.eq('branch_id', branchId);
    const { data: orders } = await ordersQuery;
    const orderRows = (orders as any[]) || [];
    const orderIds = orderRows.map(o => o.id);

    // Scoped to payments AGAINST today's orders (regardless of when the
    // payment itself was received) rather than payments received today
    // (which could include an old invoice being settled today) — this is
    // what guarantees cash+card+online+receivable reconciles exactly to
    // net, so the journal entry always balances.
    let paymentRows: { amount: number; payment_method: string }[] = [];
    if (orderIds.length > 0) {
      let paymentsQuery = supabase.from('lab_order_payments').select('amount, payment_method').in('lab_order_id', orderIds);
      const { data: payments } = await paymentsQuery;
      paymentRows = (payments as any[]) || [];
    }

    const gross = orderRows.reduce((s, o) => s + Number(o.total_amount), 0);
    const discount = orderRows.reduce((s, o) => s + Number(o.discount_amount), 0);
    const net = orderRows.reduce((s, o) => s + Number(o.net_amount), 0);
    const cash = paymentRows.filter(p => p.payment_method === 'cash').reduce((s, p) => s + Number(p.amount), 0);
    const card = paymentRows.filter(p => p.payment_method === 'card').reduce((s, p) => s + Number(p.amount), 0);
    const online = paymentRows.filter(p => p.payment_method === 'online').reduce((s, p) => s + Number(p.amount), 0);
    const totalCollected = cash + card + online;
    // Derived from net minus what these same orders actually collected —
    // guaranteed to reconcile exactly, since it isn't pulled from a
    // separately-maintained paid_amount column that could drift out of
    // sync with the underlying payment transactions.
    const receivable = Math.max(0, net - totalCollected);
    // The payment form doesn't block entering more than the balance due,
    // so an overpayment is a real (if rare) possibility — surfaced as a
    // blocker with a clear reason rather than letting it silently produce
    // an unbalanced journal entry.
    const overpaid = totalCollected > net ? totalCollected - net : 0;

    setSummary({ invoiceCount: orderRows.length, gross, discount, net, cash, card, online, receivable, overpaid });
    setLoading(false);
  }, [supabase, date, appUser?.branch_id]);

  useEffect(() => { load(); }, [load]);

  const handleClose = async () => {
    if (!appUser?.company_id) return;
    if (summary.invoiceCount === 0) { toast.error('No invoices found for this date — nothing to close.'); return; }
    if (summary.overpaid > 0) { toast.error(`Rs ${summary.overpaid.toLocaleString()} was collected in excess of billed amounts — resolve the overpayment (refund or apply as advance) before closing.`); return; }
    setClosing(true);
    try {
      const journalEntryId = await postJournalEntry(supabase, {
        companyId: appUser.company_id,
        branchId: appUser.branch_id,
        entryDate: date,
        description: `Daily sales closing - ${date}`,
        referenceType: 'day_closing',
        referenceId: null,
        createdBy: appUser.id,
        lines: [
          { accountCode: 'CASH', debit: summary.cash, description: 'Cash collected' },
          { accountCode: 'CARD_CLEARING', debit: summary.card, description: 'Card payments collected' },
          { accountCode: 'ONLINE_CLEARING', debit: summary.online, description: 'Online payments collected' },
          { accountCode: 'ACCOUNTS_RECEIVABLE', debit: summary.receivable, description: 'Outstanding balance for the day' },
          { accountCode: 'SALES_REVENUE', credit: summary.net, description: 'Net service revenue for the day' },
        ],
      });

      const { error: closeError } = await supabase.from('day_closings').insert({
        company_id: appUser.company_id,
        branch_id: appUser.branch_id,
        closing_date: date,
        invoice_count: summary.invoiceCount,
        total_gross: summary.gross,
        total_discount: summary.discount,
        total_net: summary.net,
        total_cash: summary.cash,
        total_card: summary.card,
        total_online: summary.online,
        total_receivable: summary.receivable,
        journal_entry_id: journalEntryId,
        closed_by: appUser.id,
      });
      if (closeError) throw closeError;

      toast.success('Day closed and posted to accounting');
      load();
    } catch (err: any) {
      toast.error('Failed to close the day: ' + getFriendlyErrorMessage(err));
    } finally {
      setClosing(false);
    }
  };

  if (loading) return <div className="flex min-h-[300px] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Daily Sales Closing</h1>
          <p className="text-muted-foreground">Close out a day's sales and post it to accounting</p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayStr()} className="h-9 w-40" disabled={closing} />
        </div>
      </div>

      {existingClose ? (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-emerald-700" />
              <CardTitle className="text-emerald-900">Day Closed</CardTitle>
            </div>
            <CardDescription>This date is already closed and locked — closed {new Date(existingClose.closed_at).toLocaleString('en-GB')}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">Invoices</p><p className="font-bold">{existingClose.invoice_count}</p></div>
            <div><p className="text-xs text-muted-foreground">Net Sales</p><p className="font-bold">Rs {Number(existingClose.total_net).toLocaleString()}</p></div>
            <div><p className="text-xs text-muted-foreground">Cash</p><p className="font-bold">Rs {Number(existingClose.total_cash).toLocaleString()}</p></div>
            <div><p className="text-xs text-muted-foreground">Receivable</p><p className="font-bold">Rs {Number(existingClose.total_receivable).toLocaleString()}</p></div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card><CardContent className="flex items-center gap-3 pt-6"><Receipt className="h-5 w-5 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">Invoices</p><p className="text-xl font-bold">{summary.invoiceCount}</p></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 pt-6"><DollarSign className="h-5 w-5 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">Gross</p><p className="text-xl font-bold">Rs {summary.gross.toLocaleString()}</p></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 pt-6"><DollarSign className="h-5 w-5 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">Discount</p><p className="text-xl font-bold">Rs {summary.discount.toLocaleString()}</p></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 pt-6"><DollarSign className="h-5 w-5 text-emerald-600" /><div><p className="text-xs text-muted-foreground">Net Sales</p><p className="text-xl font-bold">Rs {summary.net.toLocaleString()}</p></div></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Payment Breakdown</CardTitle><CardDescription>What this closing will post to accounting</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-md border p-3"><div className="flex items-center gap-2"><Wallet className="h-4 w-4 text-muted-foreground" /><span>Cash</span></div><span className="font-medium">Rs {summary.cash.toLocaleString()}</span></div>
              <div className="flex items-center justify-between rounded-md border p-3"><div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-muted-foreground" /><span>Card</span></div><span className="font-medium">Rs {summary.card.toLocaleString()}</span></div>
              <div className="flex items-center justify-between rounded-md border p-3"><div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-muted-foreground" /><span>Online</span></div><span className="font-medium">Rs {summary.online.toLocaleString()}</span></div>
              <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-3"><div className="flex items-center gap-2"><Receipt className="h-4 w-4 text-amber-700" /><span>Outstanding (Accounts Receivable)</span></div><span className="font-medium">Rs {summary.receivable.toLocaleString()}</span></div>
              {summary.overpaid > 0 && (
                <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
                  <div className="flex items-center gap-2"><Receipt className="h-4 w-4" /><span>Overpaid — exceeds billed amount</span></div>
                  <span className="font-medium">Rs {summary.overpaid.toLocaleString()}</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Posts one journal entry: Cash / Card / Online / Receivable debited to match how the day was actually collected, Sales Revenue credited for the net amount — always balanced by construction.</p>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleClose} disabled={closing || summary.invoiceCount === 0 || summary.overpaid > 0} size="lg">
              {closing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Closing...</> : <><CheckCircle2 className="mr-2 h-4 w-4" />Close Day &amp; Post to Accounting</>}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
