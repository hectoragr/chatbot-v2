import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from '@/components/chat/ChatInput';

// ModelSelector calls fetchModels() on mount; stub fetch so it resolves cleanly.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ models: { OPENAI: [{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }] } }) })));
});

const baseQuota = { tier: 'anon' as const, remainingTokens: 500, remainingQuestions: 2, blocked: false, resetsDaily: true };

describe('ChatInput', () => {
  it('disables the textarea when quota blocked', () => {
    render(<ChatInput provider="OPENAI" model="gpt-4o-mini" onModelChange={() => {}} onSend={() => {}} quota={{ ...baseQuota, blocked: true }} />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
  it('calls onSend with typed message', () => {
    const onSend = vi.fn();
    render(<ChatInput provider="OPENAI" model="gpt-4o-mini" onModelChange={() => {}} onSend={onSend} quota={baseQuota} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi there' } });
    fireEvent.click(screen.getByLabelText(/send/i));
    expect(onSend).toHaveBeenCalledWith('hi there');
  });
});
