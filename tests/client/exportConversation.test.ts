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
