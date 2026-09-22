import { redirect } from 'next/navigation';

// Retired: patient registration now happens on the merged
// registration + test ordering + billing screen.
export default function PatientsNewRedirect() {
  redirect('/reception/register');
}
