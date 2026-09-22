'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Save, Send, Plus, Trash2, ChevronLeft, ChevronRight, RotateCcw, TestTube, FlaskConical, Microscope, MessageSquare, Paperclip, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { LabOrderItem, LabResult, Service, TestParameter, LabResultParameter } from '@/lib/types';
import { computeFlag } from '@/lib/utils/pathology';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

type ItemWithRelations = LabOrderItem & { order?: any; results?: LabResult[]; service?: Service };

type ReportFormat = 'routine' | 'culture' | 'biopsy';

type ParamRow = { test_parameter_id: string | null; parameter_name: string; result_value: string; unit: string; normal_range: string; flag: 'normal' | 'low' | 'high' | 'critical'; low_critical: number | null; high_critical: number | null; auto: boolean };
type SensitivityRow = { antibiotic: string; result: 'sensitive' | 'intermediate' | 'resistant'; mic: string };
type PrevResult = { created_at: string; parameters: { parameter_name: string; result_value: string }[]; summary: string };

const formatLabels: Record<ReportFormat, string> = { routine: 'Routine', culture: 'Culture & Sensitivity', biopsy: 'Biopsy / Histopathology' };
const formatIcons: Record<ReportFormat, typeof TestTube> = { routine: TestTube, culture: FlaskConical, biopsy: Microscope };

const flagStyles: Record<string, string> = {
  normal: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  low: 'bg-amber-100 text-amber-800 border-amber-200',
  high: 'bg-amber-100 text-amber-800 border-amber-200',
  critical: 'bg-red-100 text-red-800 border-red-200 font-semibold',
};

const flagLabels: Record<string, string> = { normal: 'Normal', low: 'Low', high: 'High', critical: 'Critical' };

