'use client';
import SideNavigation from '@cloudscape-design/components/side-navigation';

interface Convo { conversation_id: string; displayName: string; }
interface Props { conversations: Convo[]; activeId: string | null; onSelect: (id: string) => void; onNew: () => void; }

export function ConversationList({ conversations, activeId, onSelect, onNew }: Props) {
  return (
    <SideNavigation
      activeHref={activeId ? `#${activeId}` : '#new'}
      header={{ href: '#new', text: 'New conversation' }}
      onFollow={(e) => {
        e.preventDefault();
        if (e.detail.href === '#new') onNew();
        else onSelect(e.detail.href.slice(1));
      }}
      items={conversations.map((c) => ({ type: 'link', text: c.displayName, href: `#${c.conversation_id}` }))}
    />
  );
}
