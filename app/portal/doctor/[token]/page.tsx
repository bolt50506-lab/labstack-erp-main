'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileWarning, FileText, DollarSign, Stethoscope, TestTube, ExternalLink } from 'lucide-react';

type PortalData = {
  doctor: { full_name: string; specialization: string | null };
  reports: { order_code: string; created_at: string; patient_name: string; public_token: string }[];
  commission: { total: number; settled: number; unsettled: number; recent: { service_name: string; share_amount: number; settled: boolean; created_at: string; doctor_type: string }[] };
};

const roleLabel: Record<string, string> = { performing_doctor: 'Performing', opd_doctor: 'Consultant' };

export default function DoctorPortalPage() {
  const params = useParams();
  const token = params.token as string;
  const supabase = getSupabaseClient();
  const [data, setData] = useState<PortalData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: result, error } = await supabase.rpc('get_doctor_portal_data', { p_token: token });
      if (error || !result) setNotFound(true);
      else setData(result as PortalData);
      setLoading(false);
    })();
  }, [supabase, token]);

  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;

  if (notFound || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center px-6">
        <FileWarning className="h-10 w-10 text-muted-foreground" />
        <p className="font-medium">This portal link is invalid.</p>
        <p className="text-sm text-muted-foreground">Please contact the lab for a new link.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="text-xl font-bold">{data.doctor.full_name}</h1>
          {data.doctor.specialization && <p className="text-sm text-muted-foreground">{data.doctor.specialization}</p>}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Total Commission</p><p className="text-lg font-bold">Rs {Number(data.commission.total).toLocaleString()}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Settled</p><p className="text-lg font-bold text-emerald-600">Rs {Number(data.commission.settled).toLocaleString()}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Unsettled</p><p className="text-lg font-bold text-amber-600">Rs {Number(data.commission.unsettled).toLocaleString()}</p></CardContent></Card>
        </div>

        <Tabs defaultValue="reports">
          <TabsList>
            <TabsTrigger value="reports"><FileText className="mr-1.5 h-3.5 w-3.5" />My Patients' Reports</TabsTrigger>
            <TabsTrigger value="commission"><DollarSign className="mr-1.5 h-3.5 w-3.5" />Commission Statement</TabsTrigger>
          </TabsList>

          <TabsContent value="reports" className="mt-3">
            <Card>
              <CardContent className="divide-y p-0">
                {data.reports.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">No finalized reports yet.</p>
                ) : data.reports.map((r) => (
                  <a key={r.order_code} href={`/portal/report/${r.public_token}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50">
                    <div><p className="font-medium">{r.patient_name}</p><p className="text-xs text-muted-foreground">{r.order_code} &middot; {new Date(r.created_at).toLocaleDateString('en-GB')}</p></div>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="commission" className="mt-3">
            <Card>
              <CardContent className="divide-y p-0">
                {data.commission.recent.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">No commission transactions yet.</p>
                ) : data.commission.recent.map((c, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium">{c.service_name}</p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {c.doctor_type === 'opd_doctor' ? <Stethoscope className="h-3 w-3" /> : <TestTube className="h-3 w-3" />}
                        {roleLabel[c.doctor_type] ?? c.doctor_type} &middot; {new Date(c.created_at).toLocaleDateString('en-GB')}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">Rs {Number(c.share_amount).toLocaleString()}</p>
                      <Badge variant={c.settled ? 'default' : 'secondary'} className="text-[10px]">{c.settled ? 'Settled' : 'Unsettled'}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
