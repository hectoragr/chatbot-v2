import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (!req.cookies.get('anon_id')) {
    res.cookies.set('anon_id', randomUUID(), {
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
