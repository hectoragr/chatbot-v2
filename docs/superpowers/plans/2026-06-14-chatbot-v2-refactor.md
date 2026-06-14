# chatbot-v2 Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `chatbot-api` (Express/Node) and `ai-bot-project` (React/Vite) into a single Next.js App Router monorepo (`chatbot-v2`), deployed to `chat.hectoragomez.com` via OpenNext (S3 + Lambda + CloudFront), with CloudScape UI, Auth0 user identity, a tiered anonymous/logged-in/approved quota engine, a model selector, and two least-privilege AWS IAM roles.

**Architecture:** One Next.js App Router app. The existing backend `src/lib/*.ts` business logic is ported almost verbatim into `lib/` and called from Next route handlers under `app/api/*`. OpenNext bundles static assets to S3 and SSR/route-handlers to a single "server" Lambda that runs with a **user-scoped** IAM role. Privileged admin mutations (approve token, edit/delete any record, full-table scans) are delegated from admin route handlers to a separate **`admin-fn` Lambda** running with a privileged role; the server Lambda may only `lambda:InvokeFunction` that one ARN after verifying the caller is the Auth0 admin. Quota is enforced server-side: anonymous users are tracked by an httpOnly cookie + client IP in a date-partitioned `Usage` table; logged-in users are keyed by Auth0 email.

**Tech Stack:** Next.js 15 (App Router, React 19), TypeScript (strict, ESM), `@cloudscape-design/components` + `@cloudscape-design/global-styles`, `@auth0/nextjs-auth0` v4, AWS SDK v3 (`@aws-sdk/client-dynamodb`, `lib-dynamodb`, `@aws-sdk/client-lambda`), `zod`, `i18next`/`react-i18next`, `vitest` + `@testing-library/react` (unit/component), `@playwright/test` (e2e), OpenNext (`@opennextjs/aws`) + AWS CDK (`aws-cdk-lib`) for infra.

---

## Source Material (what we are porting from)

Absolute paths of the two existing repos. Read these while implementing — most tasks are "port file X, change Y".

**Backend — `/Users/hectorgomez/Workspace/chatbot-api`:**
- `api/index.ts` — all Express routes (port each to a Next route handler).
- `src/lib/ddb.ts` — DDB singleton + all `*Doc` types + `TABLES` map.
- `src/lib/tokens.ts`, `users.ts`, `conversations.ts`, `providers.ts`, `prompts.ts`, `rateLimits.ts` — business logic (port near-verbatim).
- `src/utils/utils.ts` — CSRF/HMAC/captcha/rate-limit middleware (split: pure crypto → `lib/csrf.ts`; rate-limit → `lib/rateLimits.ts`).
- `src/config/prompts.json` — system prompt catalog (copy verbatim).
- `scripts/bootstrap-ddb.mjs` — table + GSI definitions (source of truth for the `Usage` table addition).
- `infra/lib/chatbot-stack.ts`, `infra/bin/app.ts` — existing CDK (Route53 hosted zone id `Z01423473OIRTW86CLXNU`, zone `hectoragomez.com`, ACM-in-us-east-1 pattern) — reuse the domain/cert/Route53 patterns.

**Frontend — `/Users/hectorgomez/Workspace/ai-bot-project`:**
- `src/components/ChatBotApp.jsx` — chat shell, sidebar, input, emoji, send/delete logic.
- `src/components/ChatBotComponent.jsx` — provider start screen.
- `src/components/EmojiPicker.jsx`, `MarkdownMessage.jsx`, `MarkdownToolbar.jsx`, `LanguageSelector.jsx` — reuse internals.
- `src/components/RequestTokenForm.jsx` — signup/token-request form (name, email, company, tokenLimit, provider, captcha).
- `src/Admin.jsx` + `src/components/{UsersTable,TokensTable,ConversationsTable,TokenRequestTable}.jsx` — admin dashboards.
- `src/service/FetchService.js` — client API calls (reshape into typed `lib/client/*`).
- `src/i18n.js` — i18n resources (copy en/es/fr/de).
- `src/auth.js` — Auth0 SPA usage (replaced by `@auth0/nextjs-auth0`).

---

## Target Repo Structure (`/Users/hectorgomez/Workspace/chatbot-v2`)

Each file has one responsibility. Files that change together live together.

```
chatbot-v2/
├── package.json                      # Next app + scripts
├── next.config.ts                    # transpilePackages for cloudscape; reactStrictMode
├── open-next.config.ts               # OpenNext build config
├── tsconfig.json
├── vitest.config.ts                  # unit/component tests (jsdom)
├── playwright.config.ts              # e2e (ported)
├── .env.example
├── middleware.ts                     # issues anon_id cookie; attaches request id
├── app/
│   ├── layout.tsx                    # root layout; CloudScape global styles
│   ├── providers.tsx                 # 'use client' Auth0 + i18n + appearance providers
│   ├── globals.css
│   ├── page.tsx                      # landing → new conversation (anon allowed)
│   ├── admin/
│   │   ├── layout.tsx                # server: Auth0 admin guard + CloudScape AppLayout
│   │   └── page.tsx                  # dashboards (4 CloudScape tables)
│   └── api/
│       ├── auth/[auth0]/route.ts     # Auth0 SDK handler (login/logout/callback)
│       ├── csrf/route.ts
│       ├── prompts/route.ts
│       ├── models/route.ts
│       ├── me/route.ts               # session + tier + remaining quota
│       ├── quota/route.ts            # current usage snapshot
│       ├── conversations/route.ts    # GET list / latest
│       ├── conversations/[id]/route.ts  # GET one / DELETE own
│       ├── completions/route.ts      # quota-aware completion
│       ├── requestToken/route.ts     # create TokenRequest (logged-in or captcha)
│       └── admin/
│           ├── tables/route.ts
│           ├── users/[email]/route.ts
│           ├── tokens/[token]/route.ts
│           ├── approveToken/[id]/route.ts
│           └── blocks/route.ts        # GET list / POST add / DELETE remove
├── lib/
│   ├── ddb.ts                        # ported: client + types + TABLES (+ Usage)
│   ├── tokens.ts                     # ported
│   ├── users.ts                      # ported (+ auth0_sub, approved, dailyLimit)
│   ├── conversations.ts              # ported
│   ├── providers.ts                  # ported (+ model threading)
│   ├── prompts.ts                    # ported
│   ├── rateLimits.ts                 # ported (burst limiter)
│   ├── usage.ts                      # NEW: date-partitioned usage rows
│   ├── quota.ts                      # NEW: tiered quota engine
│   ├── blocks.ts                     # NEW: block subjects (account/IP)
│   ├── abuse.ts                      # NEW: burst detection → auto-block
│   ├── models.ts                     # NEW: model catalog per provider
│   ├── csrf.ts                       # NEW (from utils.ts): hmac/csrf/captcha
│   ├── auth.ts                       # NEW: Auth0 session + admin check (server)
│   ├── anon.ts                       # NEW: read anon_id cookie + client IP
│   ├── adminInvoke.ts                # NEW: invoke admin-fn Lambda
│   └── http.ts                       # NEW: json() helper + error→status mapping
├── lib/client/
│   ├── api.ts                        # typed fetch wrappers (from FetchService.js)
│   └── csrfClient.ts
├── components/
│   ├── chat/
│   │   ├── ChatShell.tsx
│   │   ├── ConversationList.tsx
│   │   ├── MessageList.tsx
│   │   ├── MarkdownMessage.tsx       # ported
│   │   ├── ChatInput.tsx             # input + emoji + ModelSelector + send (quota-aware)
│   │   ├── EmojiPicker.tsx           # ported
│   │   ├── ModelSelector.tsx         # NEW
│   │   ├── SettingsPanel.tsx         # language + appearance
│   │   └── QuotaBanner.tsx           # NEW: shows remaining / blocked
│   ├── admin/
│   │   ├── UsersTable.tsx
│   │   ├── TokensTable.tsx
│   │   ├── ConversationsTable.tsx
│   │   ├── TokenRequestsTable.tsx
│   │   └── BlocksTable.tsx
│   └── auth/
│       └── SignupRequestForm.tsx     # tokens requested + company + basic info
├── i18n/
│   ├── config.ts                     # i18next init (client)
│   └── resources.ts                  # en/es/fr/de (ported)
├── admin-fn/
│   ├── handler.ts                    # privileged Lambda: switch on op
│   └── ops.ts                        # admin ops reusing lib/*
├── infra/
│   ├── package.json
│   ├── cdk.json
│   ├── bin/app.ts
│   └── lib/chatbot-v2-stack.ts       # tables import + Usage + 2 roles + OpenNext + admin-fn + CF/R53
├── tests/                            # vitest + playwright
└── .github/workflows/deploy.yml
```

---

## Cross-Cutting Design (read before coding)

### Quota tiers (server-authoritative)

| Tier | Who | Question cap | Token cap | Reset |
|------|-----|-------------|-----------|-------|
| `anon` | no Auth0 session | 3 / day | 1000 / day | daily (whichever hits first blocks) |
| `unapproved` | Auth0 session, no approved Token | none | 1000 / day | daily |
| `approved` | Auth0 session + active Token (`limit-used>0`) | none | `Token.limit` then **1000/day** | Token first, then daily |

`Usage` DynamoDB table:
- PK `subject` (`anon:<anonId>` or `user:<email>`), SK `period` (`lifetime` or `YYYY-MM-DD`).
- Attrs `questions:N`, `tokens:N`, `ttl:N` (epoch seconds; daily rows expire ~48h out).
- Anonymous abuse guard: also write an `ip:<ip>` subject row and block if **either** the cookie row **or** the IP row is exhausted.

### HTTP status codes
- Quota exhausted (tier cap reached): **402** `{ error: 'quota_exceeded', tier, reason, reset }` (matches existing `token_limit_exceeded` use).
- Burst rate limit (too many requests in window): **429** `{ error: 'rate_limited' }`.
- Subject blocked (manual or auto abuse block): **403** `{ error: 'blocked', reason }`.
- Token not found: **404**; token inactive/expired/unprocessed: **403**.
- CSRF missing/invalid: **403**. Admin required: **401**.

### Blocking / abuse control
A subject (account email **or** client IP) can be blocked two ways: **manually** by an admin in the dashboard, or **automatically** when a burst of requests trips the abuse threshold. Blocked subjects are denied at the start of the request path with **403 `blocked`** — checked before quota.

`Blocks` DynamoDB table:
- PK `subject` (`user:<email>` or `ip:<ip>`).
- Attrs `reason:S`, `source:S` (`'manual'|'auto'`), `createdAt:S`, optional `ttl:N` (epoch seconds — auto-blocks expire; manual blocks omit `ttl` and persist until removed).
- A request resolves its candidate subjects (`ip:<ip>` always; `user:<email>` when authenticated) and is blocked if **any** candidate has a live `Blocks` row.
- Auto-block: a short burst window counter (reuse `RateLimits`); when a subject exceeds `BURST_MAX` requests in `BURST_WINDOW_SEC`, write an `auto` block with a 1h `ttl` for `ip:<ip>`.
- IAM: user role gets `GetItem` + `PutItem` on `Blocks` (read for the check, write for auto-block). admin-fn gets full access (Scan/Put/Delete) for the admin portal.

### Two IAM roles (reconciled with OpenNext)
- **OpenNext server role (user-scoped):** `dynamodb:GetItem|PutItem|UpdateItem|Query` on `Conversations`, `Tokens`, `Users`, `TokenRequests`, `Usage`, `RateLimits` + their indexes. **No** `Scan`, **no** `DeleteItem` on `Users`/`Tokens`. `DeleteItem` on `Conversations` allowed (owner-checked in app). Plus `lambda:InvokeFunction` on the admin-fn ARN only.
- **admin-fn role (privileged):** full `dynamodb:*` (Scan/Delete/Put/Update/Get) on all five tables.
- Admin route handlers verify Auth0 admin, then call `adminInvoke(op, payload)` → `admin-fn`. The user Lambda never deletes users/tokens or scans tables directly.

### Auth0 (one SDK for the whole app)
- `@auth0/nextjs-auth0` v4. Env: `AUTH0_SECRET`, `APP_BASE_URL=https://chat.hectoragomez.com`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SCOPE='openid profile email'`. Admin identity via `ADMIN_EMAIL`.
- Server: `auth0.getSession()` in route handlers / server components.
- Client: `<Auth0Provider>` + `useUser()` for login state.

---

## Phase 0 — Repo Scaffold & Tooling

**Goal:** An empty-but-runnable Next.js + TypeScript + CloudScape app with test harness, committed.

**Files:**
- Create: `chatbot-v2/package.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `lib/http.ts`, `tests/smoke.test.ts`
- Init: git repo

- [ ] **Step 1: Initialize the repo and Next app skeleton**

```bash
cd /Users/hectorgomez/Workspace/chatbot-v2
git init
```

Create `package.json`:

