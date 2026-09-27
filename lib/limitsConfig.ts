/**
 * Central runtime-tunable limits.
 *
 * Every abuse / quota / kill-switch knob lives here so operators can retune
 * the deployed service WITHOUT a code change or redeploy: set the matching
 * environment variable (in prod, an SSM-backed Lambda env var — see
 * infra/lib/chatbot-v2-stack.ts) and the new value takes effect on the next
 * cold start. When a var is unset we fall back to the CURRENT hard-coded
 * value, so behaviour is unchanged until an operator overrides it.
 *
 * abuse.ts / quota.ts / killSwitch.ts import from here and KEEP their existing
 * exported constant names (computed from this config) so pre-existing tests
 * and imports continue to work unchanged.
 */

/**
 * Parse an environment variable as a non-negative finite number, falling back
 * to `def` when the var is unset, empty, or not a valid number. We deliberately
 * reject NaN/Infinity/negatives rather than silently accepting a nonsense
 * override that could disable a limit (e.g. `BURST_MAX=abc` must not become 0).
 */
export function envNum(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return def;
  return n;
}

// ─── Burst / auto-block (lib/abuse.ts) ────────────────────────────────────────
/** Sliding-window length, seconds, for the short burst counter. */
export const BURST_WINDOW_SEC = envNum('BURST_WINDOW_SEC', 60);
/** Max requests allowed inside one burst window before auto-blocking. */
export const BURST_MAX = envNum('BURST_MAX', 20);
/** How long, seconds, an auto-block lasts. */
export const AUTO_BLOCK_TTL_SEC = envNum('AUTO_BLOCK_TTL_SEC', 60 * 60);

// ─── Multi-window per-IP ceilings (lib/abuse.ts) ──────────────────────────────
/** Per-IP hourly request ceiling (rolling hour bucket). */
export const IP_HOURLY_MAX = envNum('IP_HOURLY_MAX', 100);
/** Per-IP hourly window length, seconds. */
export const IP_HOURLY_WINDOW_SEC = envNum('IP_HOURLY_WINDOW_SEC', 3600);
/** Per-IP daily request ceiling (rolling day bucket). */
export const IP_DAILY_MAX = envNum('IP_DAILY_MAX', 300);
/** Per-IP daily window length, seconds. */
export const IP_DAILY_WINDOW_SEC = envNum('IP_DAILY_WINDOW_SEC', 86400);

// ─── Quota tiers (lib/quota.ts) ───────────────────────────────────────────────
/** Anonymous tier: max questions/day. */
export const ANON_QUESTIONS = envNum('ANON_QUESTIONS', 3);
/** Anonymous tier: max tokens/day. */
export const ANON_TOKENS = envNum('ANON_TOKENS', 1000);
/** Logged-in but unapproved tier: max tokens/day. */
export const UNAPPROVED_TOKENS = envNum('UNAPPROVED_TOKENS', 1000);
/** Approved tier daily fallback once all tokens are exhausted: max tokens/day. */
export const DAILY_TOKENS = envNum('DAILY_TOKENS', 1000);

// ─── Global daily kill-switch (lib/killSwitch.ts) ─────────────────────────────
/**
 * Global daily token-spend ceiling across ALL users. A safety brake against a
 * runaway bill (a bypass we missed, a viral spike). Default is generous enough
 * not to trip in normal operation but bounds worst-case daily spend; retune via
 * GLOBAL_DAILY_TOKENS.
 */
export const GLOBAL_DAILY_TOKENS = envNum('GLOBAL_DAILY_TOKENS', 5_000_000);

// ─── Anonymous captcha gate (lib/captcha.ts + completions route) ──────────────
/**
 * Whether anonymous requests must carry a valid captcha. Defaults ON (secure by
 * default). An operator can disable it without a redeploy by setting
 * ANON_CAPTCHA_REQUIRED=false (e.g. if the captcha UI regresses and is blocking
 * legitimate anon users). Any value other than a case-insensitive "false"/"0"
 * leaves it enabled.
 */
export function anonCaptchaRequired(): boolean {
  const raw = (process.env.ANON_CAPTCHA_REQUIRED ?? '').trim().toLowerCase();
  return raw !== 'false' && raw !== '0';
}

/**
 * LIVE accessor: re-reads process.env on every call, so a test (or a warm
 * Lambda whose env was mutated) sees an override without re-importing this
 * module. The exported consts above are the one-shot snapshot taken at module
 * load and are kept only so existing constant-name imports keep working
 * (abuse.ts / quota.ts re-export them). Prefer `limits()` for anything that
 * should honour a runtime override.
 */
export function limits() {
  return {
    BURST_WINDOW_SEC: envNum('BURST_WINDOW_SEC', 60),
    BURST_MAX: envNum('BURST_MAX', 20),
    AUTO_BLOCK_TTL_SEC: envNum('AUTO_BLOCK_TTL_SEC', 60 * 60),
    IP_HOURLY_MAX: envNum('IP_HOURLY_MAX', 100),
    IP_HOURLY_WINDOW_SEC: envNum('IP_HOURLY_WINDOW_SEC', 3600),
    IP_DAILY_MAX: envNum('IP_DAILY_MAX', 300),
    IP_DAILY_WINDOW_SEC: envNum('IP_DAILY_WINDOW_SEC', 86400),
    ANON_QUESTIONS: envNum('ANON_QUESTIONS', 3),
    ANON_TOKENS: envNum('ANON_TOKENS', 1000),
    UNAPPROVED_TOKENS: envNum('UNAPPROVED_TOKENS', 1000),
    DAILY_TOKENS: envNum('DAILY_TOKENS', 1000),
    GLOBAL_DAILY_TOKENS: envNum('GLOBAL_DAILY_TOKENS', 5_000_000),
  };
}
