# Bedrock-only migration + tiered model access

**Decision (locked):** drop OpenAI + DeepSeek entirely. Every completion runs on
Amazon Bedrock, billed via IAM (no API keys, no prepaid credits). Region
`us-east-1`. Hard cutover — the OpenAI/DeepSeek code paths and their SSM params
are deleted, not flag-gated.

> ⚠️ **This repo deploys to prod on merge to `main`.** A Bedrock-only cutover that
> merges *before* per-model access is enabled in the Bedrock console will take the
> live chatbot down — every completion returns `AccessDeniedException`. The merge
> is gated on Step 0 below being done.

## Tiers (as implemented)

| Tier | Models (Bedrock inference-profile IDs) | Daily limit | Vision | Auth |
|---|---|---|---|---|
| **anon** | Nova Micro, Nova Lite | 3 prompts / 1000 tokens (IP+cookie) | Nova Lite only | captcha |
| **unapproved** (signed-in) | + Nova Pro, Claude Haiku 4.5 | **1000 tokens/day** | no | Auth0 |
| **approved** | + Claude Sonnet 4.5, Llama 3.3 70B, Pixtral Large | admin token grant, then daily fallback | yes | Auth0 + approval |

Confirmed IDs (from `aws bedrock list-inference-profiles`, us-east-1):
`us.amazon.nova-micro-v1:0`, `us.amazon.nova-lite-v1:0`, `us.amazon.nova-pro-v1:0`,
`us.anthropic.claude-haiku-4-5-20251001-v1:0`, `us.anthropic.claude-sonnet-4-5-20250929-v1:0`,
`us.meta.llama3-3-70b-instruct-v1:0`, `us.mistral.pixtral-large-2502-v1:0`.
(Mistral Large 2/3 is NOT in the account's profile list — Pixtral Large is the
Mistral flagship available, and it is vision-capable, so it takes the approved slot.)

The tier gate lives at the existing quota chokepoint in
`app/api/completions/route.ts`: resolve tier → intersect the requested model with
that tier's allowlist → fall back to the tier's default model if not allowed. The
auto-router (`lib/autoModel.ts`) only picks from the caller's allowed set, so anon
"auto" can never route to Sonnet.

## Implementation status — COMPLETE (on branch, pre-merge)

- ✅ `lib/models.ts` — Bedrock-only registry, tier allowlists, vision flags
- ✅ `lib/providers.ts` — rewritten to the Bedrock Converse API (`@aws-sdk/client-bedrock-runtime`), images as Converse image blocks, real token usage from the API
- ✅ `lib/autoModel.ts` — Bedrock tier preferences, allowed-model routing, classifier on the cheapest model
- ✅ `app/api/completions/route.ts` — tier-gated model resolution, vision→tier vision model, provider-agnostic charging
- ✅ `lib/conversations.ts` / `lib/locales.ts` — title + locale generation moved to Bedrock (were OpenAI/DeepSeek)
- ✅ `app/api/requestToken/route.ts` — token grants are always `ANY` (no provider dimension)
- ✅ `infra/lib/chatbot-v2-stack.ts` — `bedrock:InvokeModel` IAM on the server role; OpenAI/DeepSeek SSM env removed
- ✅ Tests — 48 files / 200 tests green; dead per-provider-token tests removed, charging-semantics tests rewritten
- ✅ `npm run typecheck`, `eslint` (migration source), and `npm run build` all pass locally

## Step 0 — AWS access (model-access page RETIRED; IAM is the gate now)

AWS retired the manual "Model access" page: serverless foundation models
auto-enable on first invocation account-wide. So there is **no manual per-model
enablement step**. What remains:

- **Anthropic use-case form (one-time):** first-time Anthropic use may require a
  short use-case submission (Model catalog → open a Claude model → submit). Do
  this once so the first real Sonnet/Haiku call doesn't fail.
- **IAM is the real gate:** access is now controlled by the IAM policy on the
  server Lambda role. The `bedrock:InvokeModel` statement added in step 6 is what
  authorizes invocation — if it's missing/misscoped the Lambda gets AccessDenied.
  `cdk deploy` (on merge) applies it, so the cutover is self-sufficient once the
  IAM statement is correct.

## Model IDs — CONFIRMED against the account (us-east-1 inference profiles)

Verified via `aws bedrock list-inference-profiles`. NOTE: Mistral Large 2/3 is
NOT available in this account — substituted Mistral Pixtral Large (the available
Mistral flagship, vision-capable). Only dated/GA `-v1:0` IDs are used; preview
profiles (Claude Sonnet 5, GPT-6, etc.) are deliberately excluded.

| Role | Tier | Exact inference-profile ID | Vision |
|---|---|---|---|
| cheapest | anon | `us.amazon.nova-micro-v1:0` | no |
| cheap | anon | `us.amazon.nova-lite-v1:0` | yes |
| balanced | unapproved | `us.amazon.nova-pro-v1:0` | yes |
| fast-quality | unapproved | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | yes |
| flagship | approved | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | yes |
| open-weight | approved | `us.meta.llama3-3-70b-instruct-v1:0` | no |
| mistral (vision) | approved | `us.mistral.pixtral-large-2502-v1:0` | yes |

