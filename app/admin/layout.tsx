import { redirect } from 'next/navigation';
import { getSessionUser, isAdminEmail } from '@/lib/auth';
import type { ReactNode } from 'react';

// Reads the session (cookies/headers), so it must render dynamically — otherwise
// Next prerenders it static and 500s with a static→dynamic conflict at runtime.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Admin' };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/auth/login?returnTo=/admin');
  if (!isAdminEmail(user.email)) redirect('/');
  return <>{children}</>;
}
