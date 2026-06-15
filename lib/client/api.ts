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