Classifier + title-summary calls run on `us.amazon.nova-micro-v1:0` (cheapest).
The IAM statement grants `bedrock:InvokeModel` on
`arn:aws:bedrock:us-east-1::foundation-model/*` AND
`arn:aws:bedrock:us-east-1:<account>:inference-profile/us.*` (invoking a `us.`
profile also requires invoke perms on the underlying foundation models in each
region the profile spans — grant the foundation-model wildcard to cover this).

## Code changes

### 1. `lib/providers.ts` — rewrite `runCompletion` to Bedrock Converse
- Replace the OpenAI + DeepSeek `fetch` branches with a single
  `@aws-sdk/client-bedrock-runtime` `ConverseCommand` call.
- `Provider` collapses to `'BEDROCK'`. Signature becomes
  `runCompletion(model, messages, promptId?, opts?)` — provider arg removed.
- Map `messages` to Converse `messages[]` (`role` + `content:[{text}]`); pull any
  leading `system` message into the Converse `system` field.
- Vision: attach images as Converse `content:[{image:{format,source:{bytes}}}]`
  blocks on the last user message (decode the data URL the client already sends).
- Keep the existing mock fallback (`[mocked completion]`) for the keyless CI/E2E
  path: if no AWS creds are resolvable, return the mock — this is what keeps the
  E2E smoke test free.
- Token estimate: prefer the real `usage` from the Converse response
  (`response.usage.inputTokens/outputTokens`) when present; fall back to the
  char/4 approximation.

### 2. `lib/models.ts` — Bedrock registry + tier allowlists
- `Provider = 'BEDROCK'`. `ALL_MODELS` becomes the 6 Bedrock models above with
  `costPer1kTokens` and a `vision: boolean` flag.
- Add `TIER_MODELS: Record<'anon'|'unapproved'|'approved', string[]>` (the
  allowlists) and `defaultModelForTier(tier)`.
- `isModelAllowedForTier(tier, id)` helper.

### 3. `lib/autoModel.ts` — Bedrock tiers + classifier model
- `TIER_MODELS` (difficulty tiers) point at Bedrock ids: simple→Nova Lite,
  moderate→Nova Pro, complex→Sonnet (approved) / Nova Pro (others).
- The classifier's own call (`gpt-4.1-nano` today) moves to a cheap Bedrock model
  (Nova Lite). `AUTO_FALLBACK_MODEL` → Nova Lite.
- `pickForTier` intersects with the caller's allowed tier set, not provider.

### 4. `app/api/completions/route.ts`
- Drop the `provider !== 'OPENAI' && ...` validation; provider is always Bedrock.
- After resolving subject/tier, gate the chosen model:
  `isModelAllowedForTier(tier, chosenModel)` else `defaultModelForTier(tier)`.
- Vision (`images.length > 0`): allowed only for the approved tier; else strip
  images (text-only) or return a clear 4xx. Route vision to a Bedrock vision model.
- Charging simplifies: no per-provider token matching. Approved-with-grant →
  charge the token; everyone else → Usage ledger. `selectTokenForProvider` is
  removed (or reduced to "the active token with room").

### 5. `lib/quota.ts`
- `UNAPPROVED_TOKENS` stays **1000** (unchanged). Confirm anon 3 prompts / 1000
  tokens unchanged. Tier→model allowlist is enforced in the route, not here.

### 6. `infra/lib/chatbot-v2-stack.ts`
- **Remove** the `OPENAI_API_KEY` and `DEEPSEEK_API_KEY` SSM params + env wiring.
- **Add** an IAM statement to `serverFnRole`: `bedrock:InvokeModel` (+
  `bedrock:InvokeModelWithResponseStream` if streaming later) on
  `arn:aws:bedrock:us-east-1::foundation-model/*` and the `us.` inference-profile
  ARNs (`arn:aws:bedrock:us-east-1:<account>:inference-profile/*`).
- The classifier + summary calls also run on Bedrock, so no separate key path.

### 7. Tests
- Update every test asserting the `'OPENAI'|'DEEPSEEK'` union → `'BEDROCK'`
  (`lib/models.test.ts`, completions provider-validation tests, autoModel tests).
- Add: tier-gate tests (anon requesting Sonnet → downgraded to Nova Lite; approved
  → allowed), vision-tier test (anon image → stripped/refused), a Bedrock
  `runCompletion` mock test.
- The keyless mock path keeps the anon E2E working unchanged (still gets
  `[mocked completion]`); the captcha flow from PR #10 is unaffected.

## Post-merge verification
- Confirm the prod deploy's `cdk deploy` applied the `bedrock:InvokeModel` IAM.
- Smoke: one anon prompt (Nova Lite), one approved prompt (Sonnet), one image as
  approved (vision), one anon image (refused/stripped).
- Watch the kill-switch counter (`global:daily`) now that spend is real AWS $.

## Rollback
Because it's a hard cutover, rollback = revert the merge commit and re-add the two
SSM params. Keep the pre-cutover commit SHA handy at merge time.
