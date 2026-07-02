# UI/UX Batch Improvements — Design

Date: 2026-07-01
Status: Approved

## Goal

Eight user-facing improvements to chatbot-v2: auto model selection, message
copy buttons, token-request modal success flow, admin layout polish, admin
conversation markdown rendering, conversation export, a Kiro-IDE-like dark
look with tighter navigation spacing, and proper page titles.

## 1. Auto model mode

**Server** — new `lib/autoModel.ts`:

- `pickModelForMessage(message: string): Promise<string>` calls `gpt-4.1-nano`
  with a one-shot classification prompt returning exactly one of
  `simple | moderate | complex`.
- Tier → model map (cheapest capable per tier):
  - `simple` → `gpt-4.1-nano` (~$0.10/1K)
  - `moderate` → `deepseek-chat` (~$0.27/1K)
  - `complex` → `deepseek-reasoner` (~$0.55/1K, reasoning)
- Classifier failure or unparseable output → fall back to `gpt-4o-mini`.
  Classification must never block or fail the completion.

**Route** — `app/api/completions/route.ts`: when `model === 'auto'`, resolve
the real model via `pickModelForMessage(message)` and derive the provider via
`providerForModel(...)` (the client-sent provider is ignored in auto mode).
Response gains `modelUsed: string` so the UI can display which model answered.

**UI** — `components/chat/ModelPicker.tsx`: prepend option
"Auto — picks best model" with value `AUTO:auto`. `ChatShell` sends
`provider: 'AUTO', model: 'auto'`; server handles resolution.

**Tests** — `lib/autoModel.test.ts` (mocked provider call: each tier, garbage
output, thrown error) + completions route test for the auto path.

**Provider-aware selection** — auto mode must not route an approved token
holder to a provider they can't be billed on. For an approved user with token
room, the route computes the set of providers covered by their active tokens
(a token with provider `'ANY'` counts as covering both `OPENAI` and
`DEEPSEEK`) and passes it to `pickModelForMessage` as `allowedProviders`; the
tier's cheapest candidate on an allowed provider is chosen, falling back to
the tier's primary (default) candidate if none of the user's tokens cover it.
Users billed via the Usage ledger (anonymous, unapproved, or approved users
who've exhausted all token room) are provider-agnostic, so they get the
default tier mapping unchanged. Note that the classification call itself
always runs on the app's own OpenAI key (`gpt-4.1-nano`) after the quota/abuse
gates and is never charged against the user's quota — this is deliberate, so
classification cost is absorbed by the app rather than the user.

## 2. Copy buttons on messages

`components/chat/MarkdownMessage.tsx`: add Cloudscape `CopyToClipboard`
(icon variant) in the message footer next to the timestamp. Copies the raw
message `content`. Applies to both prompt and response messages, and to the
admin conversation modal (shared component).

## 3. Token request modal success flow

`components/auth/SignupRequestForm.tsx`: when submission succeeds, replace the
form with a success Alert + Close button. New `onDone?: () => void` prop;
`ChatShell` wires it to close the modal. Errors keep the current inline Alert
with the form still visible for retry.

## 4. Admin page layout

`app/admin/page.tsx`: center the content in a `max-width: 1100px;
margin: 0 auto` wrapper; increase table separation to `SpaceBetween size="xl"`.

## 5. Admin conversations modal

`components/admin/ConversationsTable.tsx`: render each message with
`MarkdownMessage` (markdown + syntax highlighting + the new copy button)
instead of plain `Box` text. Modal size `max`.

## 6. Export conversation

Client-side only. `ButtonDropdown` "Export" in the chat header actions,
enabled only when a conversation with messages is active. Two items:

- **Markdown** — `## 👤 User` / `## 🤖 Assistant` headers with timestamps,
  message content verbatim. Filename `<displayName>.md`.
- **JSON** — raw `messages[]` array. Filename `<displayName>.json`.

Implementation: pure formatter functions + Blob download helper (new
`lib/client/exportConversation.ts`), unit-tested.

## 7. Kiro-like look + navigation spacing

- Apply Cloudscape dark mode (`applyMode(Mode.Dark)`) and compact density
  (`applyDensity(Density.Compact)`) in `app/providers.tsx`.
- `app/globals.css`: chat pane fills viewport height; message bubbles restyled
  for dark; code highlight theme switches to `github-dark`; tighter header.
- Header actions become icon buttons with tighter `SpaceBetween` spacing —
  addresses "space in menus and buttons is not optimal".
- 100% Cloudscape components (per CLAUDE.md); no other UI libs.

## 8. Page titles

Next.js `metadata` exports in server files:

- `app/layout.tsx`: `title` becomes a template
  (`{ default: 'Chat · chat.hectoragomez.com', template: '%s · chat.hectoragomez.com' }`).
- `app/admin/layout.tsx`: `export const metadata = { title: 'Admin' }`.

## Error handling

- Auto-classifier failure → default `gpt-4o-mini`, completion proceeds.
- Clipboard failures → handled by Cloudscape `CopyToClipboard` popover.
- Export with no active/empty conversation → dropdown disabled.

## Testing

- `lib/autoModel.test.ts` — tier mapping, fallback on garbage/error.
- Completions route test — `model: 'auto'` path resolves and charges the
  resolved provider.
- `lib/client/exportConversation` formatter unit tests.
- Existing suite stays green: `npm run typecheck && npm test` before commit.

## Out of scope

- No streaming, no per-user theme toggle, no server-side export endpoint,
  no changes to quota/token charging logic beyond provider resolution for
  auto mode.
