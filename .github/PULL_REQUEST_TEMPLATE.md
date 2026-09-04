## What & why
Describe the change and the problem it solves. Reference the issue if one
exists (e.g. `Closes #12`).

## How it was verified
- [ ] Local quality gates pass: `cd backend && npm run lint && npm test`
- [ ] `cd frontend && npm run lint && npm run build`
- [ ] All required CI checks are green on this PR (PostgreSQL tier, Playwright
      E2E, CodeQL, gitleaks, dependency review included)

## Conventions honored
- [ ] Migrations for any schema change; tests run on SQLite **and** PostgreSQL
- [ ] User-facing text is i18n'd (en/bn) where applicable
- [ ] Sensitive mutations write audit-log entries
- [ ] Docs updated in this PR (`docs/` and/or README) where behavior is
      user-visible
- [ ] No `.env` files, databases, credentials, or secrets are included

## Notes for reviewers
Anything unusual, risky, or worth extra scrutiny.
