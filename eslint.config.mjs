import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// core-web-vitals already includes the base next config; adding
// eslint-config-next's root export alongside it redefines the @next/next
// plugin and crashes flat-config resolution.
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.open-next/**',
      '.claude/**',
      'out/**',
      'build/**',
      'coverage/**',
      'next-env.d.ts',
      'infra/cdk.out/**',
      'infra/node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // ponytail: new react-hooks v6 rule; three pre-existing mount-sync
      // effects (admin/page, ChatInput contact mode, SettingsPanel theme)
      // trip it. Downgraded to warn — refactor to render-time derivation
      // or useSyncExternalStore in a dedicated PR, not a CI-noise one.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];

export default eslintConfig;
