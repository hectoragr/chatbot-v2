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
  onClose?: () => void;
}

export function ConversationList({ conversations, activeId, onSelect, onNew, onDelete, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <SpaceBetween size="xs" direction="vertical">
      {onClose && (
        <Box padding={{ horizontal: 'm', vertical: 'xs' }} float="right">
          <Button variant="icon" iconName="close" ariaLabel="Close panel" onClick={onClose} />
        </Box>
      )}
      <Box padding={{ horizontal: 'm', vertical: 's' }}>
        <Button variant="primary" fullWidth onClick={onNew} iconName="add-plus">
          {t('newConversation')}
        </Button>
      </Box>
      {conversations.map((c) => (
        <Box key={c.conversation_id} padding={{ horizontal: 'm', vertical: 'xxs' }}>
          <div data-testid={`convo-row-${c.conversation_id}`} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
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
              <div style={{ flexShrink: 0 }}>
                <Button
                  variant="inline-icon"
                  iconName="close"
                  ariaLabel={t('deleteConversation')}
                  onClick={(e) => { e.stopPropagation(); onDelete(c.conversation_id); }}
                />
              </div>
            )}
          </div>
        </Box>
      ))}
    </SpaceBetween>
  );
}
