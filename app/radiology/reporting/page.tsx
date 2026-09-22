'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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
import { Loader2, Save, CheckCircle2, Bold, Italic, Underline, List, ListOrdered, ChevronLeft, ChevronRight, RotateCcw, FileText, MessageSquare, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import type { LabOrderItem, LabOrder, Patient, Service, Doctor } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

type ItemWithRelations = LabOrderItem & { order?: LabOrder & { patient?: Patient }; patient?: Patient; service?: Service; radiology_report?: any[] };

const REPORT_TEMPLATES: { matches: string[]; findings: string; impression: string }[] = [
  { matches: ['chest', 'x-ray', 'xray'], findings: '<b>Findings:</b><br>Lung fields are clear. Cardiac silhouette is normal in size and contour. Costophrenic angles are sharp. Bony thorax is unremarkable.<br><br><b>Technique:</b> PA view chest radiograph.', impression: 'Normal chest radiograph. No acute cardiopulmonary abnormality detected.' },
  { matches: ['abdomen', 'ultrasound'], findings: '<b>Findings:</b><br>Liver: Normal in size and echogenicity. No focal lesion.<br>Gallbladder: Well-distended, no stones or wall thickening.<br>Pancreas: Normal.<br>Kidneys: Normal in size and corticomedullary differentiation.<br>No free fluid seen.', impression: 'Normal abdominal ultrasound examination.' },
  { matches: ['head', 'brain', 'ct'], findings: '<b>Findings:</b><br>Brain parenchyma shows normal density. Ventricular system is normal in size and position. Midline is not shifted. No intracranial hemorrhage or infarct detected. Bone windows show no fracture.', impression: 'No acute intracranial abnormality detected.' },
];

export default function RadiologyReportingPage() {
  const supabase = getSupabaseClient();
  const { appUser } = useAuth();
  const [items, setItems] = useState<ItemWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [findings, setFindings] = useState('');
  const [impression, setImpression] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [itemsRes, docsRes] = await Promise.all([
      supabase.from('lab_order_items').select('*, order:lab_orders(*, patient:patients(*)), service:services(*), radiology_report:radiology_reports(*)').in('status', ['pending', 'sample_collected', 'processing', 'result_entered']).order('created_at', { ascending: false }),
      supabase.from('doctors').select('*').eq('is_active', true).order('full_name'),
    ]);
    if (itemsRes.error) toast.error(getFriendlyErrorMessage(itemsRes.error));
    else setItems(((itemsRes.data as any) || []).filter((i: any) => i.service?.category === 'radiology'));
    setDoctors((docsRes.data as Doctor[]) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const selected = items[selectedIndex] ?? null;

  const loadEditor = useCallback((item: ItemWithRelations | null) => {
    if (!item) return;
    const result = item.radiology_report?.[0];
    setFindings(result?.findings ?? '');
    setImpression(result?.impression ?? '');
    setComment('');
    setSelectedDoctorId(item.verified_by_doctor_id ?? '');
    setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = result?.result_value ?? ''; }, 0);
  }, []);

  useEffect(() => { loadEditor(selected); }, [selected, loadEditor]);

  const moveSelection = (direction: -1 | 1) => {
    setSelectedIndex(Math.max(0, Math.min(items.length - 1, selectedIndex + direction)));
  };

  const initializeReport = () => {
    if (!selected) return;
    const name = selected.service_name.toLowerCase();
    const template = REPORT_TEMPLATES.find((t) => t.matches.some((match) => name.includes(match)));
    const nextFindings = template?.findings ?? '<b>Findings:</b><br><br><b>Technique:</b> ';
    const nextImpression = template?.impression ?? '';
    if (editorRef.current) editorRef.current.innerHTML = nextFindings;
    setFindings(nextFindings);
    setImpression(nextImpression);
    toast.success('Report template initialized');
  };

  const execCmd = (cmd: string) => {
    document.execCommand(cmd, false);
    if (editorRef.current) setFindings(editorRef.current.innerHTML);
    editorRef.current?.focus();
  };

  const saveReport = async (approve: boolean) => {
    if (!selected || !findings.trim()) { toast.error('Enter findings before saving'); return; }
    approve ? setApproving(true) : setSaving(true);
    const now = new Date().toISOString();
    const reportPayload = {
      company_id: appUser?.company_id,
      lab_order_item_id: selected.id,
      findings,
      impression,
      reporting_doctor_id: selectedDoctorId || null,
      report_status: approve ? 'approved' : 'result_entered',
      signed_at: approve ? now : null,
      updated_at: now,
    };
    const { error: reportError } = await supabase.from('radiology_reports').upsert(reportPayload, { onConflict: 'lab_order_item_id' });
    if (reportError) { toast.error(getFriendlyErrorMessage(reportError)); setSaving(false); setApproving(false); return; }
    const update = approve
      ? { status: 'approved', result_entered_at: now, result_entered_by: appUser?.id ?? null, verified_at: now, verified_by: appUser?.id ?? null, verified_by_doctor_id: selectedDoctorId || null }
      : { status: 'result_entered', result_entered_at: new Date().toISOString(), result_entered_by: appUser?.id ?? null, verified_by_doctor_id: selectedDoctorId || null };
    const { error } = await supabase.from('lab_order_items').update(update).eq('id', selected.id);
    if (error) toast.error(getFriendlyErrorMessage(error));
    else toast.success(approve ? 'Report saved and signed off' : 'Report saved and sent for verification');
    setSaving(false); setApproving(false);
    await load();
  };

  if (loading) return <div className="flex min-h-[420px] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading radiology reports...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /><h1 className="text-xl font-semibold">Radiology Reports</h1></div>
        <p className="text-sm text-muted-foreground">{selected ? selected.order?.order_code : 'No reports waiting'}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-2 shadow-sm">
        <div className="flex items-center gap-1.5">
          <Button variant="default" size="sm"><ChevronLeft className="mr-1 h-3.5 w-3.5" />Back</Button>
          <Button variant="outline" size="sm" disabled={selectedIndex === 0} onClick={() => moveSelection(-1)}>« Previous</Button>
          <Input value={selected?.order?.order_code ?? ''} readOnly className="h-8 w-36 bg-muted/40 font-mono text-xs" />
          <Button variant="outline" size="sm" disabled={selectedIndex >= items.length - 1} onClick={() => moveSelection(1)}>Next »</Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={load}><RotateCcw className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" className="rounded-full" onClick={initializeReport} disabled={!selected}><RotateCcw className="mr-1 h-3.5 w-3.5" />Initialize All</Button>
          <Button variant="outline" size="sm" onClick={() => loadEditor(selected)}><span className="mr-1">×</span>Cancel</Button>
          <Button variant="secondary" size="sm" onClick={() => saveReport(false)} disabled={saving || !selected}><Save className="mr-1 h-3.5 w-3.5" />Save</Button>
          <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => saveReport(true)} disabled={approving || !selected}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Save &amp; Transfer</Button>
        </div>
      </div>

      {selected ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
          <main className="min-w-0 rounded-md border bg-card shadow-sm">
            <div className="grid grid-cols-2 gap-3 border-b bg-muted/25 px-4 py-3 text-sm md:grid-cols-4">
              <div><span className="text-muted-foreground">PIN:</span> <strong className="font-mono">{selected.order?.order_code}</strong></div>
              <div><span className="text-muted-foreground">Name:</span> <strong>{selected.order?.patient?.full_name ?? 'Unknown'}</strong></div>
              <div><span className="text-muted-foreground">Panel:</span> <strong>Radiology</strong></div>
              <div><span className="text-muted-foreground">Age/Gender:</span> <strong>{selected.order?.patient?.age ?? '-'} / {selected.order?.patient?.gender ?? '-'}</strong></div>
            </div>
            <div className="border-b px-4 py-3 text-sm"><span className="text-muted-foreground">Reg Date:</span> <strong>{new Date(selected.order?.created_at ?? selected.created_at).toLocaleDateString('en-GB')}</strong><span className="ml-8 text-muted-foreground">Sample ID:</span> <strong className="font-mono">{selected.sample_id ?? '-'}</strong></div>
            <div className="p-4">
              <Tabs defaultValue="examination">
                <TabsList><TabsTrigger value="examination">{selected.service_name}</TabsTrigger><TabsTrigger value="history">Report History</TabsTrigger></TabsList>
                <TabsContent value="examination" className="mt-4 space-y-4">
                  <div className="flex items-center justify-between border-b pb-3"><div><h2 className="font-semibold">{selected.service_name}</h2><p className="text-xs text-muted-foreground">{selected.service?.method ?? 'Radiology examination'}</p></div><Button size="sm" className="rounded-full" onClick={initializeReport}>Initialize</Button></div>
                  <div className="space-y-2"><div className="flex flex-wrap items-center gap-1 border rounded-md bg-muted/20 p-1"><Button variant="ghost" size="sm" onClick={() => execCmd('bold')}><Bold className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="sm" onClick={() => execCmd('italic')}><Italic className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="sm" onClick={() => execCmd('underline')}><Underline className="h-3.5 w-3.5" /></Button><span className="mx-1 h-4 w-px bg-border" /><Button variant="ghost" size="sm" onClick={() => execCmd('insertUnorderedList')}><List className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="sm" onClick={() => execCmd('insertOrderedList')}><ListOrdered className="h-3.5 w-3.5" /></Button></div><Label>Findings</Label><div ref={editorRef} contentEditable onInput={(e) => setFindings(e.currentTarget.innerHTML)} className="min-h-[260px] rounded-md border p-3 text-sm leading-6 outline-none focus:ring-1 focus:ring-primary" data-placeholder="Enter radiological findings..." /></div>
                  <div className="space-y-2"><Label>Impression</Label><Textarea value={impression} onChange={(e) => setImpression(e.target.value)} rows={4} placeholder="Enter radiological impression..." /></div>
                  <div className="space-y-2"><Label>Verified / Signed by Doctor</Label><Select value={selectedDoctorId} onValueChange={setSelectedDoctorId}><SelectTrigger><SelectValue placeholder="Select a doctor to sign off..." /></SelectTrigger><SelectContent>{doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}{d.specialization ? ` — ${d.specialization}` : ''}</SelectItem>)}</SelectContent></Select></div>
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Enter Test Comments here" />
                </TabsContent>
                <TabsContent value="history" className="mt-4"><div className="rounded-md border p-6 text-center text-sm text-muted-foreground">Previous report versions will appear here.</div></TabsContent>
              </Tabs>
            </div>
          </main>

          <aside className="space-y-3">
            <Card><CardHeader className="border-b py-3"><CardTitle className="text-base">Services</CardTitle></CardHeader><CardContent className="p-0"><div className="grid grid-cols-[1fr_auto] border-b px-3 py-2 text-xs font-semibold text-muted-foreground"><span>Name</span><span>Status</span></div>{items.map((item, index) => <button key={item.id} onClick={() => setSelectedIndex(index)} className={`grid w-full grid-cols-[1fr_auto] items-center gap-2 border-b px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 ${index === selectedIndex ? 'bg-primary/5' : ''}`}><span className="flex min-w-0 items-center gap-2 truncate"><FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{item.service_name}</span><Badge variant={item.status === 'result_entered' ? 'secondary' : 'outline'} className="text-[10px]">{item.status === 'result_entered' ? 'Entered' : 'Analysis'}</Badge></button>)}</CardContent></Card>
            <Card><CardHeader className="border-b py-3"><CardTitle className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><MessageSquare className="h-4 w-4" />Visit Remarks</span><Badge>1</Badge></CardTitle></CardHeader><CardContent className="p-3"><p className="text-sm text-muted-foreground">No visit remarks recorded.</p><div className="mt-3 flex items-center gap-2"><Input placeholder="Enter Remarks" className="h-8 text-xs" /><Button size="icon" className="h-8 w-8"><MessageSquare className="h-3.5 w-3.5" /></Button></div></CardContent></Card>
            <Card><CardHeader className="border-b py-3"><CardTitle className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><Paperclip className="h-4 w-4" />Documents</span><Button size="sm" className="h-7 bg-emerald-600 text-xs text-white hover:bg-emerald-700">+ Save</Button></CardTitle></CardHeader><CardContent className="min-h-32 p-3"><Button variant="outline" size="sm"><Paperclip className="mr-1 h-3.5 w-3.5" />Browse</Button><p className="mt-4 text-center text-xs text-muted-foreground">No documents attached.</p></CardContent></Card>
          </aside>
        </div>
      ) : <Card><CardContent className="py-16 text-center text-muted-foreground">No radiology examinations are waiting for report entry.</CardContent></Card>}
    </div>
  );
}
