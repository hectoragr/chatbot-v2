import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SignupRequestForm } from '@/components/auth/SignupRequestForm';

describe('SignupRequestForm', () => {
  it('renders company, tokens, and provider fields', () => {
    render(<SignupRequestForm />);
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('Tokens requested')).toBeInTheDocument();
    expect(screen.getByText('Provider')).toBeInTheDocument();
  });
});
