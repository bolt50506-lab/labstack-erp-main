'use client';

import { useState, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, FileUp, Loader2, CheckCircle2, Download, FileDown } from 'lucide-react';
import { toast } from 'sonner';

export type ImportColumn = {
  key: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'number' | 'boolean';
  default?: any;
};

export type ImportExportConfig<T> = {
  table: string;
  entityName: string;
  columns: ImportColumn[];
  matchKey: string;
  buildPayload: (row: Record<string, string>, companyId: string) => Partial<T>;
  buildExportRow: (item: T) => Record<string, string | number>;
};

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += char; }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ',') { current.push(field); field = ''; }
      else if (char === '\n') { current.push(field); rows.push(current); current = []; field = ''; }
      else if (char !== '\r') { field += char; }
    }
  }
  if (field || current.length) { current.push(field); rows.push(current); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function ImportExportDialog<T extends { id: string }>({
  open,
  onOpenChange,
  config,
  existingData,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: ImportExportConfig<T>;
  existingData: T[];
  onImported: () => void;
}) {
  const supabase = getSupabaseClient();
  const { appUser } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [exporting, setExporting] = useState(false);

  const existingKeys = new Set(
    existingData.map((d) => String((d as any)[config.matchKey] ?? '').toLowerCase()).filter(Boolean),
  );

  const handleFile = async (file: File) => {
    setDone(false);
    setFileName(file.name);
    const text = await file.text();
    const csvRows = parseCSV(text);
    if (csvRows.length < 2) {
      toast.error('CSV must have a header row and at least one data row');
      return;
    }

    const headers = csvRows[0].map((h) => h.trim().toLowerCase());
    const headerIndex: Record<string, number> = {};
    headers.forEach((h, i) => { headerIndex[h] = i; });

    for (const col of config.columns) {
      if (col.required && headerIndex[col.key] === undefined) {
        toast.error(`CSV must have a "${col.key}" column`);
        return;
      }
    }

    const parsed: Record<string, string>[] = [];
    for (let i = 1; i < csvRows.length; i++) {
      const row: Record<string, string> = {};
      for (const col of config.columns) {
        const idx = headerIndex[col.key];
        row[col.key] = idx !== undefined ? (csvRows[i][idx] || '').trim() : '';
      }
      const hasAny = config.columns.some((c) => row[c.key]);
      if (hasAny) parsed.push(row);
    }
    setRows(parsed);
    if (parsed.length === 0) toast.error('No valid rows found');
    else toast.info(`${parsed.length} rows parsed`);
  };

  const handleImport = async () => {
    if (!appUser?.company_id || rows.length === 0) return;
    setImporting(true);
    let created = 0, updated = 0, errors = 0;

    for (const row of rows) {
      const payload = config.buildPayload(row, appUser.company_id);
      const keyValue = String(row[config.matchKey] ?? '').toLowerCase();

      if (existingKeys.has(keyValue)) {
        const { error } = await supabase
          .from(config.table)
          .update(payload)
          .eq(config.matchKey, row[config.matchKey])
          .eq('company_id', appUser.company_id);
        if (error) errors++;
        else updated++;
      } else {
        const { error } = await supabase.from(config.table).insert(payload);
        if (error) errors++;
        else created++;
      }
    }

    setImporting(false);
    setDone(true);
    toast.success(`Import complete: ${created} created, ${updated} updated${errors > 0 ? `, ${errors} errors` : ''}`);
    onImported();
  };

  const handleExport = () => {
    if (existingData.length === 0) {
      toast.error('No data to export');
      return;
    }
    setExporting(true);
    const headers = config.columns.map((c) => c.key);
    const dataLines = existingData.map((item) => {
      const row = config.buildExportRow(item);
      return config.columns.map((c) => {
        const val = row[c.key] ?? '';
        const str = String(val);
        return `"${str.replace(/"/g, '""')}"`;
      }).join(',');
    });
    const allLines = [headers.map((h) => `"${h}"`).join(','), ...dataLines];
    const csv = '\uFEFF' + allLines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.entityName.toLowerCase().replace(/\s+/g, '-')}-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
    toast.success(`Exported ${existingData.length} records`);
  };

  const handleDownloadTemplate = () => {
    const headers = config.columns.map((c) => c.key);
    const exampleRow = config.columns.map((c) => {
      if (c.type === 'number') return '0';
      if (c.type === 'boolean') return 'false';
      return c.default ?? '';
    });
    const lines = [headers.join(','), exampleRow.join(',')];
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.entityName.toLowerCase().replace(/\s+/g, '-')}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Template downloaded');
  };

  const handleClose = () => {
    setRows([]);
    setFileName('');
    setDone(false);
    if (fileRef.current) fileRef.current.value = '';
    onOpenChange(false);
  };

  const newCount = rows.filter((r) => !existingKeys.has(String(r[config.matchKey] ?? '').toLowerCase())).length;
  const updateCount = rows.length - newCount;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" /> Import / Export {config.entityName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || existingData.length === 0}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
              Export CSV ({existingData.length})
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDownloadTemplate}>
              <Download className="mr-2 h-4 w-4" />
              Download Template
            </Button>
          </div>

          <div className="rounded-lg border-2 border-dashed p-6 text-center">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-2">
              {fileName ? `Loaded: ${fileName}` : `Upload a CSV file to import ${config.entityName.toLowerCase()}`}
            </p>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              Choose CSV File
            </Button>
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <p className="font-medium mb-1">
              Required columns: <code className="text-xs">{config.columns.filter((c) => c.required).map((c) => c.key).join(', ')}</code>
            </p>
            <p className="text-muted-foreground">
              Optional: <code className="text-xs">{config.columns.filter((c) => !c.required).map((c) => c.key).join(', ')}</code>
            </p>
          </div>

          {rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Preview ({rows.length} rows)</p>
                <div className="flex gap-2">
                  <Badge variant="default">{newCount} new</Badge>
                  <Badge variant="secondary">{updateCount} updates</Badge>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Mode</TableHead>
                      {config.columns.slice(0, 5).map((c) => (
                        <TableHead key={c.key}>{c.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 100).map((row, i) => {
                      const isUpdate = existingKeys.has(String(row[config.matchKey] ?? '').toLowerCase());
                      return (
                        <TableRow key={i}>
                          <TableCell>
                            <Badge variant={isUpdate ? 'secondary' : 'default'}>
                              {isUpdate ? 'Update' : 'New'}
                            </Badge>
                          </TableCell>
                          {config.columns.slice(0, 5).map((c) => (
                            <TableCell key={c.key} className="text-sm">{row[c.key]}</TableCell>
                          ))}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {rows.length > 100 && <p className="p-2 text-center text-xs text-muted-foreground">Showing first 100 of {rows.length} rows</p>}
              </div>
            </div>
          )}

          {done && (
            <div className="flex items-center gap-2 rounded-lg bg-[hsl(var(--chart-1))]/10 p-3 text-sm text-[hsl(var(--chart-1))]">
              <CheckCircle2 className="h-4 w-4" />
              Import completed successfully. Close this dialog to see the updated list.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Close</Button>
          <Button onClick={handleImport} disabled={importing || rows.length === 0 || done}>
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {importing ? 'Importing...' : `Import ${rows.length} Rows`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
