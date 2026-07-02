# UI/UX Batch Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved UI/UX batch: auto model mode, message copy buttons, token-request success flow, admin layout + markdown modal, conversation export, page titles, and a Kiro-like dark/compact look.

**Architecture:** Server-side auto model selection via a cheap-LLM classifier in `lib/autoModel.ts`, hooked into the completions route. Everything else is client-side: Cloudscape components, a pure export formatter in `lib/client/`, CSS polish in `app/globals.css`, and Next.js metadata for titles.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Cloudscape Design System (`@cloudscape-design/components` 3.0.1310), react-i18next, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-01-ui-ux-batch-design.md`

## Global Constraints

- TypeScript strict; `npm run typecheck` must stay clean.
- Cloudscape only for UI controls — no raw HTML controls (existing code-block copy button is a grandfathered exception).
- All user-facing copy via react-i18next; add every new key to ALL FOUR locales (en/es/fr/de) in `i18n/resources.ts`.
- CSRF header on every mutating request (no new mutating endpoints in this plan).
- **Before every commit: `npm run typecheck && npm test`.** Tests need local DynamoDB: if failures mention connection refused, run `colima start && npm run ddb:start && npm run ddb:bootstrap`.
- `lib/` is server-only except `lib/client/`. Never import server lib into components.

---

### Task 1: Auto model classifier (`lib/autoModel.ts`)

**Files:**
- Create: `lib/autoModel.ts`
- Test: `lib/autoModel.test.ts`

**Interfaces:**
- Consumes: `runCompletion(provider, model, messages)` from `lib/providers.ts` (returns `{ content: string; estimatedTokens: number }`); `Message` type from `lib/ddb.ts` (`{ role, content, createdAt }`).
- Produces: `pickModelForMessage(message: string): Promise<string>` — returns a model id from `ALL_MODELS`; never throws. Also exports `AUTO_FALLBACK_MODEL = 'gpt-4o-mini'`.

- [ ] **Step 1: Write the failing test**

Create `lib/autoModel.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./providers', () => ({ runCompletion: vi.fn() }));

const { runCompletion } = await import('./providers');
const { pickModelForMessage, AUTO_FALLBACK_MODEL } = await import('./autoModel');
const mockRun = vi.mocked(runCompletion);

beforeEach(() => { mockRun.mockReset(); });

