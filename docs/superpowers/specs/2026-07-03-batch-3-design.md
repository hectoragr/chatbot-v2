# Batch 3 — Design

Date: 2026-07-03
Status: Approved
Depends on: batch 2 (merged, PR #2).

## Goal

Fix the production contact-email failure and ship three admin/abuse features:
token-request reason field, email-pattern + IP blocking, and anonymous
conversations in the admin table with delete.

## 1. Production email fix (bug)

Root cause (confirmed via prod CloudWatch logs, failing since 2026-06-22):

1. `chatbot-v2-server-fn-role` has no SES permission →
   `ses:SendEmail ... not authorized`.
2. The AWS account has ZERO verified SES identities — `hector.agr@gmail.com`
   (the `ADMIN_EMAIL` fallback FROM) was never verified.

Fix:

- **CDK** (`infra/lib/chatbot-v2-stack.ts`): server Lambda role gains an
  inline policy allowing `ses:SendEmail` and `ses:SendRawEmail` on
  `arn:aws:ses:*:628835453302:identity/*`.
- **One-time AWS op** (run during implementation, outside git):
  `aws ses verify-email-identity --email-address hector.agr@gmail.com
  --region us-east-1`. Hector clicks the link AWS emails him.
- No new env/SSM: `FROM` falls back to `ADMIN_EMAIL`, which becomes the
  verified identity.
- **Documented caveat** (AGENTS.md deploy notes): the account is in the SES
  sandbox. Contact + admin-notification emails work (sender = recipient =
  the verified address). Approval/denial emails to OTHER users require SES
  production access (AWS console request) — until then those sends fail and
  are visible in CloudWatch only (`send()` already returns false; those
  callers deliberately ignore it).

## 2. Token-request reason field

- `TokenRequestDoc.reason?: string` — ≤100 chars, control characters
  stripped, longer input → 400 from `/api/requestToken`.
- `SignupRequestForm`: "Reason" `Input` with `constraintText` (≤100), i18n
  keys in all four locales.
- Admin `TokenRequestsTable`: new "Reason" column.
- `notifyAdminTokenRequest` email includes a `Reason: …` line when present.

## 3. IP capture + email-pattern blocks

### IP on token requests

- `/api/requestToken` records `ip: clientIp(req)` on the request doc.
- Admin `TokenRequestsTable`: "IP" column + inline **Block IP** action —
  calls the existing `addBlock` admin op with subject `ip:<ip>`, then
  refreshes.

### Email-pattern blocks

- New block-subject format: `emailpat:<glob>` where the glob supports `*`
  only (e.g. `emailpat:*@spam.com`, `emailpat:bot-*@*`). Matching is
  case-insensitive; everything except `*` is regex-escaped (no regex
  injection).
- `lib/blocks.ts` gains `findPatternBlock(email: string):
  Promise<BlockDoc | null>` — scans live blocks whose subject starts with
  `emailpat:`, in-module cache with 60s TTL (same pattern as
  `listDocTopics`); any error → null (never block on infra failure).
- Enforcement at BOTH gates, returning 403 `{ error: 'blocked' }`:
  - `/api/requestToken` — after auth, before creating the request.
  - `/api/completions` — alongside the existing `findBlock` lookup, only
    when the subject has an email.
- Blocks admin UI: helper/description text documenting the three subject
  formats (`ip:<ip>`, `user:<email>`, `emailpat:<glob>`). The existing
  free-text add form already accepts any subject.

## 4. Anonymous conversations (persist with 30-day TTL)

Design change: anonymous conversations ARE now persisted.

- `/api/completions`: `persist` becomes unconditional. Anonymous
  conversations get `user_id: 'anon:<anonId>'`, a new `ip` field
  (`ConversationDoc.ip?: string`, set for anon only), and
  `ttl` = now + 30 days (`ConversationDoc.ttl?: number`, epoch seconds,
  anon only). Logged-in conversations unchanged (no ttl, no ip).
- Multi-turn anonymous chats thread naturally: the client already tracks
  the returned `conversationId` in memory for the session. `/api/
  conversations` remains auth-only — anonymous users never see stored
  history across visits.
- **TTL infra**: `Conversations` is a legacy imported table, so TTL is
  enabled operationally, not via CDK:
  - prod (one-time, during implementation):
    `aws dynamodb update-time-to-live --table-name Conversations
    --time-to-live-specification "Enabled=true, AttributeName=ttl"
    --region us-east-1`
  - `scripts/bootstrap-ddb.mjs`: enable the same TTL spec locally
    (idempotent; tolerate "already enabled" errors).
- Admin `ConversationsTable`:
  - anon rows appear via the existing listing; "User" column already shows
    `user_id` (`anon:…`).
  - new "IP" column (dash for logged-in rows).
  - per-row **Delete** action with a typed/inline confirm (Cloudscape
    Modal or confirm pattern consistent with the table) — new
    `{ op: 'deleteConversation'; payload: { conversation_id } }` admin op
    reusing the `deleteConversation` lib fn `purgeUser` already uses (hard
    delete), plus a thin API route.
  - inline **Block IP** action on anon rows (same addBlock op).

## 5. Error handling

- Pattern-cache/scan failure → no pattern block, request proceeds.
- Reason >100 chars → 400 with a clear error.
- SES still failing after IAM fix (e.g. unverified identity) → existing
  502 `send_failed` on contact; token-request flow keeps ignoring the send
  result (request itself must still succeed).
- Admin delete failures surface in the table (match AdminDocsPanel's error
  handling).

## 6. Testing

- `lib/blocks.test.ts` (extend/create): glob matching (prefix/suffix/middle
  `*`, case-insensitivity, regex-metachar emails safe), cache invalidation
  path, non-matching email → null.
- Route tests: requestToken — reason stored/truncation 400, ip recorded,
  pattern-blocked email 403; completions — pattern-blocked logged-in user
  403, anon message persists a conversation with `anon:` user_id + ttl + ip
  and threads on the second message.
- Admin op test: deleteConversation removes the row.
- Component tests: reason field renders with constraint; TokenRequestsTable
  shows reason/IP + Block IP action; ConversationsTable delete action.

## Out of scope

- SES production-access request (manual AWS console step, Hector).
- Retroactive anon conversations (nothing was stored before this change).
- Pattern blocks on subjects other than email (IP ranges, etc.).
