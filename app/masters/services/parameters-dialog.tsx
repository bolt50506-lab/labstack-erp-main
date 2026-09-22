'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Service, TestParameter } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

type Row = {
  id: string | null;
  name: string;
  unit: string;
  normal_range: string;
  low_critical: string;
  high_critical: string;
  display_order: number;
  analyzer_code: string;
};

const toRow = (p: TestParameter, i: number): Row => ({
  id: p.id,
  name: p.name,
  unit: p.unit ?? '',
  normal_range: p.normal_range ?? '',
  low_critical: p.low_critical != null ? String(p.low_critical) : '',
  high_critical: p.high_critical != null ? String(p.high_critical) : '',
  display_order: p.display_order ?? i,
  analyzer_code: p.analyzer_code ?? '',
});

const emptyRow = (order: number): Row => ({
  id: null, name: '', unit: '', normal_range: '', low_critical: '', high_critical: '', display_order: order, analyzer_code: '',
});

export function ParametersDialog({ service, open, onOpenChange }: { service: Service | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const supabase = getSupabaseClient();
  const { appUser } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    const { data, error } = await supabase.from('test_parameters').select('*').eq('service_id', service.id).order('display_order');
    if (error) toast.error('Failed to load parameters: ' + getFriendlyErrorMessage(error));
    setRows(((data as TestParameter[]) || []).map(toRow));
    setLoading(false);
  }, [supabase, service]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const addRow = () => setRows(prev => [...prev, emptyRow(prev.length)]);
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: keyof Row, value: string) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));

  const save = async () => {
    if (!service) return;
    const named = rows.filter(r => r.name.trim());
    const invalid = named.some(r => {
      const lo = r.low_critical.trim() ? parseFloat(r.low_critical) : null;
      const hi = r.high_critical.trim() ? parseFloat(r.high_critical) : null;
      return (r.low_critical.trim() && Number.isNaN(lo)) || (r.high_critical.trim() && Number.isNaN(hi)) || (lo != null && hi != null && lo > hi);
    });
    if (invalid) { toast.error('Critical values must be numbers, and low critical cannot exceed high critical'); return; }

    setSaving(true);
    const existingIds = named.filter(r => r.id).map(r => r.id as string);
    // Remove parameters that were deleted from the list
    const { data: current } = await supabase.from('test_parameters').select('id').eq('service_id', service.id);
    const toDelete = ((current as { id: string }[]) || []).map(c => c.id).filter(id => !existingIds.includes(id));
    if (toDelete.length > 0) await supabase.from('test_parameters').delete().in('id', toDelete);

    for (let i = 0; i < named.length; i++) {
      const r = named[i];
      const payload = {
        company_id: appUser?.company_id,
        service_id: service.id,
        name: r.name.trim(),
        unit: r.unit.trim() || null,
        normal_range: r.normal_range.trim() || null,
        low_critical: r.low_critical.trim() ? parseFloat(r.low_critical) : null,
        high_critical: r.high_critical.trim() ? parseFloat(r.high_critical) : null,
        display_order: i,
        is_active: true,
        analyzer_code: r.analyzer_code.trim() || null,
      };
      if (r.id) {
        await supabase.from('test_parameters').update(payload).eq('id', r.id);
      } else {
        await supabase.from('test_parameters').insert(payload);
      }
    }
    setSaving(false);
    toast.success('Reference values saved');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Reference values — {service?.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Leave empty for a single-value test (its reference range is set on the service itself).
          Add rows here for panel tests with multiple parameters (e.g. CBC, LFTs) — these drive
          the automatic Normal / Low / High / Critical flag during report entry.
        </p>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parameter</TableHead>
                  <TableHead className="w-24">Unit</TableHead>
                  <TableHead className="w-36">Reference range</TableHead>
                  <TableHead className="w-28">Low critical</TableHead>
                  <TableHead className="w-28">High critical</TableHead>
                  <TableHead className="w-28">Analyzer code</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell><Input value={r.name} onChange={e => updateRow(i, 'name', e.target.value)} placeholder="Hemoglobin" className="h-8" /></TableCell>
                    <TableCell><Input value={r.unit} onChange={e => updateRow(i, 'unit', e.target.value)} placeholder="g/dL" className="h-8" /></TableCell>
                    <TableCell><Input value={r.normal_range} onChange={e => updateRow(i, 'normal_range', e.target.value)} placeholder="13.0 - 17.0" className="h-8" /></TableCell>
                    <TableCell><Input value={r.low_critical} onChange={e => updateRow(i, 'low_critical', e.target.value)} placeholder="optional" className="h-8" /></TableCell>
                    <TableCell><Input value={r.high_critical} onChange={e => updateRow(i, 'high_critical', e.target.value)} placeholder="optional" className="h-8" /></TableCell>
                    <TableCell><Input value={r.analyzer_code} onChange={e => updateRow(i, 'analyzer_code', e.target.value)} placeholder="e.g. HGB" className="h-8" /></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => removeRow(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="p-2">
              <Button variant="outline" size="sm" onClick={addRow}><Plus className="mr-1 h-3.5 w-3.5" /> Add parameter</Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