describe('pickModelForMessage', () => {
  it('maps simple → gpt-4.1-nano', async () => {
    mockRun.mockResolvedValue({ content: 'simple', estimatedTokens: 1 });
    expect(await pickModelForMessage('what is 2+2')).toBe('gpt-4.1-nano');
  });

  it('maps moderate → deepseek-chat (case/punctuation tolerant)', async () => {
    mockRun.mockResolvedValue({ content: ' Moderate.', estimatedTokens: 1 });
    expect(await pickModelForMessage('summarize this article')).toBe('deepseek-chat');
  });

  it('maps complex → deepseek-reasoner', async () => {
    mockRun.mockResolvedValue({ content: 'complex', estimatedTokens: 1 });
    expect(await pickModelForMessage('prove this theorem')).toBe('deepseek-reasoner');
  });

  it('falls back on garbage output', async () => {
    mockRun.mockResolvedValue({ content: '[mocked completion]', estimatedTokens: 1 });
    expect(await pickModelForMessage('hi')).toBe(AUTO_FALLBACK_MODEL);
  });

  it('falls back when the classifier throws', async () => {
    mockRun.mockRejectedValue(new Error('boom'));
    expect(await pickModelForMessage('hi')).toBe(AUTO_FALLBACK_MODEL);
  });

  it('classifies with the cheap OpenAI model', async () => {
    mockRun.mockResolvedValue({ content: 'simple', estimatedTokens: 1 });
    await pickModelForMessage('hi');
    expect(mockRun).toHaveBeenCalledWith('OPENAI', 'gpt-4.1-nano', expect.any(Array));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/autoModel.test.ts`
Expected: FAIL — `Cannot find module './autoModel'` (or equivalent resolve error).

- [ ] **Step 3: Write minimal implementation**

Create `lib/autoModel.ts`:

```ts
import { runCompletion } from './providers';
import type { Message } from './ddb';

// Cheapest capable model per difficulty tier (see ALL_MODELS in lib/models.ts).
const TIER_MODEL: Record<string, string> = {
  simple: 'gpt-4.1-nano',
  moderate: 'deepseek-chat',
  complex: 'deepseek-reasoner',
};

export const AUTO_FALLBACK_MODEL = 'gpt-4o-mini';

const CLASSIFY_PROMPT =
  'Classify the difficulty of answering the following user question. ' +
  'Reply with exactly one word: "simple" (greetings, trivia, short factual answers), ' +
  '"moderate" (summaries, translations, everyday coding, general explanations), or ' +
  '"complex" (multi-step reasoning, math proofs, debugging, architecture, long analysis). ' +
  'Reply with only that one word.';

/**
 * Picks the cheapest capable model for a message by asking gpt-4.1-nano to
 * rate its difficulty. Never throws — any failure falls back to a safe default
 * so classification can never block a completion.
 */
export async function pickModelForMessage(message: string): Promise<string> {
  try {
    const probe: Message = {
      role: 'user',
      content: `${CLASSIFY_PROMPT}\n\nQuestion:\n${message.slice(0, 2000)}`,
      createdAt: new Date().toISOString(),
    };
    const { content } = await runCompletion('OPENAI', 'gpt-4.1-nano', [probe]);
    const tier = content.trim().toLowerCase().match(/\b(simple|moderate|complex)\b/)?.[1];
    return (tier && TIER_MODEL[tier]) || AUTO_FALLBACK_MODEL;
  } catch {
    return AUTO_FALLBACK_MODEL;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/autoModel.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm test
git add lib/autoModel.ts lib/autoModel.test.ts
git commit -m "feat: add auto model classifier picking cheapest capable model"
```

---

### Task 2: Completions route auto path + `modelUsed`

**Files:**
- Modify: `app/api/completions/route.ts`
- Test: `tests/api/completions/autoMode.test.ts` (create)

**Interfaces:**
- Consumes: `pickModelForMessage(message)` from Task 1; existing `providerForModel`, `isValidModel`, `defaultModel` from `lib/models.ts`.
- Produces: request accepts `model: 'auto'` (any `provider` value, e.g. `'AUTO'`); response JSON gains `modelUsed: string` (the concrete model that ran). Clients from Task 3 rely on `modelUsed`.

- [ ] **Step 1: Write the failing test**

Create `tests/api/completions/autoMode.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret';

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null), isAdminEmail: () => false }));
vi.mock('@/lib/providers', () => ({ runCompletion: vi.fn(async () => ({ content: 'hi', estimatedTokens: 10 })) }));
vi.mock('@/lib/autoModel', () => ({
  pickModelForMessage: vi.fn(async () => 'deepseek-chat'),
  AUTO_FALLBACK_MODEL: 'gpt-4o-mini',
}));

const { POST } = await import('@/app/api/completions/route');
const { runCompletion } = await import('@/lib/providers');
const { pickModelForMessage } = await import('@/lib/autoModel');
const { generateCSRFToken } = await import('@/lib/csrf');

const anonId = `c-${globalThis.crypto.randomUUID()}`;
const ip = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

function makeReq(body: Record<string, unknown>) {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, 'x-forwarded-for': ip, cookie: `anon_id=${anonId}` },
    body: JSON.stringify(body),
  });
}

