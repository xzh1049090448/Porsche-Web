# Open Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Resolve the two confirmed frontend defects and verify the already-implemented backend model catalog fix without touching production.

**Architecture:** Reuse the Pinia chat store and conversation DTO/API mapping; coordinate initialization and capture request GUIDs across asynchronous detail loading. Keep the API-key dialog as the owner of transient secret state, delegating clipboard operations to a small tested utility. Backend changes are limited to acceptance evidence unless a regression demonstrates a missing behavior.

**Tech Stack:** Vue 3, Pinia, Vite, Node test runner, Playwright, Go testing, disposable local MySQL 8/Redis.

---

### Task 1: Existing backend fix acceptance

- [x] Create separate local Docker fixtures with unique names, loopback-only ephemeral ports and disposable storage. Never use the existing user containers or production `.env`.
- [x] Apply existing migrations to `porsche_issue2_test` with `go run ./cmd/migrate up` using only the fixture URL. The first configuration attempt lacked `SNOWFLAKE_NODE_ID`; retry with `APP_ENV=test SNOWFLAKE_NODE_ID=101` applied migrations 0001 and 0002 successfully.
- [x] Run `go test ./internal/whitelabel ./internal/handler -run 'Slash|CatalogWithEmpty|PatternAllowlist|ModelACL' -count=1 -v` with `TEST_DATABASE_URL` and `TEST_REDIS_URL` set to the fixtures. Require the four previously skipped ACL route tests to execute. Executed serially with `-p 1`: 13 top-level tests passed without skips.
- [x] Run the full Go suite serially by package (`go test -p 1 ./... -count=1`) when sharing one disposable database; record any unrelated baseline failures accurately. Executed and FAILED; this check means the run and disclosure are complete, not that all backend tests pass.
- [x] Update backend `feature_list.json`, `progress.md` and a scoped acceptance report. Keep real-upstream acceptance blocked; do not close #2 or mark go-004 fully passing. Backend evidence commit: `a4202de`; cross-repository report: `../reports/2026-09-02-open-issues-verification.md`.

### Task 2: Frontend #3 initial history

**Files:** `src/stores/chat.js`; `src/views/Chat.vue` only if necessary for load failure/retry UX; focused `src/stores/chat.test.js` or a narrowly extracted async helper and its Node tests; issue-specific entries in `feature_list.json` and `progress.md`.

- [x] Add executable regression tests exercising the real loading path: initial active selection waits for historical details; reload; empty list; concurrent initialization; slow selection changes; stale 404; failure and retry. Do not rely exclusively on source-text assertions.
- [x] Run targeted tests before changes and preserve the expected failing assertion.
- [x] After selecting an initial valid GUID, await the existing detail path before initialization resolves. Capture the requested GUID before each asynchronous fetch. Merge only into that requested conversation; stale errors cannot remove the new active conversation. Deduplicate in-flight detail loading when initialization paths overlap, without changing the API contract or storing real history in localStorage.
- [x] Verify targeted tests, `npm test`, `npm run build`, `git diff --check` and local real-browser UI history probes with intercepted dummy APIs.
- [x] Product/spec review followed by independent final-diff security/quality review; fix any findings, then commit only #3 implementation/tracking files with `fix: load initial conversation history`. Commits `7471a38` and `fbfd2dd`; the latter resolves the review finding that sending must wait for pending history.

### Task 3: Frontend #4 transient key copying

**Files:** `src/utils/clipboard.js`, `src/utils/clipboard.test.js`, `src/views/ApiKeys.vue`; tracking files and necessary copy-specific localized messages only.

- [x] Add Node behavioral tests for native success, missing API, native rejection, fallback true/false/throw, empty text, selection/focus restoration and temporary-node cleanup. Observe failures before implementation.
- [x] Implement `copyText(text, environment)` with a boolean success result: reject empty input, try native `writeText`, fall back to a temporary selectable textarea and synchronous copy in the active document, remove that node in `finally`. Do not retain credentials in module state, Storage or logs.
- [x] Update `copySecret()` to show existing success only for true and existing manual-copy warning otherwise. Preserve the read-only source input and existing `clearSecret()` hooks.
- [x] Run `node --test src/utils/clipboard.test.js`, `npm test`, `npm run build`, `git diff --check`, and browser probes inside the actual Element Plus dialog (including focus-trap behavior and clipboard-denied/missing paths).
- [x] Product/spec review followed by final-diff security/quality review; commit only #4 and its evidence with `fix: add safe API key copy fallback`. Commit `969bdc5`.

### Task 4: Final handoff

- [x] Independently rerun the final frontend suite/build and adversarial browser probes. Local mock API browser tests do not prove live HTTPS production acceptance.
- [x] Confirm clean isolated branches, preserve root worktrees, report local SHAs and pending external checks. Stop/remove only newly created disposable fixture containers after tests; never delete user volumes. Both issue-resolution worktrees are retained; the two new `--rm`/tmpfs fixtures were stopped and destroyed.
- [x] Keep GitHub Issues open until changes reach the agreed deployment and acceptance gate. No push/merge/deploy commands.
