import { NextResponse, type NextRequest } from 'next/server';
import { getAuth0, isAuth0Configured } from '@/lib/auth0';

function withAnonCookie(req: NextRequest, res: NextResponse): NextResponse {
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

export async function middleware(req: NextRequest) {
  // Anonymous-only mode: when Auth0 isn't configured, skip the SDK middleware
  // entirely so anon chat works without an Auth0 tenant.
  if (!isAuth0Configured()) {
    return withAnonCookie(req, NextResponse.next());
  }
  try {
    const res = (await getAuth0().middleware(req)) as NextResponse; // mounts /auth/* + rolls session
    return withAnonCookie(req, res);
  } catch (e) {
    // A misconfigured or unreachable Auth0 tenant must never break anonymous
    // requests (the public chat). Degrade to anon and surface the error in logs.
    console.error('Auth0 middleware error (continuing as anonymous):', e);
    return withAnonCookie(req, NextResponse.next());
  }
}

export const config = {
  // Run on everything except static assets; MUST include /auth/* so the SDK handles them.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