```json
{
  "name": "chatbot-v2",
  "private": true,
  "type": "module",
  "engines": { "node": "22.x" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "ddb:start": "docker compose up -d dynamodb",
    "ddb:bootstrap": "LOCAL_DDB=true DDB_ENDPOINT=http://localhost:8000 node scripts/bootstrap-ddb.mjs"
  },
  "dependencies": {
    "@auth0/nextjs-auth0": "^4.0.0",
    "@aws-sdk/client-dynamodb": "^3.700.0",
    "@aws-sdk/client-lambda": "^3.700.0",
    "@aws-sdk/lib-dynamodb": "^3.700.0",
    "@cloudscape-design/components": "^3.0.0",
    "@cloudscape-design/global-styles": "^1.0.0",
    "@emoji-mart/data": "^1.2.1",
    "@emoji-mart/react": "^1.1.1",
    "i18next": "^25.4.2",
    "i18next-browser-languagedetector": "^8.2.0",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-i18next": "^15.7.3",
    "react-markdown": "^10.1.0",
    "rehype-highlight": "^7.0.2",
    "remark-gfm": "^4.0.1",
    "uuid": "^11.1.0",
    "zod": "^4.1.11"
  },
  "devDependencies": {
    "@playwright/test": "^1.56.1",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.8"
  }
}
```

Run: `npm install`

- [ ] **Step 2: Write config files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "infra", "admin-fn"]
}
```

`next.config.ts` (CloudScape must be transpiled by Next):

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@cloudscape-design/components',
    '@cloudscape-design/component-toolkit',
    '@cloudscape-design/global-styles',
  ],
};

export default nextConfig;
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'lib/**/*.test.ts'],
  },
  resolve: { alias: { '@': new URL('.', import.meta.url).pathname } },
});
```

Create `tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Write `lib/http.ts` (shared response helpers) with a failing test**

Create `lib/http.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { errorStatus } from './http.js';

