import { Auth0Client } from '@auth0/nextjs-auth0/server';

let _client: Auth0Client | null = null;

// True only when all required Auth0 env vars are present. `new Auth0Client()`
// throws if any are missing, so callers must check this before getAuth0().
// When false the app runs in anonymous-only mode (login/admin are unavailable).
export function isAuth0Configured(): boolean {
  return Boolean(
    process.env.AUTH0_DOMAIN &&
    process.env.AUTH0_CLIENT_ID &&
    process.env.AUTH0_CLIENT_SECRET &&
    process.env.AUTH0_SECRET &&
    process.env.APP_BASE_URL,
  );
}

// Lazily construct so importing this module doesn't require Auth0 env at build/test time.
export function getAuth0(): Auth0Client {
  if (!_client) _client = new Auth0Client();
  return _client;
}
