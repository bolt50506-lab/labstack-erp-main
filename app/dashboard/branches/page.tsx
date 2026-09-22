'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Building2, TrendingUp, Users, AlertTriangle, Crown } from 'lucide-react';
import { toast } from 'sonner';
import type { Branch } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

type BranchStats = {
  branch: Branch;
  monthRevenue: number;
  monthOrders: number;
  patientsThisMonth: number;
  pendingResults: number;
  lowStockItems: number;
};

const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); };

export default function BranchComparisonPage() {
  const supabase = getSupabaseClient();
  const [stats, setStats] = useState<BranchStats[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: branches, error } = await supabase.from('branches').select('*').eq('is_active', true).order('name');
    if (error) { toast.error(getFriendlyErrorMessage(error)); setLoading(false); return; }

    const monthStart = firstOfMonth();
    const results = await Promise.all(((branches as Branch[]) || []).map(async (branch) => {
      const [ordersRes, patientsRes, pendingRes, lowStockRes] = await Promise.all([
        supabase.from('lab_orders').select('net_amount').eq('branch_id', branch.id).gte('created_at', monthStart),
        supabase.from('patients').select('id', { count: 'exact', head: true }).eq('branch_id', branch.id).gte('created_at', monthStart),
        supabase.from('lab_order_items').select('id, order:lab_orders!inner(branch_id)', { count: 'exact', head: true }).eq('order.branch_id', branch.id).in('status', ['processing', 'result_entered']),
        supabase.from('inventory_items').select('current_stock, reorder_level').eq('branch_id', branch.id),
      ]);
      const orders = (ordersRes.data as { net_amount: number }[]) || [];
      const monthRevenue = orders.reduce((s, o) => s + Number(o.net_amount), 0);
      const lowStockItems = ((lowStockRes.data as { current_stock: number; reorder_level: number }[]) || []).filter(i => i.current_stock <= i.reorder_level).length;

      return {
        branch,
        monthRevenue,
        monthOrders: orders.length,
        patientsThisMonth: patientsRes.count ?? 0,
        pendingResults: pendingRes.count ?? 0,
        lowStockItems,
      };
    }));

    setStats(results.sort((a, b) => b.monthRevenue - a.monthRevenue));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const chartData = stats.map(s => ({ name: s.branch.name, revenue: s.monthRevenue }));
  const totalRevenue = stats.reduce((s, x) => s + x.monthRevenue, 0);
  const topBranch = stats[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Branch Comparison</h1>
        <p className="text-muted-foreground">This month's performance across all branches, side by side</p>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : stats.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No active branches found.</CardContent></Card>
      ) : stats.length === 1 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Only one active branch — comparison needs at least two. Add another branch in Masters → Branches to use this view.</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card><CardContent className="flex items-center gap-4 pt-6">
              <div className="rounded-lg bg-[hsl(var(--chart-4))]/10 p-3"><TrendingUp className="h-6 w-6 text-[hsl(var(--chart-4))]" /></div>
              <div><p className="text-sm text-muted-foreground">Total Revenue (MTD)</p><p className="text-2xl font-bold">Rs {totalRevenue.toLocaleString()}</p></div>
            </CardContent></Card>
            <Card><CardContent className="flex items-center gap-4 pt-6">
              <div className="rounded-lg bg-amber-500/10 p-3"><Crown className="h-6 w-6 text-amber-600" /></div>
              <div><p className="text-sm text-muted-foreground">Top Branch</p><p className="text-xl font-bold">{topBranch?.branch.name}</p></div>
            </CardContent></Card>
            <Card><CardContent className="flex items-center gap-4 pt-6">
              <div className="rounded-lg bg-[hsl(var(--chart-2))]/10 p-3"><Building2 className="h-6 w-6 text-[hsl(var(--chart-2))]" /></div>
              <div><p className="text-sm text-muted-foreground">Branches</p><p className="text-2xl font-bold">{stats.length}</p></div>
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Revenue by Branch (This Month)</CardTitle><CardDescription>Net amount billed, month to date</CardDescription></CardHeader>
            <CardContent>
              <ChartContainer config={{ revenue: { label: 'Revenue', color: 'hsl(var(--chart-1))' } }} className="h-[280px] w-full">
                <BarChart data={chartData} margin={{ left: 12, right: 12, top: 12, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="revenue" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} barSize={40} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {stats.map((s) => (
              <Card key={s.branch.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" />{s.branch.name}</CardTitle>
                    {s.branch.is_head_office && <Badge variant="outline">Head Office</Badge>}
                  </div>
                  <CardDescription>{s.branch.city ?? '-'}</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <div><p className="text-xs text-muted-foreground">Revenue (MTD)</p><p className="font-bold">Rs {s.monthRevenue.toLocaleString()}</p></div>
                  <div><p className="text-xs text-muted-foreground">Orders (MTD)</p><p className="font-bold">{s.monthOrders}</p></div>
                  <div><p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" />New Patients</p><p className="font-bold">{s.patientsThisMonth}</p></div>
                  <div><p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Pending Results</p><p className="font-bold">{s.pendingResults}</p></div>
                  {s.lowStockItems > 0 && (
                    <div className="col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                      {s.lowStockItems} item(s) at or below reorder level
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
