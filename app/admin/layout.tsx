import { redirect } from 'next/navigation';
import { getSessionUser, isAdminEmail } from '@/lib/auth';
import type { ReactNode } from 'react';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/auth/login?returnTo=/admin');
  if (!isAdminEmail(user.email)) redirect('/');
  return <>{children}</>;
}
