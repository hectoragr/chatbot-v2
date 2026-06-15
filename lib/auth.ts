import { getAuth0, isAuth0Configured } from './auth0.js';

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
  // Anonymous-only mode (or any Auth0 failure) → no session. Never let an Auth0
  // misconfiguration turn an anonymous request into a 500.
  if (!isAuth0Configured()) return null;
  try {
    const session = await getAuth0().getSession();
    // Require both email and sub so the returned SessionUser always satisfies its contract.
    if (!session?.user?.email || !session.user.sub) return null;
    return {
      email: session.user.email as string,
      name: session.user.name as string | undefined,
      sub: session.user.sub as string,
    };
  } catch (e) {
    console.error('getSessionUser error (treating as anonymous):', e);
    return null;
  }
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !isAdminEmail(user.email)) {
    throw new Error('ADMIN_REQUIRED');
  }
  return user;
}
