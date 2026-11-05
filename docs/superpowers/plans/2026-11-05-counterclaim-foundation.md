# Counterclaim Foundation Implementation Plan

> Execute inline using superpowers:executing-plans, with test-first implementation and final verification. The user's build request authorizes execution in the current directory; no commits, API calls or deployment.

**Goal:** Offline-tested sandbox PayPal adapter, persistent case snapshots and history, verified webhooks and polling routes.
**Architecture:** Injectable PayPal client validates responses; SQLite repository atomically compares/stores snapshots and appends events; sync and route factories inject dependencies. Next.js runtime wiring is lazy, so builds need no credentials or database.
**Tech Stack:** Latest stable Next.js App Router, strict TypeScript, Zod, node:sqlite, ESLint, Vitest; installed Node major 26.
**Spec:** docs/superpowers/specs/2026-11-05-counterclaim-design.md, restricted to the user's stage 1 scope.

## Global Constraints
Never access secret files, invoke PayPal/AI, edit spike or the design, commit, push or deploy. Fixed sandbox origin. No logging response bodies or credentials. All tests offline. Six names only in .env.example; document CRON_SECRET separately.

## Review Focus
- Pagination must stay on the fixed sandbox origin and not silently omit later pages.
- Concurrent syncs must not race snapshot/history writes or regress a case within one service.
- Property/link ordering alone must not create history noise; unknown fields must survive storage.
- Missing webhook headers, invalid payloads and absent cron configuration must fail closed.
- Untrusted fetch failures and error bodies must never become logged error messages.

### Task 1: Scaffold and recorded contracts
- [x] Add package/configuration files and sanitized fixtures built from poll summaries; explicitly record inferred terminal/requested states.
- [x] Write failing schema/action/view tests for all fixtures and unknown fields.
- [x] Implement src/paypal/schemas.ts and src/cases/derive.ts; verify tests.

### Task 2: PayPal transport
- [x] Write failing src/paypal/client.test.ts for OAuth caching/expiry, JSON/multipart writes, refusal, retries, safe errors, pagination and webhook verification.
- [x] Implement src/paypal/client.ts and index.ts with injected fetch/clock, fixed paths and redirect rejection.
- [x] Run adapter tests.

### Task 3: Storage and sync
- [x] Write failing src/cases/sync.test.ts for full replay, unchanged states, canonical comparison, persisted reopen, transactions and syncAll pagination/local cases.
- [x] Implement src/cases/storage.ts and sync.ts; use SQLite migrations and append-only triggers.
- [x] Run storage/sync tests.

### Task 4: Routes and final checks
- [x] Write failing route tests for verified webhook sync, bad signature, unknown event, malformed payload, cron auth and health.
- [x] Implement route factories and lazy runtime wiring with safe generic error responses.
- [x] Add minimal page/layout and README covering setup, fixture provenance, assumptions and limitations.
- [x] Run npm run lint, npm run typecheck, npm test, npm run build; review scope and report actual results.

## Execution record

Completed in the requested current directory, without commits or secret-file/API access. No worktree was created because the user explicitly requested this directory. All scaffolding and implementation stayed outside spike and the supplied design.

Ruling: Keep exactly six names in .env.example and document CRON_SECRET in README — reconciles the explicit example-file list with cron authentication.
Ruling: Use TypeScript 6 and ESLint 9 with Next 16.4.5 — Next's current ESLint dependencies do not support TypeScript 7 / all ESLint 10 peers.
Ruling: Disable dotenv loading during builds through a CommonJS preload — Next would otherwise read the existing root secret file. Runtime dev environment loading stays standard.
Ruling: Preserve additional observed transient states and document reconstructed link/document objects and terminal fields — poll.log contains summaries and truncated records rather than complete responses.

Fresh-context implementation review found two reliability gaps. Added failing regression tests, then fixed body-download GET retry and per-case polling failure isolation. Follow-up review found both resolved. This is additional implementation review, not the separate later Codex review requested in the design.

Final verification: npm run lint exit 0; npm run typecheck exit 0; npm test exit 0 (44 passed across 4 files, no skipped tests); npm run build exit 0 (Next 16.4.5, all requested routes compiled). Production dependency audit has zero advisories; eight moderate development-tool advisories remain in the ESLint dependency tree.
