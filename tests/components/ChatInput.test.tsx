import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatInput } from '@/components/chat/ChatInput';
import '@/i18n/config';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ models: { OPENAI: [{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }] }, allModels: [{ id: 'gpt-4o-mini', provider: 'OPENAI', label: 'GPT-4o Mini', description: '', costPer1kTokens: 0.15 }] }) })));
});

const baseQuota = { tier: 'anon' as const, remainingTokens: 500, remainingQuestions: 2, blocked: false, resetsDaily: true };

describe('ChatInput', () => {
  it('disables the textarea when quota blocked', () => {
    render(<ChatInput provider="OPENAI" model="gpt-4o-mini" onModelChange={() => {}} onSend={() => {}} quota={{ ...baseQuota, blocked: true }} />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
  it('calls onSend with typed message', async () => {
    const onSend = vi.fn();
    render(<ChatInput provider="OPENAI" model="gpt-4o-mini" onModelChange={() => {}} onSend={onSend} quota={baseQuota} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi there' } });
    fireEvent.click(screen.getByLabelText(/send/i));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hi there', {}));
  });
  it('shows the Auto option as selected when model is auto', () => {
    render(<ChatInput provider="AUTO" model="auto" onModelChange={() => {}} onSend={() => {}} quota={baseQuota} />);
    expect(screen.getByText('Auto')).toBeInTheDocument();
  });

  it('shows which model answered in auto mode', () => {
    render(<ChatInput provider="AUTO" model="auto" lastAutoModel="deepseek-chat" onModelChange={() => {}} onSend={() => {}} quota={baseQuota} />);
    expect(screen.getByText(/deepseek-chat/)).toBeInTheDocument();
  });

  it('shows contact hint and captcha input in anonymous contact mode', () => {
    render(<ChatInput provider="AUTO" model="auto" onModelChange={() => {}} onSend={() => {}} quota={baseQuota}
      contact={{ active: true, anon: true, question: '3 + 4', onCancel: () => {} }} />);
    expect(screen.getByText(/emailed to the site owner/i)).toBeInTheDocument();
    expect(screen.getByText(/3 \+ 4/)).toBeInTheDocument();
  });

  it('passes the captcha answer through onSend in contact mode', async () => {
    const onSend = vi.fn();
    render(<ChatInput provider="AUTO" model="auto" onModelChange={() => {}} onSend={onSend} quota={baseQuota}
      contact={{ active: true, anon: true, question: '3 + 4', onCancel: () => {} }} />);
    fireEvent.change(screen.getByRole('textbox', { name: '' }), { target: { value: 'hello owner' } });
    const answerInput = screen.getByPlaceholderText('?');
    fireEvent.change(answerInput, { target: { value: '7' } });
    fireEvent.click(screen.getByLabelText(/send/i));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hello owner', { captchaAnswer: '7' }));
  });

  it('renders the file upload control', () => {
    render(<ChatInput provider="AUTO" model="auto" onModelChange={() => {}} onSend={() => {}} quota={baseQuota} />);
    expect(screen.getAllByText(/attach files/i).length).toBeGreaterThan(0);
  });
});
