import { type NextRequest } from 'next/server';
import { getAuth0 } from '@/lib/auth0';

export async function middleware(req: NextRequest) {
  const res = await getAuth0().middleware(req); // mounts /auth/* and rolls session
  if (!req.cookies.get('anon_id')) {
    res.cookies.set('anon_id', crypto.randomUUID(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}

export const config = {
  // Run on everything except static assets; MUST include /auth/* so the SDK handles them.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
