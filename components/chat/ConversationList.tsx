'use client';
import { useTranslation } from 'react-i18next';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';

interface Convo { conversation_id: string; displayName: string; }
interface Props {
  conversations: Convo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
}

export function ConversationList({ conversations, activeId, onSelect, onNew, onDelete }: Props) {
  const { t } = useTranslation();
  return (
    <SpaceBetween size="xs" direction="vertical">
      <Box padding={{ horizontal: 'm', vertical: 's' }}>
        <Button variant="primary" fullWidth onClick={onNew} iconName="add-plus">
          {t('newConversation')}
        </Button>
      </Box>
      {conversations.map((c) => (
        <Box
          key={c.conversation_id}
          padding={{ horizontal: 'm', vertical: 'xxs' }}
        >
          <SpaceBetween size="xs" direction="horizontal" alignItems="center">
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <Button
                variant={c.conversation_id === activeId ? 'primary' : 'inline-link'}
                onClick={() => onSelect(c.conversation_id)}
                fullWidth
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', textAlign: 'left' }}>
                  {c.displayName}
                </span>
              </Button>
            </div>
            {onDelete && (
              <Button
                variant="inline-icon"
                iconName="close"
                ariaLabel={t('deleteConversation')}
                onClick={(e) => { e.stopPropagation(); onDelete(c.conversation_id); }}
              />
            )}
          </SpaceBetween>
        </Box>
      ))}
    </SpaceBetween>
  );
}
