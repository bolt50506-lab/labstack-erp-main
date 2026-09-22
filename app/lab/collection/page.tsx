'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { TestTube, CheckCircle2, ScanLine } from 'lucide-react';
import type { LabOrder, LabOrderItem, Patient } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

export default function LabCollectionPage() {
  const supabase = getSupabaseClient();
  const { appUser } = useAuth();
  const [items, setItems] = useState<(LabOrderItem & { order?: LabOrder; patient?: Patient })[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanValue, setScanValue] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('lab_order_items')
      .select('*, order:lab_orders(*, patient:patients(*)), service:services(category)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) {
      toast.error('Failed to load: ' + getFriendlyErrorMessage(error));
    } else {
      setItems(((data as any) || []).filter((i: any) => i.service?.category === 'lab'));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const markCollected = async (item: LabOrderItem, sampleId: string) => {
    const { error } = await supabase
      .from('lab_order_items')
      .update({
        status: 'sample_collected',
        sample_id: sampleId,
        collected_at: new Date().toISOString(),
        collected_by: appUser?.id ?? null,
      })
      .eq('id', item.id);
    if (error) {
      toast.error('Failed: ' + getFriendlyErrorMessage(error));
    } else {
      toast.success(`Sample collected: ${sampleId}`);
      loadData();
    }
  };

  // Manual fallback for a walk-up sample with no pre-printed label — a
  // sample ID gets generated on the spot rather than left blank.
  const handleCollect = (item: LabOrderItem) => {
    markCollected(item, item.sample_id || `S-${Date.now().toString().slice(-6)}`);
  };

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanValue.trim();
    setScanValue('');
    if (!code) return;
    // Matches the exact sample_id printed on the label (see
    // /reception/barcode) — a scanner types the code + Enter, which
    // this form submit handles the same as a manual paste. Focus
    // returns to the input either way, so a tech can keep scanning
    // tube after tube without touching the mouse even when one
    // doesn't match.
    const match = items.find((i) => i.sample_id === code);
    if (!match) {
      toast.error(`No pending sample matches "${code}"`);
      scanInputRef.current?.focus();
      return;
    }
    markCollected(match, code);
    scanInputRef.current?.focus();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sample Collection</h1>
        <p className="text-muted-foreground">Collect samples for pending lab tests</p>
      </div>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="flex items-center gap-2 text-base"><ScanLine className="h-4 w-4" /> Scan to Collect</CardTitle>
          <CardDescription>Scan the barcode label printed at registration — a USB/Bluetooth scanner types the code and presses Enter automatically</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <form onSubmit={handleScanSubmit} className="flex gap-2">
            <Input ref={scanInputRef} autoFocus value={scanValue} onChange={(e) => setScanValue(e.target.value)} placeholder="Scan or type sample ID..." className="font-mono" />
            <Button type="submit"><ScanLine className="mr-1 h-3.5 w-3.5" />Match</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Test</TableHead>
                <TableHead>Sample Type</TableHead>
                <TableHead>Sample ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No pending samples</TableCell></TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-sm">{item.order?.order_code}</TableCell>
                    <TableCell>{item.order?.patient?.full_name}</TableCell>
                    <TableCell>{item.service_name}</TableCell>
                    <TableCell>{item.service?.sample_type ?? '-'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.sample_id ?? 'Not labeled yet'}</TableCell>
                    <TableCell><Badge variant="secondary">Pending</Badge></TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => handleCollect(item)}>
                        <TestTube className="mr-1 h-3 w-3" />
                        Collect Manually
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
