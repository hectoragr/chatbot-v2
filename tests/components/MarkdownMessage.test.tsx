import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MarkdownMessage from '@/components/chat/MarkdownMessage';

describe('MarkdownMessage', () => {
  it('renders markdown content and timestamp', () => {
    render(<MarkdownMessage content="**bold** text" type="response" timestamp="Jan 1" />);
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('Jan 1')).toBeInTheDocument();
  });
});
