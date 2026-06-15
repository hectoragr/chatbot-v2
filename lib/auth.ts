import { getAuth0 } from './auth0.js';

export interface SessionUser {
  email: string;
  name?: string;
  sub: string;
}

export function isAdminEmail(email: string | undefined): boolean {
  const admin = process.env.ADMIN_EMAIL;
  return !!admin && !!email && email === admin;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getAuth0().getSession();
  // Require both email and sub so the returned SessionUser always satisfies its contract.
  if (!session?.user?.email || !session.user.sub) return null;
  return {
    email: session.user.email as string,
    name: session.user.name as string | undefined,
    sub: session.user.sub as string,
  };
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !isAdminEmail(user.email)) {
    throw new Error('ADMIN_REQUIRED');
  }
  return user;
}
