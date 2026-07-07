import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'lib/**/*.test.ts'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: [
        'lib/**/*.ts',
        'admin-fn/**/*.ts',
        'app/api/**/*.ts',
        'components/**/*.tsx',
      ],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/*.d.ts'],
      reporter: ['text-summary', 'text'],
      // Ratchet floors: set just under measured coverage (2026-07). Target is
      // ≥85% lines — when a PR raises coverage, raise these to match. Floors
      // only go up. See AGENTS.md "Testing".
      thresholds: {
        lines: 55,
        statements: 55,
        functions: 52,
        branches: 75,
      },
    },
  },
  resolve: { alias: { '@': new URL('.', import.meta.url).pathname } },
});
