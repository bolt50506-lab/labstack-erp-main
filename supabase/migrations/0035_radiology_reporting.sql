-- Radiology reporting separation and signed-report configuration
alter table public.services drop constraint if exists services_report_format_check;
alter table public.services add constraint services_report_format_check
  check (report_format = any (array['routine','culture','biopsy','radiology']));

alter table public.doctors add column if not exists signature_url text;

create table if not exists public.radiology_report_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  template_body text not null default '',
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.radiology_report_templates enable row level security;
drop policy if exists select_radiology_report_templates on public.radiology_report_templates;
drop policy if exists insert_radiology_report_templates on public.radiology_report_templates;
drop policy if exists update_radiology_report_templates on public.radiology_report_templates;
drop policy if exists delete_radiology_report_templates on public.radiology_report_templates;
create policy select_radiology_report_templates on public.radiology_report_templates for select to authenticated using (is_company_member(company_id));
create policy insert_radiology_report_templates on public.radiology_report_templates for insert to authenticated with check (is_company_member(company_id));
create policy update_radiology_report_templates on public.radiology_report_templates for update to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));
create policy delete_radiology_report_templates on public.radiology_report_templates for delete to authenticated using (is_company_member(company_id));

create table if not exists public.radiology_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lab_order_item_id uuid not null unique references public.lab_order_items(id) on delete cascade,
  template_id uuid references public.radiology_report_templates(id) on delete set null,
  clinical_history text,
  technique text,
  findings text not null default '',
  impression text not null default '',
  report_status text not null default 'draft' check (report_status = any (array['draft','result_entered','verified','approved','printed'])),
  reporting_doctor_id uuid references public.doctors(id) on delete set null,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.radiology_reports enable row level security;
drop policy if exists select_radiology_reports on public.radiology_reports;
drop policy if exists insert_radiology_reports on public.radiology_reports;
drop policy if exists update_radiology_reports on public.radiology_reports;
drop policy if exists delete_radiology_reports on public.radiology_reports;
create policy select_radiology_reports on public.radiology_reports for select to authenticated using (is_company_member(company_id));
create policy insert_radiology_reports on public.radiology_reports for insert to authenticated with check (is_company_member(company_id));
create policy update_radiology_reports on public.radiology_reports for update to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));
create policy delete_radiology_reports on public.radiology_reports for delete to authenticated using (is_company_member(company_id));

create index if not exists idx_radiology_reports_company on public.radiology_reports(company_id);
create index if not exists idx_radiology_templates_company on public.radiology_report_templates(company_id);
