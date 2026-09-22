'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Printer, FileWarning } from 'lucide-react';
import { basePrintStyles, buildLabReportHtml } from '@/lib/utils/pdf';

type PublicReport = {
  order: { order_code: string; created_at: string };
  company: { name?: string; address?: string; city?: string; phone?: string; email?: string } | null;
  patient: { full_name?: string; patient_code?: string; gender?: string; age?: number; phone?: string } | null;
  doctor: { full_name?: string } | null;
  items: { service_name: string; category?: string; result_value?: string | null; unit?: string | null; normal_range?: string | null; flag?: string | null; remarks?: string | null; verifying_doctor?: string | null }[];
};

export default function PublicReportPortalPage() {
  const params = useParams();
  const token = params.token as string;
  const supabase = getSupabaseClient();
  const [data, setData] = useState<PublicReport | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Calls a SECURITY DEFINER function scoped to this exact token — no
      // login required, and no way to browse or guess other reports.
      const { data: result, error } = await supabase.rpc('get_public_report', { p_token: token });
      if (error || !result || !(result as PublicReport).order) {
        setNotFound(true);
      } else {
        setData(result as PublicReport);
      }
      setLoading(false);
    })();
  }, [supabase, token]);

  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading report...</div>;

  if (notFound || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center px-6">
        <FileWarning className="h-10 w-10 text-muted-foreground" />
        <p className="font-medium">This report link is invalid or has expired.</p>
        <p className="text-sm text-muted-foreground">Please contact the lab that sent you this link.</p>
      </div>
    );
  }

  const { bodyHtml } = buildLabReportHtml(data);

  return (
    <div className="min-h-screen bg-muted/30 py-8">
      <style dangerouslySetInnerHTML={{ __html: basePrintStyles }} />
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex justify-end px-2 print:hidden">
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print / Save as PDF
          </Button>
        </div>
        <div className="rounded-lg border bg-white p-8 shadow-sm" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      </div>
    </div>
  );
}
