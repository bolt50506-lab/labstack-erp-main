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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Copy, Key, Activity } from 'lucide-react';
import type { Analyzer, AnalyzerResultLog } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

const emptyAnalyzer = { name: '', code: '', manufacturer: '', is_active: true };

export default function AnalyzersPage() {
  const supabase = getSupabaseClient();
  const { appUser } = useAuth();
  const [analyzers, setAnalyzers] = useState<Analyzer[]>([]);
  const [logs, setLogs] = useState<AnalyzerResultLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyAnalyzer);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Analyzer | null>(null);
  const [newKey, setNewKey] = useState<{ analyzerName: string; key: string } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [aRes, lRes] = await Promise.all([
      supabase.from('analyzers').select('id, company_id, branch_id, name, code, manufacturer, api_key_prefix, is_active, last_seen_at, created_at, updated_at').order('name'),
      supabase.from('analyzer_result_logs').select('*, analyzer:analyzers(name)').order('created_at', { ascending: false }).limit(30),
    ]);
    if (aRes.error) toast.error(getFriendlyErrorMessage(aRes.error));
    setAnalyzers((aRes.data as Analyzer[]) || []);
    setLogs((lRes.data as AnalyzerResultLog[]) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAdd = () => { setForm(emptyAnalyzer); setDialogOpen(true); };

  const generateApiKey = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return 'ak_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  };

  const sha256Hex = async (text: string) => {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.code.trim() || !appUser?.company_id) {
      toast.error('Name and code are required');
      return;
    }
    const rawKey = generateApiKey();
    const keyHash = await sha256Hex(rawKey);
    const { error } = await supabase.from('analyzers').insert({
      company_id: appUser.company_id,
      branch_id: appUser.branch_id,
      name: form.name.trim(),
      code: form.code.trim(),
      manufacturer: form.manufacturer.trim() || null,
      api_key_hash: keyHash,
      api_key_prefix: rawKey.slice(0, 10),
      is_active: form.is_active,
    });
    if (error) { toast.error(getFriendlyErrorMessage(error)); return; }
    setDialogOpen(false);
    setNewKey({ analyzerName: form.name.trim(), key: rawKey });
    loadData();
  };

  const handleToggleActive = async (a: Analyzer) => {
    const { error } = await supabase.from('analyzers').update({ is_active: !a.is_active }).eq('id', a.id);
    if (error) toast.error(getFriendlyErrorMessage(error));
    else { toast.success(a.is_active ? 'Analyzer deactivated' : 'Analyzer activated'); loadData(); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from('analyzers').delete().eq('id', deleteTarget.id);
    if (error) toast.error(getFriendlyErrorMessage(error));
    else { toast.success('Analyzer removed'); loadData(); }
    setDeleteOpen(false);
  };

  const copyIngestUrl = () => {
    navigator.clipboard.writeText(`${window.location.origin}/api/hl7/ingest`);
    toast.success('Ingestion URL copied');
  };

  const columns: Column<Analyzer>[] = [
    { key: 'name', label: 'Name', render: (a) => <span className="font-medium">{a.name}</span> },
    { key: 'code', label: 'Code' },
    { key: 'manufacturer', label: 'Manufacturer', render: (a) => a.manufacturer ?? '-' },
    { key: 'api_key_prefix', label: 'API Key', render: (a) => <span className="font-mono text-xs">{a.api_key_prefix}...</span> },
    { key: 'last_seen_at', label: 'Last Seen', render: (a) => a.last_seen_at ? new Date(a.last_seen_at).toLocaleString('en-GB') : 'Never' },
    { key: 'is_active', label: 'Status', render: (a) => <Badge variant={a.is_active ? 'default' : 'secondary'}>{a.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'actions', label: 'Actions', render: (a) => (
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleToggleActive(a); }}>
          {a.is_active ? 'Deactivate' : 'Activate'}
        </Button>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(a); setDeleteOpen(true); }}>Delete</Button>
      </div>
    ) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Lab Analyzers</h1>
          <p className="text-muted-foreground">Register machines that push results in via HL7 — each gets its own API key</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={copyIngestUrl}><Copy className="mr-2 h-4 w-4" /> Copy Ingestion URL</Button>
          <Button onClick={handleAdd}><Key className="mr-2 h-4 w-4" /> Register Analyzer</Button>
        </div>
      </div>

      <div className="rounded-md border bg-amber-50 border-amber-200 p-3 text-sm text-amber-800">
        This endpoint accepts HTTPS POST with a raw HL7 ORU^R01 message body — it does not speak raw MLLP/TCP or serial directly (this app is deployed serverless, which cannot hold that kind of socket open). A small on-site bridge or a tool like Mirth Connect is needed to relay from the analyzer's native output to this URL.
      </div>

      <DataTable columns={columns} data={analyzers} loading={loading} searchPlaceholder="Search analyzers..." />

      <div>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Activity className="h-4 w-4" /> Recent Ingestion Log</h2>
        <div className="rounded-md border divide-y">
          {logs.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No results received yet.</p>
          ) : logs.map((log) => (
            <div key={log.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div>
                <span className="font-medium">{log.analyzer?.name ?? 'Unknown analyzer'}</span>
                <span className="ml-2 text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString('en-GB')}</span>
                {log.error_message && <p className="text-xs text-muted-foreground">{log.error_message}</p>}
              </div>
              <Badge variant={log.status === 'matched' ? 'default' : log.status === 'error' ? 'destructive' : 'secondary'}>{log.status}</Badge>
            </div>
          ))}
        </div>
      </div>

      <FormDialog open={dialogOpen} onOpenChange={setDialogOpen} title="Register Analyzer" onSubmit={handleSubmit} submitLabel="Register & Generate Key">
        <div className="space-y-4">
          <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sysmex XN-1000" /></div>
          <div className="space-y-2"><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SYSMEX-1" /></div>
          <div className="space-y-2"><Label>Manufacturer</Label><Input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></div>
          <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} /></div>
        </div>
      </FormDialog>

      <Dialog open={!!newKey} onOpenChange={() => setNewKey(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>API Key for {newKey?.analyzerName}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Copy this now — it won't be shown again. Configure it in the bridge/relay software that talks to this machine, sent as the <code>X-Api-Key</code> header.</p>
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3 font-mono text-sm">
            {newKey?.key}
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { if (newKey) { navigator.clipboard.writeText(newKey.key); toast.success('Key copied'); } }}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <DialogFooter><Button onClick={() => setNewKey(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Analyzer"
        description={`Remove ${deleteTarget?.name}? Its API key will stop working immediately.`}
        onConfirm={handleDelete}
      />
    </div>
  );
}
