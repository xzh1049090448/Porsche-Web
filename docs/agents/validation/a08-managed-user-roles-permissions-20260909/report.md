# A08 managed-user roles and permissions frontend evidence

Status: `BLOCKED_FIXTURE`

Frontend code under test is `3fec2779381369907dba0e19c44580d23f614496`. The paired backend evidence commit `0d685a97f22e663e6cda01f7a7c0161c9febc798` identifies backend production code `9fdc07b3bcf4cb06049e4af0f5adde28e36facab`. The frontend and authoritative backend A08 contracts are byte-identical with SHA-256 `dd202cb5019b10a891e10f03f77629b5f54e993110f148f417e05d089df35698`.

## Automated frontend gates

All contract tests ran with absolute paths to the authoritative backend A03, A05, A06, A14 and A08 contract files. The A08 focused command passed 50/50 tests with zero failures and zero skips. The full `npm test` command passed 445/445 tests with zero failures and zero skips.

The production build passed with `VITE_USE_MOCK=false`. It retained the existing warnings for two misplaced `@vueuse/core` PURE annotations, mixed dynamic/static imports of `src/utils/export.js` and `src/api/request.js`, and chunks larger than 500 kB. `git diff --check` passed before this evidence archive was written.

The automated coverage includes exact A08 contract parity, API request and response validation, memory-only attempt coordination, permission editor behavior, mounted Element Plus dialog behavior, UserDetail eligibility, singleflight conflict refresh, stable-result reconciliation, and stale route/identity/capability/version/catalog/owner rejection. These Node and JSDOM results are not visible-browser acceptance.

## Missing acceptance evidence

Task7 visible-browser acceptance has not run. A visible-Chromium diagnostic reached the real-mode candidate login page on port 4174, where refresh returned 500 because the backend was unavailable. A mock-mode diagnostic on port 4175 visibly loaded the login page with zero console errors, but the fixed mock identity was an ordinary User and there were no A08 admin fixtures. These diagnostics are not acceptance passes. Baseline and override promotion, permission save, demotion, 409 refresh, commit-unknown Query, disabled targets, keyboard and focus behavior, and 375 px/390 px layouts remain `NOT_RUN / BLOCKED_FIXTURE` in a visible browser.

Real cross-stack acceptance is `BLOCKED_FIXTURE`. The paired backend canonical report records the required isolated MySQL 8, Redis 7 and `ACTION_SECURITY_HMAC_KEY` fixture as unavailable. Migration ledger `0001` through `0012`, old Access/Refresh rejection, current Gateway Key authorization, demoted-policy cleanup, safe later promotion, database and audit terminal facts, rollback, concurrency, and fixture cleanup remain `NOT_RUN`.

Independent final frontend review, independent security review, visible-UX review and external backend project-manager confirmation remain `PENDING_NOT_RUN`. Production migration, deployment and acceptance were not run, and no real business account was used.

## Tracker boundary

A08 moves from `BLOCKED_NOT_IMPLEMENTED` to `BLOCKED_FIXTURE`; it does not become `PASS_LIMITED_SCOPE`. The 26-item matrix remains 14 `PASS_LIMITED_SCOPE` and 12 blocked: 9 `BLOCKED_NOT_IMPLEMENTED`, 1 `BLOCKED_FIXTURE`, 1 `BLOCKED_PRODUCT` and 1 `BLOCKED_ENV`. `web-012` remains `in_progress` with phase `joint_acceptance_partial_14_limited_12_blocked`.

The canonical backend evidence is `/Users/xuzhihao/code/Porsche/.worktrees/a07-managed-user-entitlements/docs/superpowers/reports/validation/2026-09-09-a08-managed-user-roles-permissions/backend/manifest.json`.
