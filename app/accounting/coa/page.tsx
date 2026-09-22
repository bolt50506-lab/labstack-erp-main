'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { FormDialog } from '@/components/shared/form-dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { ImportExportDialog, type ImportExportConfig } from '@/components/shared/import-export-dialog';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';
import {
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

type COA = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parent_id: string | null;
  is_group: boolean;
  opening_balance: number;
  current_balance: number;
  is_active: boolean;
};

type AccountForm = {
  code: string;
  name: string;
  type: AccountType;
  parent_id: string | null;
  is_group: boolean;
  opening_balance: number;
  current_balance: number;
  is_active: boolean;
};

const typeLabels: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Capital',
  revenue: 'Income',
  expense: 'Expenses',
};

const typeColors: Record<AccountType, string> = {
  asset: 'bg-sky-100 text-sky-800',
  liability: 'bg-amber-100 text-amber-800',
  equity: 'bg-emerald-100 text-emerald-800',
  revenue: 'bg-blue-100 text-blue-800',
  expense: 'bg-rose-100 text-rose-800',
};

const emptyForm: AccountForm = {
  code: '',
  name: '',
  type: 'asset',
  parent_id: null,
  is_group: false,
  opening_balance: 0,
  current_balance: 0,
  is_active: true,
};

const coaImportConfig: ImportExportConfig<COA> = {
  table: 'chart_of_accounts',
  entityName: 'Chart of Accounts',
  matchKey: 'code',
  columns: [
    { key: 'code', label: 'Code', required: true },
    { key: 'name', label: 'Name', required: true },
    { key: 'type', label: 'Type', default: 'asset' },
    { key: 'is_group', label: 'Is Group', type: 'boolean', default: 'false' },
    { key: 'opening_balance', label: 'Opening Balance', type: 'number', default: '0' },
    { key: 'current_balance', label: 'Current Balance', type: 'number', default: '0' },
    { key: 'is_active', label: 'Active', type: 'boolean', default: 'true' },
  ],
  buildPayload: (row, companyId) => ({
    company_id: companyId,
    code: row.code,
    name: row.name,
    type: (row.type || 'asset') as AccountType,
    parent_id: null,
    is_group: row.is_group === 'true' || row.is_group === '1',
    opening_balance: parseFloat(row.opening_balance) || 0,
    current_balance: parseFloat(row.current_balance) || 0,
    is_active: row.is_active !== 'false' && row.is_active !== '0',
  }),
  buildExportRow: (item) => ({
    code: item.code,
    name: item.name,
    type: item.type,
    is_group: item.is_group ? 'true' : 'false',
    opening_balance: item.opening_balance,
    current_balance: item.current_balance,
    is_active: item.is_active ? 'true' : 'false',
  }),
};

