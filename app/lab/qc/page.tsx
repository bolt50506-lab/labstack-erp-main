'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer } from 'recharts';
import { Loader2, FlaskConical, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { computeZScore, evaluateWestgard } from '@/lib/utils/westgard';
import type { QcControl, QcResult } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

const flagStyles: Record<string, string> = {
  pass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  fail: 'bg-red-100 text-red-800 border-red-200',
};

export default function QcEntryPage() {
  const supabase = getSupabaseClient();
  const { appUser } = useAuth();
  const [controls, setControls] = useState<QcControl[]>([]);
  const [selectedControlId, setSelectedControlId] = useState<string>('');
  const [results, setResults] = useState<QcResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const loadControls = useCallback(async () => {
    const { data } = await supabase.from('qc_controls').select('*').eq('is_active', true).order('name');
    setControls((data as QcControl[]) || []);
    if (data && data.length > 0 && !selectedControlId) setSelectedControlId((data[0] as QcControl).id);
  }, [supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadResults = useCallback(async (controlId: string) => {
    if (!controlId) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from('qc_results').select('*').eq('qc_control_id', controlId).order('run_date', { ascending: true }).limit(30);
    setResults((data as QcResult[]) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadControls(); }, [loadControls]);
  useEffect(() => { loadResults(selectedControlId); }, [selectedControlId, loadResults]);

  const selectedControl = controls.find(c => c.id === selectedControlId);

  const handleSubmit = async () => {
    if (!selectedControl || !value.trim() || !appUser?.company_id) { toast.error('Enter a measured value'); return; }
    const measured = parseFloat(value);
    if (Number.isNaN(measured)) { toast.error('Value must be a number'); return; }
    setSaving(true);

    const zScore = computeZScore(measured, selectedControl.target_mean, selectedControl.target_sd);
    const historyZScores = results.map(r => r.z_score);
    const { flag, rule } = evaluateWestgard(zScore, historyZScores);

    const { error } = await supabase.from('qc_results').insert({
      company_id: appUser.company_id,
      qc_control_id: selectedControl.id,
      measured_value: measured,
      z_score: zScore,
      flag,
      westgard_rule: rule,
      performed_by: appUser.id,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) { toast.error(getFriendlyErrorMessage(error)); return; }

    if (flag === 'fail') toast.error(`QC FAILED — rule ${rule} violated. Do not report patient results until resolved.`);
    else if (flag === 'warning') toast.warning(`QC warning — rule ${rule}. Review before proceeding.`);
    else toast.success('QC result recorded — within range');

    setValue(''); setNotes('');
    loadResults(selectedControl.id);
  };

  const chartData = results.map(r => ({ date: new Date(r.run_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), value: r.measured_value, flag: r.flag }));
  const mean = selectedControl?.target_mean ?? 0;
  const sd = selectedControl?.target_sd ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-primary" /><h1 className="text-2xl font-bold">Quality Control</h1></div>

      <div className="flex items-end gap-4">
        <div className="space-y-1 w-72">
          <Label className="text-xs">Control Material</Label>
          <Select value={selectedControlId} onValueChange={setSelectedControlId}>
            <SelectTrigger><SelectValue placeholder="Select a control..." /></SelectTrigger>
            <SelectContent>{controls.map(c => <SelectItem key={c.id} value={c.id}>{c.name} — {c.level}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {selectedControl && <p className="pb-2 text-xs text-muted-foreground">Target: {mean} ± {sd} {selectedControl.unit}</p>}
      </div>

      {controls.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No QC controls defined yet — add one in Masters → QC Controls first.</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Record Today's Run</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-end gap-4">
              <div className="space-y-1"><Label className="text-xs">Measured Value</Label><Input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} className="w-40" /></div>
              <div className="space-y-1 flex-1 min-w-[200px]"><Label className="text-xs">Notes (optional)</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              <Button onClick={handleSubmit} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Record QC Run</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Levy-Jennings Chart</CardTitle>
              <CardDescription>Last 30 runs, with ±1SD/±2SD/±3SD reference lines</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : chartData.length === 0 ? (
                <p className="py-16 text-center text-muted-foreground">No QC runs recorded yet for this control.</p>
              ) : (
                <ChartContainer config={{ value: { label: 'Measured Value', color: 'hsl(var(--chart-1))' } }} className="h-[300px] w-full">
                  <LineChart data={chartData} margin={{ left: 12, right: 12, top: 12, bottom: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis fontSize={11} tickLine={false} axisLine={false} domain={[mean - 4 * sd, mean + 4 * sd]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ReferenceLine y={mean} stroke="#64748b" strokeDasharray="4 2" label={{ value: 'Mean', fontSize: 10, position: 'right' }} />
                    <ReferenceLine y={mean + sd} stroke="#94a3b8" strokeDasharray="2 2" />
                    <ReferenceLine y={mean - sd} stroke="#94a3b8" strokeDasharray="2 2" />
                    <ReferenceLine y={mean + 2 * sd} stroke="#f59e0b" strokeDasharray="2 2" label={{ value: '+2SD', fontSize: 10, position: 'right' }} />
                    <ReferenceLine y={mean - 2 * sd} stroke="#f59e0b" strokeDasharray="2 2" label={{ value: '-2SD', fontSize: 10, position: 'right' }} />
                    <ReferenceLine y={mean + 3 * sd} stroke="#dc2626" label={{ value: '+3SD', fontSize: 10, position: 'right' }} />
                    <ReferenceLine y={mean - 3 * sd} stroke="#dc2626" label={{ value: '-3SD', fontSize: 10, position: 'right' }} />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Recent Runs</CardTitle></CardHeader>
            <CardContent className="divide-y p-0">
              {[...results].reverse().slice(0, 10).map((r) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div>
                    <span className="font-medium">{r.measured_value}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{new Date(r.run_date).toLocaleDateString('en-GB')} &middot; z={r.z_score.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.flag === 'fail' && <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
                    {r.westgard_rule && <span className="text-xs text-muted-foreground">{r.westgard_rule}</span>}
                    <Badge variant="outline" className={flagStyles[r.flag]}>{r.flag}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
