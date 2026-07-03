import { describe, it, expect } from 'vitest';
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

  it('offers an export action per row', () => {
    render(<ConversationsTable items={[convo]} />);
    expect(screen.getAllByRole('button', { name: /export/i }).length).toBeGreaterThanOrEqual(1);
  });
});