export default function LabResultsPage() {
  const supabase = getSupabaseClient();
  const { appUser } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ItemWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [paramRows, setParamRows] = useState<ParamRow[]>([]);
  const [reportFormat, setReportFormat] = useState<ReportFormat>('routine');
  const [generalResult, setGeneralResult] = useState({ result_value: '', unit: '', normal_range: '', flag: 'normal' as const, method: '', remarks: '' });
  const [cultureData, setCultureData] = useState({ specimen: '', grossAppearance: '', growth: '', organism: '', colonyCount: '', remarks: '' });
  const [sensitivityRows, setSensitivityRows] = useState<SensitivityRow[]>([]);
  const [biopsyData, setBiopsyData] = useState({ grossExamination: '', microscopicExamination: '', diagnosis: '', remarks: '' });
  const [saving, setSaving] = useState(false);
  const [prevResults, setPrevResults] = useState<PrevResult[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('lab_order_items').select('*, order:lab_orders(*, patient:patients(*)), results:lab_results(*, parameters:lab_result_parameters(*)), service:services(*)').in('status', ['processing', 'result_entered']).order('created_at', { ascending: false });
    if (error) toast.error('Failed to load: ' + getFriendlyErrorMessage(error));
    const filtered = ((data as any) || []).filter((i: any) => i.service?.category === 'lab');
    if (!error) setItems(filtered);
    setLoading(false);
    return filtered as ItemWithRelations[];
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const selected = items[selectedIndex] ?? null;

  const loadHistory = useCallback(async (item: ItemWithRelations) => {
    if (!item.service_id) { setPrevResults([]); return; }
    const { data } = await supabase
      .from('lab_order_items')
      .select('id, created_at, results:lab_results(id, result_value, created_at, parameters:lab_result_parameters(parameter_name, result_value))')
      .eq('service_id', item.service_id)
      .neq('id', item.id)
      .in('status', ['result_entered', 'verified', 'approved'])
      .order('created_at', { ascending: false })
      .limit(5);
    const rows = ((data as any[]) || []).map(r => {
      const res = r.results?.[0];
      const params = (res?.parameters as { parameter_name: string; result_value: string }[]) || [];
      const summary = params.length > 0
        ? params.map(p => p.parameter_name + ' ' + p.result_value).join(', ')
        : (res?.result_value ?? '').slice(0, 80);
      return { created_at: r.created_at, parameters: params, summary };
    });
    setPrevResults(rows);
  }, [supabase]);

  const loadEditor = useCallback(async (item: ItemWithRelations | null) => {
    if (!item) return;
    const fmt: ReportFormat = (item.service?.report_format as ReportFormat) || 'routine';
    setReportFormat(fmt);
    const existing = item.results?.[0];
    const structured: Record<string, any> = existing?.structured_data || {};

    setGeneralResult({ result_value: existing?.result_value ?? '', unit: existing?.unit ?? '', normal_range: existing?.normal_range ?? '', flag: (existing?.flag as 'normal') ?? 'normal', method: existing?.method ?? item.service?.method ?? '', remarks: existing?.remarks ?? '' });

    setCultureData({
      specimen: structured.specimen ?? '', grossAppearance: structured.grossAppearance ?? '', growth: structured.growth ?? '',
      organism: structured.organism ?? '', colonyCount: structured.colonyCount ?? '', remarks: structured.remarks ?? existing?.remarks ?? '',
    });
    setSensitivityRows(structured.sensitivityRows ?? []);
    setBiopsyData({
      grossExamination: structured.grossExamination ?? '', microscopicExamination: structured.microscopicExamination ?? '',
      diagnosis: structured.diagnosis ?? '', remarks: structured.remarks ?? existing?.remarks ?? '',
    });

    const { data: params } = await supabase.from('test_parameters').select('*').eq('service_id', item.service_id).eq('is_active', true).order('display_order');
    const paramList = (params as TestParameter[]) || [];
    const existingParams = existing?.parameters ?? [];
    if (paramList.length > 0) {
      setParamRows(paramList.map((p) => {
        const ep = existingParams.find((e) => e.test_parameter_id === p.id || e.parameter_name === p.name);
        const value = ep?.result_value ?? '';
        const computed = value ? computeFlag(value, ep?.normal_range ?? p.normal_range, p.low_critical, p.high_critical) : null;
        return {
          test_parameter_id: p.id, parameter_name: p.name, result_value: value,
          unit: ep?.unit ?? p.unit ?? '', normal_range: ep?.normal_range ?? p.normal_range ?? '',
          flag: (computed ?? (ep?.flag as 'normal') ?? 'normal'), low_critical: p.low_critical, high_critical: p.high_critical, auto: true,
        };
      }));
    } else {
      setParamRows(existingParams.map((ep) => ({
        test_parameter_id: ep.test_parameter_id, parameter_name: ep.parameter_name, result_value: ep.result_value ?? '',
        unit: ep.unit ?? '', normal_range: ep.normal_range ?? '', flag: (ep.flag as 'normal') ?? 'normal',
        low_critical: null, high_critical: null, auto: false,
      })));
    }
    loadHistory(item);
  }, [supabase, loadHistory]);

  useEffect(() => { loadEditor(selected); }, [selected, loadEditor]);

  const moveSelection = (dir: -1 | 1) => setSelectedIndex(Math.max(0, Math.min(items.length - 1, selectedIndex + dir)));

  const updateParamRow = (i: number, field: keyof ParamRow, value: string) => {
    setParamRows(prev => prev.map((row, idx) => {
      if (idx !== i) return row;
      const next = { ...row, [field]: value } as ParamRow;
      if (field === 'result_value' && next.auto) {
        const computed = computeFlag(value, next.normal_range, next.low_critical, next.high_critical);
        if (computed) next.flag = computed;
      }
      if (field === 'flag') next.auto = false;
      return next;
    }));
  };
  const addParamRow = () => setParamRows([...paramRows, { test_parameter_id: null, parameter_name: '', result_value: '', unit: '', normal_range: '', flag: 'normal', low_critical: null, high_critical: null, auto: false }]);
  const removeParamRow = (i: number) => setParamRows(paramRows.filter((_, idx) => idx !== i));
  const addSensitivityRow = () => setSensitivityRows([...sensitivityRows, { antibiotic: '', result: 'sensitive', mic: '' }]);
  const updateSensitivityRow = (i: number, field: keyof SensitivityRow, value: string) => { const u = [...sensitivityRows]; (u[i] as any)[field] = value; setSensitivityRows(u); };
  const removeSensitivityRow = (i: number) => setSensitivityRows(sensitivityRows.filter((_, idx) => idx !== i));

  const buildPayload = () => {
    let resultPayload: Record<string, any>;
    let structuredData: Record<string, any> | null = null;
    let paramInserts: any[] = [];
    if (reportFormat === 'routine') {
      resultPayload = { ...generalResult };
      if (paramRows.length > 0) {
        paramInserts = paramRows.filter(r => r.parameter_name.trim()).map(r => ({ test_parameter_id: r.test_parameter_id, parameter_name: r.parameter_name, result_value: r.result_value, unit: r.unit, normal_range: r.normal_range, flag: r.flag }));
        const anyCritical = paramInserts.some(p => p.flag === 'critical');
        const anyAbnormal = paramInserts.find(p => p.flag !== 'normal');
        resultPayload.flag = anyCritical ? 'critical' : (anyAbnormal ? anyAbnormal.flag : 'normal');
      }
    } else if (reportFormat === 'culture') {
      structuredData = { ...cultureData, sensitivityRows };
      const report = ['Specimen: ' + (cultureData.specimen || '-'), 'Gross Appearance: ' + (cultureData.grossAppearance || '-'), 'Growth: ' + (cultureData.growth || '-'), 'Organism Isolated: ' + (cultureData.organism || '-'), 'Colony Count: ' + (cultureData.colonyCount || '-')].join('\n');
      resultPayload = { result_value: report, unit: '', normal_range: '', flag: 'normal', method: generalResult.method, remarks: cultureData.remarks, structured_data: structuredData };
      if (sensitivityRows.length > 0) paramInserts = sensitivityRows.filter(r => r.antibiotic.trim()).map(r => ({ test_parameter_id: null, parameter_name: r.antibiotic, result_value: r.result, unit: r.mic, normal_range: '', flag: r.result === 'resistant' ? 'high' : 'normal' }));
    } else {
      structuredData = { ...biopsyData };
      const report = ['GROSS EXAMINATION:\n' + (biopsyData.grossExamination || '-'), 'MICROSCOPIC EXAMINATION:\n' + (biopsyData.microscopicExamination || '-')].join('\n\n');
      resultPayload = { result_value: report, unit: '', normal_range: '', flag: 'normal', method: generalResult.method, remarks: biopsyData.diagnosis ? 'DIAGNOSIS: ' + biopsyData.diagnosis + (biopsyData.remarks ? '\n\n' + biopsyData.remarks : '') : biopsyData.remarks, structured_data: structuredData };
    }
    if (reportFormat === 'routine') resultPayload.structured_data = null;
    return { resultPayload, paramInserts };
  };

  const handleSubmitResult = async (submitForVerification: boolean) => {
    if (!selected) return;
    setSaving(true);
    const existing = selected.results?.[0];
    const { resultPayload, paramInserts } = buildPayload();

    let resultId: string;
    if (existing) {
      const { data, error } = await supabase.from('lab_results').update(resultPayload).eq('id', existing.id).select('id');
      if (error) { toast.error(getFriendlyErrorMessage(error)); setSaving(false); return; }
      resultId = data[0].id;
      await supabase.from('lab_result_parameters').delete().eq('lab_result_id', resultId);
    } else {
      const { data, error } = await supabase.from('lab_results').insert({ lab_order_item_id: selected.id, service_id: selected.service_id, ...resultPayload }).select('id');
      if (error) { toast.error(getFriendlyErrorMessage(error)); setSaving(false); return; }
      resultId = data[0].id;
    }
    if (paramInserts.length > 0) { const { error: pError } = await supabase.from('lab_result_parameters').insert(paramInserts.map(p => ({ ...p, lab_result_id: resultId }))); if (pError) toast.error('Failed to save parameters: ' + getFriendlyErrorMessage(pError)); }

    if (submitForVerification) {
      const { error: sErr } = await supabase.from('lab_order_items').update({
        status: 'result_entered', result_entered_at: new Date().toISOString(), result_entered_by: appUser?.id ?? null,
      }).eq('id', selected.id);
      if (sErr) toast.error('Failed to update status: ' + getFriendlyErrorMessage(sErr));
    }
    setSaving(false);
    toast.success(submitForVerification ? 'Submitted for verification' : 'Draft saved');
    const freshItems = await loadData();
    if (submitForVerification) {
      // Drop the technician onto the next item still needing work instead
      // of leaving them on the one they just finished — this is the
      // difference between one click per sample and zero, across dozens
      // of samples a day.
      const nextIndex = freshItems.findIndex((i) => i.status === 'processing');
      setSelectedIndex(nextIndex >= 0 ? nextIndex : 0);
    }
  };

  if (loading) return <div className="flex min-h-[420px] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading pathology results...</div>;

  const hasCritical = paramRows.some(r => r.flag === 'critical');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><TestTube className="h-5 w-5 text-primary" /><h1 className="text-xl font-semibold">Pathology Reports</h1></div>
        <p className="text-sm text-muted-foreground">{selected ? selected.order?.order_code : 'No results waiting'}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-2 shadow-sm">
        <div className="flex items-center gap-1.5">
          <Button variant="default" size="sm" onClick={() => router.back()}><ChevronLeft className="mr-1 h-3.5 w-3.5" />Back</Button>
          <Button variant="outline" size="sm" disabled={selectedIndex === 0} onClick={() => moveSelection(-1)}>« Previous</Button>
          <Input value={selected?.order?.order_code ?? ''} readOnly className="h-8 w-36 bg-muted/40 font-mono text-xs" />
          <Button variant="outline" size="sm" disabled={selectedIndex >= items.length - 1} onClick={() => moveSelection(1)}>Next »</Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={loadData}><RotateCcw className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => loadEditor(selected)}><span className="mr-1">×</span>Cancel</Button>
          <Button variant="secondary" size="sm" onClick={() => handleSubmitResult(false)} disabled={saving || !selected}><Save className="mr-1 h-3.5 w-3.5" />Save Draft</Button>
          <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => handleSubmitResult(true)} disabled={saving || !selected}><Send className="mr-1 h-3.5 w-3.5" />Submit for Verification</Button>
        </div>
      </div>

      {hasCritical && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          One or more parameters are flagged Critical — verify carefully before submitting.
        </div>
      )}

      {selected ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
          <main className="min-w-0 rounded-md border bg-card shadow-sm">
            <div className="grid grid-cols-2 gap-3 border-b bg-muted/25 px-4 py-3 text-sm md:grid-cols-4">
              <div><span className="text-muted-foreground">PIN:</span> <strong className="font-mono">{selected.order?.order_code}</strong></div>
              <div><span className="text-muted-foreground">Name:</span> <strong>{selected.order?.patient?.full_name ?? 'Unknown'}</strong></div>
              <div><span className="text-muted-foreground">Panel:</span> <strong>Pathology</strong></div>
              <div><span className="text-muted-foreground">Age/Gender:</span> <strong>{selected.order?.patient?.age ?? '-'} / {selected.order?.patient?.gender ?? '-'}</strong></div>
            </div>
            <div className="border-b px-4 py-3 text-sm"><span className="text-muted-foreground">Reg Date:</span> <strong>{new Date(selected.order?.created_at ?? selected.created_at).toLocaleDateString('en-GB')}</strong><span className="ml-8 text-muted-foreground">Sample ID:</span> <strong className="font-mono">{selected.sample_id ?? '-'}</strong></div>
            <div className="p-4">
              <Tabs defaultValue="examination">
                <TabsList><TabsTrigger value="examination">{selected.service_name}</TabsTrigger><TabsTrigger value="history">Report History</TabsTrigger></TabsList>
                <TabsContent value="examination" className="mt-4 space-y-4">
                  <div className="flex items-center justify-between border-b pb-3">
                    <div><h2 className="font-semibold">{selected.service_name}</h2><p className="text-xs text-muted-foreground">{selected.service?.method ?? 'Pathology test'}</p></div>
                    <Badge variant="outline">{formatLabels[reportFormat]}</Badge>
                  </div>

                  {reportFormat === 'routine' && (
                    <div className="space-y-4">
                      {paramRows.length > 0 ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between"><Label>Test Parameters</Label><Button variant="outline" size="sm" onClick={addParamRow}><Plus className="mr-1 h-3 w-3" /> Add Parameter</Button></div>
                          <div className="rounded-lg border">
                            <Table>
                              <TableHeader><TableRow><TableHead>Parameter</TableHead><TableHead>Result</TableHead><TableHead>Unit</TableHead><TableHead>Reference Range</TableHead><TableHead>Flag</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
                              <TableBody>
                                {paramRows.map((row, i) => (
                                  <TableRow key={i} className={row.flag === 'critical' ? 'bg-red-50' : ''}>
                                    <TableCell><Input value={row.parameter_name} onChange={(e) => updateParamRow(i, 'parameter_name', e.target.value)} className="h-8" /></TableCell>
                                    <TableCell><Input value={row.result_value} onChange={(e) => updateParamRow(i, 'result_value', e.target.value)} className="h-8" /></TableCell>
                                    <TableCell><Input value={row.unit} onChange={(e) => updateParamRow(i, 'unit', e.target.value)} className="h-8 w-20" /></TableCell>
                                    <TableCell><Input value={row.normal_range} onChange={(e) => updateParamRow(i, 'normal_range', e.target.value)} className="h-8 w-32" placeholder="3.5 - 5.5" /></TableCell>
                                    <TableCell>
                                      <Select value={row.flag} onValueChange={(v) => updateParamRow(i, 'flag', v)}>
                                        <SelectTrigger className={"h-8 w-28 " + flagStyles[row.flag]}><SelectValue>{flagLabels[row.flag]}</SelectValue></SelectTrigger>
                                        <SelectContent><SelectItem value="normal">Normal</SelectItem><SelectItem value="low">Low</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell><Button variant="ghost" size="sm" onClick={() => removeParamRow(i)}><Trash2 className="h-3 w-3" /></Button></TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          <p className="text-xs text-muted-foreground">Flags are computed automatically from the reference range defined for this test in Masters → Services → Reference Values. Change the dropdown to override a specific row.</p>
                        </div>
                      ) : (<div className="space-y-2"><Label>Result Value</Label><Input value={generalResult.result_value} onChange={(e) => setGeneralResult({ ...generalResult, result_value: e.target.value })} /><p className="text-xs text-muted-foreground">No parameters defined for this test yet — add them in Masters → Services → Reference Values to enable per-parameter entry and auto-flagging.</p></div>)}
                      <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Method</Label><Input value={generalResult.method} onChange={(e) => setGeneralResult({ ...generalResult, method: e.target.value })} /></div><div className="space-y-2"><Label>Overall Flag</Label><Select value={generalResult.flag} onValueChange={(v) => setGeneralResult({ ...generalResult, flag: v as 'normal' })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="normal">Normal</SelectItem><SelectItem value="low">Low</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent></Select></div></div>
                      <div className="space-y-2"><Label>Remarks / Notes</Label><Textarea value={generalResult.remarks} onChange={(e) => setGeneralResult({ ...generalResult, remarks: e.target.value })} rows={2} /></div>
                    </div>
                  )}

                  {reportFormat === 'culture' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Specimen</Label><Input value={cultureData.specimen} onChange={(e) => setCultureData({ ...cultureData, specimen: e.target.value })} placeholder="Urine, Wound swab, Blood..." /></div><div className="space-y-2"><Label>Colony Count</Label><Input value={cultureData.colonyCount} onChange={(e) => setCultureData({ ...cultureData, colonyCount: e.target.value })} placeholder="10^5 CFU/ml" /></div></div>
                      <div className="space-y-2"><Label>Gross Appearance</Label><Textarea value={cultureData.grossAppearance} onChange={(e) => setCultureData({ ...cultureData, grossAppearance: e.target.value })} rows={2} placeholder="Appearance of specimen on receipt..." /></div>
                      <div className="space-y-2"><Label>Growth Observation</Label><Select value={cultureData.growth} onValueChange={(v) => setCultureData({ ...cultureData, growth: v })}><SelectTrigger><SelectValue placeholder="Select growth pattern..." /></SelectTrigger><SelectContent><SelectItem value="no_growth">No Growth</SelectItem><SelectItem value="scanty">Scanty Growth</SelectItem><SelectItem value="moderate">Moderate Growth</SelectItem><SelectItem value="heavy">Heavy Growth</SelectItem><SelectItem value="mixed">Mixed Flora</SelectItem></SelectContent></Select></div>
                      <div className="space-y-2"><Label>Organism Isolated</Label><Textarea value={cultureData.organism} onChange={(e) => setCultureData({ ...cultureData, organism: e.target.value })} rows={2} placeholder="e.g. E. coli, Klebsiella pneumoniae..." /></div>
                      <div className="space-y-3"><div className="flex items-center justify-between"><Label>Antibiotic Sensitivity Pattern</Label><Button variant="outline" size="sm" onClick={addSensitivityRow}><Plus className="mr-1 h-3 w-3" /> Add Antibiotic</Button></div>{sensitivityRows.length > 0 ? (<div className="rounded-lg border"><Table><TableHeader><TableRow><TableHead>Antibiotic</TableHead><TableHead>Sensitivity</TableHead><TableHead>MIC</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader><TableBody>{sensitivityRows.map((row, i) => (<TableRow key={i}><TableCell><Input value={row.antibiotic} onChange={(e) => updateSensitivityRow(i, 'antibiotic', e.target.value)} className="h-8" placeholder="Amoxicillin" /></TableCell><TableCell><Select value={row.result} onValueChange={(v) => updateSensitivityRow(i, 'result', v)}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sensitive">Sensitive (S)</SelectItem><SelectItem value="intermediate">Intermediate (I)</SelectItem><SelectItem value="resistant">Resistant (R)</SelectItem></SelectContent></Select></TableCell><TableCell><Input value={row.mic} onChange={(e) => updateSensitivityRow(i, 'mic', e.target.value)} className="h-8 w-24" placeholder="µg/ml" /></TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => removeSensitivityRow(i)}><Trash2 className="h-3 w-3" /></Button></TableCell></TableRow>))}</TableBody></Table></div>) : <p className="text-sm text-muted-foreground">No antibiotics added yet.</p>}</div>
                      <div className="space-y-2"><Label>Remarks / Comments</Label><Textarea value={cultureData.remarks} onChange={(e) => setCultureData({ ...cultureData, remarks: e.target.value })} rows={2} /></div>
                    </div>
                  )}

                  {reportFormat === 'biopsy' && (
                    <div className="space-y-4">
                      <div className="space-y-2"><Label>Gross Examination</Label><Textarea value={biopsyData.grossExamination} onChange={(e) => setBiopsyData({ ...biopsyData, grossExamination: e.target.value })} rows={4} placeholder="Describe specimen size, shape, color, consistency..." /></div>
                      <div className="space-y-2"><Label>Microscopic Examination</Label><Textarea value={biopsyData.microscopicExamination} onChange={(e) => setBiopsyData({ ...biopsyData, microscopicExamination: e.target.value })} rows={5} placeholder="Describe histological features..." /></div>
                      <div className="space-y-2"><Label>Diagnosis</Label><Textarea value={biopsyData.diagnosis} onChange={(e) => setBiopsyData({ ...biopsyData, diagnosis: e.target.value })} rows={2} placeholder="Final diagnosis / conclusion..." /></div>
                      <div className="space-y-2"><Label>Remarks / Additional Notes</Label><Textarea value={biopsyData.remarks} onChange={(e) => setBiopsyData({ ...biopsyData, remarks: e.target.value })} rows={2} /></div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="history" className="mt-4">
                  {prevResults.length > 0 ? (
                    <div className="rounded-md border divide-y">
                      {prevResults.map((r, i) => (
                        <div key={i} className="px-4 py-3 text-sm">
                          <div className="font-medium">{new Date(r.created_at).toLocaleDateString('en-GB')}</div>
                          <div className="text-muted-foreground">{r.summary || 'No summary available'}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">No previous reports for this test yet.</div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </main>

          <aside className="space-y-3">
            <Card><CardHeader className="border-b py-3"><CardTitle className="text-base">Services</CardTitle></CardHeader><CardContent className="p-0"><div className="grid grid-cols-[1fr_auto] border-b px-3 py-2 text-xs font-semibold text-muted-foreground"><span>Name</span><span>Status</span></div>{items.map((item, index) => { const fmt: ReportFormat = (item.service?.report_format as ReportFormat) || 'routine'; const Icon = formatIcons[fmt]; return (<button key={item.id} onClick={() => setSelectedIndex(index)} className={"grid w-full grid-cols-[1fr_auto] items-center gap-2 border-b px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 " + (index === selectedIndex ? 'bg-primary/5' : '')}><span className="flex min-w-0 items-center gap-2 truncate"><Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{item.service_name}</span><Badge variant={item.status === 'result_entered' ? 'secondary' : 'outline'} className="text-[10px]">{item.status === 'result_entered' ? 'Entered' : 'Analysis'}</Badge></button>); })}</CardContent></Card>
            <Card><CardHeader className="border-b py-3"><CardTitle className="flex items-center gap-2 text-sm"><MessageSquare className="h-4 w-4" />Visit Remarks</CardTitle></CardHeader><CardContent className="p-3"><p className="text-sm text-muted-foreground">Not available in this build yet — needs a dedicated remarks table and hasn't been wired up.</p></CardContent></Card>
            <Card><CardHeader className="border-b py-3"><CardTitle className="flex items-center gap-2 text-sm"><Paperclip className="h-4 w-4" />Documents</CardTitle></CardHeader><CardContent className="p-3"><p className="text-sm text-muted-foreground">Not available in this build yet — needs document storage and hasn't been wired up.</p></CardContent></Card>
          </aside>
        </div>
      ) : <Card><CardContent className="py-16 text-center text-muted-foreground">No pathology tests are waiting for result entry.</CardContent></Card>}
    </div>
  );
}
