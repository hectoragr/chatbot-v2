import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuotaBanner } from '@/components/chat/QuotaBanner';

describe('QuotaBanner', () => {
  it('shows remaining tokens when not blocked', () => {
    render(<QuotaBanner quota={{ tier: 'anon', remainingTokens: 800, remainingQuestions: 2, blocked: false, resetsDaily: true }} />);
    expect(screen.getByText(/800/)).toBeInTheDocument();
  });
  it('shows a blocked message when blocked', () => {
    render(<QuotaBanner quota={{ tier: 'anon', remainingTokens: 0, remainingQuestions: 0, blocked: true, reason: 'questions_exhausted', resetsDaily: true }} />);
    expect(screen.getAllByText(/limit/i)[0]).toBeInTheDocument();
  });
});
