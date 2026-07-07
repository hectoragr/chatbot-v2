# AGENTS.md

Guidance for AI coding agents working in this repo. Human-readable too.
`CLAUDE.md` is a symlink to this file — edit `AGENTS.md`, never create a
separate `CLAUDE.md`.

This file extends the global baseline at `~/Workspace/AGENTS.md` (request
modes, mock-first UI, testing and git/PR rules). On conflict, this file wins.

> **For multi-agent / multi-model runners:** this file is the contract. Read
> "Engineering standards" before writing code and "Definition of done" before
> claiming a task complete. Every rule here is enforced by review; violating
> one is a failed task, not a style preference.

## Project overview

`chatbot-v2` is a multi-provider LLM chat app (OpenAI + DeepSeek) built on
**Next.js 15 App Router** (React 19, TypeScript). It serves three tiers of
users — anonymous, logged-in-unapproved, and logged-in-approved — each with its
own usage quota. Data lives in **DynamoDB**; auth is **Auth0**; transactional
email is **AWS SES**; UI is the **Cloudscape Design System**. It deploys to AWS
via **OpenNext + CDK** behind CloudFront.

The app is AWS-native throughout. Design and review against the six pillars of
the [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
— see "AWS Well-Architected" below for how each pillar maps to this codebase.

## Setup

```bash
npm install
cp .env.example .env.local        # fill in secrets (see below)
npm run ddb:start                 # local DynamoDB in Docker
npm run ddb:bootstrap             # create tables + GSIs + TTL locally
npm run dev                       # http://localhost:3000
```

Set `LOCAL_DDB=true` for local dev. It changes three behaviors:
- DynamoDB points at `DDB_ENDPOINT` with dummy creds.
- `adminInvoke` runs the admin op **in-process** instead of invoking the Lambda.
- `lib/email.ts` sends via local Mailpit SMTP (view at http://localhost:8025),
  falling back to console log if Mailpit isn't up.

App runs anonymous-only if Auth0 isn't configured — never 500s on missing auth.

If tests fail with a DynamoDB connection error, local DDB isn't running:
`colima start && npm run ddb:start && npm run ddb:bootstrap`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` — run before every commit |
| `npm run lint` | ESLint (next) |
| `npm test` | Vitest unit + component tests |
| `npm run test:coverage` | Vitest with coverage — floors enforced (see Testing) |
| `npm run test:e2e` | Playwright (also runs in CI, keyless) |
| `npm run build:opennext` | OpenNext bundle for AWS |
| `npm run ddb:start` / `ddb:bootstrap` | Local DynamoDB up / create tables + GSIs + TTL |
| `npm run mail:start` | Mailpit local SMTP (UI at http://localhost:8025) |
| `npm run services:start` | All local Docker services (DDB + Mailpit) |

**Before any commit: `npm run typecheck && npm test` (and `npm run lint`).**
CI runs lint, typecheck, and test as a gate before deploy
(`.github/workflows/deploy.yml`). Run the FULL suite, not just the file you
touched — a change to a shared lib (e.g. `lib/blocks.ts`) can break API-route
tests that mock it. Regressions have shipped from running only the new test.

## Project structure

```
app/                 Next.js routes (pages + API route handlers)
  api/               Backend endpoints (see "Request flow")
  admin/             Admin UI page
components/
  chat/              Chat UI (ChatShell orchestrates everything)
  admin/             Admin tables (users, tokens, conversations, blocks, docs)
  auth/              Signup / token-request form
lib/                 Server logic — the core of the app
  client/            Browser-side fetch helpers (api.ts, csrfClient.ts)
admin-fn/            Privileged admin Lambda (ops.ts = the op switch)
infra/               AWS CDK stack (CloudFront, Lambda, S3, ACM, DynamoDB)
scripts/             bootstrap-ddb.mjs (local table setup)
tests/               Vitest (api/, components/, client/, admin/) + e2e/
docs/superpowers/    specs/ (design) + plans/ (implementation plans)
```

`lib/*.ts` files are colocated with their `*.test.ts`.

## Data model (DynamoDB)

All types in `lib/ddb.ts`. `user_id` **is the email** for logged-in users, and
`anon:<anonId>` for anonymous ones. `TABLES` in `lib/ddb.ts` is the single
source of table names (env-overridable) — never hardcode a table name.

| Table | Key | Notes |
|---|---|---|
| `Users` | `user_id` | `approved`, `pendingDelete`, `dailyLimit` |
| `Tokens` | `token` | Billing unit: `limit`/`used`, `isActive`, `provider` |
| `Conversations` | `conversation_id` | `messages[]`, `hidden` (soft delete); anon rows carry `ip` + `ttl` (30-day auto-expiry) |
| `TokenRequests` | `token` | `processed`, `denied`, `reason` (≤100 chars), `ip` |
| `Usage` | `subject` + `period` | Quota ledger, TTL'd |
| `RateLimits` | `key` | Burst counters, TTL'd |
| `Blocks` | `subject` | `manual` (permanent) or `auto` (TTL); subjects: `ip:<addr>`, `user:<email>`, `emailpat:<glob>` |
| `Locales` | `lang` | LLM-generated UI translations: `name`, `rtl`, `translations`, `usageCount` |
| `AdminDocs` | `doc_id` | Admin "about me" markdown docs: `title`, `topics`, `content` |

GSIs on `Conversations`: `byUserCreatedAt` (all of a user's convos),
`byTokenUserCreatedAt` (one token's convos). Created by `ddb:bootstrap` locally.
`Conversations` also has TTL enabled on `ttl` (local: bootstrap; prod:
operational, see deploy gotchas).

## Architecture / key flows

### Request flow (`app/api/completions/route.ts`)
Gates run in order; every rejection happens **before** any billable work
(LLM call, token charge, DB write). Preserve this ordering when editing.
1. Verify CSRF header (`x-csrf-token`) → 403.
2. Validate body + attachments (count ≤3, ≤2MB each / 4MB total, kind
   whitelist, JSON parses, image data-URL mime) → 400. See `lib/attachments.ts`.
3. `resolveSubject(req)` → anon / unapproved-user / approved-user (with ALL
   active tokens attached).
4. Abuse gate: burst auto-block + exact block lookup + `findPatternBlock(email)`
   → 403.
5. `getQuotaStatus(subject)` → 402 if blocked.
6. Classify + shape (`lib/autoModel.ts` `classifyMessage`): one cheap
   `gpt-4.1-nano` call rates difficulty (→ auto model, constrained to providers
   the user has token room on) AND matches the question to `AdminDocs` topics.
   Never throws — failure falls back to `gpt-4o-mini`, no doc injection. Matched
   docs + the attachment guard are prepended as system messages to a
   `providerHistory` that is sent to the model but **never persisted**. An image
   attachment forces an OpenAI vision model here.
7. `runCompletion(provider, model, providerHistory, promptId?, { images })`
   calls the provider API.
8. Charge: approved-with-token-room → **provider-aware token selection** via
   `selectTokenForProvider()` (exact provider match → 'ANY' provider → best
   token fallback), then decrement the chosen **Token**; everyone else →
   **Usage** ledger (`consumeQuota`). Provider errors charge **nothing**.
9. Persist conversation (everyone). `ensureConversation` enforces ownership: a
   supplied `conversationId` that doesn't match the caller's `user_id` silently
   yields a fresh conversation (no cross-user read/append). First reply triggers
   a cheap-model rename of the title. Anon rows get `ip` + 30-day `ttl`.

### Quota tiers (`lib/quota.ts`)
- **anon**: 3 questions OR 1000 tokens/day, keyed by cookie AND ip (max of both).
- **unapproved**: 1000 tokens/day.
- **approved**: sum of remaining across **all active tokens**; when all exhausted,
  falls back to 1000 tokens/day. Charging is **provider-aware** (see step 8).

### Blocks & abuse (`lib/blocks.ts`, `lib/abuse.ts`)
Three block-subject formats: `ip:<addr>`, `user:<email>`, `emailpat:<glob>`
(`*` is the only wildcard, case-insensitive, regex-injection-safe, wildcard
count capped to prevent ReDoS). `findPatternBlock` and admin-doc topic lookups
use a 60s in-module cache — **same-process only**: in prod the admin Lambda
mutates while the server Lambda reads, so the 60s TTL is the real staleness
bound, not the explicit invalidation. Pattern/abuse lookups return null on any
error — never block the service on infra failure.

### Admin operations (`admin-fn/`)
Privileged mutations (purge user, approve/deny token, blocks, delete
conversation, admin docs) go through a single op switch in `admin-fn/ops.ts`. In
prod the API route calls `adminInvoke()` which invokes the **admin Lambda**;
locally it runs the same `runAdminOp()` in-process. Add a capability by
extending the `AdminOp` union + the switch, then adding a thin API route that
calls `adminInvoke({ op, payload })` after `requireAdmin()` + CSRF.

### Models (`lib/models.ts`)
`ALL_MODELS` is the unified catalog (both providers) sorted expensive→cheap with
cost labels. UI uses `ModelPicker` (single flat dropdown, "Auto" first).
`providerForModel(id)` maps a model back to its provider.

### Auto mode & doc injection (`lib/autoModel.ts`, `lib/adminDocs.ts`)
`classifyMessage` is the single classifier entry point. Provider distinctions
are being deprecated (future Bedrock migration) — new token requests are all
`ANY`; do not deepen provider-specific surface area.

## Engineering standards

These are enforced in review. Treat each as a task requirement.

### Next.js / React performance
- **Server-first.** Keep components server components unless they need state,
  effects, or browser APIs. Add `'use client'` only at the leaf that truly needs
  it; never at a layout or page that could stay server-rendered.
- **Hoist invariants.** Anything that doesn't depend on props/state (option
  arrays, regexes, `Intl` formatters, config maps, static JSX) goes to
  module scope, not inside the component body. A `new RegExp(...)` or
  `[{label,value}...]` rebuilt every render is a review finding.
- **`useMemo` / `useCallback` with intent.** Memoize (a) expensive derivations
  and (b) values/callbacks passed as props to memoized children or into effect
  deps. Do NOT memoize trivial scalars — needless memoization adds deps-array
  bugs and noise. If it's not expensive and not a stable-identity requirement,
  leave it plain.
- **Stable keys, no index keys** for lists that reorder or delete (chat
  messages, admin rows) — use the domain id (`conversation_id`, `token`).
- **Guard async UI.** User-triggered async actions (send, submit, delete) must
  disable their control while in-flight (`loading`/`disabled`) so a double-click
  can't double-submit. `await` the action before clearing input state.
- **`export const dynamic = 'force-dynamic'`** on any server component/route that
  reads the session (cookies/headers) — otherwise it 500s on Lambda (see deploy
  gotchas).
- **Route metadata** for `<title>` etc. via the `metadata` export, not runtime
  DOM writes.

### DRY — reuse the libraries
- Business logic lives in `lib/` (server) and `lib/client/` (browser). A route
  handler or component should call a lib function, not re-implement it. Examples
  to reuse rather than duplicate: `getCsrf()` + `X-CSRF-Token` for every mutating
  fetch; `verifyCSRFTokenValue` + `requireAdmin`/`getSessionUser` server-side;
  `safeCompare` (constant-time) for any HMAC/secret comparison;
  `conversationToMarkdown`/`conversationToJson`/`downloadFile` for exports;
  `clientIp`, `consumeQuota`, `selectTokenForProvider`, `addBlock`.
- Before writing a helper, grep `lib/` — the primitive probably exists.
- Admin routes are near-identical thin wrappers; copy the exact CSRF →
  `requireAdmin` → `adminInvoke` shape from a sibling (`app/api/admin/docs`,
  `.../conversations`, `.../blocks`), don't invent a new shape.
- New server logic ships with a colocated `*.test.ts` (Vitest, no heavy
  fixtures). New shared helper → one focused unit test that fails if the logic
  breaks.

### Accessibility & UX
- **Cloudscape only** for UI controls — no raw HTML `<button>`/`<input>`/`<select>`,
  no other component libs. Cloudscape gives you labeling, focus, and keyboard
  support for free; hand-rolled controls lose it. (Layout `<div>`s are fine.)
- Every icon-only control gets an `ariaLabel`. Every form control gets a
  `FormField` with a label + `constraintText` for limits. Use `errorText` for
  validation feedback — never fail silently.
- Surface every non-happy-path outcome to the user: an error `Alert`, a disabled
  state, or an inline message. A stopped spinner with no feedback is a UX bug.
- Respect direction: on locale switch set `document.documentElement.dir`
  (`rtl`/`ltr`) and `lang`. Cloudscape follows `dir` natively.
- **i18n every user-facing string** via `react-i18next`, in ALL FOUR base
  locales (en/es/fr/de). Admin-only tables are the one grandfathered exception
  (hardcoded English) — match the surrounding table, don't introduce i18n there
  piecemeal. Never hardcode copy in user-facing surfaces.
- Confirm destructive actions (delete conversation, purge user) with a modal.

### Security (non-negotiable)
- **CSRF on every mutating request.** Client: `getCsrf()` then send
  `X-CSRF-Token`. Server route: `verifyCSRFTokenValue(...)` first, 403 on fail.
- **Never trust the client for auth.** Re-derive the session server-side
  (`getSessionUser`, `requireAdmin`). Authorize by ownership on reads too, not
  just writes (`GET /api/conversations/[id]` checks owner-or-admin).
- Treat all untrusted input as data, not instructions: attachments are wrapped
  in `<file>` guards, LLM-generated locale bundles are validated + `<`/`>`
  stripped, user globs are regex-escaped + wildcard-capped.
- **Soft delete** conversations (`hidden=true`) from user actions; hard delete
  only via admin ops.
- `lib/` is server-only except `lib/client/`. Don't import server lib into
  components.

### AWS Well-Architected

We use AWS-native services; hold changes to the six pillars
(https://aws.amazon.com/architecture/well-architected/):

- **Operational excellence** — infra is code (`infra/` CDK); deploys are the
  CI/CD pipeline, not manual clicks. Log actionable errors (the SES failure was
  found in CloudWatch). Document operational steps that live outside CDK (see
  deploy gotchas) so they survive a redeploy.
- **Security** — least-privilege IAM: the server Lambda role has scoped DDB
  access + narrow SES; the admin Lambda is the only full-DDB principal, reached
  only via `adminInvoke`. Secrets in SSM, IAM-gated. GitHub OIDC for deploy — no
  long-lived keys. Scope IAM resource ARNs as tight as the feature allows.
- **Reliability** — the app degrades, never hard-fails: anonymous-only without
  Auth0; classifier/pattern/cache failures fall back instead of 500ing;
  provider errors deliver a message without charging. New code must not
  introduce a path that takes the request down on a dependency hiccup.
- **Performance efficiency** — DynamoDB single-item reads by key on the hot
  path; avoid `Scan` in request handlers (the `Tokens` subject scan is a known,
  isolated exception with its own IAM grant). Cache cross-request lookups with a
  TTL. Pick the cheapest capable model (auto mode). Cap unbounded work (ReDoS
  guard, attachment size, injection payload).
- **Cost optimization** — pay-per-request DynamoDB; cheap-model classification
  and title rename; prompt-only attachments (not stored); TTL on anon
  conversations, usage, and rate-limit rows so storage self-cleans. Don't add an
  unmetered LLM call a user can trigger at will.
- **Sustainability** — the above cost/perf choices (right-sized models, TTL
  cleanup, no idle infra) are the sustainability levers here; keep them.

## Testing

Vitest + Testing Library (jsdom). Tests live in `tests/` and beside `lib/`
files. Mock `fetch` for client/component tests; API-route tests hit local
DynamoDB. **Use unique-per-run subjects** (e.g. `` `x-${Date.now()}@t` ``) in
tests that touch `RateLimits` or daily-capped paths — rows persist 24h locally
and poison reruns. When you add an export to a shared lib that route handlers
import, update the `vi.mock(...)` of that lib in every route test that mocks it,
or those tests 500. Playwright e2e in `tests/e2e/`. Always run `npm test` before
committing.

**Coverage** (`npm run test:coverage`, v8): CI enforces floors set in
`vitest.config.ts` (currently lines 51 / branches 50 / functions 48) — a PR
that drops below them fails. The target is **≥85% lines**; the floors are a
ratchet: when your PR raises coverage, raise the floors to match. Floors only
go up — with one exception: a vitest major bump changes how the metrics are
counted (v3→v4 re-based branches from ~78% to ~52% with identical tests), so
re-measure and recalibrate the floors as part of any provider upgrade.
Biggest gaps to close first: `lib/tokens.ts`, `lib/providers.ts`,
`lib/conversations.ts`, `lib/users.ts`, `lib/email.ts`.

**E2E** runs in CI on every PR — keyless: with no provider API keys,
completions fall back to a mocked response, so specs assert flow, not model
output. Add a spec to `tests/e2e/` when you add a user-visible flow.

## Definition of done

A task is complete only when ALL hold:
1. `npm run typecheck && npm test && npm run lint` all clean (full suite).
2. New/changed non-trivial logic has a colocated test that fails if the logic
   breaks; the test asserts real behavior, not mock internals.
3. User-facing strings are i18n'd in all four locales (admin tables exempt).
4. The Engineering standards above are met (perf, DRY, a11y, security).
5. No secrets, table names, or magic values hardcoded that belong in
   `lib/ddb.ts` `TABLES`, env, or a shared constant.
6. Coverage floors pass (`npm run test:coverage`); if the PR raised coverage,
   the floors in `vitest.config.ts` were raised to match.
7. Improvement pass done: assumptions/gotchas discovered this session are
   written back into this file in the same PR (or the PR states none were found).

## Git & PR workflow

- **Never commit to `main`** — merge to `main` auto-deploys production. Branch
  per change: `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- **Pull before every push — first push and every revision alike:**
  `git pull --rebase origin main`, resolve, re-run typecheck + tests, then
  push. Force-push only with `--force-with-lease`, only right after that
  rebase. (A local checkout of this repo once drifted 63 commits behind and
  nearly produced doc edits against an obsolete file — always start from a
  fresh pull.)
- Every change lands via PR: what & why, test evidence, screenshots or the
  HTML mock for UI changes, assumptions made. Fill the PR template checklist —
  it mirrors Definition of done.
- CI (lint, typecheck, tests + coverage floors, e2e smoke) green before merge.

## Deploy

**Production:** https://chat.hectoragomez.com — AWS account `628835453302`,
region `us-east-1`, CloudFormation stack `ChatbotV2Stack` (CDK in `infra/`).

### CI/CD (automatic)
Push to `main` → `.github/workflows/deploy.yml`:
1. **build-test** — lint → typecheck → test. Runs a `dynamodb-local` service
   container; a bootstrap step (`ddb:bootstrap`, pinned `AWS_REGION=us-east-1`)
   creates the tables the integration tests need.
2. **deploy** (only on push to `main`) — builds the OpenNext bundle, then
   `cdk deploy`. Auth is GitHub OIDC: role `chatbot-v2-gha-deploy` (trusts
   `repo:hectoragr/chatbot-v2:*`, can assume the CDK bootstrap roles), passed
   via repo secret `AWS_DEPLOY_ROLE_ARN`. No long-lived AWS keys.

So shipping a feature = merge to `main`. The pipeline deploys it.

### Manual deploy (when needed)
```bash
APP_BASE_URL=https://chat.hectoragomez.com npm run build:opennext
cd infra && CDK_DEFAULT_ACCOUNT=628835453302 npx cdk deploy --require-approval never --no-rollback
```
Use `--no-rollback` so a mid-deploy failure keeps resources (the assets bucket
has `RemovalPolicy.RETAIN`, so a rollback orphans it and the next deploy 409s on
bucket-already-exists — delete it first if that happens).

### What the stack creates (`infra/lib/chatbot-v2-stack.ts`)
Server Lambda (`chatbot-v2-server`, scoped DDB role + narrow SES), admin Lambda
(`chatbot-v2-admin`, full DDB role), S3 assets bucket, CloudFront distribution,
ACM cert + Route53 A record (`domainName` in `infra/bin/app.ts`). It **imports**
the 7 original DynamoDB tables by name and **creates** `Locales` + `AdminDocs`
(RETAIN). The imported tables predate the stack; run `ddb:bootstrap` against a
fresh account once.

### Secrets (SSM)
8 params under `/chatbot-v2/prod/`: `CSRF_SECRET`, `AUTH0_SECRET`,
`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `OPENAI_API_KEY`,
`DEEPSEEK_API_KEY`, `ADMIN_EMAIL`. They MUST be **String** type — the stack reads
them with `valueForStringParameter`, which can't resolve `SecureString`
(deploy fails "types not supported by CloudFormation"). Tradeoff: plaintext at
rest, IAM-gated. Upgrade path: runtime SSM fetch in the Lambda.

Changing an SSM value does NOT trigger a redeploy (no template diff) and the
Lambda has values baked at deploy time — after editing a secret, either force a
deploy or patch the `chatbot-v2-server` Lambda env directly to apply it.

### Deploy gotchas (all hit + fixed in production)
- **Assets**: deploy them to the **bucket root** (no prefix). OpenNext requests
  `/_next/*`; a prefix → 403 → broken hydration/CSS.
- **CI DynamoDB**: the service container has no `-sharedDb`, so it partitions by
  region+creds. Bootstrap must use the same region as the tests (`us-east-1`).
- **Route53**: CDK `ARecord` does CREATE not UPSERT — a pre-existing external
  record blocks deploy; delete it first.
- **Custom-domain CNAME**: only one CloudFront distribution may own an alias;
  free it from the old one before claiming it.
- **Dynamic routes**: server components that read the session (cookies/headers),
  e.g. `app/admin/layout.tsx`, need `export const dynamic = 'force-dynamic'` or
  they 500 with a static→dynamic conflict on Lambda.
- **Server role**: needs `dynamodb:Scan` on **Tokens** (subject resolution scans
  by `user_id`; Tokens has no GSI for it).
- OpenNext logs benign `NoSuchBucket`/`EROFS` ISR-cache warnings — no cache
  bucket is wired; harmless for this dynamic app.
- `Locales`/`AdminDocs` are CREATED by the CDK stack (RETAIN). Do NOT pre-create
  them in the prod account via `ddb:bootstrap` before the first deploy —
  CloudFormation CREATE fails on table-already-exists. Local/CI bootstrap still
  creates them (separate accounts).
- **SES**: the server Lambda sends email (contact form, token-request
  notifications). It needs `ses:SendEmail` (in the stack) AND a verified SES
  identity for the FROM address (`SES_FROM_EMAIL` or `ADMIN_EMAIL`). The
  account is in the SES **sandbox**: only verified recipients receive mail, so
  admin-bound emails work but requester-bound emails (approve/deny notices)
  silently fail until SES production access is requested in the console.
- **Conversations TTL**: anon conversations carry a `ttl` attribute (30 days).
  The prod table has TTL enabled operationally (`aws dynamodb
  update-time-to-live`), NOT via CDK (the table is imported). Local/CI TTL is
  enabled by `ddb:bootstrap`.

## Environment variables

Local dev: see `.env.example` — `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, the
`AUTH0_*` set, `ADMIN_EMAIL` (single admin), `SES_FROM_EMAIL`, `CSRF_SECRET`,
`LOCAL_DDB`/`DDB_ENDPOINT`. In prod these come from SSM (above); `ADMIN_FN_NAME`
is set by infra.

## Workflow

**Full ceremony required** when a change adds a user-facing surface, touches
quota/auth/billing/blocks, or spans more than ~2 non-test files:
brainstorm → design spec (`docs/superpowers/specs/`) → implementation plan
(`docs/superpowers/plans/`) → build task-by-task with a fresh review after
each → browser/AWS smoke test → whole-branch review → PR to `main`
(auto-deploys). Keep specs and plans in the repo; they are the audit trail.
Established across three shipped batches.

**Anything smaller** (bugfix, copy, config): branch → failing test → fix → PR.

**New UI feature? Mock first.** Before implementing, produce standalone HTML
mock(s) showing all states (empty / loading / error / populated), light/dark,
and mobile — presented side by side (variants when direction is open,
current-vs-proposed when changing a screen). Iterate until approved, then
build it in Cloudscape; the mock is the contract for layout and states, never
code to paste. Attach it to the PR.

**Every PR: improvement pass.** List the assumptions made during the session;
write anything that generalizes (new gotcha, corrected command, refined
convention) back into this file in the same PR. Run judgment work — planning,
review, this pass — on the most capable reasoning model available in the
executing environment.
