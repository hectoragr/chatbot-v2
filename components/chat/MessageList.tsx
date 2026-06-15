'use client';
import { useEffect, useRef } from 'react';
import MarkdownMessage from './MarkdownMessage';

interface Msg { role: 'user' | 'assistant' | 'system'; content: string; createdAt: string; }

export function MessageList({ messages, typing }: { messages: Msg[]; typing: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, typing]);
  return (
    <div className="chat-messages">
      {messages.map((m, i) => (
        <MarkdownMessage key={i} content={m.content} type={m.role === 'user' ? 'prompt' : 'response'}
          timestamp={new Date(m.createdAt).toLocaleString()} />
      ))}
      {typing && <div className="typing">Typing&hellip;</div>}
      <div ref={end} />
    </div>
  );
}
