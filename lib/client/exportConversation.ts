export interface ExportMsg { role: string; content: string; createdAt: string; }
export interface ExportConvo { displayName: string; messages: ExportMsg[]; }

export function conversationToMarkdown(c: ExportConvo): string {
  const lines = [`# ${c.displayName}`, ''];
  for (const m of c.messages) {
    const who = m.role === 'user' ? '👤 User' : '🤖 Assistant';
    lines.push(`## ${who} — ${new Date(m.createdAt).toLocaleString()}`, '', m.content, '');
  }
  return lines.join('\n');
}

export function conversationToJson(c: ExportConvo): string {
  return JSON.stringify({ displayName: c.displayName, messages: c.messages }, null, 2);
}

export function safeFilename(name: string): string {
  return (name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'conversation').slice(0, 60);
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
