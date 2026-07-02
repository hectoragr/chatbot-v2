'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AppLayout from '@cloudscape-design/components/app-layout';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { ConversationList } from './ConversationList';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { SettingsPanel } from './SettingsPanel';
import { SignupRequestForm } from '@/components/auth/SignupRequestForm';
import { fetchMe, fetchConversations, sendCompletion, deleteConversation } from '@/lib/client/api';
import { providerForModel } from '@/lib/models';
import { conversationToMarkdown, conversationToJson, safeFilename, downloadFile } from '@/lib/client/exportConversation';
import type { QuotaStatusDTO } from '@/lib/client/api';

interface Msg { role: 'user' | 'assistant' | 'system'; content: string; createdAt: string; }
interface Convo { conversation_id: string; displayName: string; messages: Msg[]; }

const EMPTY_QUOTA: QuotaStatusDTO = { tier: 'anon', remainingTokens: 0, remainingQuestions: 0, blocked: false, resetsDaily: true };
const TEMP_PREFIX = 'temp_';

export function ChatShell() {
  const { t } = useTranslation();
  const [authenticated, setAuthenticated] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [conversations, setConversations] = useState<Convo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [model, setModel] = useState('auto');
  const [provider, setProvider] = useState('AUTO');
  const [lastAutoModel, setLastAutoModel] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaStatusDTO>(EMPTY_QUOTA);
  const [providerRemaining, setProviderRemaining] = useState<Record<string, number> | undefined>(undefined);
  const [typing, setTyping] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const me = await fetchMe();
      setAuthenticated(!!me.authenticated);
      setPendingApproval(!!me.pendingApproval);
      setQuota(me.quota ?? EMPTY_QUOTA);
      if (me.providerRemaining) setProviderRemaining(me.providerRemaining);
      if (me.authenticated) {
        const c = await fetchConversations();
        setConversations(c.conversations ?? []);
      }
    })();
  }, []);

  const startNew = () => {
    const tempId = `${TEMP_PREFIX}${Date.now()}`;
    const tempName = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    setConversations((c) => [
      { conversation_id: tempId, displayName: tempName, messages: [] },
      ...c.filter((x) => !x.conversation_id.startsWith(TEMP_PREFIX)),
    ]);
    setActiveId(tempId);
    setMessages([]);
  };

  const selectConvo = (id: string) => {
    if (id.startsWith(TEMP_PREFIX)) return;
    const c = conversations.find((x) => x.conversation_id === id);
    setActiveId(id);
    setMessages(c?.messages ?? []);
  };

  const onSend = async (text: string) => {
    const userMsg: Msg = { role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, userMsg]);
    setTyping(true);
    const realConvoId = activeId?.startsWith(TEMP_PREFIX) ? null : activeId;
    const { status, body } = await sendCompletion({ message: text, provider, model, conversationId: realConvoId });
    setTyping(false);
    if (status === 402 && body.error === 'provider_tokens_exhausted') {
      const providerName = body.provider ?? provider;
      const errMsg: Msg = { role: 'assistant', content: t('providerExhausted', { provider: providerName }), createdAt: new Date().toISOString() };
      setMessages((m) => [...m, errMsg]);
    } else if (status === 200 && body.valid) {
      setMessages((m) => [...m, body.message]);
      setLastAutoModel(body.modelUsed ?? null);
      if (body.conversationId) {
        setActiveId(body.conversationId);
        setConversations((c) => c.filter((x) => !x.conversation_id.startsWith(TEMP_PREFIX)));
      }
      // Update quota immediately from response
      if (typeof body.remaining === 'number') {
        setQuota((q) => ({ ...q, remainingTokens: body.remaining, blocked: !!body.blocked }));
      }
      if (authenticated) {
        const c = await fetchConversations();
        setConversations(c.conversations ?? []);
      }
    }
    const me = await fetchMe();
    setQuota(me.quota ?? EMPTY_QUOTA);
    if (me.providerRemaining) setProviderRemaining(me.providerRemaining);
  };

  const removeConvo = async (id: string) => {
    await deleteConversation(id);
    setConversations((c) => c.filter((x) => x.conversation_id !== id));
    if (activeId === id) startNew();
  };

  const handleModelChange = (newProvider: string, newModel: string) => {
    setProvider(newProvider);
    setModel(newModel);
  };

  const exportActive = (format: string) => {
    const name = conversations.find((c) => c.conversation_id === activeId)?.displayName ?? 'conversation';
    const convo = { displayName: name, messages };
    if (format === 'md') downloadFile(`${safeFilename(name)}.md`, conversationToMarkdown(convo), 'text/markdown');
    else downloadFile(`${safeFilename(name)}.json`, conversationToJson(convo), 'application/json');
  };

  const headerActions = (
    <SpaceBetween direction="horizontal" size="xs">
      <ButtonDropdown
        items={[{ id: 'md', text: t('exportMarkdown') }, { id: 'json', text: t('exportJson') }]}
        disabled={messages.length === 0}
        onItemClick={({ detail }) => exportActive(detail.id)}
      >
        {t('export')}
      </ButtonDropdown>
      <Button onClick={() => setToolsOpen((o) => !o)} iconName="settings">{t('settings')}</Button>
      {authenticated
        ? <Button onClick={() => setRequestOpen(true)}>{t('requestTokens')}</Button>
        : <Button onClick={() => { window.location.href = '/auth/login?returnTo=/'; }}>{t('logIn')}</Button>
      }
    </SpaceBetween>
  );

  return (
    <>
      <Modal visible={requestOpen} onDismiss={() => setRequestOpen(false)} header={t('requestTokens')}>
        <SignupRequestForm key={String(requestOpen)} onDone={() => setRequestOpen(false)} />
      </Modal>
      <AppLayout
        navigationHide={!authenticated}
        navigation={
          <ConversationList
            conversations={conversations}
            activeId={activeId}
            onSelect={selectConvo}
            onNew={startNew}
            onDelete={removeConvo}
          />
        }
        toolsOpen={toolsOpen}
        onToolsChange={({ detail }) => setToolsOpen(detail.open)}
        tools={<SettingsPanel authenticated={authenticated} />}
        content={
          <ContentLayout header={<Header variant="h1" actions={headerActions}>{t('chat')}</Header>}>
            <Container footer={
              <ChatInput
                provider={provider}
                model={model}
                onModelChange={handleModelChange}
                onSend={onSend}
                quota={quota}
                pendingApproval={pendingApproval}
                providerRemaining={providerRemaining}
                lastAutoModel={lastAutoModel}
              />
            }>
              <MessageList messages={messages} typing={typing} />
            </Container>
          </ContentLayout>
        }
      />
    </>
  );
}
