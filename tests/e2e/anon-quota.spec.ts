import { test, expect } from '@playwright/test';

test('anon lands in a new conversation and is blocked after 3 questions', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder('Type your message here...');
  await expect(input).toBeVisible();

  for (let i = 0; i < 3; i++) {
    await input.fill(`hello ${i}`);
    await page.getByRole('button', { name: /send/i }).click();
    // wait for the assistant reply to render (the mocked completion)
    await expect(page.getByText(/mocked completion/i)).toHaveCount(i + 1, { timeout: 20_000 });
  }

  // 4th attempt is blocked: banner shows the limit message and input is disabled.
  await expect(page.getByText(/reached your limit/i)).toBeVisible();
  await expect(input).toBeDisabled();
});
