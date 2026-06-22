'use client';
import Select from '@cloudscape-design/components/select';
import { useEffect, useState } from 'react';
import { fetchModels } from '@/lib/client/api';

interface Props { provider: string; value: string; onChange: (id: string) => void; }

export function ModelSelector({ provider, value, onChange }: Props) {
  const [options, setOptions] = useState<{ label: string; value: string }[]>([]);
  useEffect(() => {
    fetchModels().then((resp) => {
      const catalog = resp.models as Record<string, { id: string; label: string }[]>;
      const list = (catalog[provider] ?? []).map((x: { id: string; label: string }) => ({ label: x.label, value: x.id }));
      setOptions(list);
      if (list.length && !list.some((o: { value: string }) => o.value === value)) onChange(list[0].value);
    });
  }, [provider]);
  const selected = options.find((o) => o.value === value) ?? null;
  return (
    <Select
      selectedOption={selected}
      onChange={({ detail }) => onChange(detail.selectedOption.value!)}
      options={options}
      placeholder="Model"
      ariaLabel="Select model"
    />
  );
}
