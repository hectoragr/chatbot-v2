import { defineConfig, devices } from '@playwright/test';

const RUN_IP = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // Fresh per-run ip subject so the anon quota isn't polluted by prior runs
    // (localhost requests otherwise resolve to clientIp 'unknown', a shared key).
    extraHTTPHeaders: { 'x-forwarded-for': RUN_IP },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
