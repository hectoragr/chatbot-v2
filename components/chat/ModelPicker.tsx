'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Select from '@cloudscape-design/components/select';
import type { UnifiedModel } from '@/lib/models';

interface Props {
  modelId: string;
  onChange: (provider: string, modelId: string) => void;
  providerRemaining?: Record<string, number>;
}

export function ModelPicker({ modelId, onChange, providerRemaining }: Props) {
  const { t } = useTranslation();
  const [models, setModels] = useState<UnifiedModel[]>([]);

  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.allModels)) setModels(d.allModels);
      });
  }, []);

  const hasProviderData = providerRemaining && Object.keys(providerRemaining).length > 0;

  const autoOption = {
    label: t('autoModelLabel'),
    value: 'AUTO:auto',
    description: t('autoModelDescription'),
    disabled: false,
  };

  const options = [
    autoOption,
    ...models.map((m) => {
      const isDisabled = hasProviderData
        && !providerRemaining['ANY']
        && (providerRemaining[m.provider] === undefined || providerRemaining[m.provider] === 0);

      return {
        label: m.label,
        value: `${m.provider}:${m.id}`,
        description: isDisabled ? `${m.description} (${t('noTokensForProvider', { provider: m.provider })})` : m.description,
        disabled: isDisabled,
      };
    }),
  ];

  const selected = modelId === 'auto'
    ? autoOption
    : options.find((o) => o.value === `${models.find((m) => m.id === modelId)?.provider}:${modelId}`) ?? null;

  return (
    <Select
      selectedOption={selected}
      onChange={({ detail }) => {
        const [provider, id] = detail.selectedOption.value!.split(':');
        onChange(provider, id);
      }}
      options={options}
      placeholder="Select model"
      ariaLabel="Select model"
    />
  );
}
