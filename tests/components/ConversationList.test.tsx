import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n/config';
import { ConversationList } from '@/components/chat/ConversationList';

describe('ConversationList', () => {
  it('renders title and delete control in one flex row', () => {
    render(<ConversationList
      conversations={[{ conversation_id: 'c1', displayName: 'A very long conversation title that should truncate' }]}
      activeId={null} onSelect={() => {}} onNew={() => {}} onDelete={vi.fn()} />);
    const row = screen.getByTestId('convo-row-c1');
    expect(getComputedStyle(row).display).toBe('flex');
    expect(screen.getByLabelText(/delete conversation/i)).toBeInTheDocument();
  });
});
