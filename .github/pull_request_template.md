## What & why

<!-- One paragraph: the change and the reason. Link the spec/plan if full ceremony. -->

## Test evidence

<!-- Paste the tail of typecheck + test + coverage output. Screenshots or HTML mock for UI changes. -->

## Assumptions made

<!-- Guessed conventions, unclear requirements, discovered gotchas — or "none". -->

## Checklist (mirrors AGENTS.md Definition of done)

- [ ] `npm run typecheck && npm test && npm run lint` clean (full suite)
- [ ] Coverage floors pass (`npm run test:coverage`); floors raised if coverage rose
- [ ] New/changed non-trivial logic has a colocated test that fails if the logic breaks
- [ ] User-facing strings i18n'd in en/es/fr/de (admin tables exempt)
- [ ] UI change → screenshot or HTML mock attached
- [ ] Rebased on latest `main` before push (`git pull --rebase origin main`)
- [ ] Improvement pass: session assumptions/gotchas written back into AGENTS.md (or none found)
