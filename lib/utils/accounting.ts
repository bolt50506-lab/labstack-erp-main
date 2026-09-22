import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fixed codes for the accounts this module posts against. Looked up by
 * code and auto-created (inactive-safe defaults) the first time they're
 * needed, so a settle action or a day-close never fails just because
 * nobody has set up the Chart of Accounts yet. A company that already
 * has these codes from its own setup will just reuse them.
 */
export const STANDARD_ACCOUNTS = {
  CASH: { code: 'CASH-001', name: 'Cash in Hand', type: 'asset' as const },
  CARD_CLEARING: { code: 'BANK-CARD', name: 'Card / POS Clearing', type: 'asset' as const },
  ONLINE_CLEARING: { code: 'BANK-ONLINE', name: 'Online Payments Clearing', type: 'asset' as const },
  ACCOUNTS_RECEIVABLE: { code: 'AR-001', name: 'Accounts Receivable - Patients', type: 'asset' as const },
  SALES_REVENUE: { code: 'REV-LAB', name: 'Lab & Diagnostic Service Revenue', type: 'revenue' as const },
  DOCTOR_COMMISSION_EXPENSE: { code: 'EXP-DOC-COMM', name: 'Doctor Commission Expense', type: 'expense' as const },
  REFERRAL_COMMISSION_EXPENSE: { code: 'EXP-REF-COMM', name: 'Referral Commission Expense', type: 'expense' as const },
  SALARY_EXPENSE: { code: 'EXP-SALARY', name: 'Salary Expense', type: 'expense' as const },
};

export async function getOrCreateAccount(
  supabase: SupabaseClient,
  companyId: string,
  account: { code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' }
): Promise<string> {
  const { data: existing } = await supabase.from('chart_of_accounts').select('id').eq('company_id', companyId).eq('code', account.code).maybeSingle();
  if (existing) return (existing as { id: string }).id;
  const { data: created, error } = await supabase.from('chart_of_accounts').insert({
    company_id: companyId, code: account.code, name: account.name, type: account.type,
    is_group: false, opening_balance: 0, current_balance: 0, is_active: true,
  }).select('id').single();
  if (error) throw error;
  return (created as { id: string }).id;
}

export type JournalLineInput = { accountCode: keyof typeof STANDARD_ACCOUNTS | string; debit?: number; credit?: number; description?: string };

/**
 * Posts a balanced journal entry. Lines with a zero amount are skipped
 * automatically (e.g. a day with no card payments won't create a
 * zero-value clearing line). Throws if the resulting entry wouldn't
 * balance, so callers know immediately rather than silently posting bad
 * books.
 */
export async function postJournalEntry(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    branchId?: string | null;
    entryDate: string;
    description: string;
    referenceType: string;
    referenceId?: string | null;
    createdBy?: string | null;
    lines: JournalLineInput[];
  }
) {
  const nonZeroLines = params.lines.filter(l => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
  const totalDebit = nonZeroLines.reduce((s, l) => s + (l.debit ?? 0), 0);
  const totalCredit = nonZeroLines.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (nonZeroLines.length === 0 || Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Journal entry does not balance: debit ${totalDebit.toFixed(2)} vs credit ${totalCredit.toFixed(2)}`);
  }

  const accountIds = await Promise.all(nonZeroLines.map(async (l) => {
    const std = (STANDARD_ACCOUNTS as Record<string, { code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' }>)[l.accountCode];
    if (!std) throw new Error(`Unknown account code: ${l.accountCode}`);
    return getOrCreateAccount(supabase, params.companyId, std);
  }));

  const entryNumber = `JE-${Date.now().toString().slice(-8)}`;
  const { data: entryData, error: entryError } = await supabase.from('journal_entries').insert({
    company_id: params.companyId,
    branch_id: params.branchId ?? null,
    entry_number: entryNumber,
    entry_date: params.entryDate,
    description: params.description,
    reference_type: params.referenceType,
    reference_id: params.referenceId ?? null,
    status: 'posted',
    total_debit: totalDebit,
    total_credit: totalCredit,
    created_by: params.createdBy ?? null,
  }).select('id').single();
  if (entryError) throw entryError;
  const journalEntryId = (entryData as { id: string }).id;

  const lineInserts = nonZeroLines.map((l, i) => ({
    journal_entry_id: journalEntryId,
    account_id: accountIds[i],
    debit: l.debit ?? 0,
    credit: l.credit ?? 0,
    description: l.description ?? params.description,
  }));
  const { error: lineError } = await supabase.from('journal_lines').insert(lineInserts);
  if (lineError) throw lineError;

  return journalEntryId;
}
