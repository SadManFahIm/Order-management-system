# Contributing to Orderly OMS

Thanks for taking the time to contribute! Orderly OMS is a multi-tenant
restaurant ordering SaaS. Please read the [README](README.md) first, then
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening anything.

## How to contribute

1. **Open an issue first** for bugs or feature ideas (use the issue templates).
   Small, clearly-scoped fixes may skip straight to a pull request.
2. **Fork** the repository and create a branch off `master` — never commit to
   `master` directly (it is branch-protected).
3. Follow the repository conventions:
   - Backend: Express modular monolith — routes → services; zod validation.
   - Frontend: React SPA, route-level code splitting; user-facing text is
     i18n'd (en/bn).
   - Schema changes ship as versioned migrations, and tests run on **both**
     SQLite and PostgreSQL.
   - Sensitive mutations write audit-log entries.
   - Docs update in the same PR (`docs/` + README when behavior is
     user-visible).
4. Run the quality gates locally before opening the PR:
   - `cd backend && npm run lint && npm test`
   - `cd frontend && npm run lint && npm run build`
5. Open a pull request against `master` using the PR template. CI runs the
   full required check set on every PR — backend lint/test/audit, the
   PostgreSQL 16 tier, Playwright E2E, the gateway sandbox, the S3/MinIO
   driver, frontend lint/build/audit, CodeQL, gitleaks, and dependency
   review. All must pass.
6. Maintainers review and merge. Expect feedback — treat review comments as
   part of the work.

## Development setup

See **Local Development** in the [README](README.md): Node, Docker Compose for
PostgreSQL, `.env` files from the documented environment variables
(README → Environment Variables), and the seed commands. Never commit `.env` files, databases, or real credentials.

## Branching & release notes

`master` is protected: PR + required checks, strict up-to-date, linear
history, no force pushes. Merges are squash merges, so write a clear,
conventional commit message (`feat:`, `fix:`, `docs:`, `chore:`, `security:`)
describing the *why*, not just the *what*.

## Reporting security issues

Do **not** open a public issue for a vulnerability — follow the disclosure
process in [SECURITY.md](SECURITY.md).
