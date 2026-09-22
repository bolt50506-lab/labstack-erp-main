'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Search, X, Plus, Loader2, Printer, Check, UserPlus, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import type { Patient, Doctor, ReferralSource, Service, CorporateClient, PanelRate } from '@/lib/types';
import { computeDoctorShare, computeReferralShare, findMatchingRule, computeDoctorShareFromRule, type ShareRule } from '@/lib/utils/shares';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

type LineItem = {
  tempId: string;
  service: Service;
  consultantDoctorId: string;
  performingDoctorId: string;
  reportDueAt: string;
  discount: string;
  isUrgent: boolean;
};

const emptyPatientForm = {
  full_name: '', gender: 'male', date_of_birth: '', age: '', phone: '', cnic: '',
  email: '', blood_group: '', address: '', city: '',
};

export default function PatientEntryPage() {
  const router = useRouter();
  const supabase = getSupabaseClient();
  const { appUser } = useAuth();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [referrals, setReferrals] = useState<ReferralSource[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [corporates, setCorporates] = useState<CorporateClient[]>([]);
  const [shareRules, setShareRules] = useState<ShareRule[]>([]);
  const [panelRates, setPanelRates] = useState<Record<string, number>>({});

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientDialogOpen, setPatientDialogOpen] = useState(false);
  const [patientForm, setPatientForm] = useState(emptyPatientForm);
  const [savingPatient, setSavingPatient] = useState(false);

  const [selectedCorporate, setSelectedCorporate] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  const [refSearch, setRefSearch] = useState('');
  const [selectedReferral, setSelectedReferral] = useState('');
  const [refNo, setRefNo] = useState('');
  const [internalRemarks, setInternalRemarks] = useState('');
  const [patientComments, setPatientComments] = useState('');
  const [restrictFinalReport, setRestrictFinalReport] = useState(false);

  const [percentDiscount, setPercentDiscount] = useState('0');
  const [fixedDiscount, setFixedDiscount] = useState('0');
  const [paid, setPaid] = useState('0');
  const [paymentMode, setPaymentMode] = useState<'cash' | 'online' | 'card'>('cash');
  const [patientType, setPatientType] = useState('regular');

  const [submitting, setSubmitting] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState('');

  const loadData = useCallback(async () => {
    const [pRes, dRes, rRes, sRes, cRes, srRes] = await Promise.all([
      supabase.from('patients').select('*').order('full_name'),
      supabase.from('doctors').select('*').eq('is_active', true).order('full_name'),
      supabase.from('referral_sources').select('*').eq('is_active', true).order('name'),
      supabase.from('services').select('*').eq('is_active', true).order('name'),
      supabase.from('corporate_clients').select('*').eq('is_active', true).order('name'),
      supabase.from('share_rules').select('*').eq('is_active', true).order('priority', { ascending: false }),
    ]);
    setPatients((pRes.data as Patient[]) || []);
    setDoctors((dRes.data as Doctor[]) || []);
    setReferrals((rRes.data as ReferralSource[]) || []);
    setServices((sRes.data as Service[]) || []);
    setCorporates((cRes.data as CorporateClient[]) || []);
    setShareRules((srRes.data as ShareRule[]) || []);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!selectedCorporate) { setPanelRates({}); return; }
    (async () => {
      const { data } = await supabase.from('panel_rates').select('service_id, panel_price').eq('corporate_client_id', selectedCorporate);
      const map: Record<string, number> = {};
      for (const r of (data as PanelRate[]) || []) map[r.service_id] = Number(r.panel_price);
      setPanelRates(map);
    })();
  }, [supabase, selectedCorporate]);

  const priceFor = (s: Service) => selectedCorporate && panelRates[s.id] != null ? panelRates[s.id] : Number(s.price);

  const patientResults = useMemo(() => {
    if (!patientSearch.trim()) return [];
    const q = patientSearch.toLowerCase();
    return patients.filter(p =>
      p.full_name.toLowerCase().includes(q) ||
      p.patient_code.toLowerCase().includes(q) ||
      (p.phone ?? '').includes(q) ||
      (p.cnic ?? '').includes(q)
    ).slice(0, 8);
  }, [patients, patientSearch]);

  const filteredServices = useMemo(() => {
    if (!serviceSearch.trim()) return [];
    const q = serviceSearch.toLowerCase();
    return services
      .filter(s => !lineItems.some(li => li.service.id === s.id))
      .filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || (s.short_name ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [services, serviceSearch, lineItems]);

  const refResults = useMemo(() => {
    if (!refSearch.trim()) return [];
    const q = refSearch.toLowerCase();
    return referrals.filter(r => r.name.toLowerCase().includes(q)).slice(0, 8);
  }, [referrals, refSearch]);

  const addService = (svc: Service) => {
    setLineItems(prev => [...prev, {
      tempId: `${svc.id}-${Date.now()}`,
      service: svc,
      consultantDoctorId: '',
      performingDoctorId: '',
      reportDueAt: '',
      discount: '0',
      isUrgent: false,
    }]);
    setServiceSearch('');
  };

  const removeLine = (tempId: string) => setLineItems(prev => prev.filter(li => li.tempId !== tempId));

  const updateLine = (tempId: string, patch: Partial<LineItem>) => {
    setLineItems(prev => prev.map(li => li.tempId === tempId ? { ...li, ...patch } : li));
  };

  const computed = useMemo(() => {
    const rows = lineItems.map(li => {
      const gross = priceFor(li.service);
      const lineDiscount = parseFloat(li.discount) || 0;
      const netAfterLine = Math.max(0, gross - lineDiscount);
      return { li, gross, lineDiscount, netAfterLine };
    });
    const subtotal = rows.reduce((s, r) => s + r.netAfterLine, 0);
    const pct = parseFloat(percentDiscount) || 0;
    const fixed = parseFloat(fixedDiscount) || 0;
    const globalDiscount = Math.min(subtotal, fixed + (subtotal * pct) / 100);
    const rowsWithNet = rows.map(r => {
      const share = subtotal > 0 ? r.netAfterLine / subtotal : 0;
      const finalNet = Math.max(0, r.netAfterLine - globalDiscount * share);
      return { ...r, finalNet };
    });
    const totalAmount = rows.reduce((s, r) => s + r.gross, 0);
    const totalDiscount = rows.reduce((s, r) => s + r.lineDiscount, 0) + globalDiscount;
    const netAmount = Math.max(0, totalAmount - totalDiscount);
    return { rowsWithNet, totalAmount, totalDiscount, netAmount };
  }, [lineItems, percentDiscount, fixedDiscount, selectedCorporate, panelRates]);

  const paidNum = parseFloat(paid) || 0;
  const balance = computed.netAmount - paidNum;

  const openNewPatient = () => { setPatientForm(emptyPatientForm); setPatientDialogOpen(true); };
  const openEditPatient = () => {
    if (!selectedPatient) return;
    setPatientForm({
      full_name: selectedPatient.full_name,
      gender: selectedPatient.gender || 'male',
      date_of_birth: selectedPatient.date_of_birth || '',
      age: selectedPatient.age != null ? String(selectedPatient.age) : '',
      phone: selectedPatient.phone || '',
      cnic: selectedPatient.cnic || '',
      email: selectedPatient.email || '',
      blood_group: selectedPatient.blood_group || '',
      address: selectedPatient.address || '',
      city: selectedPatient.city || '',
    });
    setPatientDialogOpen(true);
  };

  const savePatient = async () => {
    if (!patientForm.full_name.trim()) { toast.error('Patient name is required'); return; }
    setSavingPatient(true);
    const payload = {
      full_name: patientForm.full_name,
      gender: patientForm.gender,
      date_of_birth: patientForm.date_of_birth || null,
      age: patientForm.age ? parseInt(patientForm.age) : null,
      phone: patientForm.phone || null,
      cnic: patientForm.cnic || null,
      email: patientForm.email || null,
      blood_group: patientForm.blood_group || null,
      address: patientForm.address || null,
      city: patientForm.city || null,
    };

    if (selectedPatient) {
      const { data, error } = await supabase.from('patients').update(payload).eq('id', selectedPatient.id).select().single();
      setSavingPatient(false);
      if (error) { toast.error('Failed to update: ' + getFriendlyErrorMessage(error)); return; }
      setSelectedPatient(data as Patient);
      setPatients(prev => prev.map(p => p.id === data.id ? (data as Patient) : p));
      setPatientDialogOpen(false);
      toast.success('Patient updated');
      return;
    }

    const { data: codeData, error: codeErr } = await supabase.rpc('next_code', {
      p_company_id: appUser?.company_id, p_branch_id: appUser?.branch_id, p_seq_type: 'patient', p_prefix: 'PT-', p_pad: 6,
    });
    if (codeErr) { setSavingPatient(false); toast.error('Failed to generate MR number: ' + getFriendlyErrorMessage(codeErr)); return; }

    const { data, error } = await supabase.from('patients').insert({
      ...payload,
      company_id: appUser?.company_id,
      branch_id: appUser?.branch_id,
      patient_code: codeData as string,
      is_active: true,
    }).select().single();
    setSavingPatient(false);
    if (error) { toast.error('Failed to register patient: ' + getFriendlyErrorMessage(error)); return; }
    setSelectedPatient(data as Patient);
    setPatients(prev => [...prev, data as Patient]);
    setPatientDialogOpen(false);
    toast.success(`Patient registered: ${codeData}`);
  };

  const handleSubmit = async () => {
    if (!selectedPatient) { toast.error('Search or register a patient first'); return; }
    if (lineItems.length === 0) { toast.error('Add at least one service'); return; }
    setSubmitting(true);

    const { data: codeData, error: codeErr } = await supabase.rpc('next_code', {
      p_company_id: appUser?.company_id, p_branch_id: appUser?.branch_id, p_seq_type: 'order', p_prefix: 'INV-', p_pad: 6,
    });
    if (codeErr) { toast.error('Failed to generate invoice number: ' + getFriendlyErrorMessage(codeErr)); setSubmitting(false); return; }

    const { data: order, error } = await supabase.from('lab_orders').insert({
      company_id: appUser?.company_id,
      branch_id: appUser?.branch_id,
      patient_id: selectedPatient.id,
      referral_source_id: selectedReferral || null,
      corporate_client_id: selectedCorporate || null,
      order_code: codeData as string,
      status: 'pending',
      total_amount: computed.totalAmount,
      discount_amount: computed.totalDiscount,
      net_amount: computed.netAmount,
      paid_amount: paidNum,
      payment_status: paidNum >= computed.netAmount ? 'paid' : paidNum > 0 ? 'partial' : 'unpaid',
      ref_no: refNo || null,
      internal_remarks: internalRemarks || null,
      patient_comments: patientComments || null,
      restrict_final_report: restrictFinalReport,
      patient_type: patientType,
    }).select().single();

    if (error) { toast.error('Failed: ' + getFriendlyErrorMessage(error)); setSubmitting(false); return; }

    if (paidNum > 0) {
      await supabase.from('lab_order_payments').insert({
        company_id: appUser?.company_id,
        branch_id: appUser?.branch_id,
        lab_order_id: order.id,
        amount: paidNum,
        payment_method: paymentMode,
        received_by: appUser?.id || null,
      });
    }

    const items = computed.rowsWithNet.map(r => ({
      lab_order_id: order.id,
      service_id: r.li.service.id,
      service_name: r.li.service.name,
      price: r.gross,
      discount_amount: r.lineDiscount,
      is_urgent: r.li.isUrgent,
      consultant_doctor_id: r.li.consultantDoctorId || null,
      performing_doctor_id: r.li.performingDoctorId || null,
      report_due_at: r.li.reportDueAt ? new Date(r.li.reportDueAt).toISOString() : null,
      status: 'pending',
    }));
    await supabase.from('lab_order_items').insert(items);

    const doctorSettlements: any[] = [];
    for (const r of computed.rowsWithNet) {
      if (r.li.performingDoctorId) {
        const share = computeDoctorShare(r.li.service, r.finalNet);
        if (share.share_amount > 0) {
          doctorSettlements.push({
            company_id: appUser?.company_id,
            doctor_id: r.li.performingDoctorId,
            doctor_type: 'performing_doctor',
            lab_order_id: order.id,
            service_name: r.li.service.name,
            share_type: share.share_type,
            share_amount: share.share_amount,
            settled: false,
          });
        }
      }
      if (r.li.consultantDoctorId) {
        const rule = findMatchingRule(shareRules, 'performing_doctor', {
          doctorId: r.li.consultantDoctorId,
          serviceId: r.li.service.id,
          serviceCategory: r.li.service.category,
          doctorType: 'opd_doctor',
        });
        if (rule) {
          const share = computeDoctorShareFromRule(rule, r.li.service, {
            gross_amount: r.gross, discount_amount: r.lineDiscount, net_amount: r.finalNet,
            cash_amount: paidNum, doctor_share_amount: 0, referral_share_amount: 0,
          });
          if (share.share_amount > 0) {
            doctorSettlements.push({
              company_id: appUser?.company_id,
              doctor_id: r.li.consultantDoctorId,
              doctor_type: 'opd_doctor',
              lab_order_id: order.id,
              service_name: r.li.service.name,
              share_type: share.share_type,
              share_amount: share.share_amount,
              settled: false,
            });
          }
        }
      }
    }
    if (doctorSettlements.length > 0) await supabase.from('doctor_settlements').insert(doctorSettlements);

    if (selectedReferral) {
      const referralShares = computed.rowsWithNet.map(r => computeReferralShare(r.li.service, r.finalNet)).filter(s => s.share_amount > 0);
      if (referralShares.length > 0) {
        await supabase.from('referral_settlements').insert(referralShares.map(s => ({
          company_id: appUser?.company_id,
          referral_source_id: selectedReferral,
          lab_order_id: order.id,
          service_name: s.service_name,
          commission_type: s.share_type,
          commission_amount: s.share_amount,
          settled: false,
        })));
      }
    }

    setCreatedOrderId(order.id);
    setSubmitting(false);
    toast.success(`Saved: ${codeData}`);
  };

  const resetForm = () => {
    setSelectedPatient(null);
    setPatientSearch('');
    setLineItems([]);
    setSelectedReferral('');
    setRefSearch('');
    setRefNo('');
    setInternalRemarks('');
    setPatientComments('');
    setRestrictFinalReport(false);
    setPercentDiscount('0');
    setFixedDiscount('0');
    setPaid('0');
    setPatientType('regular');
    setCreatedOrderId('');
  };

  if (createdOrderId) {
    return (
      <div className="space-y-6 max-w-xl">
        <div className="flex flex-col items-center gap-4 py-12 rounded-md border">
          <div className="rounded-full bg-[hsl(var(--chart-1))]/10 p-4"><Check className="h-12 w-12 text-[hsl(var(--chart-1))]" /></div>
          <p className="text-lg font-medium">Saved successfully</p>
          <div className="flex flex-wrap gap-2 justify-center">
            <Link href={`/reception/receipt/${createdOrderId}`}><Button variant="outline"><Printer className="mr-2 h-4 w-4" /> Print Receipt</Button></Link>
            <Link href={`/reception/barcode/${createdOrderId}`}><Button variant="outline"><Printer className="mr-2 h-4 w-4" /> Print Barcodes</Button></Link>
            <Button onClick={resetForm}><UserPlus className="mr-2 h-4 w-4" /> New Entry</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Patient Registration</h1>
        <p className="text-muted-foreground">Search or register a patient, add services, and bill — all in one screen</p>
      </div>

      <div className="relative rounded-md border bg-card p-3 flex flex-wrap items-center gap-x-8 gap-y-2">
        <div className="text-sm"><span className="text-muted-foreground">MRNO: </span><span className="font-medium">{selectedPatient?.patient_code ?? '—'}</span></div>
        <div className="text-sm"><span className="text-muted-foreground">Name: </span><span className="font-medium">{selectedPatient?.full_name ?? '—'}</span></div>
        <div className="text-sm"><span className="text-muted-foreground">DOB/Gender: </span><span className="font-medium">{selectedPatient ? `${selectedPatient.date_of_birth ?? selectedPatient.age ?? '—'} / ${selectedPatient.gender}` : '—'}</span></div>
        <div className="text-sm"><span className="text-muted-foreground">Cell: </span><span className="font-medium">{selectedPatient?.phone ?? '—'}</span></div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} placeholder="Search by name, MRNO, phone, or CNIC..." className="pl-8 h-9" />
          {patientResults.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-y-auto">
              {patientResults.map(p => (
                <button key={p.id} type="button" onClick={() => { setSelectedPatient(p); setPatientSearch(''); }}
                  className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/60 text-left">
                  <span>{p.full_name}</span>
                  <span className="text-xs text-muted-foreground">{p.patient_code} · {p.phone ?? 'no phone'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={openEditPatient} disabled={!selectedPatient}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit</Button>
          <Button type="button" size="sm" onClick={openNewPatient}><Plus className="mr-1.5 h-3.5 w-3.5" /> New</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <div className="space-y-4">
          <div className="rounded-md border bg-card p-4 space-y-3">
            <div className="flex gap-2 items-center">
              {corporates.length > 0 && (
                <Select value={selectedCorporate || 'none'} onValueChange={(v) => setSelectedCorporate(v === 'none' ? '' : v)}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="Panel / Corporate" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No panel</SelectItem>
                    {corporates.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={serviceSearch} onChange={(e) => setServiceSearch(e.target.value)} placeholder="Search services to add..." className="pl-8" />
                {filteredServices.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-y-auto">
                    {filteredServices.map(s => (
                      <button key={s.id} type="button" onClick={() => addService(s)}
                        className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/60 text-left">
                        <span>{s.name} <span className="text-xs text-muted-foreground">{s.code}</span></span>
                        <span className="font-medium">Rs {priceFor(s).toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {lineItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No services added yet — search above to add tests.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground text-left">
                      <th className="font-normal pb-2 pr-2">Service</th>
                      <th className="font-normal pb-2 pr-2 w-36">Consultant</th>
                      <th className="font-normal pb-2 pr-2 w-36">Performing</th>
                      <th className="font-normal pb-2 pr-2 w-40">Report time</th>
                      <th className="font-normal pb-2 pr-2 w-20 text-right">Price</th>
                      <th className="font-normal pb-2 pr-2 w-20 text-right">Disc.</th>
                      <th className="font-normal pb-2 pr-2 w-14 text-center">Urgent</th>
                      <th className="w-6"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map(li => (
                      <tr key={li.tempId} className="border-t">
                        <td className="py-2 pr-2">
                          <div className="font-medium">{li.service.name}</div>
                          <div className="text-xs text-muted-foreground">{li.service.code}</div>
                        </td>
                        <td className="py-2 pr-2">
                          <Select value={li.consultantDoctorId || 'none'} onValueChange={(v) => updateLine(li.tempId, { consultantDoctorId: v === 'none' ? '' : v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Search staff..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">—</SelectItem>
                              {doctors.map(d => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2 pr-2">
                          <Select value={li.performingDoctorId || 'none'} onValueChange={(v) => updateLine(li.tempId, { performingDoctorId: v === 'none' ? '' : v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Search staff..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">—</SelectItem>
                              {doctors.map(d => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2 pr-2">
                          <Input type="datetime-local" value={li.reportDueAt} onChange={(e) => updateLine(li.tempId, { reportDueAt: e.target.value })} className="h-8 text-xs" />
                        </td>
                        <td className="py-2 pr-2 text-right">{priceFor(li.service).toLocaleString()}</td>
                        <td className="py-2 pr-2">
                          <Input type="number" value={li.discount} onChange={(e) => updateLine(li.tempId, { discount: e.target.value })} className="h-8 text-xs text-right" />
                        </td>
                        <td className="py-2 pr-2 text-center">
                          <Checkbox checked={li.isUrgent} onCheckedChange={(c) => updateLine(li.tempId, { isUrgent: c === true })} />
                        </td>
                        <td className="py-2 text-center">
                          <button type="button" onClick={() => removeLine(li.tempId)} className="text-muted-foreground hover:text-destructive">
                            <X className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-md border bg-card p-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1"><Label className="text-xs">Total amount</Label><div className="h-9 flex items-center px-3 rounded-md bg-muted text-sm font-medium">{computed.totalAmount.toLocaleString()}</div></div>
              <div className="space-y-1"><Label className="text-xs">%age discount</Label><Input type="number" value={percentDiscount} onChange={(e) => setPercentDiscount(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Fixed discount</Label><Input type="number" value={fixedDiscount} onChange={(e) => setFixedDiscount(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Net amount</Label><div className="h-9 flex items-center px-3 rounded-md bg-muted text-sm font-medium">{computed.netAmount.toLocaleString()}</div></div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1"><Label className="text-xs">Paid amount</Label><Input type="number" value={paid} onChange={(e) => setPaid(e.target.value)} /></div>
              <div className="space-y-1">
                <Label className="text-xs">Payment mode</Label>
                <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as 'cash' | 'online' | 'card')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Balance</Label><div className={`h-9 flex items-center px-3 rounded-md bg-muted text-sm font-medium ${balance > 0 ? 'text-destructive' : ''}`}>{balance.toLocaleString()}</div></div>
              <div className="space-y-1">
                <Label className="text-xs">Patient type</Label>
                <Select value={patientType} onValueChange={setPatientType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="vip">VIP</SelectItem>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="free">Free</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : <><Check className="mr-2 h-4 w-4" /> Save</>}
            </Button>
          </div>
        </div>

        <div className="rounded-md border bg-card p-4 space-y-3 h-fit">
          <div className="space-y-1 relative">
            <Label className="text-xs">Ref by</Label>
            <div className="flex gap-1">
              <Input value={selectedReferral ? referrals.find(r => r.id === selectedReferral)?.name ?? '' : refSearch}
                onChange={(e) => { setRefSearch(e.target.value); setSelectedReferral(''); }}
                placeholder="Search ref by..." className="h-9" />
            </div>
            {refResults.length > 0 && !selectedReferral && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                {refResults.map(r => (
                  <button key={r.id} type="button" onClick={() => { setSelectedReferral(r.id); setRefSearch(''); }}
                    className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/60 text-left">
                    <span>{r.name}</span>
                    <Badge variant="outline" className="text-xs capitalize">{r.type}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1"><Label className="text-xs">Ref no</Label><Input value={refNo} onChange={(e) => setRefNo(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Internal remarks</Label><Textarea value={internalRemarks} onChange={(e) => setInternalRemarks(e.target.value)} className="h-20" /></div>
          <div className="space-y-1"><Label className="text-xs">Patient comments</Label><Textarea value={patientComments} onChange={(e) => setPatientComments(e.target.value)} className="h-20" /></div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={restrictFinalReport} onCheckedChange={(c) => setRestrictFinalReport(c === true)} />
            Restrict final report
          </label>
        </div>
      </div>

      <Dialog open={patientDialogOpen} onOpenChange={setPatientDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{selectedPatient ? 'Edit Patient' : 'New Patient'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1"><Label>Full name *</Label><Input value={patientForm.full_name} onChange={(e) => setPatientForm({ ...patientForm, full_name: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>Gender</Label>
              <Select value={patientForm.gender} onValueChange={(v) => setPatientForm({ ...patientForm, gender: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Age</Label><Input type="number" value={patientForm.age} onChange={(e) => setPatientForm({ ...patientForm, age: e.target.value })} /></div>
            <div className="space-y-1"><Label>Date of birth</Label><Input type="date" value={patientForm.date_of_birth} onChange={(e) => setPatientForm({ ...patientForm, date_of_birth: e.target.value })} /></div>
            <div className="space-y-1"><Label>Phone</Label><Input value={patientForm.phone} onChange={(e) => setPatientForm({ ...patientForm, phone: e.target.value })} /></div>
            <div className="space-y-1"><Label>CNIC</Label><Input value={patientForm.cnic} onChange={(e) => setPatientForm({ ...patientForm, cnic: e.target.value })} placeholder="XXXXX-XXXXXXX-X" /></div>
            <div className="space-y-1"><Label>Email</Label><Input type="email" value={patientForm.email} onChange={(e) => setPatientForm({ ...patientForm, email: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>Blood group</Label>
              <Select value={patientForm.blood_group} onValueChange={(v) => setPatientForm({ ...patientForm, blood_group: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => <SelectItem key={bg} value={bg}>{bg}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1"><Label>Address</Label><Input value={patientForm.address} onChange={(e) => setPatientForm({ ...patientForm, address: e.target.value })} /></div>
            <div className="space-y-1"><Label>City</Label><Input value={patientForm.city} onChange={(e) => setPatientForm({ ...patientForm, city: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPatientDialogOpen(false)}>Cancel</Button>
            <Button onClick={savePatient} disabled={savingPatient}>
              {savingPatient ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
