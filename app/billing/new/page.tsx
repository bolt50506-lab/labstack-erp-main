import { redirect } from 'next/navigation';

// Retired: billing/order entry now happens on the merged
// registration + test ordering + billing screen.
export default function BillingNewRedirect() {
  redirect('/reception/register');
}