describe('errorStatus', () => {
  it('maps token errors to http codes', () => {
    expect(errorStatus('TOKEN_NOT_FOUND')).toBe(404);
    expect(errorStatus('TOKEN_INACTIVE')).toBe(403);
    expect(errorStatus('TOKEN_EXPIRED')).toBe(403);
    expect(errorStatus('TOKEN_REQUEST_NOT_PROCESSED')).toBe(403);
    expect(errorStatus('quota_exceeded')).toBe(402);
    expect(errorStatus('rate_limited')).toBe(429);
    expect(errorStatus('anything_else')).toBe(500);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- lib/http.test.ts`
Expected: FAIL — `Cannot find module './http.js'`.

- [ ] **Step 5: Implement `lib/http.ts`**

```ts
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
  return json({ error: message, ...extra }, errorStatus(message));
}
```

- [ ] **Step 6: Write minimal root layout + landing placeholder**

`app/globals.css`:

```css
html, body { margin: 0; padding: 0; height: 100%; }
#__next, body { min-height: 100%; }
```

`app/layout.tsx`:

```tsx
import '@cloudscape-design/global-styles/index.css';
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'chat.hectoragomez.com' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`app/page.tsx`:

```tsx
export default function Home() {
  return <main>chatbot-v2 scaffold</main>;
}
```

- [ ] **Step 7: Verify the app builds and tests pass**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean, `http.test.ts` PASS, `next build` succeeds.

- [ ] **Step 8: Copy `.env.example` and DDB tooling**

Copy `/Users/hectorgomez/Workspace/chatbot-api/docker-compose.yml` and `scripts/bootstrap-ddb.mjs` into `chatbot-v2/` (the bootstrap script is extended in Phase 1). Create `.env.example`:

```
# Local DynamoDB
LOCAL_DDB=true
DDB_ENDPOINT=http://localhost:8000
AWS_REGION=us-east-1
# LLM providers
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
OPENAI_MODEL=gpt-4.1-nano
DEEPSEEK_MODEL=deepseek-chat
# Auth0 (nextjs-auth0 v4)
AUTH0_SECRET=
APP_BASE_URL=http://localhost:3000
AUTH0_DOMAIN=
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
AUTH0_SCOPE=openid profile email
ADMIN_EMAIL=
# CSRF
CSRF_SECRET=change_this_secret
# admin-fn (set by infra at deploy)
ADMIN_FN_NAME=chatbot-v2-admin
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js + CloudScape + vitest for chatbot-v2"
```

---

## Phase 1 — Data Layer & Business Logic Port

**Goal:** All DynamoDB business logic ported and unit-tested against local DynamoDB, plus the new `Usage` table, `quota.ts`, and `models.ts`.

**Files:**
- Create (port): `lib/ddb.ts`, `lib/tokens.ts`, `lib/users.ts`, `lib/conversations.ts`, `lib/providers.ts`, `lib/prompts.ts`, `lib/rateLimits.ts`, `lib/csrf.ts`, `src/config/prompts.json`
- Create (new): `lib/usage.ts`, `lib/quota.ts`, `lib/models.ts`
- Modify: `scripts/bootstrap-ddb.mjs` (add `Usage` table)
- Test: `lib/usage.test.ts`, `lib/quota.test.ts`, `lib/models.test.ts`, `lib/csrf.test.ts`

### Task 1.1: Port `lib/ddb.ts` + add Usage type

- [ ] **Step 1: Copy `ddb.ts` verbatim, add Usage table + type**

Copy `/Users/hectorgomez/Workspace/chatbot-api/src/lib/ddb.ts` to `chatbot-v2/lib/ddb.ts` unchanged, then add to the `TABLES` map and the type exports:

```ts
export const TABLES = {
  Tokens: process.env.DDB_TOKENS || 'Tokens',
  Users: process.env.DDB_USERS || 'Users',
  Conversations: process.env.DDB_CONVERSATIONS || 'Conversations',
  RateLimits: process.env.DDB_RATELIMITS || 'RateLimits',
  TokenRequests: process.env.DDB_TOKENS_REQUEST || 'TokenRequests',
  Usage: process.env.DDB_USAGE || 'Usage',
  Blocks: process.env.DDB_BLOCKS || 'Blocks',
};

export type UsageDoc = {
  subject: string;   // "anon:<id>" | "ip:<ip>" | "user:<email>"
  period: string;    // "lifetime" | "YYYY-MM-DD"
  questions: number;
  tokens: number;
  ttl: number;       // epoch seconds
};

export type BlockDoc = {
  subject: string;   // "user:<email>" | "ip:<ip>"
  reason: string;
  source: 'manual' | 'auto';
  createdAt: string;
  ttl?: number;      // epoch seconds; omitted for manual (permanent) blocks
};
```

Also extend `UserDoc` (used by Phase 2/5):

```ts
export type UserDoc = {
  user_id: string;
  email?: string;
  name?: string;
  company?: string;
  auth0_sub?: string;
  approved?: boolean;
  dailyLimit?: number; // default 1000
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 2: Port the rest of the lib modules verbatim**

Copy these from `chatbot-api/src/lib/` to `chatbot-v2/lib/` unchanged (their imports already use `./ddb.js` relative paths): `tokens.ts`, `users.ts`, `conversations.ts`, `providers.ts`, `prompts.ts`, `rateLimits.ts`. Copy `chatbot-api/src/config/prompts.json` to `chatbot-v2/src/config/prompts.json` (keep the path `prompts.ts` expects).

- [ ] **Step 3: Split `utils.ts` into `lib/csrf.ts`**

Create `lib/csrf.ts` with the pure crypto/CSRF/captcha functions from `chatbot-api/src/utils/utils.ts` (`hmac`, `randNonce`, `safeCompare`, `generateCSRFToken`, `verifyCSRFToken` rewritten for Web `Request`, `generateToken`). The Express middleware version of `rateLimit`/`verifyCSRFToken` is replaced by route-handler helpers in Phase 3 — keep only the pure functions here:

```ts
import crypto from 'crypto';

const SEC = process.env.CSRF_SECRET || 'change_this_secret';
export const CSRF_TTL_MS = 2 * 60 * 1000;

export function hmac(data: string) {
  return crypto.createHmac('sha256', SEC).update(data).digest('hex');
}
export function randNonce() {
  return crypto.randomBytes(16).toString('hex');
}
export function safeCompare(a: string, b: string) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function generateToken(user_id: string): string {
  const randomBytes = crypto.randomBytes(16);
  const timestamp = Date.now().toString(36);
  return crypto.createHash('sha256')
    .update(user_id + timestamp + randomBytes.toString('hex'))
    .digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    .slice(0, 32);
}
export function generateCSRFToken(origin: string) {
  const ts = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = JSON.stringify({ origin, ts, nonce });
  const sig = hmac(payload);
  const token = Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');
  return { token, expiresIn: CSRF_TTL_MS };
}
export function verifyCSRFTokenValue(token: string | null): boolean {
  if (!token) return false;
  let parsed: { payload: string; sig: string };
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
  } catch { return false; }
  if (!parsed?.payload || !parsed?.sig) return false;
  return safeCompare(hmac(parsed.payload), parsed.sig);
}
```

Note: `tokens.ts` imports `generateToken` from `../utils/utils.js`. Update its import to `./csrf.js`.

- [ ] **Step 4: Write `lib/csrf.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { generateCSRFToken, verifyCSRFTokenValue, generateToken } from './csrf.js';

describe('csrf', () => {
  it('round-trips a valid token', () => {
    const { token } = generateCSRFToken('https://chat.hectoragomez.com');
    expect(verifyCSRFTokenValue(token)).toBe(true);
  });
  it('rejects tampered token', () => {
    const { token } = generateCSRFToken('x');
    expect(verifyCSRFTokenValue(token + 'AAAA')).toBe(false);
    expect(verifyCSRFTokenValue(null)).toBe(false);
  });
  it('generateToken yields 32-char url-safe string', () => {
    const t = generateToken('a@b.com');
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
```

- [ ] **Step 5: Run csrf tests**

Run: `npm test -- lib/csrf.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/ src/config/prompts.json
git commit -m "feat: port DynamoDB business logic + csrf utils to lib/"
```

### Task 1.2: Add `Usage` + `Blocks` tables to bootstrap

- [ ] **Step 1: Add Usage table creation to `scripts/bootstrap-ddb.mjs`**

In the `Tables` object add `Usage: process.env.DDB_USAGE || "Usage"` and `Blocks: process.env.DDB_BLOCKS || "Blocks"`, and in `createTables()` add (composite key + TTL):

```js
if (!existing.TableNames?.includes(Tables.Usage)) {
  await client.send(new CreateTableCommand({
    TableName: Tables.Usage,
    KeySchema: [
      { AttributeName: "subject", KeyType: "HASH" },
      { AttributeName: "period", KeyType: "RANGE" }
    ],
    AttributeDefinitions: [
      { AttributeName: "subject", AttributeType: "S" },
      { AttributeName: "period", AttributeType: "S" }
    ],
    TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
    BillingMode: "PAY_PER_REQUEST"
  }));
  console.log(`➕ Created: ${Tables.Usage}`);
} else {
  console.log(`✅ Table exists: ${Tables.Usage}`);
}
```

- [ ] **Step 2: Add Blocks table creation to `scripts/bootstrap-ddb.mjs`**

```js
if (!existing.TableNames?.includes(Tables.Blocks)) {
  await client.send(new CreateTableCommand({
    TableName: Tables.Blocks,
    KeySchema: [
      { AttributeName: "subject", KeyType: "HASH" }
    ],
    AttributeDefinitions: [
      { AttributeName: "subject", AttributeType: "S" }
    ],
    TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
    BillingMode: "PAY_PER_REQUEST"
  }));
  console.log(`➕ Created: ${Tables.Blocks}`);
} else {
  console.log(`✅ Table exists: ${Tables.Blocks}`);
}
```

Also add `Tables.Usage` and `Tables.Blocks` to the `purgeAll()` loop list.

- [ ] **Step 3: Start local DDB and bootstrap**

Run: `npm run ddb:start && npm run ddb:bootstrap`
Expected: log shows all 7 tables created/exist including `Usage` and `Blocks`.

- [ ] **Step 4: Commit**

```bash
git add scripts/bootstrap-ddb.mjs
git commit -m "feat: add Usage + Blocks tables to DynamoDB bootstrap"
```

### Task 1.3: `lib/usage.ts` (date-partitioned usage rows)

- [ ] **Step 1: Write failing test `lib/usage.test.ts`**

These tests run against local DDB (`LOCAL_DDB=true`). Set env in the test file.

```ts
import { describe, it, expect, beforeAll } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { getUsage, addUsage, todayPeriod } = await import('./usage.js');

describe('usage', () => {
  const subject = `anon:test-${Date.now()}`;
  it('starts at zero', async () => {
    const u = await getUsage(subject, todayPeriod());
    expect(u.questions).toBe(0);
    expect(u.tokens).toBe(0);
  });
  it('accumulates questions and tokens', async () => {
    await addUsage(subject, todayPeriod(), 1, 120);
    await addUsage(subject, todayPeriod(), 1, 80);
    const u = await getUsage(subject, todayPeriod());
    expect(u.questions).toBe(2);
    expect(u.tokens).toBe(200);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npm test -- lib/usage.test.ts`
Expected: FAIL — `Cannot find module './usage.js'`.

- [ ] **Step 3: Implement `lib/usage.ts`**

```ts
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './ddb.js';
import type { UsageDoc } from './ddb.js';

export function todayPeriod(d = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function getUsage(subject: string, period: string): Promise<UsageDoc> {
  const out = await ddb().send(new GetCommand({
    TableName: TABLES.Usage,
    Key: { subject, period },
  }));
  return (out.Item as UsageDoc) ?? { subject, period, questions: 0, tokens: 0, ttl: 0 };
}

export async function addUsage(subject: string, period: string, questions: number, tokens: number): Promise<UsageDoc> {
  const ttl = Math.floor(Date.now() / 1000) + 60 * 60 * 48; // 48h
  const out = await ddb().send(new UpdateCommand({
    TableName: TABLES.Usage,
    Key: { subject, period },
    UpdateExpression: 'ADD #q :q, #t :tk SET #ttl = :ttl',
    ExpressionAttributeNames: { '#q': 'questions', '#t': 'tokens', '#ttl': 'ttl' },
    ExpressionAttributeValues: { ':q': questions, ':tk': tokens, ':ttl': ttl },
    ReturnValues: 'ALL_NEW',
  }));
  return out.Attributes as UsageDoc;
}
```

- [ ] **Step 4: Run usage tests**

Run: `npm test -- lib/usage.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/usage.ts lib/usage.test.ts
git commit -m "feat: add date-partitioned Usage accumulator"
```

### Task 1.4: `lib/models.ts` (model catalog)

- [ ] **Step 1: Write failing test `lib/models.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { MODELS, modelsForProvider, isValidModel, defaultModel } from './models.js';

describe('models', () => {
  it('lists models per provider', () => {
    expect(modelsForProvider('OPENAI').length).toBeGreaterThan(0);
    expect(modelsForProvider('DEEPSEEK').length).toBeGreaterThan(0);
  });
  it('validates a model id against a provider', () => {
    const id = MODELS.OPENAI[0].id;
    expect(isValidModel('OPENAI', id)).toBe(true);
    expect(isValidModel('OPENAI', 'bogus')).toBe(false);
  });
  it('returns a default model per provider', () => {
    expect(isValidModel('DEEPSEEK', defaultModel('DEEPSEEK'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npm test -- lib/models.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/models.ts`**

```ts
export type Provider = 'OPENAI' | 'DEEPSEEK';
export interface ModelOption { id: string; label: string; }

export const MODELS: Record<Provider, ModelOption[]> = {
  OPENAI: [
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { id: 'gpt-4o', label: 'GPT-4o' },
  ],
  DEEPSEEK: [
    { id: 'deepseek-chat', label: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  ],
};

export function modelsForProvider(p: Provider): ModelOption[] {
  return MODELS[p] ?? [];
}
export function isValidModel(p: Provider, id: string): boolean {
  return modelsForProvider(p).some((m) => m.id === id);
}
export function defaultModel(p: Provider): string {
  return modelsForProvider(p)[0].id;
}
```

- [ ] **Step 4: Run models tests; commit**

Run: `npm test -- lib/models.test.ts` → PASS.

```bash
git add lib/models.ts lib/models.test.ts
git commit -m "feat: add model catalog per provider"
```

### Task 1.5: `lib/quota.ts` (tiered quota engine)

- [ ] **Step 1: Write failing test `lib/quota.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { getQuotaStatus, consumeQuota } = await import('./quota.js');

describe('quota: anonymous', () => {
  it('blocks after 3 questions even under token cap', async () => {
    const anonId = `q-${Date.now()}`;
    const subject = { kind: 'anon' as const, anonId, ip: `1.2.3.${Date.now() % 255}` };
    for (let i = 0; i < 3; i++) {
      const s = await getQuotaStatus(subject);
      expect(s.blocked).toBe(false);
      await consumeQuota(subject, 10); // 10 tokens each, well under 1000
    }
    const s = await getQuotaStatus(subject);
    expect(s.blocked).toBe(true);
    expect(s.reason).toBe('questions_exhausted');
  });

  it('blocks when token cap hit before question cap', async () => {
    const anonId = `tk-${Date.now()}`;
    const subject = { kind: 'anon' as const, anonId, ip: `9.9.9.${Date.now() % 255}` };
    await consumeQuota(subject, 999);
    let s = await getQuotaStatus(subject);
    expect(s.blocked).toBe(false);
    await consumeQuota(subject, 2); // now 1001 > 1000
    s = await getQuotaStatus(subject);
    expect(s.blocked).toBe(true);
    expect(s.reason).toBe('tokens_exhausted');
  });
});

describe('quota: unapproved logged-in', () => {
  it('grants 1000 daily tokens (resets daily), no question cap', async () => {
    const subject = { kind: 'user' as const, email: `u-${Date.now()}@x.com`, approved: false, token: undefined };
    const s = await getQuotaStatus(subject);
    expect(s.tier).toBe('unapproved');
    expect(s.maxTokens).toBe(1000);
    expect(s.maxQuestions).toBeNull();
    expect(s.resetsDaily).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npm test -- lib/quota.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/quota.ts`**

```ts
import { getUsage, addUsage, todayPeriod } from './usage.js';
import type { TokenDoc } from './ddb.js';

export const ANON_QUESTIONS = 3;
export const ANON_TOKENS = 1000;
export const UNAPPROVED_TOKENS = 1000;
export const DAILY_TOKENS = 1000;

export type QuotaSubject =
  | { kind: 'anon'; anonId: string; ip: string }
  | { kind: 'user'; email: string; approved: boolean; token?: TokenDoc };

export type Tier = 'anon' | 'unapproved' | 'approved';
export type BlockReason = 'questions_exhausted' | 'tokens_exhausted';

export interface QuotaStatus {
  tier: Tier;
  questionsUsed: number;
  tokensUsed: number;
  maxQuestions: number | null;
  maxTokens: number;
  remainingTokens: number;
  remainingQuestions: number | null;
  blocked: boolean;
  reason?: BlockReason;
  resetsDaily: boolean;
}

function tierOf(s: QuotaSubject): Tier {
  if (s.kind === 'anon') return 'anon';
  if (s.approved && s.token && (s.token.limit - s.token.used) > 0) return 'approved';
  return s.approved ? 'approved' : 'unapproved';
}

// Anonymous: block if EITHER the cookie subject OR the ip subject is exhausted.
async function anonUsage(anonId: string, ip: string) {
  const period = todayPeriod();
  const [byCookie, byIp] = await Promise.all([
    getUsage(`anon:${anonId}`, period),
    getUsage(`ip:${ip}`, period),
  ]);
  return {
    questions: Math.max(byCookie.questions, byIp.questions),
    tokens: Math.max(byCookie.tokens, byIp.tokens),
  };
}

export async function getQuotaStatus(s: QuotaSubject): Promise<QuotaStatus> {
  const tier = tierOf(s);

  if (tier === 'anon') {
    const a = s as Extract<QuotaSubject, { kind: 'anon' }>;
    const used = await anonUsage(a.anonId, a.ip);
    const blockedByQ = used.questions >= ANON_QUESTIONS;
    const blockedByT = used.tokens >= ANON_TOKENS;
    return {
      tier, questionsUsed: used.questions, tokensUsed: used.tokens,
      maxQuestions: ANON_QUESTIONS, maxTokens: ANON_TOKENS,
      remainingTokens: Math.max(0, ANON_TOKENS - used.tokens),
      remainingQuestions: Math.max(0, ANON_QUESTIONS - used.questions),
      blocked: blockedByQ || blockedByT,
      reason: blockedByT ? 'tokens_exhausted' : (blockedByQ ? 'questions_exhausted' : undefined),
      resetsDaily: true,
    };
  }

  const u = s as Extract<QuotaSubject, { kind: 'user' }>;

  if (tier === 'unapproved') {
    // 1000 tokens/day; resets daily once exhausted (same reset behavior as the
    // approved-daily fallback). Keyed by today's period, not 'lifetime'.
    const used = await getUsage(`user:${u.email}`, todayPeriod());
    return {
      tier, questionsUsed: used.questions, tokensUsed: used.tokens,
      maxQuestions: null, maxTokens: UNAPPROVED_TOKENS,
      remainingTokens: Math.max(0, UNAPPROVED_TOKENS - used.tokens),
      remainingQuestions: null,
      blocked: used.tokens >= UNAPPROVED_TOKENS,
      reason: used.tokens >= UNAPPROVED_TOKENS ? 'tokens_exhausted' : undefined,
      resetsDaily: true,
    };
  }

  // approved: consume Token.limit first; when exhausted fall back to DAILY_TOKENS/day
  const tokenRemaining = u.token ? Math.max(0, u.token.limit - u.token.used) : 0;
  if (tokenRemaining > 0) {
    return {
      tier, questionsUsed: 0, tokensUsed: u.token!.used,
      maxQuestions: null, maxTokens: u.token!.limit,
      remainingTokens: tokenRemaining, remainingQuestions: null,
      blocked: false, resetsDaily: false,
    };
  }
  const daily = await getUsage(`user:${u.email}`, todayPeriod());
  return {
    tier, questionsUsed: daily.questions, tokensUsed: daily.tokens,
    maxQuestions: null, maxTokens: DAILY_TOKENS,
    remainingTokens: Math.max(0, DAILY_TOKENS - daily.tokens),
    remainingQuestions: null,
    blocked: daily.tokens >= DAILY_TOKENS,
    reason: daily.tokens >= DAILY_TOKENS ? 'tokens_exhausted' : undefined,
    resetsDaily: true,
  };
}

// Record consumption of one question + `tokens` against the right ledger.
// Approved users whose Token still has room are charged on the Token by the
// caller (incrementTokenUsed); this only writes the Usage ledger for the
// anon / unapproved / approved-daily ledgers.
export async function consumeQuota(s: QuotaSubject, tokens: number): Promise<void> {
  if (s.kind === 'anon') {
    const period = todayPeriod();
    await Promise.all([
      addUsage(`anon:${s.anonId}`, period, 1, tokens),
      addUsage(`ip:${s.ip}`, period, 1, tokens),
    ]);
    return;
  }
  const tier = tierOf(s);
  if (tier === 'unapproved') {
    await addUsage(`user:${s.email}`, todayPeriod(), 1, tokens);
    return;
  }
  // approved with token room → charged on Token elsewhere; only ledger daily once token empty
  const tokenRemaining = s.token ? Math.max(0, s.token.limit - s.token.used) : 0;
  if (tokenRemaining <= 0) {
    await addUsage(`user:${s.email}`, todayPeriod(), 1, tokens);
  }
}
```

- [ ] **Step 4: Run quota tests**

Run: `npm test -- lib/quota.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/quota.ts lib/quota.test.ts
git commit -m "feat: tiered quota engine (anon/unapproved/approved)"
```

### Task 1.6: `lib/blocks.ts` + `lib/abuse.ts` (block subjects + burst auto-block)

- [ ] **Step 1: Write failing test `lib/blocks.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { addBlock, removeBlock, findBlock } = await import('./blocks.js');

describe('blocks', () => {
  it('returns null when no subject is blocked', async () => {
    const hit = await findBlock([`ip:1.2.3.${Date.now() % 255}`]);
    expect(hit).toBeNull();
  });
  it('finds a manual block by account or ip', async () => {
    const email = `user:b-${Date.now()}@x.com`;
    await addBlock(email, 'spam', 'manual');
    const hit = await findBlock(['ip:9.9.9.9', email]);
    expect(hit?.subject).toBe(email);
    expect(hit?.source).toBe('manual');
  });
  it('removes a block', async () => {
    const ip = `ip:5.5.5.${Date.now() % 255}`;
    await addBlock(ip, 'burst', 'auto', 3600);
    await removeBlock(ip);
    expect(await findBlock([ip])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npm test -- lib/blocks.test.ts`
Expected: FAIL — `Cannot find module './blocks.js'`.

- [ ] **Step 3: Implement `lib/blocks.ts`**

```ts
import { GetCommand, PutCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './ddb.js';
import type { BlockDoc } from './ddb.js';

function isLive(b: BlockDoc): boolean {
  if (!b.ttl) return true; // permanent (manual)
  return b.ttl > Math.floor(Date.now() / 1000);
}

export async function findBlock(subjects: string[]): Promise<BlockDoc | null> {
  for (const subject of subjects) {
    const out = await ddb().send(new GetCommand({ TableName: TABLES.Blocks, Key: { subject } }));
    const b = out.Item as BlockDoc | undefined;
    if (b && isLive(b)) return b;
  }
  return null;
}

export async function addBlock(subject: string, reason: string, source: 'manual' | 'auto', ttlSeconds?: number): Promise<BlockDoc> {
  const doc: BlockDoc = {
    subject, reason, source,
    createdAt: new Date().toISOString(),
    ...(ttlSeconds ? { ttl: Math.floor(Date.now() / 1000) + ttlSeconds } : {}),
  };
  await ddb().send(new PutCommand({ TableName: TABLES.Blocks, Item: doc }));
  return doc;
}

export async function removeBlock(subject: string): Promise<void> {
  await ddb().send(new DeleteCommand({ TableName: TABLES.Blocks, Key: { subject } }));
}

export async function listBlocks(limit = 200): Promise<BlockDoc[]> {
  const out = await ddb().send(new ScanCommand({ TableName: TABLES.Blocks, Limit: limit }));
  return (out.Items as BlockDoc[]) || [];
}

// Resolve the candidate block subjects for a request.
export function blockSubjects(opts: { ip: string; email?: string }): string[] {
  const subs = [`ip:${opts.ip}`];
  if (opts.email) subs.push(`user:${opts.email}`);
  return subs;
}
```

- [ ] **Step 4: Run blocks test**

Run: `npm run ddb:start && npm test -- lib/blocks.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write failing test `lib/abuse.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { recordHitAndMaybeBlock, BURST_MAX } = await import('./abuse.js');
const { findBlock } = await import('./blocks.js');

describe('abuse burst auto-block', () => {
  it(`auto-blocks an ip after exceeding BURST_MAX (${'$'}{BURST_MAX}) hits`, async () => {
    const ip = `7.1.1.${Date.now() % 255}`;
    let blocked = false;
    for (let i = 0; i < BURST_MAX + 2; i++) {
      blocked = await recordHitAndMaybeBlock(ip);
    }
    expect(blocked).toBe(true);
    expect(await findBlock([`ip:${ip}`])).not.toBeNull();
  });
});
```

- [ ] **Step 6: Run it, verify failure**

Run: `npm test -- lib/abuse.test.ts`
Expected: FAIL — `Cannot find module './abuse.js'`.

- [ ] **Step 7: Implement `lib/abuse.ts`** (reuses the `RateLimits` burst counter)

```ts
import { loadRateLimit, updateRateLimit } from './rateLimits.js';
import { addBlock } from './blocks.js';

export const BURST_WINDOW_SEC = 60;
export const BURST_MAX = 20;        // >20 completions / 60s ip → auto-block
export const AUTO_BLOCK_TTL_SEC = 60 * 60; // 1 hour

// Increments a short burst window counter for the ip; if it exceeds BURST_MAX,
// writes a 1h auto-block and returns true (caller should deny with 403).
export async function recordHitAndMaybeBlock(ip: string): Promise<boolean> {
  const key = `burst:ip:${ip}:${Math.floor(Date.now() / 1000 / BURST_WINDOW_SEC)}`;
  const current = await loadRateLimit(key);
  const count = current.count >= BURST_MAX ? current.count : await updateRateLimit(key, 1, BURST_WINDOW_SEC);
  if (count > BURST_MAX) {
    await addBlock(`ip:${ip}`, 'burst_auto', 'auto', AUTO_BLOCK_TTL_SEC);
    return true;
  }
  return false;
}
```

- [ ] **Step 8: Run abuse test**

Run: `npm test -- lib/abuse.test.ts`
Expected: PASS — ip auto-blocked after the burst.

- [ ] **Step 9: Commit**

```bash
git add lib/blocks.ts lib/blocks.test.ts lib/abuse.ts lib/abuse.test.ts
git commit -m "feat: block subjects + burst auto-block detection"
```

---

## Phase 2 — Auth0 Identity & Anonymous Tracking

**Goal:** Auth0 wired for the whole app (login/logout/session), server admin guard, and anon-id cookie issuance in middleware.

**Files:**
- Create: `app/api/auth/[auth0]/route.ts`, `lib/auth.ts`, `lib/anon.ts`, `middleware.ts`, `app/providers.tsx`
- Modify: `app/layout.tsx`
- Test: `lib/anon.test.ts`, `lib/auth.test.ts`

### Task 2.1: Anonymous identity (`lib/anon.ts`)

- [ ] **Step 1: Write failing test `lib/anon.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { clientIp, anonIdFrom } from './anon.js';

function req(headers: Record<string, string>) {
  return new Request('http://x', { headers });
}

describe('anon', () => {
  it('extracts first x-forwarded-for ip', () => {
    expect(clientIp(req({ 'x-forwarded-for': '5.5.5.5, 10.0.0.1' }))).toBe('5.5.5.5');
    expect(clientIp(req({}))).toBe('unknown');
  });
  it('reads anon id from cookie header', () => {
    expect(anonIdFrom(req({ cookie: 'anon_id=abc123; other=1' }))).toBe('abc123');
    expect(anonIdFrom(req({}))).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- lib/anon.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/anon.ts`**

```ts
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export function anonIdFrom(req: Request): string | null {
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  const m = cookie.match(/(?:^|;\s*)anon_id=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export const ANON_COOKIE = 'anon_id';
```

- [ ] **Step 4: Run; commit**

Run: `npm test -- lib/anon.test.ts` → PASS.

```bash
git add lib/anon.ts lib/anon.test.ts
git commit -m "feat: anonymous ip + cookie helpers"
```

### Task 2.2: `middleware.ts` issues anon cookie

- [ ] **Step 1: Implement `middleware.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';

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
```

- [ ] **Step 2: Manual verify**

Run: `npm run dev`, open `http://localhost:3000`, confirm a `Set-Cookie: anon_id=...` is present on first load (DevTools → Network → document response headers). Stop the server.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat: issue httpOnly anon_id cookie in middleware"
```

### Task 2.3: Auth0 SDK wiring + admin guard

- [ ] **Step 1: Create the Auth0 client + route**

`lib/auth0.ts`:

```ts
import { Auth0Client } from '@auth0/nextjs-auth0/server';
export const auth0 = new Auth0Client();
```

`app/api/auth/[auth0]/route.ts`:

```ts
import { auth0 } from '@/lib/auth0';
export const GET = auth0.middleware as never; // handled via middleware in v4
```

> Note: In `@auth0/nextjs-auth0` v4 the auth routes are served by the SDK middleware. If the installed version exposes `handleAuth()`, use `export const GET = handleAuth()` instead. Verify against the installed version's README before finalizing this file.

- [ ] **Step 2: Write `lib/auth.ts` (session + admin helpers) with a failing test**

`lib/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isAdminEmail } from './auth.js';

describe('isAdminEmail', () => {
  it('matches the configured admin', () => {
    process.env.ADMIN_EMAIL = 'boss@x.com';
    expect(isAdminEmail('boss@x.com')).toBe(true);
    expect(isAdminEmail('other@x.com')).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `npm test -- lib/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `lib/auth.ts`**

```ts
import { auth0 } from './auth0.js';

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
  const session = await auth0.getSession();
  if (!session?.user?.email) return null;
  return {
    email: session.user.email,
    name: session.user.name,
    sub: session.user.sub,
  };
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !isAdminEmail(user.email)) {
    throw new Error('ADMIN_REQUIRED');
  }
  return user;
}
```

- [ ] **Step 5: Run; commit**

Run: `npm test -- lib/auth.test.ts` → PASS.

```bash
git add lib/auth0.ts lib/auth.ts lib/auth.test.ts app/api/auth
git commit -m "feat: Auth0 session helpers + admin guard"
```

### Task 2.4: Client providers (Auth0 + i18n + appearance)

- [ ] **Step 1: Port i18n**

Create `i18n/resources.ts` exporting the `resources` object from `ai-bot-project/src/i18n.js` (copy en/es/fr/de verbatim). Create `i18n/config.ts`:

```ts
'use client';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { resources } from './resources';

if (!i18n.isInitialized) {
  i18n.use(LanguageDetector).use(initReactI18next).init({
    resources,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator', 'htmlTag'], caches: ['localStorage'], lookupLocalStorage: 'i18nextLng' },
  });
}
export default i18n;
```

- [ ] **Step 2: Implement `app/providers.tsx`**

```tsx
'use client';
import { Auth0Provider } from '@auth0/nextjs-auth0';
import { I18nextProvider } from 'react-i18next';
import { useEffect, useState, type ReactNode } from 'react';
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import i18n from '@/i18n/config';

export function Providers({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(Mode.Light);
  useEffect(() => {
    const saved = (localStorage.getItem('appearance') as Mode) || Mode.Light;
    setMode(saved);
    applyMode(saved);
  }, []);
  return (
    <Auth0Provider>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </Auth0Provider>
  );
}
```

- [ ] **Step 3: Wrap the app**

Modify `app/layout.tsx` body to `<body><Providers>{children}</Providers></body>` and import `{ Providers }` from `./providers`.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds (providers compile as client component).

- [ ] **Step 5: Commit**

```bash
git add i18n app/providers.tsx app/layout.tsx
git commit -m "feat: client providers (Auth0, i18n, appearance)"
```

---

## Phase 3 — User/Public API Route Handlers

**Goal:** All non-admin endpoints as Next route handlers, quota-enforced, reusing `lib/*`. Each handler returns the documented status codes.

**Files:**
- Create: `app/api/csrf/route.ts`, `app/api/prompts/route.ts`, `app/api/models/route.ts`, `app/api/me/route.ts`, `app/api/quota/route.ts`, `app/api/conversations/route.ts`, `app/api/conversations/[id]/route.ts`, `app/api/completions/route.ts`, `app/api/requestToken/route.ts`
- Create: `lib/subject.ts` (resolve a `QuotaSubject` from a Request)
- Test: `lib/subject.test.ts`, route tests under `tests/api/`

### Task 3.1: Subject resolver

- [ ] **Step 1: Write failing test `lib/subject.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('./auth.js', () => ({ getSessionUser: vi.fn(async () => null) }));
vi.mock('./users.js', () => ({ getUserById: vi.fn(async () => null) }));
vi.mock('./tokens.js', () => ({ listTokens: vi.fn(async () => []) }));

const { resolveSubject } = await import('./subject.js');

describe('resolveSubject', () => {
  it('returns anon subject when no session', async () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.1.1.1', cookie: 'anon_id=zzz' } });
    const s = await resolveSubject(req);
    expect(s.kind).toBe('anon');
    if (s.kind === 'anon') { expect(s.anonId).toBe('zzz'); expect(s.ip).toBe('1.1.1.1'); }
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- lib/subject.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/subject.ts`**

```ts
import { getSessionUser } from './auth.js';
import { getUserById } from './users.js';
import { listTokens } from './tokens.js';
import { clientIp, anonIdFrom } from './anon.js';
import type { QuotaSubject } from './quota.js';
import type { TokenDoc } from './ddb.js';

export async function resolveSubject(req: Request): Promise<QuotaSubject> {
  const user = await getSessionUser();
  if (!user) {
    return { kind: 'anon', anonId: anonIdFrom(req) ?? 'none', ip: clientIp(req) };
  }
  const userDoc = await getUserById(user.email);
  const approved = !!userDoc?.approved;
  // pick the user's active token with the most remaining, if any
  const tokens = (await listTokens(user.email, 10)) as TokenDoc[];
  const active = tokens
    .filter((t) => t.isActive)
    .sort((a, b) => (b.limit - b.used) - (a.limit - a.used))[0];
  return { kind: 'user', email: user.email, approved, token: active };
}
```

- [ ] **Step 4: Run; commit**

Run: `npm test -- lib/subject.test.ts` → PASS.

```bash
git add lib/subject.ts lib/subject.test.ts
git commit -m "feat: resolve quota subject from request"
```

### Task 3.2: Simple GET endpoints (csrf, prompts, models)

- [ ] **Step 1: Implement `app/api/csrf/route.ts`**

```ts
import { generateCSRFToken } from '@/lib/csrf';
import { json } from '@/lib/http';

export async function GET(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  return json(generateCSRFToken(origin));
}
```

- [ ] **Step 2: Implement `app/api/prompts/route.ts`**

```ts
import { listPrompts } from '@/lib/prompts';
import { json, fail } from '@/lib/http';

export async function GET() {
  try {
    return json(await listPrompts());
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
```

- [ ] **Step 3: Implement `app/api/models/route.ts`**

```ts
import { MODELS } from '@/lib/models';
import { json } from '@/lib/http';

export async function GET() {
  return json({ models: MODELS });
}
```

- [ ] **Step 4: Write route test `tests/api/simple.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { GET as csrf } from '@/app/api/csrf/route';
import { GET as models } from '@/app/api/models/route';

describe('simple routes', () => {
  it('csrf returns a token', async () => {
    const res = await csrf(new Request('http://x', { headers: { origin: 'http://x' } }));
    const body = await res.json();
    expect(body.token).toBeTruthy();
  });
  it('models returns provider catalog', async () => {
    const res = await models();
    const body = await res.json();
    expect(body.models.OPENAI.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run; commit**

Run: `npm test -- tests/api/simple.test.ts` → PASS.

```bash
git add app/api/csrf app/api/prompts app/api/models tests/api/simple.test.ts
git commit -m "feat: csrf/prompts/models route handlers"
```

### Task 3.3: `me` + `quota` endpoints

- [ ] **Step 1: Implement `app/api/quota/route.ts`**

```ts
import { resolveSubject } from '@/lib/subject';
import { getQuotaStatus } from '@/lib/quota';
import { json, fail } from '@/lib/http';

export async function GET(req: Request) {
  try {
    const subject = await resolveSubject(req);
    return json(await getQuotaStatus(subject));
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
```

- [ ] **Step 2: Implement `app/api/me/route.ts`**

```ts
import { getSessionUser } from '@/lib/auth';
import { getUserById } from '@/lib/users';
import { resolveSubject } from '@/lib/subject';
import { getQuotaStatus } from '@/lib/quota';
import { isAdminEmail } from '@/lib/auth';
import { json, fail } from '@/lib/http';

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    const subject = await resolveSubject(req);
    const quota = await getQuotaStatus(subject);
    if (!user) return json({ authenticated: false, quota });
    const doc = await getUserById(user.email);
    return json({
      authenticated: true,
      email: user.email,
      name: user.name ?? doc?.name,
      company: doc?.company,
      approved: !!doc?.approved,
      isAdmin: isAdminEmail(user.email),
      quota,
    });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/me app/api/quota
git commit -m "feat: me + quota snapshot endpoints"
```

### Task 3.4: Conversations endpoints

- [ ] **Step 1: Implement `app/api/conversations/route.ts` (list)**

```ts
import { getSessionUser } from '@/lib/auth';
import { getConversationsByUserAndToken, getLatestConversationByTokenUser } from '@/lib/conversations';
import { listTokens } from '@/lib/tokens';
import { json, fail } from '@/lib/http';
import type { TokenDoc } from '@/lib/ddb';

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return json({ valid: true, conversations: [] }); // anon: no persisted history
    const url = new URL(req.url);
    const all = url.searchParams.get('all') === 'true';
    const tokens = (await listTokens(user.email, 10)) as TokenDoc[];
    const token = tokens[0]?.token ?? '';
    if (!token) return json({ valid: true, conversations: [] });
    if (all) {
      return json({ valid: true, conversations: await getConversationsByUserAndToken(user.email, token) });
    }
    const latest = await getLatestConversationByTokenUser(token, user.email);
    return json({ valid: true, conversations: latest ? [latest] : [] });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
```

- [ ] **Step 2: Implement `app/api/conversations/[id]/route.ts` (get one + delete own)**

```ts
import { getSessionUser } from '@/lib/auth';
import { getConversation, deleteConversation } from '@/lib/conversations';
import { json, fail } from '@/lib/http';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const convo = await getConversation(id);
    if (!convo) return json({ error: 'conversation not found' }, 404);
    return json({ valid: true, conversation: convo });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return json({ error: 'unauthorized' }, 401);
    const { id } = await params;
    const convo = await getConversation(id);
    if (!convo) return json({ error: 'conversation not found' }, 404);
    if (convo.user_id !== user.email) return json({ error: 'forbidden' }, 403);
    await deleteConversation(id);
    return json({ valid: true, conversationId: id });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/conversations
git commit -m "feat: conversations list/get/delete-own endpoints"
```

### Task 3.5: Completions endpoint (quota + CSRF + model)

- [ ] **Step 1: Implement `app/api/completions/route.ts`**

```ts
import { getSessionUser } from '@/lib/auth';
import { resolveSubject } from '@/lib/subject';
import { getQuotaStatus, consumeQuota } from '@/lib/quota';
import { ensureConversation, getConversation, appendMessages, renameConversation, runSmallModelForSummary } from '@/lib/conversations';
import { runCompletion } from '@/lib/providers';
import { incrementTokenUsed } from '@/lib/tokens';
import { isValidModel, defaultModel, type Provider } from '@/lib/models';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { clientIp } from '@/lib/anon';
import { findBlock, blockSubjects } from '@/lib/blocks';
import { recordHitAndMaybeBlock } from '@/lib/abuse';
import { json, fail } from '@/lib/http';
import type { Message } from '@/lib/ddb';

export async function POST(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) {
    return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  }
  try {
    const { message, conversationId, provider, model } = await req.json();
    if (!message || !provider) return json({ error: 'message and provider required' }, 400);

    const subject = await resolveSubject(req);

    // Abuse control (before quota): burst auto-block, then block check → 403.
    const ip = clientIp(req);
    const subjectEmail = subject.kind === 'user' ? subject.email : undefined;
    const burstTripped = await recordHitAndMaybeBlock(ip);
    const block = await findBlock(blockSubjects({ ip, email: subjectEmail }));
    if (burstTripped || block) {
      return json({ error: 'blocked', reason: block?.reason ?? 'burst_auto' }, 403);
    }

    const pre = await getQuotaStatus(subject);
    if (pre.blocked) {
      return json({ error: 'quota_exceeded', tier: pre.tier, reason: pre.reason, resetsDaily: pre.resetsDaily }, 402);
    }

    const user = await getSessionUser();
    const email = user?.email ?? `anon:${subject.kind === 'anon' ? subject.anonId : 'x'}`;
    const chosenModel = isValidModel(provider as Provider, model) ? model : defaultModel(provider as Provider);

    // Anonymous users are not persisted; logged-in users get conversations.
    const persist = !!user;
    let convo = persist
      ? await ensureConversation(conversationId, (subject as { token?: { token: string } }).token?.token ?? email, email, provider)
      : null;

    const now = new Date().toISOString();
    const userMsg: Message = { role: 'user', content: String(message), createdAt: now };
    const history: Message[] = [...(convo?.messages ?? []), userMsg];

    const result = await runCompletion(provider, chosenModel, history);
    const cost = result.estimatedTokens;

    // Enforce token ceiling for this single call.
    if (cost > pre.remainingTokens) {
      return json({ error: 'quota_exceeded', tier: pre.tier, reason: 'tokens_exhausted', remaining: pre.remainingTokens }, 402);
    }

    const assistantMsg: Message = { role: 'assistant', content: result.content, createdAt: new Date().toISOString() };

    // Charge: approved-with-token-room → charge the Token; everyone else → Usage ledger.
    if (subject.kind === 'user' && subject.approved && subject.token && (subject.token.limit - subject.token.used) > 0) {
      await incrementTokenUsed(subject.token.token, cost);
    } else {
      await consumeQuota(subject, cost);
    }

    if (convo) {
      if (conversationId !== convo.conversation_id) {
        const title = await runSmallModelForSummary(userMsg.content, assistantMsg.content);
        await renameConversation(convo.conversation_id, title);
        convo = (await getConversation(convo.conversation_id))!;
      }
      await appendMessages(convo.conversation_id, [userMsg, assistantMsg]);
    }

    const post = await getQuotaStatus(await resolveSubject(req));
    return json({
      valid: true,
      conversationId: convo?.conversation_id ?? null,
      message: assistantMsg,
      displayName: convo?.displayName ?? null,
      remaining: post.remainingTokens,
      blocked: post.blocked,
    });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
```

- [ ] **Step 2: Write integration test `tests/api/completions.test.ts`**

Mock `@/lib/providers` so no real LLM call, anon subject, assert quota decrements and blocking. (Run against local DDB.)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
process.env.NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret';

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null), isAdminEmail: () => false }));
vi.mock('@/lib/providers', () => ({ runCompletion: vi.fn(async () => ({ content: 'hi', estimatedTokens: 10 })) }));

const { POST } = await import('@/app/api/completions/route');
const { generateCSRFToken } = await import('@/lib/csrf');

function makeReq(anonId: string) {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, 'x-forwarded-for': `7.7.7.${anonId.length}`, cookie: `anon_id=${anonId}` },
    body: JSON.stringify({ message: 'hello', provider: 'OPENAI', model: 'gpt-4o-mini' }),
  });
}

describe('completions anon quota', () => {
  const anonId = `c-${Date.now()}`;
  it('allows first 3 then blocks with 402', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await POST(makeReq(anonId));
      expect(res.status).toBe(200);
    }
    const res = await POST(makeReq(anonId));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('quota_exceeded');
  });
});
```

- [ ] **Step 3: Run completions test**

Run: `npm run ddb:start && npm test -- tests/api/completions.test.ts`
Expected: PASS — 4th call returns 402.

- [ ] **Step 4: Commit**

```bash
git add app/api/completions tests/api/completions.test.ts
git commit -m "feat: quota-aware completions endpoint with model selection"
```

### Task 3.6: requestToken endpoint

- [ ] **Step 1: Implement `app/api/requestToken/route.ts`**

Logged-in users may request without captcha (identity already proven); anonymous requests still require the captcha (reuse `createTokenRequestMaxThreeTokens`). Body: `{ tokenLimit, company, name?, provider }`.

```ts
import { getSessionUser } from '@/lib/auth';
import { createTokenRequestMaxThreeTokens } from '@/lib/tokens';
import { createUserIfNotExists } from '@/lib/users';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json, fail } from '@/lib/http';
import type { Provider } from '@/lib/models';

export async function POST(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) {
    return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  }
  try {
    const user = await getSessionUser();
    if (!user) return json({ error: 'login_required' }, 401);
    const { tokenLimit, company, provider, name } = await req.json();
    const limit = Number(tokenLimit);
    if (!provider || !Number.isFinite(limit) || limit <= 0) {
      return json({ error: 'provider and positive tokenLimit required' }, 400);
    }
    await createUserIfNotExists(user.email, name ?? user.name ?? user.email, user.email, company ?? '');
    const reqDoc = await createTokenRequestMaxThreeTokens(
      user.email, name ?? user.name ?? user.email, provider as Provider, limit, company ?? '',
    );
    return json({ valid: true, token: reqDoc.token, message: 'Request submitted for admin approval.' });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/requestToken
git commit -m "feat: logged-in token request endpoint (admin approval)"
```

---

## Phase 4 — Chat UI (CloudScape shell + reused internals)

**Goal:** Landing page lands directly in a new conversation; CloudScape AppLayout shell with conversation side panel, message list, input with emoji + model selector + send, settings (language + appearance), and a quota banner that disables input when blocked.

**Files:**
- Create: `app/page.tsx` (replace placeholder), `components/chat/*`, `lib/client/api.ts`, `lib/client/csrfClient.ts`
- Port: `MarkdownMessage.tsx`, `EmojiPicker.tsx` from `ai-bot-project`
- Test: `tests/components/ChatInput.test.tsx`, `tests/components/QuotaBanner.test.tsx`

### Task 4.1: Typed client API

- [ ] **Step 1: Implement `lib/client/csrfClient.ts`**

```ts
export async function getCsrf(): Promise<string> {
  const res = await fetch('/api/csrf');
  const data = await res.json();
  return data.token as string;
}
```

- [ ] **Step 2: Implement `lib/client/api.ts`**

```ts
import { getCsrf } from './csrfClient';

export interface QuotaStatusDTO {
  tier: 'anon' | 'unapproved' | 'approved';
  remainingTokens: number;
  remainingQuestions: number | null;
  blocked: boolean;
  reason?: string;
  resetsDaily: boolean;
}

export async function fetchModels() {
  const r = await fetch('/api/models');
  return (await r.json()).models as Record<string, { id: string; label: string }[]>;
}

export async function fetchMe() {
  const r = await fetch('/api/me');
  return r.json();
}

export async function fetchConversations() {
  const r = await fetch('/api/conversations?all=true');
  return r.json();
}

export async function sendCompletion(input: {
  message: string; provider: string; model: string; conversationId?: string | null;
}) {
  const csrf = await getCsrf();
  const r = await fetch('/api/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(input),
  });
  return { status: r.status, body: await r.json() };
}

export async function deleteConversation(id: string) {
  const r = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { status: r.status, body: await r.json() };
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/client
git commit -m "feat: typed client API wrappers"
```

### Task 4.2: Port presentational components

- [ ] **Step 1: Port `MarkdownMessage`**

Copy `ai-bot-project/src/components/MarkdownMessage.jsx` → `components/chat/MarkdownMessage.tsx`. Add `'use client'` at top, convert prop signature to typed:

```tsx
'use client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface Props { content: string; type: 'prompt' | 'response'; timestamp: string; }

export default function MarkdownMessage({ content, type, timestamp }: Props) {
  return (
    <div className={`md-message ${type}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
      <div className="md-timestamp">{timestamp}</div>
    </div>
  );
}
```

(Preserve the existing CSS by copying `MarkdownMessage.css` into `components/chat/` and importing it.)

- [ ] **Step 2: Port `EmojiPicker`**

Copy `ai-bot-project/src/components/EmojiPicker.jsx` → `components/chat/EmojiPicker.tsx`, add `'use client'`, type props `{ isOpen: boolean; onClose: () => void; onEmojiSelect: (emoji: string) => void }`. Keep the `@emoji-mart/react` usage.

- [ ] **Step 3: Build check; commit**

Run: `npm run build` → succeeds.

```bash
git add components/chat/MarkdownMessage.tsx components/chat/EmojiPicker.tsx components/chat/*.css
git commit -m "feat: port MarkdownMessage and EmojiPicker as client components"
```

### Task 4.3: ModelSelector + QuotaBanner

- [ ] **Step 1: Write failing test `tests/components/QuotaBanner.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuotaBanner } from '@/components/chat/QuotaBanner';

describe('QuotaBanner', () => {
  it('shows remaining tokens when not blocked', () => {
    render(<QuotaBanner quota={{ tier: 'anon', remainingTokens: 800, remainingQuestions: 2, blocked: false, resetsDaily: true }} />);
    expect(screen.getByText(/800/)).toBeInTheDocument();
  });
  it('shows a blocked message when blocked', () => {
    render(<QuotaBanner quota={{ tier: 'anon', remainingTokens: 0, remainingQuestions: 0, blocked: true, reason: 'questions_exhausted', resetsDaily: true }} />);
    expect(screen.getByText(/limit/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- tests/components/QuotaBanner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `components/chat/QuotaBanner.tsx`**

```tsx
'use client';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import type { QuotaStatusDTO } from '@/lib/client/api';

export function QuotaBanner({ quota }: { quota: QuotaStatusDTO }) {
  if (quota.blocked) {
    return (
      <Alert type="warning" header="You've reached your limit">
        {quota.reason === 'questions_exhausted'
          ? 'You have used all your free questions.'
          : 'You have used all your available tokens.'}
        {quota.resetsDaily ? ' Your limit resets tomorrow, or sign in / request more tokens.' : ' Sign in or request more tokens to continue.'}
      </Alert>
    );
  }
  return (
    <Box color="text-status-inactive" fontSize="body-s">
      {quota.remainingTokens} tokens
      {quota.remainingQuestions != null ? ` · ${quota.remainingQuestions} questions` : ''} remaining
    </Box>
  );
}
```

- [ ] **Step 4: Implement `components/chat/ModelSelector.tsx`**

```tsx
'use client';
import Select from '@cloudscape-design/components/select';
import { useEffect, useState } from 'react';
import { fetchModels } from '@/lib/client/api';

interface Props { provider: string; value: string; onChange: (id: string) => void; }

export function ModelSelector({ provider, value, onChange }: Props) {
  const [options, setOptions] = useState<{ label: string; value: string }[]>([]);
  useEffect(() => {
    fetchModels().then((m) => {
      const list = (m[provider] ?? []).map((x) => ({ label: x.label, value: x.id }));
      setOptions(list);
      if (list.length && !list.some((o) => o.value === value)) onChange(list[0].value);
    });
  }, [provider]);
  const selected = options.find((o) => o.value === value) ?? null;
  return (
    <Select
      selectedOption={selected}
      onChange={({ detail }) => onChange(detail.selectedOption.value!)}
      options={options}
      placeholder="Model"
      ariaLabel="Select model"
    />
  );
}
```

- [ ] **Step 5: Run QuotaBanner test; commit**

Run: `npm test -- tests/components/QuotaBanner.test.tsx` → PASS.

```bash
git add components/chat/QuotaBanner.tsx components/chat/ModelSelector.tsx tests/components/QuotaBanner.test.tsx
git commit -m "feat: QuotaBanner + ModelSelector (CloudScape)"
```

### Task 4.4: ChatInput (input + emoji + model + send, quota-aware)

- [ ] **Step 1: Write failing test `tests/components/ChatInput.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from '@/components/chat/ChatInput';

const baseQuota = { tier: 'anon' as const, remainingTokens: 500, remainingQuestions: 2, blocked: false, resetsDaily: true };

describe('ChatInput', () => {
  it('disables send + textarea when quota blocked', () => {
    render(<ChatInput provider="OPENAI" model="gpt-4o-mini" onModelChange={() => {}} onSend={() => {}} quota={{ ...baseQuota, blocked: true }} />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
  it('calls onSend with typed message', () => {
    const onSend = vi.fn();
    render(<ChatInput provider="OPENAI" model="gpt-4o-mini" onModelChange={() => {}} onSend={onSend} quota={baseQuota} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi there' } });
    fireEvent.click(screen.getByLabelText(/send/i));
    expect(onSend).toHaveBeenCalledWith('hi there');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- tests/components/ChatInput.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `components/chat/ChatInput.tsx`**

```tsx
'use client';
import { useState } from 'react';
import Textarea from '@cloudscape-design/components/textarea';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { ModelSelector } from './ModelSelector';
import { EmojiPickerButton } from './EmojiPickerButton';
import { QuotaBanner } from './QuotaBanner';
import type { QuotaStatusDTO } from '@/lib/client/api';

interface Props {
  provider: string;
  model: string;
  onModelChange: (id: string) => void;
  onSend: (message: string) => void;
  quota: QuotaStatusDTO;
}

export function ChatInput({ provider, model, onModelChange, onSend, quota }: Props) {
  const [value, setValue] = useState('');
  const disabled = quota.blocked;
  const submit = () => {
    if (disabled || value.trim() === '') return;
    onSend(value.trim());
    setValue('');
  };
  return (
    <SpaceBetween size="xs">
      <QuotaBanner quota={quota} />
      <SpaceBetween size="xs" direction="horizontal">
        <ModelSelector provider={provider} value={model} onChange={onModelChange} />
        <EmojiPickerButton disabled={disabled} onSelect={(e) => setValue((v) => v + e)} />
      </SpaceBetween>
      <Textarea
        value={value}
        disabled={disabled}
        onChange={({ detail }) => setValue(detail.value)}
        onKeyDown={({ detail }) => { if (detail.key === 'Enter' && !detail.shiftKey) submit(); }}
        placeholder="Type your message here..."
        rows={3}
      />
      <Button variant="primary" disabled={disabled} ariaLabel="Send" onClick={submit}>Send</Button>
    </SpaceBetween>
  );
}
```

Create `components/chat/EmojiPickerButton.tsx` wrapping the ported `EmojiPicker` behind a CloudScape `Button` toggle:

```tsx
'use client';
import { useState } from 'react';
import Button from '@cloudscape-design/components/button';
import EmojiPicker from './EmojiPicker';

export function EmojiPickerButton({ disabled, onSelect }: { disabled?: boolean; onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button iconName="contact" ariaLabel="Insert emoji" disabled={disabled} onClick={() => setOpen(true)} />
      <EmojiPicker isOpen={open} onClose={() => setOpen(false)} onEmojiSelect={(e) => { onSelect(e); setOpen(false); }} />
    </>
  );
}
```

- [ ] **Step 4: Run ChatInput test**

Run: `npm test -- tests/components/ChatInput.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/chat/ChatInput.tsx components/chat/EmojiPickerButton.tsx tests/components/ChatInput.test.tsx
git commit -m "feat: quota-aware ChatInput with model + emoji"
```

### Task 4.5: SettingsPanel (language + appearance)

- [ ] **Step 1: Implement `components/chat/SettingsPanel.tsx`**

```tsx
'use client';
import { useTranslation } from 'react-i18next';
import Select from '@cloudscape-design/components/select';
import FormField from '@cloudscape-design/components/form-field';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import { useState } from 'react';

const LANGS = [
  { label: 'English', value: 'en' }, { label: 'Español', value: 'es' },
  { label: 'Français', value: 'fr' }, { label: 'Deutsch', value: 'de' },
];

export function SettingsPanel() {
  const { i18n } = useTranslation();
  const [mode, setMode] = useState<string>(typeof window !== 'undefined' ? (localStorage.getItem('appearance') || 'light') : 'light');
  const lang = LANGS.find((l) => l.value === i18n.language) ?? LANGS[0];
  return (
    <SpaceBetween size="l">
      <FormField label="Language">
        <Select selectedOption={lang} options={LANGS}
          onChange={({ detail }) => i18n.changeLanguage(detail.selectedOption.value!)} />
      </FormField>
      <FormField label="Appearance">
        <Select
          selectedOption={{ label: mode === 'dark' ? 'Dark' : 'Light', value: mode }}
          options={[{ label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }]}
          onChange={({ detail }) => {
            const v = detail.selectedOption.value!;
            setMode(v);
            applyMode(v === 'dark' ? Mode.Dark : Mode.Light);
            localStorage.setItem('appearance', v);
          }}
        />
      </FormField>
    </SpaceBetween>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chat/SettingsPanel.tsx
git commit -m "feat: settings panel for language + appearance"
```

### Task 4.6: ConversationList, MessageList, ChatShell, landing page

- [ ] **Step 1: Implement `components/chat/ConversationList.tsx`**

```tsx
'use client';
import SideNavigation from '@cloudscape-design/components/side-navigation';

interface Convo { conversation_id: string; displayName: string; }
interface Props { conversations: Convo[]; activeId: string | null; onSelect: (id: string) => void; onNew: () => void; }

export function ConversationList({ conversations, activeId, onSelect, onNew }: Props) {
  return (
    <SideNavigation
      activeHref={activeId ? `#${activeId}` : '#new'}
      header={{ href: '#new', text: 'New conversation' }}
      onFollow={(e) => {
        e.preventDefault();
        if (e.detail.href === '#new') onNew();
        else onSelect(e.detail.href.slice(1));
      }}
      items={conversations.map((c) => ({ type: 'link', text: c.displayName, href: `#${c.conversation_id}` }))}
    />
  );
}
```

- [ ] **Step 2: Implement `components/chat/MessageList.tsx`**

```tsx
'use client';
import { useEffect, useRef } from 'react';
import MarkdownMessage from './MarkdownMessage';

interface Msg { role: 'user' | 'assistant' | 'system'; content: string; createdAt: string; }

export function MessageList({ messages, typing }: { messages: Msg[]; typing: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, typing]);
  return (
    <div className="chat-messages">
      {messages.map((m, i) => (
        <MarkdownMessage key={i} content={m.content} type={m.role === 'user' ? 'prompt' : 'response'}
          timestamp={new Date(m.createdAt).toLocaleString()} />
      ))}
      {typing && <div className="typing">Typing…</div>}
      <div ref={end} />
    </div>
  );
}
```

- [ ] **Step 3: Implement `components/chat/ChatShell.tsx`** (orchestrator; client component holding chat state — adapt the logic in `ai-bot-project/src/components/ChatBotApp.jsx` and `User.jsx`, but anon-friendly)

```tsx
'use client';
import { useEffect, useState } from 'react';
import AppLayout from '@cloudscape-design/components/app-layout';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import Button from '@cloudscape-design/components/button';
import { ConversationList } from './ConversationList';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { SettingsPanel } from './SettingsPanel';
import { fetchMe, fetchConversations, sendCompletion, deleteConversation } from '@/lib/client/api';
import type { QuotaStatusDTO } from '@/lib/client/api';

interface Msg { role: 'user' | 'assistant' | 'system'; content: string; createdAt: string; }
interface Convo { conversation_id: string; displayName: string; messages: Msg[]; }

const EMPTY_QUOTA: QuotaStatusDTO = { tier: 'anon', remainingTokens: 0, remainingQuestions: 0, blocked: false, resetsDaily: true };

export function ChatShell() {
  const [authenticated, setAuthenticated] = useState(false);
  const [conversations, setConversations] = useState<Convo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [provider, setProvider] = useState('OPENAI');
  const [model, setModel] = useState('gpt-4o-mini');
  const [quota, setQuota] = useState<QuotaStatusDTO>(EMPTY_QUOTA);
  const [typing, setTyping] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const me = await fetchMe();
      setAuthenticated(!!me.authenticated);
      setQuota(me.quota);
      if (me.authenticated) {
        const c = await fetchConversations();
        setConversations(c.conversations ?? []);
      }
    })();
  }, []);

  const startNew = () => { setActiveId(null); setMessages([]); };

  const selectConvo = (id: string) => {
    const c = conversations.find((x) => x.conversation_id === id);
    setActiveId(id);
    setMessages(c?.messages ?? []);
  };

  const onSend = async (text: string) => {
    const userMsg: Msg = { role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, userMsg]);
    setTyping(true);
    const { status, body } = await sendCompletion({ message: text, provider, model, conversationId: activeId });
    setTyping(false);
    if (status === 200 && body.valid) {
      setMessages((m) => [...m, body.message]);
      if (body.conversationId) setActiveId(body.conversationId);
      if (authenticated) { const c = await fetchConversations(); setConversations(c.conversations ?? []); }
    }
    const me = await fetchMe();
    setQuota(me.quota);
  };

  const removeConvo = async (id: string) => {
    await deleteConversation(id);
    setConversations((c) => c.filter((x) => x.conversation_id !== id));
    if (activeId === id) startNew();
  };

  return (
    <AppLayout
      navigationHide={!authenticated}
      navigation={<ConversationList conversations={conversations} activeId={activeId} onSelect={selectConvo} onNew={startNew} />}
      toolsOpen={toolsOpen}
      onToolsChange={({ detail }) => setToolsOpen(detail.open)}
      tools={<SettingsPanel />}
      content={
        <ContentLayout header={<Header variant="h1" actions={<Button onClick={() => setToolsOpen(true)} iconName="settings">Settings</Button>}>Chat</Header>}>
          <Container footer={<ChatInput provider={provider} model={model} onModelChange={setModel} onSend={onSend} quota={quota} />}>
            <MessageList messages={messages} typing={typing} />
          </Container>
        </ContentLayout>
      }
    />
  );
}
```

> Provider selection: keep `provider` state and add a CloudScape `Select` (OPENAI/DEEPSEEK) next to the model selector if you want per-provider switching; `ModelSelector` already re-loads options when `provider` changes. For the first cut, `provider` defaults to `OPENAI`.

- [ ] **Step 4: Replace `app/page.tsx` to land directly in a new conversation**

```tsx
import { ChatShell } from '@/components/chat/ChatShell';
export default function Home() {
  return <ChatShell />;
}
```

- [ ] **Step 5: Manual smoke + build**

Run: `npm run ddb:start && npm run ddb:bootstrap && npm run dev`. Open `http://localhost:3000`: lands in an empty new conversation, can send up to 3 messages as anon (uses the mocked/real provider), 4th send disables input via QuotaBanner. Then `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add components/chat app/page.tsx
git commit -m "feat: CloudScape chat shell, lands in new conversation, quota-aware"
```

---

## Phase 5 — Admin UI + Privileged admin-fn Lambda

**Goal:** `/admin` guarded by Auth0 admin, CloudScape dashboards (4 tables) with approve/edit/delete, all mutations routed through the privileged `admin-fn` Lambda via `adminInvoke`.

**Files:**
- Create: `admin-fn/handler.ts`, `admin-fn/ops.ts`, `lib/adminInvoke.ts`
- Create: `app/admin/layout.tsx`, `app/admin/page.tsx`, `components/admin/*`
- Create: `app/api/admin/tables/route.ts`, `app/api/admin/users/[email]/route.ts`, `app/api/admin/tokens/[token]/route.ts`, `app/api/admin/approveToken/[id]/route.ts`
- Test: `admin-fn/ops.test.ts`, `tests/components/UsersTable.test.tsx`

### Task 5.1: admin-fn ops + handler

- [ ] **Step 1: Write failing test `admin-fn/ops.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
const { runAdminOp } = await import('./ops.js');

describe('admin ops', () => {
  it('lists tables', async () => {
    const res = await runAdminOp({ op: 'listTables', payload: {} });
    expect(res).toHaveProperty('users');
    expect(res).toHaveProperty('tokens');
    expect(res).toHaveProperty('conversations');
    expect(res).toHaveProperty('unprocessedTokens');
  });
  it('rejects unknown op', async () => {
    await expect(runAdminOp({ op: 'nuke' as never, payload: {} })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- admin-fn/ops.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `admin-fn/ops.ts`** (reuses `lib/*` — the privileged role makes Scan/Delete possible)

```ts
import { listTokens, deleteToken, updateToken, transformTokenRequestToToken, listUnprocessedTokensRequest } from '../lib/tokens.js';
import { listUsers, updateUser, deleteUserById, createUserIfNotExists } from '../lib/users.js';
import { listConversations } from '../lib/conversations.js';
import { listBlocks, addBlock, removeBlock } from '../lib/blocks.js';

export type AdminOp =
  | { op: 'listTables'; payload: Record<string, never> }
  | { op: 'updateUser'; payload: { email: string; name?: string; company?: string } }
  | { op: 'deleteUser'; payload: { email: string } }
  | { op: 'addUser'; payload: { email: string; name?: string; company?: string } }
  | { op: 'updateToken'; payload: { token: string; limit?: number; isActive?: boolean; provider?: string } }
  | { op: 'deleteToken'; payload: { token: string } }
  | { op: 'approveToken'; payload: { tokenRequestId: string } }
  | { op: 'addBlock'; payload: { subject: string; reason: string } }
  | { op: 'removeBlock'; payload: { subject: string } };

export async function runAdminOp(cmd: AdminOp): Promise<unknown> {
  switch (cmd.op) {
    case 'listTables': {
      const [tokens, users, conversations, unprocessedTokens, blocks] = await Promise.all([
        listTokens(), listUsers(), listConversations(), listUnprocessedTokensRequest(), listBlocks(),
      ]);
      return { tokens, users, conversations, unprocessedTokens, blocks };
    }
    case 'updateUser':
      return updateUser(cmd.payload.email, cmd.payload.name, cmd.payload.email, cmd.payload.company);
    case 'deleteUser':
      return { deleted: await deleteUserById(cmd.payload.email) };
    case 'addUser':
      return { created: await createUserIfNotExists(cmd.payload.email, cmd.payload.name ?? cmd.payload.email, cmd.payload.email, cmd.payload.company ?? '') };
    case 'updateToken':
      return { updated: await updateToken(cmd.payload.token, cmd.payload as never) };
    case 'deleteToken':
      return { deleted: await deleteToken(cmd.payload.token) };
    case 'approveToken':
      return transformTokenRequestToToken(cmd.payload.tokenRequestId);
    case 'addBlock':
      // Admin-created blocks are permanent (no ttl) until removed.
      return addBlock(cmd.payload.subject, cmd.payload.reason, 'manual');
    case 'removeBlock':
      await removeBlock(cmd.payload.subject);
      return { removed: true };
    default:
      throw new Error('UNKNOWN_ADMIN_OP');
  }
}
```

- [ ] **Step 4: Implement `admin-fn/handler.ts`** (Lambda entry)

```ts
import { runAdminOp, type AdminOp } from './ops.js';

export const handler = async (event: AdminOp) => {
  try {
    const result = await runAdminOp(event);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
};
```

- [ ] **Step 5: Run ops test; commit**

Run: `npm run ddb:start && npm test -- admin-fn/ops.test.ts` → PASS.

```bash
git add admin-fn
git commit -m "feat: privileged admin-fn ops + handler"
```

### Task 5.2: adminInvoke + admin route handlers

- [ ] **Step 1: Implement `lib/adminInvoke.ts`**

In production it invokes the Lambda; locally (`LOCAL_DDB=true` / no `ADMIN_FN_NAME`) it calls `runAdminOp` directly so dev works without AWS.

```ts
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { AdminOp } from '@/admin-fn/ops';

let client: LambdaClient | null = null;

export async function adminInvoke(cmd: AdminOp): Promise<unknown> {
  const fnName = process.env.ADMIN_FN_NAME;
  if (!fnName || process.env.LOCAL_DDB === 'true') {
    const { runAdminOp } = await import('@/admin-fn/ops');
    return runAdminOp(cmd);
  }
  if (!client) client = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const out = await client.send(new InvokeCommand({
    FunctionName: fnName,
    Payload: Buffer.from(JSON.stringify(cmd)),
  }));
  const parsed = JSON.parse(Buffer.from(out.Payload!).toString('utf-8'));
  if (!parsed.ok) throw new Error(parsed.error || 'admin_invoke_failed');
  return parsed.result;
}
```

- [ ] **Step 2: Implement `app/api/admin/tables/route.ts`**

```ts
import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { json, fail } from '@/lib/http';

export async function GET() {
  try {
    await requireAdmin();
    const tables = await adminInvoke({ op: 'listTables', payload: {} });
    return json({ valid: true, tables });
  } catch (e) {
    const msg = (e as Error).message;
    return json({ error: msg }, msg === 'ADMIN_REQUIRED' ? 401 : 500);
  }
}
```

- [ ] **Step 3: Implement the mutation routes**

`app/api/admin/approveToken/[id]/route.ts`:

```ts
import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json } from '@/lib/http';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { id } = await params;
    const result = await adminInvoke({ op: 'approveToken', payload: { tokenRequestId: id } });
    return json({ valid: true, token: result });
  } catch (e) {
    const msg = (e as Error).message;
    return json({ error: msg }, msg === 'ADMIN_REQUIRED' ? 401 : 500);
  }
}
```

`app/api/admin/users/[email]/route.ts` — `PUT` (update) + `DELETE`, both `requireAdmin` + CSRF, dispatching `updateUser`/`deleteUser` ops. `app/api/admin/tokens/[token]/route.ts` — `PUT` (update) + `DELETE`, dispatching `updateToken`/`deleteToken`. Follow the same structure as the approveToken handler: verify CSRF, `await requireAdmin()`, read `params`, parse body for PUT, call `adminInvoke` with the matching op, return `json({ valid: true, ... })`, map `ADMIN_REQUIRED`→401 else 500.

- [ ] **Step 4: Implement `app/api/admin/blocks/route.ts`** (list / add / remove)

```ts
import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json } from '@/lib/http';

function deny(msg: string) {
  return json({ error: msg }, msg === 'ADMIN_REQUIRED' ? 401 : 500);
}

export async function GET() {
  try {
    await requireAdmin();
    const tables = await adminInvoke({ op: 'listTables', payload: {} }) as { blocks: unknown };
    return json({ valid: true, blocks: tables.blocks });
  } catch (e) { return deny((e as Error).message); }
}

export async function POST(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { subject, reason } = await req.json();
    if (!subject) return json({ error: 'subject required (user:<email> or ip:<ip>)' }, 400);
    const block = await adminInvoke({ op: 'addBlock', payload: { subject, reason: reason ?? 'manual' } });
    return json({ valid: true, block });
  } catch (e) { return deny((e as Error).message); }
}

export async function DELETE(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const subject = new URL(req.url).searchParams.get('subject');
    if (!subject) return json({ error: 'subject required' }, 400);
    await adminInvoke({ op: 'removeBlock', payload: { subject } });
    return json({ valid: true });
  } catch (e) { return deny((e as Error).message); }
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/adminInvoke.ts app/api/admin
git commit -m "feat: admin route handlers delegating to admin-fn (incl. blocks)"
```

### Task 5.3: Admin CloudScape tables + page

- [ ] **Step 1: Write failing test `tests/components/UsersTable.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UsersTable } from '@/components/admin/UsersTable';

describe('UsersTable', () => {
  it('renders user rows', () => {
    render(<UsersTable users={[{ user_id: 'a@b.com', email: 'a@b.com', name: 'Alice', company: 'Acme', createdAt: '', updatedAt: '' }]} onRefresh={() => {}} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- tests/components/UsersTable.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `components/admin/UsersTable.tsx`** (canonical CloudScape table pattern)

```tsx
'use client';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
import { getCsrf } from '@/lib/client/csrfClient';
import type { UserDoc } from '@/lib/ddb';

async function del(email: string, onRefresh: () => void) {
  const csrf = await getCsrf();
  await fetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } });
  onRefresh();
}

export function UsersTable({ users, onRefresh }: { users: UserDoc[]; onRefresh: () => void }) {
  return (
    <Table
      header={<Header counter={`(${users.length})`}>Users</Header>}
      items={users}
      columnDefinitions={[
        { id: 'email', header: 'Email', cell: (u) => u.email ?? u.user_id },
        { id: 'name', header: 'Name', cell: (u) => u.name ?? '' },
        { id: 'company', header: 'Company', cell: (u) => u.company ?? '' },
        { id: 'approved', header: 'Approved', cell: (u) => (u.approved ? 'Yes' : 'No') },
        { id: 'actions', header: '', cell: (u) => <Button variant="inline-link" onClick={() => del(u.user_id, onRefresh)}>Delete</Button> },
      ]}
      empty={<Box textAlign="center">No users</Box>}
      variant="container"
    />
  );
}
```

- [ ] **Step 4: Implement the other four tables following the same pattern**

- `components/admin/TokenRequestsTable.tsx`: items `TokenRequestDoc[]`; columns email (`user_id`), name, company, provider, limit, requested (`createdAt`); action **Approve** → `PUT /api/admin/approveToken/{token}` with CSRF, then `onRefresh()`.
- `components/admin/TokensTable.tsx`: items `TokenDoc[]`; columns token (truncate to 8 chars + `…`), user (`user_id`), provider, `used`/`limit`, isActive; actions Toggle active / Delete → `PUT|DELETE /api/admin/tokens/{token}`.
- `components/admin/ConversationsTable.tsx`: items `ConversationDoc[]`; columns displayName, user (`user_id`), provider, messages count (`messages.length`), updatedAt. Read-only.
- `components/admin/BlocksTable.tsx`: items `BlockDoc[]`; columns subject, reason, source (`manual`/`auto`), createdAt, expires (`ttl` → `new Date(ttl*1000)` or `Never`); action **Unblock** → `DELETE /api/admin/blocks?subject={subject}` with CSRF, then `onRefresh()`. Header includes an inline add control: a `subject` `Input` (placeholder `user:email or ip:1.2.3.4`) + `reason` `Input` + **Block** `Button` → `POST /api/admin/blocks` `{ subject, reason }` with CSRF, then `onRefresh()`.

Each is a `'use client'` component taking `{ items, onRefresh }` (UsersTable uses `{ users, onRefresh }`), using CloudScape `Table` + `Header` + `Button`, identical structure to `UsersTable`.

- [ ] **Step 5: Implement `app/admin/layout.tsx` (server guard)**

```tsx
import { redirect } from 'next/navigation';
import { getSessionUser, isAdminEmail } from '@/lib/auth';
import type { ReactNode } from 'react';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/auth/login?returnTo=/admin');
  if (!isAdminEmail(user.email)) redirect('/');
  return <>{children}</>;
}
```

> The `/auth/login` path is whatever the installed `@auth0/nextjs-auth0` v4 exposes for initiating login — confirm against its README and adjust the redirect target.

- [ ] **Step 6: Implement `app/admin/page.tsx`**

```tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { UsersTable } from '@/components/admin/UsersTable';
import { TokensTable } from '@/components/admin/TokensTable';
import { ConversationsTable } from '@/components/admin/ConversationsTable';
import { TokenRequestsTable } from '@/components/admin/TokenRequestsTable';
import { BlocksTable } from '@/components/admin/BlocksTable';

export default function AdminPage() {
  const [tables, setTables] = useState<any>(null);
  const load = useCallback(async () => {
    const r = await fetch('/api/admin/tables');
    const data = await r.json();
    setTables(data.tables);
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!tables) return <Spinner />;
  return (
    <ContentLayout header={<Header variant="h1">Admin</Header>}>
      <SpaceBetween size="l">
        <TokenRequestsTable items={tables.unprocessedTokens ?? []} onRefresh={load} />
        <UsersTable users={tables.users ?? []} onRefresh={load} />
        <TokensTable items={tables.tokens ?? []} onRefresh={load} />
        <BlocksTable items={tables.blocks ?? []} onRefresh={load} />
        <ConversationsTable items={tables.conversations ?? []} onRefresh={load} />
      </SpaceBetween>
    </ContentLayout>
  );
}
```

- [ ] **Step 7: Run UsersTable test; build; commit**

Run: `npm test -- tests/components/UsersTable.test.tsx` → PASS. Then `npm run build`.

```bash
git add components/admin app/admin
git commit -m "feat: CloudScape admin dashboards with approve/edit/delete"
```

### Task 5.4: Signup / token-request form

- [ ] **Step 1: Implement `components/auth/SignupRequestForm.tsx`** (adapt `RequestTokenForm.jsx` — but logged-in users submit company + tokenLimit + provider; no captcha needed since Auth0 proves identity)

```tsx
'use client';
import { useState } from 'react';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Alert from '@cloudscape-design/components/alert';
import { getCsrf } from '@/lib/client/csrfClient';

const PROVIDERS = [{ label: 'OpenAI', value: 'OPENAI' }, { label: 'DeepSeek', value: 'DEEPSEEK' }, { label: 'All', value: 'ANY' }];

export function SignupRequestForm() {
  const [company, setCompany] = useState('');
  const [tokenLimit, setTokenLimit] = useState('1000');
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  const submit = async () => {
    const csrf = await getCsrf();
    const r = await fetch('/api/requestToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ company, tokenLimit: Number(tokenLimit), provider: provider.value }),
    });
    setStatus(r.ok ? 'ok' : 'error');
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Form actions={<Button variant="primary" formAction="submit">Request tokens</Button>}>
        <SpaceBetween size="l">
          {status === 'ok' && <Alert type="success">Request submitted for admin approval.</Alert>}
          {status === 'error' && <Alert type="error">Could not submit request. You may have reached the maximum of 3 token requests.</Alert>}
          <FormField label="Company"><Input value={company} onChange={({ detail }) => setCompany(detail.value)} /></FormField>
          <FormField label="Tokens requested"><Input type="number" value={tokenLimit} onChange={({ detail }) => setTokenLimit(detail.value)} /></FormField>
          <FormField label="Provider"><Select selectedOption={provider} options={PROVIDERS} onChange={({ detail }) => setProvider(detail.selectedOption as typeof provider)} /></FormField>
        </SpaceBetween>
      </Form>
    </form>
  );
}
```

- [ ] **Step 2: Surface the form** — add a "Request more tokens" action in `ChatShell` header that opens the `SettingsPanel`/a CloudScape `Modal` containing `SignupRequestForm` when `authenticated`. For anonymous users show a login `Button` linking to the Auth0 login route instead.

- [ ] **Step 3: Commit**

```bash
git add components/auth/SignupRequestForm.tsx components/chat/ChatShell.tsx
git commit -m "feat: token-request form for logged-in users"
```

---

## Phase 6 — Infrastructure & Deploy (OpenNext + CDK + two IAM roles)

**Goal:** Deployable stack: import the 7 DynamoDB tables, create the two scoped roles, deploy Next via OpenNext to S3+Lambda+CloudFront at `chat.hectoragomez.com`, deploy `admin-fn`, wire Route53/ACM, and a GitHub Actions workflow.

**Files:**
- Create: `open-next.config.ts`, `infra/package.json`, `infra/cdk.json`, `infra/bin/app.ts`, `infra/lib/chatbot-v2-stack.ts`, `.github/workflows/deploy.yml`

### Task 6.1: OpenNext config + build

- [ ] **Step 1: Add OpenNext dependency**

Run: `npm install -D @opennextjs/aws`

- [ ] **Step 2: Create `open-next.config.ts`**

```ts
import { defineCloudfrontCompatibleConfig } from '@opennextjs/aws/config';
export default defineCloudfrontCompatibleConfig({});
```

> If the installed `@opennextjs/aws` version uses the plain `{ default: {} }` config shape instead of `defineCloudfrontCompatibleConfig`, follow its README. The build command is `npx open-next build`, which emits `.open-next/` (server function, asset bundle, image-optimization function).

- [ ] **Step 3: Verify the OpenNext build**

Run: `npx open-next build`
Expected: `.open-next/` directory created with `server-functions/`, `assets/`.

- [ ] **Step 4: Commit**

```bash
git add open-next.config.ts package.json package-lock.json
git commit -m "build: add OpenNext config"
```

### Task 6.2: CDK stack — tables, roles, OpenNext, admin-fn, domain

- [ ] **Step 1: Scaffold `infra/`**

Create `infra/package.json` (deps `aws-cdk-lib`, `constructs`, `cdk-nextjs-standalone` **or** manual constructs), `infra/cdk.json` (`{ "app": "npx tsx bin/app.ts" }`), `infra/bin/app.ts` modeled on the existing `chatbot-api/infra/bin/app.ts` but with `domainName: 'chat.hectoragomez.com'`, `hostedZoneId: 'Z01423473OIRTW86CLXNU'`, `hostedZoneName: 'hectoragomez.com'`.

- [ ] **Step 2: Implement `infra/lib/chatbot-v2-stack.ts`** — the two roles + admin-fn + OpenNext site

Use the `OpenNextCdkReferenceImplementation` or the community `cdk-nextjs` construct (`cdk-nextjs-standalone`'s `Nextjs`) to deploy `.open-next`. Key parts (representative — the exact construct API depends on the chosen package; the **roles and table grants are the load-bearing detail**):

```ts
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Nextjs } from 'cdk-nextjs-standalone';
import * as path from 'path';
import { Construct } from 'constructs';

const TABLE_NAMES = ['Tokens', 'Users', 'Conversations', 'RateLimits', 'TokenRequests', 'Usage', 'Blocks'];

export class ChatbotV2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps & { domainName: string; hostedZoneId: string; hostedZoneName: string }) {
    super(scope, id, props);

    const tables = TABLE_NAMES.map((n) => dynamodb.Table.fromTableName(this, `T${n}`, n));
    const byName = Object.fromEntries(TABLE_NAMES.map((n, i) => [n, tables[i]]));

    // ── Privileged admin-fn (full DDB) ──
    const adminFn = new NodejsFunction(this, 'AdminFn', {
      functionName: 'chatbot-v2-admin',
      entry: path.join(__dirname, '../../admin-fn/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      bundling: { format: cdk.aws_lambda_nodejs.OutputFormat.CJS, externalModules: ['@aws-sdk/*'] },
      environment: { /* OPENAI/DEEPSEEK keys not needed; DDB only */ },
    });
    tables.forEach((t) => t.grantReadWriteData(adminFn)); // includes Scan + Delete

    // ── OpenNext site (server Lambda = user-scoped role) ──
    const site = new Nextjs(this, 'Site', {
      nextjsPath: path.join(__dirname, '../..'),
      buildCommand: 'npx open-next build',
      domainProps: { domainName: props.domainName, hostedZone: props.hostedZoneName },
      environment: {
        ADMIN_FN_NAME: adminFn.functionName,
        AWS_REGION: this.region,
        // Auth0 + provider envs injected from SSM/secrets at deploy time
      },
    });

    // The OpenNext server function's role is the user-scoped role.
    const serverFn = site.serverFunction.lambdaFunction; // construct-specific accessor
    const userRole = serverFn.role as iam.Role;

    // Scoped DDB: Get/Put/Update/Query on all; Delete only on Conversations; no Scan.
    userRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
      resources: tables.flatMap((t) => [t.tableArn, `${t.tableArn}/index/*`]),
    }));
    userRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:DeleteItem'],
      resources: [byName.Conversations.tableArn],
    }));
    // Allow invoking ONLY the admin function.
    adminFn.grantInvoke(serverFn);

    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${props.domainName}` });
  }
}
```

> The exact accessors (`site.serverFunction.lambdaFunction`, domain wiring) depend on the chosen Next-on-CDK construct version. If using the OpenNext reference CDK implementation instead of `cdk-nextjs-standalone`, the S3 bucket + CloudFront + server Lambda are created explicitly and you attach the same two policy statements to the server function's role. Either way: **server fn = scoped policy above; admin-fn = full `grantReadWriteData`; server may only `grantInvoke` admin-fn.**

- [ ] **Step 3: Synthesize the stack**

Run: `cd infra && npm ci && npx cdk synth`
Expected: CloudFormation template synthesizes without errors; confirm the server function role has **no** `dynamodb:Scan` and **no** `DeleteItem` on `Users`/`Tokens`, and `admin-fn` role has full access.

- [ ] **Step 4: Commit**

```bash
git add infra
git commit -m "feat: CDK stack with two scoped IAM roles + OpenNext + admin-fn"
```

### Task 6.3: GitHub Actions deploy

- [ ] **Step 1: Create `.github/workflows/deploy.yml`** (model on the two existing workflows; OIDC role, build, cdk deploy)

```yaml
name: Deploy
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
permissions: { id-token: write, contents: read }
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
  deploy:
    needs: build-test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npx open-next build
        env:
          # build-time public envs as needed
          APP_BASE_URL: https://chat.hectoragomez.com
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1
      - run: npm ci
        working-directory: infra
      - run: npx cdk deploy --require-approval never
        working-directory: infra
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: build/test/deploy workflow for chatbot-v2"
```

### Task 6.4: End-to-end smoke (Playwright)

- [ ] **Step 1: Port `playwright.config.ts`** from `ai-bot-project` (point `baseURL` at `http://localhost:3000`, `webServer: { command: 'npm run dev', port: 3000 }`).

- [ ] **Step 2: Write `tests/e2e/anon-quota.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('anon lands in a new conversation and is rate-limited after 3 questions', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByPlaceholder('Type your message here...')).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.getByPlaceholder('Type your message here...').fill(`hello ${i}`);
    await page.getByRole('button', { name: /send/i }).click();
    await expect(page.getByText(/Typing/)).toHaveCount(0, { timeout: 15000 });
  }
  await expect(page.getByText(/reached your limit/i)).toBeVisible();
  await expect(page.getByPlaceholder('Type your message here...')).toBeDisabled();
});
```

- [ ] **Step 3: Run e2e (requires local DDB + a provider key or the provider mock)**

Run: `npm run ddb:start && npm run ddb:bootstrap && npm run test:e2e`
Expected: the spec passes — input disabled after 3 sends.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e
git commit -m "test: e2e anon quota flow"
```

---

## Spec → Task Traceability (self-review)

| Spec requirement | Covered by |
|---|---|
| Single NextJS repo merging both projects | Phase 0–1 (scaffold + lib port) |
| Lives at `chat.hectoragomez.com` | Phase 6.2 (domain), 6.3 (deploy) |
| CloudScape over ad-hoc components | Phase 4 (chat shell), Phase 5 (admin tables) |
| Backend + SSR via Lambda | Phase 3 (route handlers), Phase 6.1–6.2 (OpenNext server Lambda) |
| Auth0 guards `/admin` with dashboard tables | Phase 2.3 (guard), Phase 5.3 (`app/admin/layout.tsx` + tables) |
| UI assets in S3, served via entry point | Phase 6.1–6.2 (OpenNext assets → S3 → CloudFront) |
| Landing lands directly in new conversation | Phase 4.6 (`app/page.tsx` → `ChatShell`, `startNew`) |
| Track IP + cookie; anon 3 questions / 1000 tokens | Phase 2.1–2.2 (cookie+IP), Phase 1.5 (`quota.ts` anon tier), Phase 3.5 |
| Quota reached → disabled input + proper HTTP code | Phase 3.5 (402), Phase 4.4 (disabled input via `QuotaBanner`) |
| Auth0 login/register → request token, admin-approved | Phase 2.3, Phase 3.6 (`requestToken`), Phase 5.1/5.3 (approve) |
| Logged-in unapproved → 1000 tokens/day (resets daily on exhaustion) | Phase 1.5 (`unapproved` tier, daily period), Phase 3 |
| Block users by account or IP (manual admin + auto burst) | Phase 1.2 (`Blocks` table), Phase 1.6 (`blocks.ts`/`abuse.ts`), Phase 3.5 (403 check in completions), Phase 5 (admin `BlocksTable` + ops + route), Phase 6.2 (table grants) |
| Signup form: tokens requested + company + basic info | Phase 5.4 (`SignupRequestForm`) |
| Approved → quota then 1000/day or request more | Phase 1.5 (`approved` tier + daily fallback), Phase 5.4 |
| Chat UI: side panel, main window, language/appearance, input, emoji, submit, **model select** | Phase 4 (ConversationList, MessageList, SettingsPanel, ChatInput, EmojiPicker, ModelSelector) |
| Two AWS roles (admin ops vs user ops) | Phase 5.1–5.2 (admin-fn), Phase 6.2 (two scoped IAM roles) |
| Reuse existing components | Phase 1 (lib port), Phase 4.2 (MarkdownMessage/EmojiPicker), i18n port |

**Placeholder scan:** No `TODO`/`fill-in` steps. Three places intentionally defer to the *installed package's README* (Auth0 v4 route shape, OpenNext config shape, the Next-on-CDK construct accessor) because those APIs version-drift; each names the exact symbol to verify and the fallback. The three "other tables" (5.3 Step 4) and "other admin mutation routes" (5.2 Step 3) give full column/op specs rather than repeated boilerplate — verify each renders against its `*Doc` type.

**Type consistency check:** `QuotaSubject`/`QuotaStatus` defined in `lib/quota.ts` and consumed unchanged in `subject.ts`, `me`, `quota`, `completions`. `QuotaStatusDTO` (client) mirrors the server `QuotaStatus` fields used by the UI. `AdminOp` defined in `admin-fn/ops.ts` and imported by `lib/adminInvoke.ts`. `Provider`/`ModelOption` from `lib/models.ts` used in `providers`, `completions`, `ModelSelector`. `UserDoc`/`TokenDoc`/`ConversationDoc`/`TokenRequestDoc`/`UsageDoc` all from `lib/ddb.ts`.

## Notes & Risks

- **Provider model threading:** `runCompletion(provider, model, messages, promptId?)` already accepts `model`; Phase 3.5 passes the validated `chosenModel`. No provider signature change needed.
- **Anonymous persistence:** anon conversations are **not** stored in DynamoDB (no token/identity). They live only in client state for the session. This matches "3 questions" being ephemeral. If persistence for anon is later desired, key conversations on `anon:<id>`.
- **CSRF in same-origin Next:** since UI and API share an origin under CloudFront, CSRF tokens remain as defense-in-depth; the existing 2-minute HMAC scheme is preserved in `lib/csrf.ts`.
- **Daily reset is UTC** (`todayPeriod` uses `toISOString().slice(0,10)`). If a local-timezone reset is required, inject an offset.
- **SSM secrets:** Auth0 + provider keys should be injected into the OpenNext server function env via SSM/Secrets at deploy (mirror `chatbot-api/scripts/populate-ssm.sh`). Do not commit them.
```
