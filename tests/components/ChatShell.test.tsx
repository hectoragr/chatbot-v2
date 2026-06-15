import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@/i18n/config';
import { ChatShell } from '@/components/chat/ChatShell';

// jsdom doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    let body: unknown = {};
    if (url.startsWith('/api/me')) body = { authenticated: false, quota: { tier: 'anon', remainingTokens: 1000, remainingQuestions: 3, blocked: false, resetsDaily: true } };
    else if (url.startsWith('/api/models')) body = { models: { OPENAI: [{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }] } };
    else if (url.startsWith('/api/conversations')) body = { conversations: [] };
    return { status: 200, json: async () => body } as Response;
  }));
});

describe('ChatShell', () => {
  it('mounts and renders the message composer', async () => {
    render(<ChatShell />);
    await waitFor(() => expect(screen.getByPlaceholderText('Type your message here...')).toBeInTheDocument());
  });
});
