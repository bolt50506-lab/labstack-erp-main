'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, DollarSign, TrendingUp, Download, FileText, Search } from 'lucide-react';
import { toast } from 'sonner';
import { exportToCSV } from '@/lib/utils/export';
import { printToPdf } from '@/lib/utils/pdf';
import type { ReferralSource, ReferralSettlement } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

type SettlementWithSource = ReferralSettlement & { referral_source?: ReferralSource; order?: { order_code: string; patient?: { full_name: string } } };

const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);

export default function ReferralShareReportPage() {
  const supabase = getSupabaseClient();
  const [settlements, setSettlements] = useState<SettlementWithSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(today());
  const [sourceSearch, setSourceSearch] = useState('');
  const [trendData, setTrendData] = useState<{ month: string; amount: number }[]>([]);
  const [topSources, setTopSources] = useState<{ name: string; amount: number; count: number }[]>([]);
  const [chartLoading, setChartLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Date-range scoped rather than a hard row limit — totals stay accurate
    // no matter how many settlements a company accumulates.
    const { data, error } = await supabase
      .from('referral_settlements')
      .select('*, referral_source:referral_sources(*), order:lab_orders(order_code, patient:patients(full_name))')
      .gte('created_at', fromDate)
      .lte('created_at', toDate + 'T23:59:59')
      .order('created_at', { ascending: false });
    if (error) toast.error(getFriendlyErrorMessage(error));
    setSettlements((data as any) || []);
    setLoading(false);
  }, [supabase, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const loadCharts = useCallback(async () => {
    setChartLoading(true);
    const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString();
    const { data } = await supabase
      .from('referral_settlements')
      .select('commission_amount, created_at, referral_source:referral_sources(name)')
      .gte('created_at', sixMonthsAgo)
      .order('created_at', { ascending: true });
    const rows = (data as any[]) || [];
    const monthMap = new Map<string, number>();
    for (const s of rows) {
      const d = new Date(s.created_at);
      const key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      monthMap.set(key, (monthMap.get(key) ?? 0) + Number(s.commission_amount));
    }
    setTrendData(Array.from(monthMap.entries()).map(([month, amount]) => ({ month, amount })));
    const sourceMap = new Map<string, { amount: number; count: number }>();
    for (const s of rows) {
      const name = s.referral_source?.name ?? 'Unknown';
      const existing = sourceMap.get(name) ?? { amount: 0, count: 0 };
      sourceMap.set(name, { amount: existing.amount + Number(s.commission_amount), count: existing.count + 1 });
    }
    setTopSources(Array.from(sourceMap.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 10));
    setChartLoading(false);
  }, [supabase]);
  useEffect(() => { loadCharts(); }, [loadCharts]);

  const filteredSettlements = sourceSearch.trim()
    ? settlements.filter(s => (s.referral_source?.name ?? '').toLowerCase().includes(sourceSearch.trim().toLowerCase()))
    : settlements;

  const totalCommission = filteredSettlements.reduce((s, x) => s + Number(x.commission_amount), 0);
  const settledTotal = filteredSettlements.filter(s => s.settled).reduce((s, x) => s + Number(x.commission_amount), 0);
  const unsettledTotal = filteredSettlements.filter(s => !s.settled).reduce((s, x) => s + Number(x.commission_amount), 0);

  const bySource = filteredSettlements.reduce<Record<string, { source?: ReferralSource; total: number; settled: number; unsettled: number; count: number }>>((acc, s) => {
    const key = s.referral_source_id;
    if (!acc[key]) acc[key] = { source: s.referral_source, total: 0, settled: 0, unsettled: 0, count: 0 };
    acc[key].total += Number(s.commission_amount);
    acc[key].count += 1;
    if (s.settled) acc[key].settled += Number(s.commission_amount);
    else acc[key].unsettled += Number(s.commission_amount);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Referral Share Report</h1>
        <p className="text-muted-foreground">Commission breakdown by referring doctor / affiliate</p>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-md border bg-card p-3">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Referral Source</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={sourceSearch} onChange={(e) => setSourceSearch(e.target.value)} placeholder="Search referring doctor / affiliate..." className="h-9 w-64 pl-8" />
          </div>
        </div>
        <p className="pb-2 text-xs text-muted-foreground">Totals below reflect this date range{sourceSearch.trim() ? ' and search' : ''}.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="rounded-lg bg-[hsl(var(--chart-4))]/10 p-3"><DollarSign className="h-6 w-6 text-[hsl(var(--chart-4))]" /></div>
            <div><p className="text-sm text-muted-foreground">Total Commission</p><p className="text-2xl font-bold">Rs {totalCommission.toLocaleString()}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="rounded-lg bg-[hsl(var(--chart-1))]/10 p-3"><TrendingUp className="h-6 w-6 text-[hsl(var(--chart-1))]" /></div>
            <div><p className="text-sm text-muted-foreground">Settled</p><p className="text-2xl font-bold">Rs {settledTotal.toLocaleString()}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="rounded-lg bg-[hsl(var(--chart-2))]/10 p-3"><DollarSign className="h-6 w-6 text-[hsl(var(--chart-2))]" /></div>
            <div><p className="text-sm text-muted-foreground">Unsettled</p><p className="text-2xl font-bold">Rs {unsettledTotal.toLocaleString()}</p></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Commission Trend</CardTitle>
            <CardDescription>Last 6 months, all sources</CardDescription>
          </CardHeader>
          <CardContent>
            {chartLoading ? <Skeleton className="h-[260px] w-full" /> : trendData.length === 0 ? (
              <p className="text-center text-muted-foreground py-16">No data</p>
            ) : (
              <ChartContainer config={{ amount: { label: 'Commission', color: 'hsl(var(--chart-4))' } }} className="h-[260px] w-full">
                <BarChart data={trendData} margin={{ left: 12, right: 12, top: 12, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="amount" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Referral Sources</CardTitle>
            <CardDescription>By commission volume (last 6 months)</CardDescription>
          </CardHeader>
          <CardContent>
            {chartLoading ? <Skeleton className="h-[260px] w-full" /> : topSources.length === 0 ? (
              <p className="text-center text-muted-foreground py-16">No data</p>
            ) : (
              <ChartContainer config={{ amount: { label: 'Commission', color: 'hsl(var(--chart-3))' } }} className="h-[260px] w-full">
                <BarChart data={topSources} layout="vertical" margin={{ left: 8, right: 12, top: 12, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} width={100} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="amount" fill="hsl(var(--chart-3))" radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">Summary by Source</TabsTrigger>
            <TabsTrigger value="detail">Detailed Transactions</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="mt-4">
            {Object.keys(bySource).length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">No referral share data in this date range</CardContent></Card>
            ) : (
              <div className="space-y-4">
                {Object.entries(bySource).map(([sourceId, group]) => (
                  <Card key={sourceId}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">{group.source?.name ?? 'Unknown Source'}</CardTitle>
                          <p className="text-sm text-muted-foreground">{group.count} transactions · {group.source?.type ?? ''}</p>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Total</p>
                            <p className="font-bold">Rs {group.total.toLocaleString()}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Settled</p>
                            <p className="font-bold text-[hsl(var(--chart-1))]">Rs {group.settled.toLocaleString()}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Unsettled</p>
                            <p className="font-bold text-[hsl(var(--chart-2))]">Rs {group.unsettled.toLocaleString()}</p>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="detail" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">Detailed Transactions</CardTitle>
                  <CardDescription>Every settlement line in this date range, one row per patient/service/source</CardDescription>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => exportToCSV(
                      'referral-share-detail',
                      [
                        { key: 'date', label: 'Date', format: (r: SettlementWithSource) => new Date(r.created_at).toLocaleDateString('en-GB') },
                        { key: 'invoice', label: 'Invoice #', format: (r: SettlementWithSource) => r.order?.order_code ?? '-' },
                        { key: 'patient', label: 'Patient', format: (r: SettlementWithSource) => r.order?.patient?.full_name ?? 'Unknown' },
                        { key: 'service', label: 'Service', format: (r: SettlementWithSource) => r.service_name },
                        { key: 'source', label: 'Referral Source', format: (r: SettlementWithSource) => r.referral_source?.name ?? 'Unknown' },
                        { key: 'sourceType', label: 'Source Type', format: (r: SettlementWithSource) => r.referral_source?.type ?? '-' },
                        { key: 'gross', label: 'Gross Amount', format: (r: SettlementWithSource) => Number(r.gross_amount || 0).toFixed(2) },
                        { key: 'disc', label: 'Discount', format: (r: SettlementWithSource) => Number(r.discount_amount || 0).toFixed(2) },
                        { key: 'net', label: 'Net (Paid) Amount', format: (r: SettlementWithSource) => Number(r.net_amount || 0).toFixed(2) },
                        { key: 'pct', label: 'Share %', format: (r: SettlementWithSource) => r.commission_type === 'percentage' ? `${r.share_percentage ?? 0}%` : 'Fixed' },
                        { key: 'commission', label: 'Commission Amount', format: (r: SettlementWithSource) => Number(r.commission_amount || 0).toFixed(2) },
                        { key: 'settled', label: 'Settled', format: (r: SettlementWithSource) => r.settled ? 'Yes' : 'No' },
                      ],
                      filteredSettlements,
                    )}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    <Download className="h-3.5 w-3.5" /> Export CSV
                  </button>
                  <button
                    onClick={() => printToPdf({
                      title: 'Referral Share Report',
                      bodyHtml: `
                        <div class="report-header">
                          <div><div class="company">Referral Share Report</div><div class="subtitle">${fromDate} to ${toDate}${sourceSearch.trim() ? ' &middot; Source: ' + sourceSearch : ''}</div></div>
                          <div class="doc-title">Rs ${totalCommission.toLocaleString()} total</div>
                        </div>
                        <table>
                          <thead><tr><th>Date</th><th>Patient</th><th>Service</th><th>Referral Source</th><th>Gross</th><th>Disc.</th><th>Net</th><th>Share %</th><th>Commission</th><th>Status</th></tr></thead>
                          <tbody>
                            ${filteredSettlements.map(s => `<tr>
                              <td>${new Date(s.created_at).toLocaleDateString('en-GB')}</td>
                              <td>${s.order?.patient?.full_name ?? 'Unknown'}</td>
                              <td>${s.service_name}</td>
                              <td>${s.referral_source?.name ?? 'Unknown'}</td>
                              <td>Rs ${Number(s.gross_amount || 0).toLocaleString()}</td>
                              <td>Rs ${Number(s.discount_amount || 0).toLocaleString()}</td>
                              <td>Rs ${Number(s.net_amount || 0).toLocaleString()}</td>
                              <td>${s.commission_type === 'percentage' ? (s.share_percentage ?? 0) + '%' : 'Fixed'}</td>
                              <td>Rs ${Number(s.commission_amount).toLocaleString()}</td>
                              <td>${s.settled ? 'Settled' : 'Unsettled'}</td>
                            </tr>`).join('')}
                          </tbody>
                        </table>
                        <div class="footer">Generated ${new Date().toLocaleString('en-GB')}</div>
                      `,
                    })}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    <FileText className="h-3.5 w-3.5" /> Export PDF
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                {filteredSettlements.length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground">No transactions match this date range{sourceSearch.trim() ? ' and search' : ''}</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Patient</TableHead>
                          <TableHead>Service</TableHead>
                          <TableHead>Referral Source</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                          <TableHead className="text-right">Disc.</TableHead>
                          <TableHead className="text-right">Net (Paid)</TableHead>
                          <TableHead className="text-right">Share %</TableHead>
                          <TableHead className="text-right">Commission</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSettlements.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="whitespace-nowrap text-xs">{new Date(s.created_at).toLocaleDateString('en-GB')}</TableCell>
                            <TableCell className="whitespace-nowrap">{s.order?.patient?.full_name ?? 'Unknown'}</TableCell>
                            <TableCell>{s.service_name}</TableCell>
                            <TableCell className="whitespace-nowrap">
                              <div>{s.referral_source?.name ?? 'Unknown'}</div>
                              {s.referral_source?.type && <Badge variant="outline" className="mt-0.5 text-[10px]">{s.referral_source.type}</Badge>}
                            </TableCell>
                            <TableCell className="text-right">Rs {Number(s.gross_amount || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right text-muted-foreground">Rs {Number(s.discount_amount || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right font-medium">Rs {Number(s.net_amount || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right">{s.commission_type === 'percentage' ? `${s.share_percentage ?? 0}%` : 'Fixed'}</TableCell>
                            <TableCell className="text-right font-medium">Rs {Number(s.commission_amount).toLocaleString()}</TableCell>
                            <TableCell>
                              <Badge variant={s.settled ? 'default' : 'secondary'} className="text-[10px]">{s.settled ? 'Settled' : 'Unsettled'}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
