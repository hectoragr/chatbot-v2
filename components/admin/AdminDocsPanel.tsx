'use client';
import { useState } from 'react';
import Table from '@cloudscape-design/components/table';
import Header from '@cloudscape-design/components/header';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Input from '@cloudscape-design/components/input';
import FormField from '@cloudscape-design/components/form-field';
import FileUpload from '@cloudscape-design/components/file-upload';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { getCsrf } from '@/lib/client/csrfClient';
import type { AdminDocDoc } from '@/lib/ddb';

export function AdminDocsPanel({ docs, onRefresh }: { docs: AdminDocDoc[]; onRefresh: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [topics, setTopics] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!files[0] || !title.trim() || !topics.trim()) { setError('File, title, and topics are required'); return; }
    setBusy(true); setError(null);
    try {
      const content = await files[0].text();
      const csrf = await getCsrf();
      const r = await fetch('/api/admin/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ title, topics, content }),
      });
      if (!r.ok) throw new Error(`upload failed (${r.status})`);
      setFiles([]); setTitle(''); setTopics('');
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const remove = async (doc_id: string) => {
    const csrf = await getCsrf();
    await fetch('/api/admin/docs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ doc_id }),
    });
    onRefresh();
  };

  return (
    <Table
      header={<Header counter={`(${docs.length})`} description="Markdown docs describing the site owner; injected as context when a question matches their topics.">About-me docs</Header>}
      items={docs}
      columnDefinitions={[
        { id: 'title', header: 'Title', cell: (d) => d.title },
        { id: 'topics', header: 'Topics', cell: (d) => d.topics },
        { id: 'size', header: 'Size', cell: (d) => `${(d.content.length / 1024).toFixed(1)} KB` },
        { id: 'updated', header: 'Updated', cell: (d) => new Date(d.updatedAt).toLocaleString() },
        { id: 'actions', header: 'Actions', cell: (d) => <Button variant="inline-link" onClick={() => remove(d.doc_id)}>Delete</Button> },
      ]}
      empty={<Box textAlign="center">No docs</Box>}
      variant="container"
      footer={
        <SpaceBetween size="s">
          <FormField label="Markdown file" errorText={error ?? undefined}>
            <FileUpload
              value={files}
              onChange={({ detail }) => setFiles(detail.value)}
              accept=".md,text/markdown"
              i18nStrings={{ uploadButtonText: () => 'Choose .md file', dropzoneText: () => 'Drop .md file', removeFileAriaLabel: (i) => `Remove file ${i + 1}` }}
              showFileSize
            />
          </FormField>
          <SpaceBetween size="xs" direction="horizontal">
            <FormField label="Title"><Input value={title} onChange={({ detail }) => setTitle(detail.value)} /></FormField>
            <FormField label="Topics (comma-separated)"><Input value={topics} onChange={({ detail }) => setTopics(detail.value)} /></FormField>
          </SpaceBetween>
          <Button variant="primary" loading={busy} onClick={submit}>Add / replace doc</Button>
        </SpaceBetween>
      }
    />
  );
}