export default function AccountingCOAPage() {
  const supabase = getSupabaseClient();
  const { appUser } = useAuth();
  const [accounts, setAccounts] = useState<COA[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<COA | null>(null);
  const [form, setForm] = useState<AccountForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'main' | 'subclass' | 'account'>('account');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<COA | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('chart_of_accounts').select('*').order('code');
    if (error) toast.error('Failed to load accounts: ' + getFriendlyErrorMessage(error));
    else setAccounts((data as COA[]) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const accountsByParent = useMemo(() => {
    const groups = new Map<string | null, COA[]>();
    for (const account of accounts) {
      const siblings = groups.get(account.parent_id) ?? [];
      siblings.push(account);
      groups.set(account.parent_id, siblings);
    }
    groups.forEach((siblings) => siblings.sort((a: COA, b: COA) => a.code.localeCompare(b.code)));
    return groups;
  }, [accounts]);

  const visibleTypes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (Object.keys(typeLabels) as AccountType[]).filter((type) => {
      if (!query) return true;
      return accounts.some((account) => account.type === type && (account.code.toLowerCase().includes(query) || account.name.toLowerCase().includes(query)));
    });
  }, [accounts, search]);

  const selected = accounts.find((account) => account.id === selectedId) ?? null;
  const parentOptions = accounts.filter((account) => account.is_group && account.id !== editing?.id).sort((a, b) => a.code.localeCompare(b.code));

  const selectAccount = (account: COA) => {
    setSelectedId(account.id);
    setEditing(account);
    setForm({
      code: account.code,
      name: account.name,
      type: account.type,
      parent_id: account.parent_id,
      is_group: account.is_group,
      opening_balance: account.opening_balance ?? 0,
      current_balance: account.current_balance ?? 0,
      is_active: account.is_active,
    });
  };

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreate = (mode: 'main' | 'subclass' | 'account', parent?: COA) => {
    const type = parent?.type ?? selected?.type ?? 'asset';
    setEditing(null);
    setDialogMode(mode);
    setForm({ ...emptyForm, type, parent_id: mode === 'main' ? null : parent?.id ?? (selected?.is_group ? selected.id : selected?.parent_id ?? null), is_group: mode !== 'account' });
    setDialogOpen(true);
  };

  const handleDialogSubmit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Code and name are required');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.from('chart_of_accounts').insert({
      ...form,
      company_id: appUser?.company_id,
    }).select().maybeSingle();
    setSaving(false);
    if (error) {
      toast.error('Failed to create account: ' + getFriendlyErrorMessage(error));
      return;
    }
    toast.success(`${dialogMode === 'main' ? 'Main class' : dialogMode === 'subclass' ? 'Subclass' : 'Account'} created`);
    setDialogOpen(false);
    await loadData();
    if (data?.id) {
      setSelectedId(data.id);
      setExpanded((current) => {
        const next = new Set(current);
        if (data.parent_id) next.add(data.parent_id);
        next.add(data.id);
        return next;
      });
    }
  };

  const saveSelected = async () => {
    if (!editing || !form.code.trim() || !form.name.trim()) {
      toast.error('Code and name are required');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('chart_of_accounts').update(form).eq('id', editing.id);
    setSaving(false);
    if (error) toast.error('Failed to update account: ' + getFriendlyErrorMessage(error));
    else {
      toast.success('Account updated');
      await loadData();
    }
  };

  const deleteSelected = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('chart_of_accounts').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    setDeleteOpen(false);
    if (error) toast.error('Failed to delete account: ' + getFriendlyErrorMessage(error));
    else {
      toast.success('Account deleted');
      setDeleteTarget(null);
      setSelectedId(null);
      setEditing(null);
      await loadData();
    }
  };

  const renderAccount = (account: COA, depth: number) => {
    const children = accountsByParent.get(account.id) ?? [];
    const isOpen = expanded.has(account.id) || Boolean(search);
    const matchesSearch = !search || account.code.toLowerCase().includes(search.toLowerCase()) || account.name.toLowerCase().includes(search.toLowerCase());
    const childMatches = children.some((child) => child.code.toLowerCase().includes(search.toLowerCase()) || child.name.toLowerCase().includes(search.toLowerCase()));
    if (!matchesSearch && !childMatches) return null;

    return (
      <div key={account.id}>
        <button
          type="button"
          onClick={() => selectAccount(account)}
          className={`group flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left text-sm transition-colors ${selectedId === account.id ? 'bg-sky-500 text-white' : 'text-foreground hover:bg-muted/70'}`}
          style={{ paddingLeft: `${12 + depth * 24}px` }}
        >
          {children.length > 0 ? (
            <span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); toggleExpanded(account.id); }} className="shrink-0">
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
          ) : <span className="w-4 shrink-0" />}
          {account.is_group ? <Folder className="h-4 w-4 shrink-0" /> : <FileText className="h-4 w-4 shrink-0" />}
          <span className="min-w-0 flex-1 truncate"><span className="font-mono text-xs opacity-80">{account.code}</span> {account.name}</span>
          {account.is_group && <Badge className={selectedId === account.id ? 'bg-white/20 text-white' : typeColors[account.type]}>{account.type}</Badge>}
        </button>
        {isOpen && children.map((child) => renderAccount(child, depth + 1))}
      </div>
    );
  };

  const renderFormFields = () => (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label>Code *</Label><Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="1001" /></div>
        <div className="space-y-2"><Label>Title *</Label><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Cash in Hand" /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label>Account Class *</Label><Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value as AccountType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(typeLabels) as AccountType[]).map((type) => <SelectItem key={type} value={type}>{typeLabels[type]}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label>Parent Class</Label><Select value={form.parent_id ?? 'none'} onValueChange={(value) => setForm({ ...form, parent_id: value === 'none' ? null : value })}><SelectTrigger><SelectValue placeholder="Top level" /></SelectTrigger><SelectContent><SelectItem value="none">Top level</SelectItem>{parentOptions.map((parent) => <SelectItem key={parent.id} value={parent.id}>{parent.code} - {parent.name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Opening Balance</Label><Input type="number" value={form.opening_balance} onChange={(event) => setForm({ ...form, opening_balance: Number(event.target.value) || 0 })} /></div><div className="space-y-2"><Label>Current Balance</Label><Input type="number" value={form.current_balance} onChange={(event) => setForm({ ...form, current_balance: Number(event.target.value) || 0 })} /></div></div>
      <div className="flex flex-wrap gap-6"><label className="flex items-center gap-2 text-sm"><Switch checked={form.is_group} onCheckedChange={(checked) => setForm({ ...form, is_group: checked })} /> Main / group account</label><label className="flex items-center gap-2 text-sm"><Switch checked={form.is_active} onCheckedChange={(checked) => setForm({ ...form, is_active: checked })} /> Active</label></div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div><h1 className="text-2xl font-bold">Chart of Accounts</h1><p className="text-muted-foreground">Organize main classes, subclasses, and ledger accounts</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button><Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="mr-2 h-4 w-4" />Import</Button><Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Download className="mr-2 h-4 w-4" />Export</Button><Button variant="outline" size="sm" onClick={loadData}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button><Button variant="destructive" size="sm" disabled={!selected} onClick={() => { if (selected) { setDeleteTarget(selected); setDeleteOpen(true); } }}><Trash2 className="mr-2 h-4 w-4" />Delete</Button><Button size="sm" onClick={() => openCreate('main')}><Plus className="mr-2 h-4 w-4" />Add Main Class</Button></div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.6fr)]">
        <Card className="overflow-hidden"><CardHeader className="border-b bg-muted/30 pb-4"><div className="flex items-center justify-between gap-3"><CardTitle className="text-base">Account Classes</CardTitle><Button size="sm" variant="outline" onClick={() => openCreate('account')}><FilePlus2 className="mr-2 h-4 w-4" />Account</Button></div><div className="relative mt-3"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search accounts..." className="pl-9" /></div></CardHeader><CardContent className="p-0"><div className="max-h-[620px] overflow-y-auto">{loading ? <div className="p-8 text-center text-sm text-muted-foreground">Loading accounts...</div> : visibleTypes.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No accounts found</div> : visibleTypes.map((type) => { const roots = (accountsByParent.get(null) ?? []).filter((account) => account.type === type); return <div key={type}><div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-xs font-bold uppercase tracking-wide"><span>{typeLabels[type]}</span><span className="text-muted-foreground">{type.toUpperCase()}</span></div>{roots.length === 0 ? <div className="px-6 py-2 text-xs text-muted-foreground">No main classes yet</div> : roots.map((root) => renderAccount(root, 0))}</div>; })}</div></CardContent></Card>

        <Card className="min-h-[420px]"><CardHeader className="border-b"><div className="flex items-center justify-between"><CardTitle className="text-base">{selected ? `${selected.code} — ${selected.name}` : 'Account Configuration'}</CardTitle>{selected && <Badge variant={selected.is_active ? 'default' : 'secondary'}>{selected.is_active ? 'Active' : 'Inactive'}</Badge>}</div></CardHeader><CardContent className="p-6">{selected ? <div className="space-y-6">{renderFormFields()}<div className="flex flex-wrap gap-2 border-t pt-5"><Button onClick={saveSelected} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>{selected.is_group && <Button variant="outline" onClick={() => openCreate('subclass', selected)}><FolderPlus className="mr-2 h-4 w-4" />Add Subclass</Button>}<Button variant="outline" onClick={() => openCreate('account', selected)}><FilePlus2 className="mr-2 h-4 w-4" />Add Child Account</Button></div></div> : <div className="flex h-80 flex-col items-center justify-center text-center text-muted-foreground"><Folder className="mb-4 h-12 w-12 opacity-30" /><p className="font-medium">Select an account class to configure it</p><p className="mt-1 text-sm">Choose a main class or ledger account from the tree, or create a new one.</p><div className="mt-5 flex gap-2"><Button onClick={() => openCreate('main')}><Plus className="mr-2 h-4 w-4" />Add Main Class</Button></div></div>}</CardContent></Card>
      </div>

      <FormDialog open={dialogOpen} onOpenChange={setDialogOpen} title={dialogMode === 'main' ? 'Add Main Class' : dialogMode === 'subclass' ? 'Add Subclass' : 'Add Ledger Account'} onSubmit={handleDialogSubmit} submitting={saving}>{renderFormFields()}</FormDialog>
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete Account" description={`Are you sure you want to delete ${deleteTarget?.name}? Child accounts will be detached.`} onConfirm={deleteSelected} confirmLabel="Delete" destructive submitting={deleting} />
      <ImportExportDialog open={importOpen} onOpenChange={setImportOpen} config={coaImportConfig} existingData={accounts} onImported={loadData} />
    </div>
  );
}
