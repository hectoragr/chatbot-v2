# AGENTS.md

Guidance for AI coding agents working in this repo. Human-readable too.

## Project overview

`chatbot-v2` is a multi-provider LLM chat app (OpenAI + DeepSeek) built on
**Next.js 15 App Router** (React 19, TypeScript). It serves three tiers of
users — anonymous, logged-in-unapproved, and logged-in-approved — each with its
own usage quota. Data lives in **DynamoDB**; auth is **Auth0**; transactional
email is **AWS SES**; UI is the **Cloudscape Design System**. It deploys to AWS
via **OpenNext + CDK** behind CloudFront.

## Setup

```bash
npm install
cp .env.example .env.local        # fill in secrets (see below)
npm run ddb:start                 # local DynamoDB in Docker
npm run ddb:bootstrap             # create tables + GSIs locally
npm run dev                       # http://localhost:3000
```

Set `LOCAL_DDB=true` for local dev. It changes two behaviors:
- DynamoDB points at `DDB_ENDPOINT` with dummy creds.
- `adminInvoke` runs the admin op **in-process** instead of invoking the Lambda.
- `lib/email.ts` logs emails to the console instead of calling SES.

App runs anonymous-only if Auth0 isn't configured — never 500s on missing auth.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` — run before every commit |
| `npm run lint` | ESLint (next) |
| `npm test` | Vitest unit + component tests |
| `npm run test:e2e` | Playwright |
| `npm run build:opennext` | OpenNext bundle for AWS |

**Before any commit: `npm run typecheck && npm test`.** CI runs lint, typecheck,
and test as a gate before deploy (`.github/workflows/deploy.yml`).

## Project structure

```
app/                 Next.js routes (pages + API route handlers)
  api/               Backend endpoints (see "Request flow")
  admin/             Admin UI page
components/
  chat/              Chat UI (ChatShell orchestrates everything)
  admin/             Admin tables (users, tokens, conversations, blocks)
  auth/              Signup / token-request form
lib/                 Server logic — the core of the app
  client/            Browser-side fetch helpers (api.ts, csrfClient.ts)
admin-fn/            Privileged admin Lambda (ops.ts = the op switch)
infra/               AWS CDK stack (CloudFront, Lambda, S3, ACM)
scripts/             bootstrap-ddb.mjs (local table setup)
tests/               Vitest (api/, components/, client/, admin/) + e2e/
```

`lib/*.ts` files are colocated with their `*.test.ts`.

## Data model (DynamoDB)

All types in `lib/ddb.ts`. `user_id` **is the email** throughout this app.

| Table | Key | Notes |
|---|---|---|
| `Users` | `user_id` | `approved`, `pendingDelete`, `dailyLimit` |
| `Tokens` | `token` | Billing unit: `limit`/`used`, `isActive`, `provider` |
| `Conversations` | `conversation_id` | `messages[]`, `hidden` (soft delete) |
| `TokenRequests` | `token` | `processed`, `denied` |
| `Usage` | `subject` + `period` | Quota ledger, TTL'd |
| `RateLimits` | `key` | Burst counters, TTL'd |
| `Blocks` | `subject` | `manual` (permanent) or `auto` (TTL) |

GSIs on `Conversations`: `byUserCreatedAt` (all of a user's convos),
`byTokenUserCreatedAt` (one token's convos). Created by `ddb:bootstrap` locally.

## Architecture / key flows

### Request flow (`app/api/completions/route.ts`)
1. Verify CSRF header (`x-csrf-token`).
2. `resolveSubject(req)` → anon / unapproved-user / approved-user (with ALL
   active tokens attached).
3. Abuse gate: burst auto-block + block lookup → 403.
4. `getQuotaStatus(subject)` → 402 if blocked.
5. `runCompletion(provider, model, history)` calls the provider API.
6. Charge: approved-with-token-room → **provider-aware token selection** via
   `selectTokenForProvider()` (exact provider match → 'ANY' provider → best
   token fallback), then decrement the chosen **Token**; everyone else →
   **Usage** ledger (`consumeQuota`).
7. Persist conversation (logged-in only; anon is never stored). First reply
   triggers a cheap-model rename of the conversation title.

### Quota tiers (`lib/quota.ts`)
- **anon**: 3 questions OR 1000 tokens/day, keyed by cookie AND ip (max of both).
- **unapproved**: 1000 tokens/day.
- **approved**: sum of remaining across **all active tokens**; when all exhausted,
  falls back to 1000 tokens/day. Charging is **provider-aware**: usage is
  charged to the token matching the model's provider (via `providerForModel`),
  then to an 'ANY'-provider token, then to the "best" token as a last resort.

### Admin operations (`admin-fn/`)
Privileged mutations (purge user, approve/deny token, blocks) go through a single
op switch in `admin-fn/ops.ts`. In prod the API route calls `adminInvoke()` which
invokes the **admin Lambda**; locally it runs the same `runAdminOp()` in-process.
Add a new admin capability by extending the `AdminOp` union + the switch, then
adding a thin API route that calls `adminInvoke({ op, payload })`.

### Models (`lib/models.ts`)
`ALL_MODELS` is the unified catalog (both providers) sorted expensive→cheap with
cost labels. UI uses `ModelPicker` (single flat dropdown). `providerForModel(id)`
maps a model back to its provider.

## Conventions

- **TypeScript strict.** Keep `npm run typecheck` clean.
- **Cloudscape only** for UI — no raw HTML controls, no other component libs.
- **CSRF on every mutating request.** Client: `getCsrf()` then send
  `X-CSRF-Token`. Server route: `verifyCSRFTokenValue(...)` first, return 403 on
  fail. See `lib/csrf.ts`, `lib/client/csrfClient.ts`.
- **Soft delete** conversations (`hidden=true`), never hard-delete from user
  actions. Hard delete only via admin `purgeUser`.
- **Never trust the client for auth.** Re-derive the session server-side
  (`getSessionUser`, `requireAdmin`).
- `lib/` is server-only except `lib/client/`. Don't import server lib into
  components.
- New server logic ships with a colocated `*.test.ts` (Vitest, no heavy
  fixtures).
- i18n strings via `react-i18next` — don't hardcode user-facing copy.

## Testing

Vitest + Testing Library (jsdom). Tests live in `tests/` and beside `lib/`
files. Mock `fetch` for client/component tests. Playwright e2e in `tests/e2e/`
(`npm run test:e2e`). Always run `npm test` before committing.

## Deploy

`.github/workflows/deploy.yml`: on push, runs lint→typecheck→test, then builds
the OpenNext bundle and `cdk deploy`. Infra (`infra/lib/chatbot-v2-stack.ts`):
admin Lambda, S3 assets bucket, CloudFront distribution, optional ACM cert +
Route53 record when `domainName` is set. DynamoDB tables are provisioned outside
this stack.

## Environment variables

See `.env.example`. Key ones: `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, the `AUTH0_*`
set, `ADMIN_EMAIL` (single admin), `SES_FROM_EMAIL`, `CSRF_SECRET`,
`ADMIN_FN_NAME` (set by infra). `LOCAL_DDB`/`DDB_ENDPOINT` for local dev.
