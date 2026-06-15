'use client';
import { useTranslation } from 'react-i18next';
import './EmojiPicker.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onEmojiSelect: (emoji: string) => void;
}

const EMOJIS: string[] = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
  '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
  '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩',
  '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣',
  '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬',
  '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗',
  '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯',
  '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐',
  '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙',
  '👈', '👉', '👆', '🖕', '👇', '☝️', '👋', '🤚', '🖐️', '✋',
  '🖖', '👏', '🙌', '🤝', '🙏', '✊', '👊', '🤛', '🤜', '💪',
];

export default function EmojiPicker({ isOpen, onClose, onEmojiSelect }: Props) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="emoji-picker-overlay" onClick={onClose}>
      <div className="emoji-picker" onClick={(e) => e.stopPropagation()}>
        <div className="emoji-picker-header">
          <span>{t('pickAnEmoji', 'Pick an emoji')}</span>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="emoji-grid">
          {EMOJIS.map((emoji, index) => (
            <button
              key={index}
              className="emoji-btn"
              onClick={() => {
                onEmojiSelect(emoji);
                onClose();
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
