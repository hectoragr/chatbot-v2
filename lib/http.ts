export function errorStatus(message: string | undefined): number {
  if (!message) return 500;
  if (message === 'TOKEN_NOT_FOUND') return 404;
  if (message === 'quota_exceeded') return 402;
  if (message === 'rate_limited') return 429;
  if (message.startsWith('TOKEN_')) return 403; // INACTIVE/EXPIRED/REQUEST_NOT_PROCESSED
  return 500;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function fail(message: string, extra: Record<string, unknown> = {}): Response {
  // Spread extra first so the canonical error message can't be shadowed by a caller.
  return json({ ...extra, error: message }, errorStatus(message));
}
