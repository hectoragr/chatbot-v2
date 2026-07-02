import '@/i18n/config';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MarkdownMessage from '@/components/chat/MarkdownMessage';

describe('MarkdownMessage', () => {
  it('renders markdown content and timestamp', () => {
    render(<MarkdownMessage content="**bold** text" type="response" timestamp="Jan 1" />);
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('Jan 1')).toBeInTheDocument();
  });

  it('renders a copy button and language label for a fenced code block', () => {
    render(
      <MarkdownMessage
        content={'```js\nconst x = 1;\n```'}
        type="response"
        timestamp="Jan 1"
      />,
    );
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByText('js')).toBeInTheDocument();
  });

  it('renders a message-level copy button', () => {
    render(<MarkdownMessage content="hello" type="prompt" timestamp="Jan 1" />);
    expect(screen.getByRole('button', { name: 'Copy message' })).toBeInTheDocument();
  });
});
