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
import { Loader2, DollarSign, TrendingUp, Stethoscope, TestTube, Download, FileText, Search } from 'lucide-react';
import { toast } from 'sonner';
import { exportToCSV } from '@/lib/utils/export';
import { printToPdf } from '@/lib/utils/pdf';
import type { Doctor, DoctorSettlement } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

type SettlementWithDoctor = DoctorSettlement & { doctor?: Doctor; order?: { order_code: string; patient?: { full_name: string } } };

const roleLabel: Record<string, string> = { performing_doctor: 'Performing', opd_doctor: 'Consultant' };

const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);

export default function DoctorShareReportPage() {
  const supabase = getSupabaseClient();
  const [settlements, setSettlements] = useState<SettlementWithDoctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(today());
  const [doctorSearch, setDoctorSearch] = useState('');
  const [trendData, setTrendData] = useState<{ month: string; amount: number }[]>([]);
  const [topDoctors, setTopDoctors] = useState<{ name: string; amount: number; count: number }[]>([]);
  const [chartLoading, setChartLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Date-range scoped rather than a hard row limit — totals stay accurate
    // no matter how many settlements a company accumulates.
    const { data, error } = await supabase
      .from('doctor_settlements')
      .select('*, doctor:doctors(*), order:lab_orders(order_code, patient:patients(full_name))')
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
      .from('doctor_settlements')
      .select('share_amount, created_at, doctor:doctors(full_name)')
      .gte('created_at', sixMonthsAgo)
      .order('created_at', { ascending: true });
    const rows = (data as any[]) || [];
    const monthMap = new Map<string, number>();
    for (const s of rows) {
      const d = new Date(s.created_at);
      const key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      monthMap.set(key, (monthMap.get(key) ?? 0) + Number(s.share_amount));
    }
    setTrendData(Array.from(monthMap.entries()).map(([month, amount]) => ({ month, amount })));
    const docMap = new Map<string, { amount: number; count: number }>();
    for (const s of rows) {
      const name = s.doctor?.full_name ?? 'Unknown';
      const existing = docMap.get(name) ?? { amount: 0, count: 0 };
      docMap.set(name, { amount: existing.amount + Number(s.share_amount), count: existing.count + 1 });
    }
    setTopDoctors(Array.from(docMap.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 10));
    setChartLoading(false);
  }, [supabase]);
  useEffect(() => { loadCharts(); }, [loadCharts]);

  const filteredSettlements = doctorSearch.trim()
    ? settlements.filter(s => (s.doctor?.full_name ?? '').toLowerCase().includes(doctorSearch.trim().toLowerCase()))
    : settlements;

  const totalCommission = filteredSettlements.reduce((s, x) => s + Number(x.share_amount), 0);
  const settledTotal = filteredSettlements.filter(s => s.settled).reduce((s, x) => s + Number(x.share_amount), 0);
  const unsettledTotal = filteredSettlements.filter(s => !s.settled).reduce((s, x) => s + Number(x.share_amount), 0);

  // Grouped by doctor, then split by role (Performing vs Consultant) so a
  // doctor who does both isn't shown as one opaque lump sum.
  const byDoctor = filteredSettlements.reduce<Record<string, { doctor?: Doctor; total: number; settled: number; unsettled: number; count: number; byRole: Record<string, { total: number; count: number }> }>>((acc, s) => {
    const key = s.doctor_id;
    if (!acc[key]) acc[key] = { doctor: s.doctor, total: 0, settled: 0, unsettled: 0, count: 0, byRole: {} };
    const amt = Number(s.share_amount);
    acc[key].total += amt;
    acc[key].count += 1;
    if (s.settled) acc[key].settled += amt; else acc[key].unsettled += amt;
    const role = s.doctor_type || 'performing_doctor';
    if (!acc[key].byRole[role]) acc[key].byRole[role] = { total: 0, count: 0 };
    acc[key].byRole[role].total += amt;
    acc[key].byRole[role].count += 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Doctor Share Report</h1>
        <p className="text-muted-foreground">Commission breakdown by doctor, split by Performing vs Consultant role</p>
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
          <Label className="text-xs">Doctor</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={doctorSearch} onChange={(e) => setDoctorSearch(e.target.value)} placeholder="Search doctor name..." className="h-9 w-52 pl-8" />
          </div>
        </div>
        <p className="pb-2 text-xs text-muted-foreground">Totals below reflect this date range{doctorSearch.trim() ? ' and doctor search' : ''}.</p>
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
            <CardDescription>Last 6 months, all doctors</CardDescription>
          </CardHeader>
          <CardContent>
            {chartLoading ? <Skeleton className="h-[260px] w-full" /> : trendData.length === 0 ? (
              <p className="text-center text-muted-foreground py-16">No data</p>
            ) : (
              <ChartContainer config={{ amount: { label: 'Commission', color: 'hsl(var(--chart-1))' } }} className="h-[260px] w-full">
                <BarChart data={trendData} margin={{ left: 12, right: 12, top: 12, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="amount" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Doctors</CardTitle>
            <CardDescription>By commission volume (last 6 months)</CardDescription>
          </CardHeader>
          <CardContent>
            {chartLoading ? <Skeleton className="h-[260px] w-full" /> : topDoctors.length === 0 ? (
              <p className="text-center text-muted-foreground py-16">No data</p>
            ) : (
              <ChartContainer config={{ amount: { label: 'Commission', color: 'hsl(var(--chart-3))' } }} className="h-[260px] w-full">
                <BarChart data={topDoctors} layout="vertical" margin={{ left: 8, right: 12, top: 12, bottom: 12 }}>
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
            <TabsTrigger value="summary">Summary by Doctor</TabsTrigger>
            <TabsTrigger value="detail">Detailed Transactions</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="mt-4">
            {Object.keys(byDoctor).length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">No doctor share data in this date range</CardContent></Card>
            ) : (
              <div className="space-y-4">
                {Object.entries(byDoctor).map(([doctorId, group]) => (
                  <Card key={doctorId}>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <CardTitle className="text-base">{group.doctor?.full_name ?? 'Unknown Doctor'}</CardTitle>
                          <p className="text-sm text-muted-foreground">{group.count} transactions · {group.doctor?.specialization ?? ''}</p>
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
                    <CardContent className="flex flex-wrap gap-3 pt-0">
                      {Object.entries(group.byRole).map(([role, r]) => (
                        <Badge key={role} variant="outline" className="gap-1.5 py-1.5">
                          {role === 'opd_doctor' ? <Stethoscope className="h-3 w-3" /> : <TestTube className="h-3 w-3" />}
                          {roleLabel[role] ?? role}: Rs {r.total.toLocaleString()} ({r.count})
                        </Badge>
                      ))}
                    </CardContent>
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
                  <CardDescription>Every settlement line in this date range, one row per patient/service/doctor</CardDescription>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => exportToCSV(
                      'doctor-share-detail',
                      [
                        { key: 'date', label: 'Date', format: (r: SettlementWithDoctor) => new Date(r.created_at).toLocaleDateString('en-GB') },
                        { key: 'invoice', label: 'Invoice #', format: (r: SettlementWithDoctor) => r.order?.order_code ?? '-' },
                        { key: 'patient', label: 'Patient', format: (r: SettlementWithDoctor) => r.order?.patient?.full_name ?? 'Unknown' },
                        { key: 'service', label: 'Service', format: (r: SettlementWithDoctor) => r.service_name },
                        { key: 'doctor', label: 'Doctor', format: (r: SettlementWithDoctor) => r.doctor?.full_name ?? 'Unknown' },
                        { key: 'role', label: 'Role', format: (r: SettlementWithDoctor) => roleLabel[r.doctor_type] ?? r.doctor_type },
                        { key: 'gross', label: 'Gross Amount', format: (r: SettlementWithDoctor) => Number(r.gross_amount || 0).toFixed(2) },
                        { key: 'disc', label: 'Discount', format: (r: SettlementWithDoctor) => Number(r.discount_amount || 0).toFixed(2) },
                        { key: 'net', label: 'Net (Paid) Amount', format: (r: SettlementWithDoctor) => Number(r.net_amount || 0).toFixed(2) },
                        { key: 'pct', label: 'Share %', format: (r: SettlementWithDoctor) => r.share_type === 'percentage' ? `${r.share_percentage ?? 0}%` : 'Fixed' },
                        { key: 'share', label: 'Share Amount', format: (r: SettlementWithDoctor) => Number(r.share_amount || 0).toFixed(2) },
                        { key: 'settled', label: 'Settled', format: (r: SettlementWithDoctor) => r.settled ? 'Yes' : 'No' },
                      ],
                      filteredSettlements,
                    )}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    <Download className="h-3.5 w-3.5" /> Export CSV
                  </button>
                  <button
                    onClick={() => printToPdf({
                      title: 'Doctor Share Report',
                      bodyHtml: `
                        <div class="report-header">
                          <div><div class="company">Doctor Share Report</div><div class="subtitle">${fromDate} to ${toDate}${doctorSearch.trim() ? ' &middot; Doctor: ' + doctorSearch : ''}</div></div>
                          <div class="doc-title">Rs ${totalCommission.toLocaleString()} total</div>
                        </div>
                        <table>
                          <thead><tr><th>Date</th><th>Patient</th><th>Service</th><th>Doctor</th><th>Role</th><th>Gross</th><th>Disc.</th><th>Net</th><th>Share %</th><th>Share Amt</th><th>Status</th></tr></thead>
                          <tbody>
                            ${filteredSettlements.map(s => `<tr>
                              <td>${new Date(s.created_at).toLocaleDateString('en-GB')}</td>
                              <td>${s.order?.patient?.full_name ?? 'Unknown'}</td>
                              <td>${s.service_name}</td>
                              <td>${s.doctor?.full_name ?? 'Unknown'}</td>
                              <td>${roleLabel[s.doctor_type] ?? s.doctor_type}</td>
                              <td>Rs ${Number(s.gross_amount || 0).toLocaleString()}</td>
                              <td>Rs ${Number(s.discount_amount || 0).toLocaleString()}</td>
                              <td>Rs ${Number(s.net_amount || 0).toLocaleString()}</td>
                              <td>${s.share_type === 'percentage' ? (s.share_percentage ?? 0) + '%' : 'Fixed'}</td>
                              <td>Rs ${Number(s.share_amount).toLocaleString()}</td>
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
                  <p className="py-8 text-center text-muted-foreground">No transactions match this date range{doctorSearch.trim() ? ' and doctor search' : ''}</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Patient</TableHead>
                          <TableHead>Service</TableHead>
                          <TableHead>Doctor</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                          <TableHead className="text-right">Disc.</TableHead>
                          <TableHead className="text-right">Net (Paid)</TableHead>
                          <TableHead className="text-right">Share %</TableHead>
                          <TableHead className="text-right">Share Amount</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSettlements.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="whitespace-nowrap text-xs">{new Date(s.created_at).toLocaleDateString('en-GB')}</TableCell>
                            <TableCell className="whitespace-nowrap">{s.order?.patient?.full_name ?? 'Unknown'}</TableCell>
                            <TableCell>{s.service_name}</TableCell>
                            <TableCell className="whitespace-nowrap">{s.doctor?.full_name ?? 'Unknown'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="gap-1 text-[10px]">
                                {s.doctor_type === 'opd_doctor' ? <Stethoscope className="h-2.5 w-2.5" /> : <TestTube className="h-2.5 w-2.5" />}
                                {roleLabel[s.doctor_type] ?? s.doctor_type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">Rs {Number(s.gross_amount || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right text-muted-foreground">Rs {Number(s.discount_amount || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right font-medium">Rs {Number(s.net_amount || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right">{s.share_type === 'percentage' ? `${s.share_percentage ?? 0}%` : 'Fixed'}</TableCell>
                            <TableCell className="text-right font-medium">Rs {Number(s.share_amount).toLocaleString()}</TableCell>
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
