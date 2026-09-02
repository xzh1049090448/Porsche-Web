# Open issues verification — 2026-09-02

## Result and boundaries

Frontend Issues #3 and #4 are locally implemented, tested and independently reviewed. Backend Issue #2's existing implementation passes its isolated targeted integration tests, but the full backend suite with real disposable MySQL/Redis **fails**. This is not an overall backend PASS, nor production acceptance.

All browser API traffic was intercepted locally at `http://127.0.0.1:5178`; only dummy messages and keys were used. No production account, key creation, paid upstream, deployment, push, merge or GitHub issue closure occurred. Genuine HTTPS/session and real upstream catalog/detail/Chat/SSE acceptance remain pending. Do not treat `web-010`/`web-011` as completion of broader `web-004`/`web-009`; backend `go-004` remains blocked.

## Commits and review

- Frontend branch/worktree: `fix/open-issue-resolution`, `/Users/xuzhihao/code/Porsche-Web/.worktrees/issue-resolution`.
- `7471a38`: initial selected history loading; `fbfd2dd`: wait for pending history before sending, following quality review.
- `969bdc5`: safe transient API-key copy fallback, cancellation and evidence.
- Backend branch/worktree: `fix/open-issue-resolution`, `/Users/xuzhihao/code/Porsche/.worktrees/issue-resolution`; `a4202de` is an evidence-only commit on `4da0dba` with no backend business-code or production-config change.
- Independent PM/spec review: PASS for #3 and #4. Independent quality/security review: APPROVE, including the final frontend range from `6f8fbca`; no remaining actionable finding. Reviews supplement rather than replace the commands below.

## Check: frontend suite and build

**Command run:**

```sh
# Frontend issue-resolution worktree
npm test
npm run build
git diff --check
```

**Output observed:**

```text
ℹ tests 81
ℹ pass 81
ℹ fail 0
ℹ skipped 0
✓ built in 17.02s
```

The implementation run above exited 0. The coordinator independently repeated 81/81, a successful 7.87s build and diff-check exit 0. Build retains existing dynamic-import and large-chunk warnings. No lint/type-check command is configured in `package.json`.

**Result: PASS** for local frontend tests/build. Coverage includes 13 real-store history tests and 14 clipboard utility tests; the initial tests and later selection/container fixes were observed RED before implementation.

## Check: actual Vue/Element Plus browser behavior

**Command run:**

```sh
NODE_PATH=/Users/xuzhihao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node /Users/xuzhihao/.codex/skills/playwright-skill/run.js /private/tmp/playwright-test-issue3-independent.js
NODE_PATH=/Users/xuzhihao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node /Users/xuzhihao/.codex/skills/playwright-skill/run.js /private/tmp/playwright-test-issue3-races.js
NODE_PATH=/Users/xuzhihao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node /Users/xuzhihao/.codex/skills/playwright-skill/run.js /private/tmp/playwright-test-issue4-independent.js
NODE_PATH=/Users/xuzhihao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node /Users/xuzhihao/.codex/skills/playwright-skill/run.js /private/tmp/playwright-test-issue4-lifecycle.js
```

**Output observed:**

```text
PASS: actual Vue UI initial history/reload/dedup/no-create/no-history-storage
PASS browser scenario 200
PASS browser scenario 404
PASS browser scenario 500
PASS browser scenario retry
PASS browser scenario empty
PASS browser scenario send
PASS: actual key dialog native clipboard/selection/focus/cleanup/storage
PASS: actual key dialog missing clipboard/selection/focus/cleanup/storage
PASS: actual key dialog rejected clipboard/selection/focus/cleanup/storage
PASS: actual key dialog failed clipboard/selection/focus/cleanup/storage
PASS lifecycle close-resolve
PASS lifecycle close-reject
PASS lifecycle unmount-resolve
PASS lifecycle unmount-reject
PASS lifecycle throw
PASS lifecycle selection
```

All exited 0. History and the four clipboard paths were independently repeated by the coordinator. The final clipboard probe uses actual native `writeText`/`readText`; missing/rejected paths use actual `execCommand` and native read-back of the dummy key. The failure/late-resolution cases deliberately substitute only the clipboard boundary. Tests check manual selection, temporary-node removal, no secret in Storage, and clearing on close/unmount.

Adversarial checks: slow A 200/404/500 cannot hijack B; history-pending send preserves old and new messages; late clipboard resolve/reject cannot toast or trigger fallback after close/unmount. Already-initiated native writes cannot be revoked and are not claimed to be cancelled.

Test-environment corrections: hard-loading `/api-keys` matches Vite's existing `/api` proxy, so probes use the mounted app's router. No proxy/security setting was changed. SSR store tests disable client optimization to avoid invalidating the running dev server cache. The clipboard helper receives the actual input-content container because Element Plus's outer dialog role is outside its focus trap; input selection is restored after document ranges because Chromium can otherwise reset the caret.

**Result: PASS** for local mocked-API browser behavior only.

## Check: isolated backend targeted tests, full suite and vet

**Command run:**

