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
  return (await r.json()) as { models: Record<string, { id: string; label: string }[]>; allModels: { id: string; provider: string; label: string; description: string; costPer1kTokens: number }[] };
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
  attachments?: { name: string; kind: string; content: string }[];
  captchaId?: string; captchaAnswer?: string;
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
  const csrf = await getCsrf();
  const r = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'X-CSRF-Token': csrf },
  });
  return { status: r.status, body: await r.json() };
}

export async function fetchCaptcha() {
  const r = await fetch('/api/captcha');
  return (await r.json()) as { id: string; question: string };
}

export async function postContact(input: { message: string; captchaId?: string; captchaAnswer?: string }) {
  const csrf = await getCsrf();
  const r = await fetch('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(input),
  });
  return { status: r.status, body: await r.json() };
}
