'use client';
import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';
import './MarkdownMessage.css';

interface Props {
  content: string;
  type: 'prompt' | 'response';
  timestamp: string;
}

// In react-markdown v10 the `code` component no longer receives an `inline`
// prop, and hast nodes aren't doubly-linked (no `node.parent`). A fenced code
// block is the only `code` that carries a `language-*` className, so matching
// that className is both necessary and sufficient to identify it — this
// replicates the original component's `!inline && match` condition.
const CodeBlock: Components['code'] = ({ className, children, ...props }) => {
  const match = /language-(\w+)/.exec(className || '');
  if (match) {
    return (
      <div className="code-block-container">
        <div className="code-block-header">
          <span className="language-label">{match[1]}</span>
          <button
            className="copy-button"
            onClick={() => navigator.clipboard.writeText(String(children))}
          >
            Copy
          </button>
        </div>
        <code className={className} {...props}>
          {children}
        </code>
      </div>
    );
  }
  return (
    <code className={`inline-code ${className ?? ''}`} {...props}>
      {children}
    </code>
  );
};

const mdComponents: Components = {
  code: CodeBlock,
  blockquote({ children }) {
    return <blockquote className="custom-blockquote">{children}</blockquote>;
  },
  table({ children }) {
    return (
      <div className="table-container">
        <table className="custom-table">{children}</table>
      </div>
    );
  },
  h1({ children }) {
    return <h1 className="markdown-h1">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="markdown-h2">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="markdown-h3">{children}</h3>;
  },
  ul({ children }) {
    return <ul className="markdown-ul">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="markdown-ol">{children}</ol>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="markdown-link">
        {children}
      </a>
    );
  },
};

export default function MarkdownMessage({ content, type, timestamp }: Props) {
  return (
    <div className={`markdown-message ${type}`}>
      <div className="markdown-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={mdComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
      <span className="message-time">{timestamp}</span>
    </div>
  );
}
