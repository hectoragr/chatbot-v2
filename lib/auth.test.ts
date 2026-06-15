import { describe, it, expect } from 'vitest';
import { isAdminEmail } from './auth.js';

describe('isAdminEmail', () => {
  it('matches the configured admin', () => {
    process.env.ADMIN_EMAIL = 'boss@x.com';
    expect(isAdminEmail('boss@x.com')).toBe(true);
    expect(isAdminEmail('other@x.com')).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});
