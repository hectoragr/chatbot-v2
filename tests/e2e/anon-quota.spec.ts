import { test, expect } from '@playwright/test';

// The anon completion path is captcha-gated (see the anon captcha gate in
// app/api/completions/route.ts). Each anon send must answer the stateless
// arithmetic captcha the UI shows ("A + B"), so this test reads the question
// from the FormField label, computes the sum, fills the answer, then sends.
async function solveCaptcha(page: import('@playwright/test').Page) {
  // The captcha label reads "Anti-spam check: what is A + B?" (en). Parse the
  // two operands from whatever number pair the label currently shows.
  const label = page.getByText(/anti-spam check/i).first();
  await expect(label).toBeVisible({ timeout: 20_000 });
  const text = (await label.textContent()) ?? '';
  const m = text.match(/(\d+)\s*\+\s*(\d+)/);
  expect(m, `could not parse captcha operands from "${text}"`).not.toBeNull();
  const answer = String(Number(m![1]) + Number(m![2]));
  // The captcha answer field is the Cloudscape Input with placeholder "?".
  await page.getByPlaceholder('?').fill(answer);
}

test('anon lands in a new conversation and is blocked after 3 questions', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder('Type your message here...');
  await expect(input).toBeVisible();

  for (let i = 0; i < 3; i++) {
    await solveCaptcha(page);
    await input.fill(`hello ${i}`);
    await page.getByRole('button', { name: /send/i }).click();
    // wait for the assistant reply to render (the mocked completion)
    await expect(page.getByText(/mocked completion/i)).toHaveCount(i + 1, { timeout: 20_000 });
  }

  // 4th attempt is blocked: banner shows the limit message and input is disabled.
  await expect(page.getByText(/reached your limit/i)).toBeVisible();
  await expect(input).toBeDisabled();
});
