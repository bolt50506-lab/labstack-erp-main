'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CalendarClock, CheckCircle2, FileWarning } from 'lucide-react';
import { toast } from 'sonner';

type Doctor = { id: string; full_name: string; specialization: string | null };
type CompanyInfo = { name: string; logo_url: string | null } | null;

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function PublicBookingPage() {
  const params = useParams();
  const companyId = params.companyId as string;
  const supabase = getSupabaseClient();

  const [company, setCompany] = useState<CompanyInfo>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{ patient_code: string; appointment_date: string; appointment_time: string | null } | null>(null);

  const [form, setForm] = useState({ full_name: '', phone: '', doctor_id: '', appointment_date: todayStr(), appointment_time: '', reason: '' });

  useEffect(() => {
    (async () => {
      const { data: co } = await supabase.from('companies').select('name, logo_url').eq('id', companyId).maybeSingle();
      if (!co) { setNotFound(true); setLoading(false); return; }
      setCompany(co as CompanyInfo);
      const { data: docs } = await supabase.from('doctors').select('id, full_name, specialization').eq('company_id', companyId).eq('is_active', true).order('full_name');
      setDoctors((docs as Doctor[]) || []);
      setLoading(false);
    })();
  }, [supabase, companyId]);

  const handleSubmit = async () => {
    if (!form.full_name.trim() || !form.phone.trim() || !form.appointment_date) {
      toast.error('Name, phone, and date are required');
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc('book_appointment_public', {
      p_company_id: companyId,
      p_branch_id: null,
      p_full_name: form.full_name.trim(),
      p_phone: form.phone.trim(),
      p_doctor_id: form.doctor_id || null,
      p_department_id: null,
      p_appointment_date: form.appointment_date,
      p_appointment_time: form.appointment_time || null,
      p_reason: form.reason.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      // A patient shouldn't see a raw database error — the RPC's own
      // messages (name/phone/date required, invalid date) are already
      // written for a person, everything else falls back to something
      // they can act on.
      const friendly = /required|valid, upcoming date/i.test(error.message)
        ? error.message
        : "We couldn't submit your request right now. Please try again, or call us to book directly.";
      toast.error(friendly);
      return;
    }
    setConfirmation(data);
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;

  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center px-6">
        <FileWarning className="h-10 w-10 text-muted-foreground" />
        <p className="font-medium">This booking link is invalid.</p>
      </div>
    );
  }

  if (confirmation) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            <h2 className="text-lg font-semibold">Appointment Requested</h2>
            <p className="text-sm text-muted-foreground">
              We've received your request for {new Date(confirmation.appointment_date).toLocaleDateString('en-GB')}
              {confirmation.appointment_time ? ` at ${confirmation.appointment_time}` : ''}.
              Our staff will confirm it shortly — you may receive a call to verify.
            </p>
            <p className="text-xs text-muted-foreground">Reference code: <span className="font-mono">{confirmation.patient_code}</span></p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-10 px-4">
      <div className="mx-auto max-w-md">
        <div className="mb-4 flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold">{company?.name} — Book an Appointment</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Details</CardTitle>
            <CardDescription>A staff member will confirm your appointment before it's final</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>Full Name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Phone Number</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03XX-XXXXXXX" /></div>
            {doctors.length > 0 && (
              <div className="space-y-2">
                <Label>Preferred Doctor (optional)</Label>
                <Select value={form.doctor_id} onValueChange={(v) => setForm({ ...form, doctor_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Any doctor" /></SelectTrigger>
                  <SelectContent>{doctors.map(d => <SelectItem key={d.id} value={d.id}>{d.full_name}{d.specialization ? ` — ${d.specialization}` : ''}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Date</Label><Input type="date" min={todayStr()} value={form.appointment_date} onChange={(e) => setForm({ ...form, appointment_date: e.target.value })} /></div>
              <div className="space-y-2"><Label>Preferred Time (optional)</Label><Input type="time" value={form.appointment_time} onChange={(e) => setForm({ ...form, appointment_time: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Reason for Visit (optional)</Label><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} /></div>
            <Button className="w-full" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Request Appointment
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
