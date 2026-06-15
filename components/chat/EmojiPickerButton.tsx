'use client';
import { useState } from 'react';
import Button from '@cloudscape-design/components/button';
import EmojiPicker from './EmojiPicker';

export function EmojiPickerButton({ disabled, onSelect }: { disabled?: boolean; onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button iconName="face-happy" ariaLabel="Insert emoji" disabled={disabled} onClick={() => setOpen(true)} />
      <EmojiPicker isOpen={open} onClose={() => setOpen(false)} onEmojiSelect={(e) => { onSelect(e); setOpen(false); }} />
    </>
  );
}
