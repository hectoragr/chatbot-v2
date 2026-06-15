'use client';
import { useEffect, useState } from 'react';
import AppLayout from '@cloudscape-design/components/app-layout';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import Button from '@cloudscape-design/components/button';
import { ConversationList } from './ConversationList';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { SettingsPanel } from './SettingsPanel';
import { fetchMe, fetchConversations, sendCompletion, deleteConversation } from '@/lib/client/api';
import type { QuotaStatusDTO } from '@/lib/client/api';

interface Msg { role: 'user' | 'assistant' | 'system'; content: string; createdAt: string; }
interface Convo { conversation_id: string; displayName: string; messages: Msg[]; }

const EMPTY_QUOTA: QuotaStatusDTO = { tier: 'anon', remainingTokens: 0, remainingQuestions: 0, blocked: false, resetsDaily: true };

export function ChatShell() {
  const [authenticated, setAuthenticated] = useState(false);
  const [conversations, setConversations] = useState<Convo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [provider, setProvider] = useState('OPENAI');
  const [model, setModel] = useState('gpt-4o-mini');
  const [quota, setQuota] = useState<QuotaStatusDTO>(EMPTY_QUOTA);
  const [typing, setTyping] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  // setProvider kept for downstream; suppress unused-var lint
  void setProvider;

  useEffect(() => {
    (async () => {
      const me = await fetchMe();
      setAuthenticated(!!me.authenticated);
      setQuota(me.quota);
      if (me.authenticated) {
        const c = await fetchConversations();
        setConversations(c.conversations ?? []);
      }
    })();
  }, []);

  const startNew = () => { setActiveId(null); setMessages([]); };

  const selectConvo = (id: string) => {
    const c = conversations.find((x) => x.conversation_id === id);
    setActiveId(id);
    setMessages(c?.messages ?? []);
  };

  const onSend = async (text: string) => {
    const userMsg: Msg = { role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, userMsg]);
    setTyping(true);
    const { status, body } = await sendCompletion({ message: text, provider, model, conversationId: activeId });
    setTyping(false);
    if (status === 200 && body.valid) {
      setMessages((m) => [...m, body.message]);
      if (body.conversationId) setActiveId(body.conversationId);
      if (authenticated) { const c = await fetchConversations(); setConversations(c.conversations ?? []); }
    }
    const me = await fetchMe();
    setQuota(me.quota);
  };

  const removeConvo = async (id: string) => {
    await deleteConversation(id);
    setConversations((c) => c.filter((x) => x.conversation_id !== id));
    if (activeId === id) startNew();
  };

  // removeConvo kept for downstream wiring; suppress unused-var lint
  void removeConvo;

  return (
    <AppLayout
      navigationHide={!authenticated}
      navigation={<ConversationList conversations={conversations} activeId={activeId} onSelect={selectConvo} onNew={startNew} />}
      toolsOpen={toolsOpen}
      onToolsChange={({ detail }) => setToolsOpen(detail.open)}
      tools={<SettingsPanel />}
      content={
        <ContentLayout header={<Header variant="h1" actions={<Button onClick={() => setToolsOpen(true)} iconName="settings">Settings</Button>}>Chat</Header>}>
          <Container footer={<ChatInput provider={provider} model={model} onModelChange={setModel} onSend={onSend} quota={quota} />}>
            <MessageList messages={messages} typing={typing} />
          </Container>
        </ContentLayout>
      }
    />
  );
}