describe('completions auto mode', () => {
  it('resolves model=auto via classifier and reports modelUsed', async () => {
    const res = await POST(makeReq({ message: 'hello', provider: 'AUTO', model: 'auto' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.modelUsed).toBe('deepseek-chat');
    expect(vi.mocked(pickModelForMessage)).toHaveBeenCalledWith('hello');
    // Provider derived from the resolved model, not the client-sent 'AUTO'.
    expect(vi.mocked(runCompletion)).toHaveBeenCalledWith('DEEPSEEK', 'deepseek-chat', expect.any(Array));
  });

  it('reports modelUsed on non-auto requests too', async () => {
    const res = await POST(makeReq({ message: 'hello', provider: 'OPENAI', model: 'gpt-4o-mini' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.modelUsed).toBe('gpt-4o-mini');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/completions/autoMode.test.ts`
Expected: FAIL — `modelUsed` is `undefined`, and `runCompletion` called with `('AUTO', ...)`.

- [ ] **Step 3: Implement route changes**

In `app/api/completions/route.ts`:

Add import:

```ts
import { pickModelForMessage } from '@/lib/autoModel';
```

Replace the current block

```ts
    const user = await getSessionUser();
    const email = user?.email ?? `anon:${subject.kind === 'anon' ? subject.anonId : 'x'}`;
    const chosenModel = isValidModel(provider as Provider, model) ? model : defaultModel(provider as Provider);
```

with

```ts
    const user = await getSessionUser();
    const email = user?.email ?? `anon:${subject.kind === 'anon' ? subject.anonId : 'x'}`;

    // Auto mode: classify AFTER the quota/abuse gates so blocked users never
    // trigger classifier spend. The client-sent provider is ignored.
    let effectiveProvider = provider as Provider;
    let effectiveModel = model;
    if (model === 'auto') {
      effectiveModel = await pickModelForMessage(String(message));
      effectiveProvider = providerForModel(effectiveModel);
    }
    const chosenModel = isValidModel(effectiveProvider, effectiveModel) ? effectiveModel : defaultModel(effectiveProvider);
```

Then replace every later use of the raw `provider` variable with `effectiveProvider` (three places):

```ts
      ? await ensureConversation(conversationId, (subject as { token?: { token: string } }).token?.token ?? email, email, effectiveProvider)
```

```ts
    const result = await runCompletion(effectiveProvider, chosenModel, history);
```

```ts
      const tokenToCharge = selectTokenForProvider(allTokens, effectiveProvider, chosenModel) ?? subject.token;
```

Finally add `modelUsed` to the success response:

```ts
    return json({
      valid: true,
      conversationId: convo?.conversation_id ?? null,
      message: assistantMsg,
      displayName: convo?.displayName ?? null,
      remaining: post.remainingTokens,
      blocked: post.blocked,
      modelUsed: chosenModel,
    });
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/api/completions/autoMode.test.ts tests/api/completions.test.ts tests/api/completions/`
Expected: all pass (existing anon-quota, multi-token, preservation tests unaffected).

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm test
git add app/api/completions/route.ts tests/api/completions/autoMode.test.ts
git commit -m "feat: resolve model=auto server-side and report modelUsed"
```

---

### Task 3: Auto option in ModelPicker + ChatShell wiring

**Files:**
- Modify: `components/chat/ModelPicker.tsx`
- Modify: `components/chat/ChatShell.tsx`
- Modify: `components/chat/ChatInput.tsx`
- Modify: `i18n/resources.ts`
- Test: `tests/components/ChatInput.test.tsx` (extend)

**Interfaces:**
- Consumes: `modelUsed` from the Task 2 response.
- Produces: `ModelPicker` renders an `AUTO:auto` option first; `ChatShell` defaults to `provider='AUTO', model='auto'`; `ChatInput` gains optional prop `lastAutoModel?: string | null`.

- [ ] **Step 1: Add i18n keys (all four locales)**

In `i18n/resources.ts`, add inside each locale's `translation` object (before its closing brace):

en:
```ts
      "autoModelLabel": "Auto",
      "autoModelDescription": "Picks the best model for your question",
      "answeredBy": "Answered by {{model}}",
```
es:
```ts
      "autoModelLabel": "Auto",
      "autoModelDescription": "Elige el mejor modelo para tu pregunta",
      "answeredBy": "Respondido por {{model}}",
```
fr:
```ts
      "autoModelLabel": "Auto",
      "autoModelDescription": "Choisit le meilleur modèle pour votre question",
      "answeredBy": "Répondu par {{model}}",
```
de:
```ts
      "autoModelLabel": "Auto",
      "autoModelDescription": "Wählt das beste Modell für deine Frage",
      "answeredBy": "Beantwortet von {{model}}",
```

- [ ] **Step 2: Write the failing test**

Append to `tests/components/ChatInput.test.tsx` inside the `describe` block:

```ts
  it('shows the Auto option as selected when model is auto', () => {
    render(<ChatInput provider="AUTO" model="auto" onModelChange={() => {}} onSend={() => {}} quota={baseQuota} />);
    expect(screen.getByText('Auto')).toBeInTheDocument();
  });

  it('shows which model answered in auto mode', () => {
    render(<ChatInput provider="AUTO" model="auto" lastAutoModel="deepseek-chat" onModelChange={() => {}} onSend={() => {}} quota={baseQuota} />);
    expect(screen.getByText(/deepseek-chat/)).toBeInTheDocument();
  });
```

Also add `import '@/i18n/config';` to the top of that file if not present (needed for the `answeredBy` translation).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/components/ChatInput.test.tsx`
Expected: the two new tests FAIL (no Auto option, unknown prop).

- [ ] **Step 4: Implement**

`components/chat/ModelPicker.tsx` — build the auto option first and special-case selection. Replace the `options` construction and `selected` lookup:

```ts
  const autoOption = {
    label: t('autoModelLabel'),
    value: 'AUTO:auto',
    description: t('autoModelDescription'),
    disabled: false,
  };

  const options = [
    autoOption,
    ...models.map((m) => {
      const isDisabled = hasProviderData
        && !providerRemaining['ANY']
        && (providerRemaining[m.provider] === undefined || providerRemaining[m.provider] === 0);

      return {
        label: m.label,
        value: `${m.provider}:${m.id}`,
        description: isDisabled ? `${m.description} (${t('noTokensForProvider', { provider: m.provider })})` : m.description,
        disabled: isDisabled,
      };
    }),
  ];

  const selected = modelId === 'auto'
    ? autoOption
    : options.find((o) => o.value === `${models.find((m) => m.id === modelId)?.provider}:${modelId}`) ?? null;
```

`components/chat/ChatShell.tsx` — default to auto and track the answering model:

```ts
  const [model, setModel] = useState('auto');
  const [provider, setProvider] = useState('AUTO');
  const [lastAutoModel, setLastAutoModel] = useState<string | null>(null);
```

In `onSend`, inside the `status === 200 && body.valid` branch, add:

```ts
      setLastAutoModel(body.modelUsed ?? null);
```

Pass the prop down:

```tsx
              <ChatInput
                provider={provider}
                model={model}
                onModelChange={handleModelChange}
                onSend={onSend}
                quota={quota}
                pendingApproval={pendingApproval}
                providerRemaining={providerRemaining}
                lastAutoModel={lastAutoModel}
              />
```

`components/chat/ChatInput.tsx` — accept and render it. Add to `Props`:

```ts
  lastAutoModel?: string | null;
```

Add `import Box from '@cloudscape-design/components/box';`, destructure `lastAutoModel` in the component signature, and change the picker row to:

```tsx
      <SpaceBetween size="xs" direction="horizontal" alignItems="center">
        <ModelPicker modelId={model} onChange={onModelChange} providerRemaining={providerRemaining} />
        <EmojiPickerButton disabled={disabled} onSelect={(e) => setValue((v) => v + e)} />
        {model === 'auto' && lastAutoModel && (
          <Box fontSize="body-s" color="text-status-inactive">{t('answeredBy', { model: lastAutoModel })}</Box>
        )}
      </SpaceBetween>
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/components/`
Expected: all component tests pass (ChatShell mount test unaffected — it only checks the composer placeholder).

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm test
git add components/chat/ModelPicker.tsx components/chat/ChatShell.tsx components/chat/ChatInput.tsx i18n/resources.ts tests/components/ChatInput.test.tsx
git commit -m "feat: add Auto option to model picker, default to auto mode"
```

---

### Task 4: Copy button on every message

**Files:**
- Modify: `components/chat/MarkdownMessage.tsx`
- Modify: `components/chat/MarkdownMessage.css`
- Modify: `i18n/resources.ts`
- Test: `tests/components/MarkdownMessage.test.tsx` (extend + fix ambiguity)

**Interfaces:**
- Consumes: nothing new.
- Produces: every `MarkdownMessage` (chat AND admin modal) renders a Cloudscape `CopyToClipboard` icon that copies the raw `content`. Admin modal in Task 7 gets this for free.

- [ ] **Step 1: Add i18n keys (all four locales)**

en:
```ts
      "copyMessage": "Copy message",
      "copied": "Copied",
      "copyFailed": "Copy failed",
```
es:
```ts
      "copyMessage": "Copiar mensaje",
      "copied": "Copiado",
      "copyFailed": "Error al copiar",
```
fr:
```ts
      "copyMessage": "Copier le message",
      "copied": "Copié",
      "copyFailed": "Échec de la copie",
```
de:
```ts
      "copyMessage": "Nachricht kopieren",
      "copied": "Kopiert",
      "copyFailed": "Kopieren fehlgeschlagen",
```

- [ ] **Step 2: Write the failing test**

In `tests/components/MarkdownMessage.test.tsx`: add `import '@/i18n/config';` at the top, then add:

```ts
  it('renders a message-level copy button', () => {
    render(<MarkdownMessage content="hello" type="prompt" timestamp="Jan 1" />);
    expect(screen.getByRole('button', { name: 'Copy message' })).toBeInTheDocument();
  });
```

And fix the now-ambiguous code-block assertion — change

```ts
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
```

to

```ts
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/components/MarkdownMessage.test.tsx`
Expected: new test FAILS (no button named "Copy message").

- [ ] **Step 4: Implement**

`components/chat/MarkdownMessage.tsx` — add imports:

```ts
import { useTranslation } from 'react-i18next';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
```

Replace the default export with:

```tsx
export default function MarkdownMessage({ content, type, timestamp }: Props) {
  const { t } = useTranslation();
  return (
    <div className={`markdown-message ${type}`}>
      <div className="markdown-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={mdComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
      <div className="message-footer">
        <span className="message-time">{timestamp}</span>
        <CopyToClipboard
          variant="icon"
          textToCopy={content}
          copyButtonAriaLabel={t('copyMessage')}
          copySuccessText={t('copied')}
          copyErrorText={t('copyFailed')}
        />
      </div>
    </div>
  );
}
```

`components/chat/MarkdownMessage.css` — add:

```css
.message-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    margin-top: 4px;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/components/MarkdownMessage.test.tsx`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm test
git add components/chat/MarkdownMessage.tsx components/chat/MarkdownMessage.css i18n/resources.ts tests/components/MarkdownMessage.test.tsx
git commit -m "feat: add copy button to every chat message"
```

---

### Task 5: Token-request modal success flow

**Files:**
- Modify: `components/auth/SignupRequestForm.tsx`
- Modify: `components/chat/ChatShell.tsx`
- Test: `tests/components/SignupRequestForm.test.tsx` (extend)

**Interfaces:**
- Consumes: existing `/api/requestToken` endpoint (unchanged).
- Produces: `SignupRequestForm` gains prop `onDone?: () => void`; on success the form is replaced by a success Alert + Close button that calls `onDone`. `ChatShell` remounts the form per modal open via a `key`.

- [ ] **Step 1: Write the failing test**

Append to `tests/components/SignupRequestForm.test.tsx`:

```ts
import { fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

  it('replaces the form with a dismissible success message after submit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/csrf')) return { ok: true, json: async () => ({ token: 'tok' }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    }));
    const onDone = vi.fn();
    render(<SignupRequestForm onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request tokens' }));
    await waitFor(() => expect(screen.getByText('Close')).toBeInTheDocument());
    expect(screen.queryByText('Company')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDone).toHaveBeenCalled();
  });
```

(Merge the imports into the existing import lines rather than duplicating them.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/SignupRequestForm.test.tsx`
Expected: FAIL — form fields still visible, no Close button.

- [ ] **Step 3: Implement**

`components/auth/SignupRequestForm.tsx` — accept the prop and early-return the success view:

```tsx
export function SignupRequestForm({ onDone }: { onDone?: () => void } = {}) {
```

Immediately before the `return (` of the form, add:

```tsx
  if (status === 'ok') {
    return (
      <SpaceBetween size="l">
        <Alert type="success">{t('tokenRequestSubmitted')}</Alert>
        <Button variant="primary" onClick={() => onDone?.()}>{t('close')}</Button>
      </SpaceBetween>
    );
  }
```

Remove the now-dead `{status === 'ok' && <Alert type="success">...}` line from the form body.

`components/chat/ChatShell.tsx` — wire dismissal and remount fresh per open:

```tsx
      <Modal visible={requestOpen} onDismiss={() => setRequestOpen(false)} header={t('requestTokens')}>
        <SignupRequestForm key={String(requestOpen)} onDone={() => setRequestOpen(false)} />
      </Modal>
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/components/SignupRequestForm.test.tsx tests/components/ChatShell.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm test
git add components/auth/SignupRequestForm.tsx components/chat/ChatShell.tsx tests/components/SignupRequestForm.test.tsx
git commit -m "feat: show dismissible success message after token request"
```

---

### Task 6: Export conversation (Markdown / JSON)

**Files:**
- Create: `lib/client/exportConversation.ts`
- Modify: `components/chat/ChatShell.tsx`
- Modify: `i18n/resources.ts`
- Test: `tests/client/exportConversation.test.ts` (create)

**Interfaces:**
- Consumes: `ChatShell`'s `messages` state and active conversation `displayName`.
- Produces:
  - `conversationToMarkdown(c: ExportConvo): string`
  - `conversationToJson(c: ExportConvo): string`
  - `safeFilename(name: string): string`
  - `downloadFile(filename: string, content: string, mime: string): void`
  - `ExportConvo = { displayName: string; messages: { role: string; content: string; createdAt: string }[] }`

- [ ] **Step 1: Add i18n keys (all four locales)**

en:
```ts
      "export": "Export",
      "exportMarkdown": "Markdown (.md)",
      "exportJson": "JSON (.json)",
```
es:
```ts
      "export": "Exportar",
      "exportMarkdown": "Markdown (.md)",
      "exportJson": "JSON (.json)",
```
fr:
```ts
      "export": "Exporter",
      "exportMarkdown": "Markdown (.md)",
      "exportJson": "JSON (.json)",
```
de:
```ts
      "export": "Exportieren",
      "exportMarkdown": "Markdown (.md)",
      "exportJson": "JSON (.json)",
```

- [ ] **Step 2: Write the failing test**

Create `tests/client/exportConversation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { conversationToMarkdown, conversationToJson, safeFilename } from '@/lib/client/exportConversation';

const convo = {
  displayName: 'My Chat',
  messages: [
    { role: 'user', content: 'hello **world**', createdAt: '2026-07-01T10:00:00.000Z' },
    { role: 'assistant', content: 'hi!', createdAt: '2026-07-01T10:00:05.000Z' },
  ],
};

describe('conversationToMarkdown', () => {
  it('renders a title and one section per message', () => {
    const md = conversationToMarkdown(convo);
    expect(md).toContain('# My Chat');
    expect(md).toContain('## 👤 User');
    expect(md).toContain('## 🤖 Assistant');
    expect(md).toContain('hello **world**');
    expect(md).toContain('hi!');
  });
});

describe('conversationToJson', () => {
  it('round-trips the messages array', () => {
    const parsed = JSON.parse(conversationToJson(convo));
    expect(parsed.displayName).toBe('My Chat');
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].content).toBe('hello **world**');
  });
});

describe('safeFilename', () => {
  it('strips unsafe characters and falls back when empty', () => {
    expect(safeFilename('My Chat: v2/final?')).toBe('My Chat v2final');
    expect(safeFilename('///')).toBe('conversation');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/client/exportConversation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `lib/client/exportConversation.ts`:

```ts
export interface ExportMsg { role: string; content: string; createdAt: string; }
export interface ExportConvo { displayName: string; messages: ExportMsg[]; }

export function conversationToMarkdown(c: ExportConvo): string {
  const lines = [`# ${c.displayName}`, ''];
  for (const m of c.messages) {
    const who = m.role === 'user' ? '👤 User' : '🤖 Assistant';
    lines.push(`## ${who} — ${new Date(m.createdAt).toLocaleString()}`, '', m.content, '');
  }
  return lines.join('\n');
}

export function conversationToJson(c: ExportConvo): string {
  return JSON.stringify({ displayName: c.displayName, messages: c.messages }, null, 2);
}

export function safeFilename(name: string): string {
  return (name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'conversation').slice(0, 60);
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/client/exportConversation.test.ts`
Expected: all pass.

- [ ] **Step 6: Add the Export dropdown to ChatShell**

In `components/chat/ChatShell.tsx` add imports:

```ts
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import { conversationToMarkdown, conversationToJson, safeFilename, downloadFile } from '@/lib/client/exportConversation';
```

Add a handler inside the component (after `handleModelChange`):

```ts
  const exportActive = (format: string) => {
    const name = conversations.find((c) => c.conversation_id === activeId)?.displayName ?? 'conversation';
    const convo = { displayName: name, messages };
    if (format === 'md') downloadFile(`${safeFilename(name)}.md`, conversationToMarkdown(convo), 'text/markdown');
    else downloadFile(`${safeFilename(name)}.json`, conversationToJson(convo), 'application/json');
  };
```

Add the dropdown as the first element of `headerActions`:

```tsx
      <ButtonDropdown
        items={[{ id: 'md', text: t('exportMarkdown') }, { id: 'json', text: t('exportJson') }]}
        disabled={messages.length === 0}
        onItemClick={({ detail }) => exportActive(detail.id)}
      >
        {t('export')}
      </ButtonDropdown>
```

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm test
git add lib/client/exportConversation.ts tests/client/exportConversation.test.ts components/chat/ChatShell.tsx i18n/resources.ts
git commit -m "feat: add conversation export to Markdown and JSON"
```

---

### Task 7: Admin layout + markdown conversation modal

**Files:**
- Modify: `app/admin/page.tsx`
- Modify: `components/admin/ConversationsTable.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/ConversationsTable.test.tsx` (create)

**Interfaces:**
- Consumes: `MarkdownMessage` from Task 4 (with its copy button).
- Produces: centered admin content (`max-width: 1100px`), `xl` spacing between tables, conversation modal rendering markdown.

- [ ] **Step 1: Write the failing test**

Create `tests/components/ConversationsTable.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n/config';
import { ConversationsTable } from '@/components/admin/ConversationsTable';
import type { ConversationDoc } from '@/lib/ddb';

const convo = {
  conversation_id: 'c1',
  displayName: 'Test convo',
  user_id: 'a@b.c',
  provider: 'OPENAI',
  messages: [
    { role: 'user', content: '**bold ask**', createdAt: '2026-07-01T10:00:00.000Z' },
    { role: 'assistant', content: 'plain answer', createdAt: '2026-07-01T10:00:05.000Z' },
  ],
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:05.000Z',
} as unknown as ConversationDoc;

describe('ConversationsTable modal', () => {
  it('renders messages as markdown with copy buttons', () => {
    render(<ConversationsTable items={[convo]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Test convo' }));
    // markdown rendered: ** stripped, <strong> present
    expect(screen.getByText('bold ask')).toBeInTheDocument();
    expect(screen.queryByText('**bold ask**')).not.toBeInTheDocument();
    // message-level copy buttons from MarkdownMessage
    expect(screen.getAllByRole('button', { name: 'Copy message' })).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ConversationsTable.test.tsx`
Expected: FAIL — raw `**bold ask**` text rendered, no copy buttons.

- [ ] **Step 3: Implement modal markdown**

In `components/admin/ConversationsTable.tsx` add:

```ts
import MarkdownMessage from '@/components/chat/MarkdownMessage';
```

Change the modal to `size="max"` and replace the message rendering block with:

```tsx
        <SpaceBetween size="s">
          {viewing?.messages.map((msg, i) => (
            <MarkdownMessage
              key={i}
              content={msg.content}
              type={msg.role === 'user' ? 'prompt' : 'response'}
              timestamp={new Date(msg.createdAt).toLocaleString()}
            />
          ))}
          {!viewing?.messages.length && <Box color="text-status-inactive">No messages</Box>}
        </SpaceBetween>
```

(The `Header` import stays; the per-message `Box` role/timestamp markup goes away.)

- [ ] **Step 4: Implement admin layout**

`app/admin/page.tsx` — wrap the content and widen spacing:

```tsx
  return (
    <div className="admin-content">
      <ContentLayout header={<Header variant="h1">Admin</Header>}>
        <SpaceBetween size="xl">
          <TokenRequestsTable items={tables.unprocessedTokens ?? []} onRefresh={load} />
          <UsersTable users={tables.users ?? []} onRefresh={load} />
          <TokensTable items={tables.tokens ?? []} onRefresh={load} />
          <BlocksTable items={tables.blocks ?? []} onRefresh={load} />
          <ConversationsTable items={tables.conversations ?? []} />
        </SpaceBetween>
      </ContentLayout>
    </div>
  );
```

`app/globals.css` — append:

```css
/* Admin page: centered, breathable tables */
.admin-content {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px 16px 48px;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/components/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm test
git add components/admin/ConversationsTable.tsx app/admin/page.tsx app/globals.css tests/components/ConversationsTable.test.tsx
git commit -m "feat: center admin layout, render conversation modal as markdown"
```

---

### Task 8: Page titles

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/admin/layout.tsx`

**Interfaces:**
- Produces: browser-tab titles — home "Chat · chat.hectoragomez.com", admin "Admin · chat.hectoragomez.com".

- [ ] **Step 1: Implement**

`app/layout.tsx` — replace the metadata export:

```ts
export const metadata = {
  title: {
    default: 'Chat · chat.hectoragomez.com',
    template: '%s · chat.hectoragomez.com',
  },
};
```

`app/admin/layout.tsx` — add below the `dynamic` export:

```ts
export const metadata = { title: 'Admin' };
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run build 2>&1 | tail -5`
Expected: typecheck clean; build succeeds.

- [ ] **Step 3: Commit**

```bash
npm test
git add app/layout.tsx app/admin/layout.tsx
git commit -m "feat: add page titles for chat and admin pages"
```

---

### Task 9: Kiro-like look — dark default, compact density, CSS polish

**Files:**
- Modify: `app/providers.tsx`
- Modify: `components/chat/SettingsPanel.tsx`
- Modify: `components/chat/MarkdownMessage.tsx` (highlight theme import)
- Modify: `components/chat/MarkdownMessage.css`
- Modify: `components/chat/ChatShell.tsx` (icon header buttons)
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: existing theme system (`applyTheme` in SettingsPanel, `data-theme` attribute). Existing custom themes (matrix, tokyo-night, solarized-*) keep working — only the DEFAULT changes.
- Produces: dark + compact by default; users who previously picked a theme keep it (localStorage wins).

- [ ] **Step 1: Dark + compact defaults**

`app/providers.tsx` — replace the effect:

```tsx
'use client';
import { Auth0Provider } from '@auth0/nextjs-auth0';
import { I18nextProvider } from 'react-i18next';
import { useEffect, type ReactNode } from 'react';
import { applyMode, applyDensity, Density, Mode } from '@cloudscape-design/global-styles';
import i18n from '@/i18n/config';

const LIGHT_THEMES = ['light', 'solarized-light'];

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    const saved = localStorage.getItem('appearance') || 'dark';
    applyMode(LIGHT_THEMES.includes(saved) ? Mode.Light : Mode.Dark);
    applyDensity(Density.Compact);
  }, []);
  return (
    <Auth0Provider>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </Auth0Provider>
  );
}
```

`components/chat/SettingsPanel.tsx` — change both defaults from `'light'` to `'dark'`:

```ts
  const [theme, setTheme] = useState('dark');
```

```ts
    const saved = localStorage.getItem('appearance') || 'dark';
```

- [ ] **Step 2: Dark code highlighting + flat IDE-style message bubbles**

`components/chat/MarkdownMessage.tsx` — swap the highlight stylesheet:

```ts
import 'highlight.js/styles/github-dark.css';
```

(replaces the `github.css` import.)

`components/chat/MarkdownMessage.css` — replace the bubble backgrounds and code header with flat dark surfaces:

```css
.markdown-message.prompt {
    background: #263349;
    color: #e6e9ef;
    margin-left: auto;
    border: 1px solid #364560;
}

.markdown-message.response {
    background: #1e2633;
    color: #e6e9ef;
    margin-right: auto;
    border: 1px solid #2c3850;
}
```

(replacing the two gradient rules), and change `.code-block-header`'s `background: #f6f8fa;` to:

```css
    background: #161b22;
    color: #e6e9ef;
```

- [ ] **Step 3: Tighter header actions (icon buttons)**

`components/chat/ChatShell.tsx` — replace `headerActions` (keeping the Export dropdown from Task 6 first):

```tsx
  const headerActions = (
    <SpaceBetween direction="horizontal" size="xs">
      <ButtonDropdown
        items={[{ id: 'md', text: t('exportMarkdown') }, { id: 'json', text: t('exportJson') }]}
        disabled={messages.length === 0}
        onItemClick={({ detail }) => exportActive(detail.id)}
      >
        {t('export')}
      </ButtonDropdown>
      <Button onClick={() => setToolsOpen((o) => !o)} iconName="settings" variant="icon" ariaLabel={t('settings')} />
      {authenticated
        ? <Button onClick={() => setRequestOpen(true)} iconName="key" variant="icon" ariaLabel={t('requestTokens')} />
        : <Button onClick={() => { window.location.href = '/auth/login?returnTo=/'; }} iconName="user-profile" variant="icon" ariaLabel={t('logIn')} />
      }
    </SpaceBetween>
  );
```

- [ ] **Step 4: Chat pane fills the viewport (IDE feel)**

`app/globals.css` — append:

```css
/* Chat pane: IDE-style fixed-height scrollable message area */
.chat-messages {
    min-height: 45vh;
    max-height: calc(100vh - 340px);
    overflow-y: auto;
    padding: 4px 2px;
    scroll-behavior: smooth;
}
```

- [ ] **Step 5: Run full verification**

Run: `npm run typecheck && npm test`
Expected: clean + all pass. (ChatShell test only asserts the composer placeholder; icon-button swap keeps `ariaLabel` so accessibility queries still work.)

- [ ] **Step 6: Visual smoke test**

Run the dev server and eyeball: dark by default, compact density, icon header buttons, message bubbles flat dark, code blocks dark, admin centered, export dropdown present, token-request success flow, copy buttons.

```bash
npm run dev
```

Check http://localhost:3000 and http://localhost:3000/admin (admin needs `ADMIN_EMAIL` + Auth0 or shows chat only — layout/title still verifiable).

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm test
git add app/providers.tsx components/chat/SettingsPanel.tsx components/chat/MarkdownMessage.tsx components/chat/MarkdownMessage.css components/chat/ChatShell.tsx app/globals.css
git commit -m "feat: Kiro-like dark compact default theme and tighter header"
```

---

## Self-review notes

- Spec coverage: auto mode (Tasks 1–3), copy buttons (Task 4), token-request flow (Task 5), export (Task 6), admin layout + markdown modal (Task 7), page titles (Task 8), Kiro look + spacing (Task 9). All spec sections covered.
- `modelUsed` is returned for every request (not only auto) — deliberate, harmless, useful.
- Existing custom themes (matrix/tokyo-night/solarized) untouched; only defaults change.
- Task 9 Step 3 depends on Task 6's `exportActive` — execute tasks in order.
