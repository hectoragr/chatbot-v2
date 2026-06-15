import { Auth0Client } from '@auth0/nextjs-auth0/server';

let _client: Auth0Client | null = null;

// Lazily construct so importing this module doesn't require Auth0 env at build/test time.
export function getAuth0(): Auth0Client {
  if (!_client) _client = new Auth0Client();
  return _client;
}
