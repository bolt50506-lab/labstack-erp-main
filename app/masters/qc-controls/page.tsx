'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { DataTable, type Column } from '@/components/shared/data-table';
import { FormDialog } from '@/components/shared/form-dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import type { QcControl, Service } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

const emptyControl = { service_id: '', test_parameter_id: null, name: '', level: 'Level 1', lot_number: '', unit: '', target_mean: 0, target_sd: 0, expiry_date: '', is_active: true };

export default function QcControlsPage() {
  const supabase = getSupabaseClient();
  const { appUser } = useAuth();
  const [controls, setControls] = useState<QcControl[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<QcControl | null>(null);
  const [form, setForm] = useState<any>(emptyControl);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<QcControl | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [cRes, sRes] = await Promise.all([
      supabase.from('qc_controls').select('*, service:services(name)').order('name'),
      supabase.from('services').select('*').eq('category', 'lab').eq('is_active', true).order('name'),
    ]);
    if (cRes.error) toast.error(getFriendlyErrorMessage(cRes.error));
    setControls((cRes.data as any) || []);
    setServices((sRes.data as Service[]) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAdd = () => { setEditing(null); setForm(emptyControl); setDialogOpen(true); };
  const handleEdit = (c: QcControl) => {
    setEditing(c);
    setForm({ ...c, expiry_date: c.expiry_date ?? '' });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.service_id || !appUser?.company_id) {
      toast.error('Name and linked test are required');
      return;
    }
    const payload = {
      company_id: appUser.company_id,
      branch_id: appUser.branch_id,
      service_id: form.service_id,
      test_parameter_id: form.test_parameter_id || null,
      name: form.name.trim(),
      level: form.level,
      lot_number: form.lot_number || null,
      unit: form.unit || null,
      target_mean: Number(form.target_mean),
      target_sd: Number(form.target_sd),
      expiry_date: form.expiry_date || null,
      is_active: form.is_active,
    };
    const { error } = editing
      ? await supabase.from('qc_controls').update(payload).eq('id', editing.id)
      : await supabase.from('qc_controls').insert(payload);
    if (error) { toast.error(getFriendlyErrorMessage(error)); return; }
    toast.success(editing ? 'Control updated' : 'Control added');
    setDialogOpen(false);
    loadData();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from('qc_controls').delete().eq('id', deleteTarget.id);
    if (error) toast.error(getFriendlyErrorMessage(error));
    else { toast.success('Control removed'); loadData(); }
    setDeleteOpen(false);
  };

  const columns: Column<QcControl>[] = [
    { key: 'name', label: 'Control Name', render: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'level', label: 'Level' },
    { key: 'service', label: 'Test', render: (c: any) => c.service?.name ?? '-' },
    { key: 'lot_number', label: 'Lot #' },
    { key: 'target', label: 'Target', render: (c) => `${c.target_mean} ± ${c.target_sd} ${c.unit ?? ''}` },
    { key: 'expiry_date', label: 'Expiry', render: (c) => c.expiry_date ? new Date(c.expiry_date).toLocaleDateString('en-GB') : '-' },
    { key: 'is_active', label: 'Status', render: (c) => <Badge variant={c.is_active ? 'default' : 'secondary'}>{c.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'actions', label: 'Actions', render: (c) => (
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleEdit(c); }}>Edit</Button>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); setDeleteOpen(true); }}>Delete</Button>
      </div>
    ) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">QC Controls</h1>
          <p className="text-muted-foreground">Define control materials with their target mean/SD, used for daily QC runs</p>
        </div>
        <Button onClick={handleAdd}>Add Control</Button>
      </div>

      <DataTable columns={columns} data={controls} loading={loading} searchPlaceholder="Search controls..." />

      <FormDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editing ? 'Edit Control' : 'Add Control'} onSubmit={handleSubmit} submitLabel={editing ? 'Save' : 'Add'}>
        <div className="space-y-4">
          <div className="space-y-2"><Label>Control Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bio-Rad Liquichek Level 1" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Level</Label>
              <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Level 1">Level 1 (Low)</SelectItem><SelectItem value="Level 2">Level 2 (Normal)</SelectItem><SelectItem value="Level 3">Level 3 (High)</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Lot Number</Label><Input value={form.lot_number} onChange={(e) => setForm({ ...form, lot_number: e.target.value })} /></div>
          </div>
          <div className="space-y-2">
            <Label>Linked Test</Label>
            <Select value={form.service_id} onValueChange={(v) => setForm({ ...form, service_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select test..." /></SelectTrigger>
              <SelectContent>{services.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Target Mean</Label><Input type="number" value={form.target_mean} onChange={(e) => setForm({ ...form, target_mean: e.target.value })} /></div>
            <div className="space-y-2"><Label>Target SD</Label><Input type="number" value={form.target_sd} onChange={(e) => setForm({ ...form, target_sd: e.target.value })} /></div>
            <div className="space-y-2"><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
          </div>
          <div className="space-y-2"><Label>Expiry Date</Label><Input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></div>
          <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} /></div>
        </div>
      </FormDialog>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete Control" description={`Remove ${deleteTarget?.name}? Its QC history will remain but won't be addable to anymore.`} onConfirm={handleDelete} />
    </div>
  );
}
