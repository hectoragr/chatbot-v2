# chatbot-v2

A multi-provider AI chat app — Next.js 15 (App Router) + CloudScape UI, deployed to AWS Lambda + S3 + CloudFront via OpenNext. Anonymous users get a small daily quota; logged-in users (Auth0) can request larger token allowances that an admin approves. Backend logic runs in Next.js route handlers backed by DynamoDB; privileged admin operations run in a separate, least-privileged Lambda.

- **Stack:** Next.js 15, React 19, TypeScript (strict, ESM), `@cloudscape-design/components`, `@auth0/nextjs-auth0` v4, AWS SDK v3, DynamoDB, OpenNext v4, AWS CDK.
- **Tests:** Vitest (unit/integration/component) + Playwright (e2e).

---

## Prerequisites

- **Node.js 22.x**
- **Docker** (for local DynamoDB)
- **npm** (the repo uses `package-lock.json`; an `.npmrc` pins `legacy-peer-deps=true` for the CloudScape + React 19 peer-dep combination)

---

## Setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`. For **local development you must keep**:

```
LOCAL_DDB=true
DDB_ENDPOINT=http://localhost:8000
AWS_REGION=us-east-1
```

Without `LOCAL_DDB=true` the app points at real AWS DynamoDB and `/api/me` returns 500 (the chat UI then has no quota and won't load).

Optional `.env.local` values:

| Var | Effect when set | Effect when unset |
|-----|-----------------|-------------------|
| `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` | Real LLM completions | Completions return `[mocked completion]` — the chat still works fully offline |
| `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL` | Login / signup / `/admin` work | Anonymous chat works; `Log in` and `/admin` redirect to Auth0 and will error |
| `ADMIN_EMAIL` | The Auth0 user with this email gets `/admin` access | No admin |
| `CSRF_SECRET` | Signs CSRF tokens | Falls back to an insecure default (fine for local only) |

`AUTH0_SECRET` can be any 32-byte hex string for local use: `openssl rand -hex 32`.

---

## Local DynamoDB

The app needs the 7 tables (`Tokens`, `Users`, `Conversations`, `RateLimits`, `TokenRequests`, `Usage`, `Blocks`).

```bash
npm run ddb:start       # docker compose up -d dynamodb  (listens on :8000)
npm run ddb:bootstrap   # idempotently create all 7 tables
```

`ddb:bootstrap` is safe to re-run — it skips tables that already exist.

**Reset all data** (e.g. to clear an exhausted quota during manual testing):

```bash
LOCAL_DDB=true DDB_ENDPOINT=http://localhost:8000 node scripts/bootstrap-ddb.mjs --purge --yes
```

(`--purge` drops and recreates every table. The flag requires `--yes`.) Stop the container with `docker compose down`.

---

## Run the app

```bash
npm run dev            # http://localhost:3000
```

The landing page drops you straight into a new anonymous conversation.

---

## Manual testing

Start the dev server and local DynamoDB first (above).

### 1. Anonymous quota (no Auth0 needed)

1. Open `http://localhost:3000` — you land in a new conversation, input enabled.
2. Send a message. With no provider key set you get `[mocked completion]`; quota decrements (3 free questions/day).
3. Send 3 messages total. On the 4th attempt the **QuotaBanner** shows "You've reached your limit" and the textarea + Send button are **disabled**. The `POST /api/completions` for the blocked attempt returns **402**.

Quota is keyed by an `anon_id` httpOnly cookie **and** client IP (it blocks on whichever is exhausted first). On `localhost` there is no `X-Forwarded-For`, so the server resolves the IP to the literal `unknown` — a shared key. To re-test from zero, **purge DynamoDB** (above) or send a unique `X-Forwarded-For` header (this is exactly what the Playwright e2e does).

To inspect raw quota: `curl http://localhost:3000/api/quota` (carries your browser cookie if you copy it; otherwise returns a fresh anon snapshot).

### 2. Login, request tokens, approval (requires Auth0 + `ADMIN_EMAIL`)

1. Configure the `AUTH0_*` vars and set `ADMIN_EMAIL` in `.env.local`. In the Auth0 dashboard add `http://localhost:3000/auth/callback` to **Allowed Callback URLs** and `http://localhost:3000` to **Allowed Logout URLs**.
2. Click **Log in** (top-right) → authenticate via Auth0 → you return to the chat. Logged-in users get 1000 tokens/day (resets daily) until approved.
3. Click **Request tokens** → fill company + tokens + provider → submit (creates a `TokenRequest`, max 3 per user).
4. Log in as the `ADMIN_EMAIL` user and visit `http://localhost:3000/admin`:
   - **Token Requests** table → **Approve** the request (creates a `Token`).
   - **Users / Tokens / Conversations / Blocks** tables for management.
   - **Blocks**: add a manual block (`user:<email>` or `ip:<ip>`); blocked subjects get **403** on completions. Auto-blocks appear after a request burst.

> `/admin` is guarded server-side: non-admins are redirected, and every admin mutation requires both an Auth0 admin session and a CSRF token. Locally (`LOCAL_DDB=true`) the admin operations run in-process; in production they are delegated to the privileged `admin-fn` Lambda.

---

## Automated tests

### Unit / integration (Vitest)

```bash
npm test            # run once (56 tests)
npm run test:watch  # watch mode
npm test -- lib/quota.test.ts   # a single file
```

Many tests exercise the **real local DynamoDB** (quota, usage, blocks, abuse, admin ops, and the API-route tests). **Start and bootstrap DynamoDB first** or those tests fail to connect:

```bash
npm run ddb:start && npm run ddb:bootstrap
npm test
```

Notes:
- Pure tests (http, csrf, models, anon, client API, components) need no DynamoDB.
- DynamoDB-backed test files start with `// @vitest-environment node` (the default vitest env is `jsdom` for component tests).
- Tests use unique per-run IDs/IPs so repeated runs don't pollute each other's quota ledgers.

### End-to-end (Playwright)

```bash
npx playwright install chromium   # first time only
npm run ddb:start && npm run ddb:bootstrap
npm run test:e2e
```

Playwright auto-starts the dev server (`webServer` in `playwright.config.ts`) and injects a random `X-Forwarded-For` per run so the anonymous quota starts fresh. The spec (`tests/e2e/anon-quota.spec.ts`) verifies: land in a new conversation → 3 sends succeed → input disabled + limit banner shown.

---

## Quality gates

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm run build       # next build
```

All three plus `npm test` run in CI (`.github/workflows/deploy.yml`).

---

## Infrastructure (CDK)

The `infra/` directory deploys the OpenNext bundle to S3 + Lambda + CloudFront with two least-privilege IAM roles (a user-scoped server role and a privileged `admin-fn` role).

```bash
npm run build:opennext        # produces .open-next/
cd infra
npm install
npx cdk synth                 # synthesize the CloudFormation template (no deploy)
```

`cdk synth` is the local verification. **Do not `cdk deploy`** until the pre-deploy hardening is done (OpenNext image-optimization/revalidation sub-Lambdas, CloudFront-only restriction on the server Function URL, and the SSM params under `/chatbot-v2/prod/`). See the comments in `infra/lib/chatbot-v2-stack.ts`.

---

## Project layout

```
app/                 # App Router pages + API route handlers (app/api/*)
components/chat/      # Chat UI (CloudScape shell, ported markdown/emoji, model selector)
components/admin/     # Admin CloudScape tables
lib/                  # Business logic (ddb, quota, usage, blocks, abuse, auth, csrf, providers, ...)
lib/client/          # Browser-side typed API wrappers
admin-fn/            # Privileged admin Lambda (ops + handler)
infra/               # AWS CDK stack
i18n/                # i18next config + en/es/fr/de resources
scripts/             # DynamoDB bootstrap
tests/               # Vitest specs + Playwright e2e
docs/superpowers/plans/  # The implementation plan
```