```sh
# Backend issue-resolution worktree; these expired credentials belonged ONLY to disposable fixtures.
APP_ENV=test SNOWFLAKE_NODE_ID=101 DATABASE_URL=mysql://root:IssueFixtureOnly20260902@127.0.0.1:49483/porsche_issue2_test GOCACHE=/private/tmp/porsche-go-build-cache go run ./cmd/migrate up
TEST_DATABASE_URL=mysql://root:IssueFixtureOnly20260902@127.0.0.1:49483/porsche_issue2_test TEST_REDIS_URL=redis://127.0.0.1:49574/0 GOCACHE=/private/tmp/porsche-go-build-cache go test -p 1 ./internal/whitelabel ./internal/handler -run 'Slash|CatalogWithEmpty|PatternAllowlist|ModelACL' -count=1 -v
TEST_DATABASE_URL=mysql://root:IssueFixtureOnly20260902@127.0.0.1:49483/porsche_issue2_test TEST_REDIS_URL=redis://127.0.0.1:49574/0 GOCACHE=/private/tmp/porsche-go-build-cache go test -p 1 ./... -count=1
GOCACHE=/private/tmp/porsche-go-build-cache go vet ./...
```

**Output observed:**

After an initial missing-`SNOWFLAKE_NODE_ID` configuration error, migration retry exited 0 and reported 0001 checksum `2da41ffd07c44d45cb05a705f867db2f2b8f01defb519000197dedce9998aedd` and 0002 checksum `58712428ca668fb1fea0943d71a2209b2e7faf26de043d870195a033ac0f413c`. The coordinator reports 13 top-level targeted tests passed without skips, including previously skipped MySQL ACL-route cases. Exact full targeted output is not retained here; this is a reported summary, corroborated by the backend `progress.md` in commit `a4202de`, not a fabricated raw transcript. `go vet` produced no output and exited 0. The full real-database suite exited 1; its retained raw excerpt is:

```text
--- FAIL: TestAuthCoreMigrationOnIsolatedMySQL (0.05s)
    runner_test.go:70: users.phone type = "", want "varchar"
    runner_test.go:70: users.phone nullable = "", want "YES"
    runner_test.go:71: users.username type = "", want "varchar"
    runner_test.go:71: users.username nullable = "", want "YES"
--- FAIL: TestAuthSessionCreateEvictsOldestAt51 (0.02s)
    auth_session_test.go:25: create session test user: Error 1406 (22001): Data too long for column 'username' at row 1
FAIL	github.com/porsche/ai-gateway-go/internal/service	1.730s
FAIL
```

Backend baseline investigation found `assertColumn` scanning empty values although direct SQL reports `users.username` as `varchar / YES`. Service fixtures use `session_user_`/`disabled_user_` plus an 18-digit GUID, exceeding `VARCHAR(20)`. Both were reproduced on the unmodified business-code baseline. They were disclosed, not fixed by broadening this issue's scope or weakening the production schema. Default `init.sh` without test database settings is not equivalent to this full integration run.

**Result: FAIL** for the full backend integration suite. Targeted Issue #2 and vet checks pass; genuine upstream acceptance remains unperformed and requires authorization/environment access.

## Check: safe cleanup and retained worktrees

**Command run:**

```sh
docker stop ef2cfaa38c5ca402e47919c266358a6ec977f1074dbcbe998e88adc7715289ea b006dfdada9b4999b23e9cba555fff1c74e0ceeee223de7558066e630f2e31e9
# Executed in each issue-resolution worktree:
git worktree list
git status --short
```

**Output observed:**

```text
ef2cfaa38c5ca402e47919c266358a6ec977f1074dbcbe998e88adc7715289ea
b006dfdada9b4999b23e9cba555fff1c74e0ceeee223de7558066e630f2e31e9
```

The coordinator's stop command exited 0; only the two newly-created `--rm` fixtures were targeted. Their tmpfs data is destroyed and cannot be recovered; no user volume was involved. Both issue-resolution worktrees remain on `fix/open-issue-resolution`; they were clean after their implementation/evidence commits, before adding this separate documentation commit. Root worktrees and their concurrent user AGENTS/docs/config changes remain untouched. The coordinator stopped the task-owned Vite service and owns cleanup of the four temporary browser scripts/two fixture screenshots. Browser command paths above are historical execution evidence, not durable test assets; ongoing automated regressions are the repository Node tests.

**Result: PASS** for scoped cleanup and preservation, not deployment.

## Next actions

1. Handle the two existing backend integration-test baseline failures in a separately scoped task; rerun with fresh isolated MySQL/Redis and require zero skips before claiming full backend PASS.
2. Obtain authorization and the correct HTTPS environment for real session-cookie and upstream catalog/detail/Chat/SSE acceptance. Do not weaken Secure/HttpOnly/Origin policy to make local probes pass.
3. User decides future push/merge/deployment. Keep all three issues open until the agreed delivery and acceptance gates complete.

Overall full-stack verification: **FAIL** because the full backend integration suite fails. Frontend local verification is **PASS**; real production/upstream acceptance is pending.
