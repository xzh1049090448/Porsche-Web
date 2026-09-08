# Vite API Proxy Route Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Narrow the local Vite API proxy to the `/api` path segment, restore `/api-keys` SPA hard reload behavior, and requalify P02/R01 in a disposable real FE+BE environment.

**Architecture:** The implementation changes only the Vite proxy context from the broad string prefix `'/api'` to the JavaScript source string `'^/api(?:/|\\?|$)'`, whose runtime RegExp text is `^/api(?:/|\?|$)`. A Node boundary test imports the real `vite.config.js`, models Vite raw-URL context matching including query strings, and protects the existing target and hook. Real acceptance uses a fresh loopback MySQL/Redis/backend/frontend fixture, then PM and independent QA evidence gates the P02/R01 status update and exact cleanup.

**Tech Stack:** Vue 3, Vite 6, Node.js `node:test`, npm, Go backend, MySQL 8, Redis 7, Playwright, Docker disposable fixtures, JSON/Markdown evidence.

---

## Safety and file map

Implementation-owned code files:

- Create: `vite.config.test.js` — imports the real Vite config and asserts proxy boundary and preserved options.
- Modify: `vite.config.js` — changes only the proxy object key.

Evidence and coordination files:

- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/writer-results.json`
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/writer-report.md`
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/pm-review.md`
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/SECURITY_REPORT.md`
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/cleanup-precheck.json`
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/cleanup-verification.json`
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/manifest.json`
- Modify after PM and independent QA pass: `docs/agents/validation/joint-acceptance-20260904/acceptance-matrix.json`
- Modify after PM and independent QA pass: `docs/agents/validation/prd-260903-confirmations.json`
- Modify after PM and independent QA pass: `progress.md`
- Modify after PM and independent QA pass: `feature_list.json`

Backend source, backend configuration files, authentication code, Vue Router, production proxy configuration, production HTTPS, deployment, and model/SSE behavior are outside the implementation scope.

Every commit uses an exact path list. Never run `git add .`, `git add -A`, `git commit -a`, `git reset`, `git clean`, or checkout over existing changes. Before each commit, run:

```bash
test -z "$(git diff --cached --name-only)"
git diff --cached --check
```

After staging, compare `git diff --cached --name-only` to the exact list in that task. If an implementation-owned path has pre-existing changes before its task starts, stop and return it to the coordinator who owns that dirty state; do not stage or rewrite those changes.

### Task 1: Establish the implementation baseline

**Files:**
- Read: `docs/superpowers/specs/2026-09-04-vite-api-route-proxy-design.md`
- Read: `vite.config.js`
- Read: `package.json`
- Read: `docs/agents/validation/joint-acceptance-20260904/SECOND-PHASE-REPORT.md`
- Read: `docs/agents/validation/joint-acceptance-20260904/FINAL-ACCEPTANCE-REPORT.md`

- [ ] **Step 1: Confirm the approved design commit and empty index**

Run:

```bash
cd /Users/xuzhihao/code/Porsche-Web/.worktrees/admin-public-260903
git rev-parse HEAD
test -z "$(git diff --cached --name-only)"
git status --short > /private/tmp/vite-api-route-fix-initial-status.txt
```

Expected: HEAD includes design commit `446a3f01029dd9f3d1b34a22b85a599bd6ea7a7f`; the index check exits 0. The status snapshot may contain authorized existing dirty files and must not be staged.

- [ ] **Step 2: Confirm the failure mechanism without starting a server**

Run:

```bash
node --input-type=module <<'NODE'
import config from './vite.config.js'
const keys = Object.keys(config.server.proxy)
if (keys.length !== 1 || keys[0] !== '/api' || !'/api-keys'.startsWith(keys[0])) process.exit(1)
console.log('baseline broad prefix confirmed')
NODE
```

Expected: `baseline broad prefix confirmed`. This is a read-only baseline probe, not the RED test and not acceptance evidence.

- [ ] **Step 3: Record the no-commit boundary**

No repository file changes in this task. Do not stage or commit the `/private/tmp` status snapshot.

### Task 2: Add the proxy boundary test and prove RED

Tasks 2 and 3 below preserve the completed first-pass TDD history. Their original expected key `^/api(?:/|$)` is historical and superseded by Task 3A; do not rerun or rewrite these commits as if they were the final implementation.

**Files:**
- Create: `vite.config.test.js`
- Test: `vite.config.test.js`

- [ ] **Step 1: Verify the test path is clean**

Run:

```bash
test ! -e vite.config.test.js
test -z "$(git diff --cached --name-only)"
```

Expected: both commands exit 0. If `vite.config.test.js` already exists, stop rather than overwriting it.

- [ ] **Step 2: Write the failing test against the real configuration**

Create `vite.config.test.js` with exactly:

```js
import assert from 'node:assert/strict'
import test from 'node:test'

import config from './vite.config.js'

const proxyEntries = Object.entries(config.server.proxy ?? {})

function matchesViteProxyContext(context, url) {
  return context.startsWith('^')
    ? new RegExp(context).test(url)
    : url.startsWith(context)
}

test('Vite proxies only the /api path segment', () => {
  assert.equal(proxyEntries.length, 1)
  const [[context]] = proxyEntries

  for (const url of [
    '/api',
    '/api/',
    '/api/v1/auth/login',
    '/api/v1/users/me?include=profile',
    '/api/public/models',
  ]) {
    assert.equal(matchesViteProxyContext(context, url), true, `${url} must be proxied`)
  }

  for (const url of [
    '/api-keys',
    '/api-keys/',
    '/api-admin',
    '/api-any-future-page',
    '/application',
  ]) {
    assert.equal(matchesViteProxyContext(context, url), false, `${url} must use SPA fallback`)
  }

  assert.equal(context, '^/api(?:/|$)')
})

test('Vite keeps the existing backend target and proxy hook', () => {
  assert.equal(proxyEntries.length, 1)
  const [[, options]] = proxyEntries
  assert.equal(options.target, 'http://localhost:8000')
  assert.equal(options.changeOrigin, true)
  assert.equal(typeof options.configure, 'function')
})
```

- [ ] **Step 3: Run the targeted test and verify the expected RED**

Run:

```bash
node --test vite.config.test.js 2>&1 | tee /private/tmp/vite-api-route-fix-red.log
```

Expected: exit 1; the boundary test reports that `/api-keys must use SPA fallback` because the actual `'/api'` context returns `true`. The target/hook test passes. If failure is an import or dependency error, fix only the test harness and rerun until the failure is the proxy-boundary assertion.

- [ ] **Step 4: Commit only the RED test**

Run:

```bash
git add -- vite.config.test.js
test "$(git diff --cached --name-only)" = "vite.config.test.js"
git diff --cached --check
git commit -m "test: define Vite API proxy boundary"
```

Expected: one-file commit containing only `vite.config.test.js`. The branch is intentionally RED until Task 3.

### Task 3: Apply the minimal proxy-key fix and verify GREEN

This task records the completed first-pass implementation in `717b278`. Its key `^/api(?:/|$)` fixed the `/api-keys` collision but did not cover a raw URL such as `/api?health=1`; Task 3A is mandatory before Task 4.

**Files:**
- Modify: `vite.config.js`
- Test: `vite.config.test.js`

- [ ] **Step 1: Confirm `vite.config.js` has no pre-existing worktree change**

Run:

```bash
test -z "$(git status --porcelain=v1 -- vite.config.js)"
test -z "$(git diff --cached --name-only)"
```

Expected: both commands exit 0. Otherwise stop and return the file to its current owner.

- [ ] **Step 2: Change only the proxy key**

Replace the proxy block with the following, preserving every option and hook:

```js
  server: {
    port: 5173,
    proxy: {
      '^/api(?:/|$)': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req) => {
            if (req.url?.includes('/chat/compare')) {
              proxyRes.headers['cache-control'] = 'no-cache'
              proxyRes.headers['x-accel-buffering'] = 'no'
            }
          })
        },
      },
    },
  },
```

Expected diff: one removed key `'/api'` and one added key `'^/api(?:/|$)'`; target, `changeOrigin`, and configure callback bytes remain unchanged.

- [ ] **Step 3: Run the targeted test and verify GREEN**

Run:

```bash
node --test vite.config.test.js 2>&1 | tee /private/tmp/vite-api-route-fix-green.log
```

Expected: exit 0; 2 tests pass, 0 fail.

- [ ] **Step 4: Run the full frontend gates**

Run:

```bash
npm test 2>&1 | tee /private/tmp/vite-api-route-fix-full-test.log
npm run build 2>&1 | tee /private/tmp/vite-api-route-fix-build.log
git diff --check
```

Expected: each command exits 0; Node reports 0 failed tests; Vite build completes successfully. Previously recorded Rollup warnings may remain, but no new error is accepted.

- [ ] **Step 5: Confirm the implementation diff is one line and commit it alone**

Run:

```bash
git diff -- vite.config.js
git add -- vite.config.js
test "$(git diff --cached --name-only)" = "vite.config.js"
git diff --cached --check
git commit -m "fix: narrow Vite API proxy boundary"
```

Expected: one-file commit. `git show --stat HEAD` reports only `vite.config.js`.

### Task 3A: Correct the raw-query boundary after quality review

**Files:**
- Read: `docs/superpowers/specs/2026-09-04-vite-api-route-proxy-design.md`
- Modify: `vite.config.test.js`
- Modify: `vite.config.js`

- [ ] **Step 1: Confirm the reviewed baseline and empty index**

Run:

```bash
git log --oneline -6
git merge-base --is-ancestor 8cf9b9b HEAD
git merge-base --is-ancestor 717b278 HEAD
git merge-base --is-ancestor 342342c HEAD
test -z "$(git diff --cached --name-only)"
test -z "$(git status --porcelain=v1 -- vite.config.test.js vite.config.js)"
```

Expected: HEAD contains test commit `8cf9b9b`, first-pass implementation `717b278`, and reviewed specification correction `342342c`; the index is empty and both implementation files are clean. The `717b278` key is the first-pass historical state, not the final expected regex.

- [ ] **Step 2: Add the raw-query positive case and final expected source string**

In the existing positive URL array in `vite.config.test.js`, add exactly:

```js
    '/api?health=1',
```

Change the final context assertion to:

```js
  assert.equal(context, '^/api(?:/|\\?|$)')
```

This JavaScript test literal evaluates to runtime text `^/api(?:/|\?|$)`. Keep the existing positive cases `/api`, `/api/`, `/api/v1/**`, and `/api/public/**`, and keep the negative `/api-keys`, `/api-admin`, arbitrary `/api-*` document routes, and `/application` cases unchanged.

- [ ] **Step 3: Prove the current `717b278` implementation is RED for the query boundary**

Run:

```bash
node --test vite.config.test.js 2>&1 | tee /private/tmp/vite-api-route-fix-query-red.log
```

Expected: exit 1. The boundary test must fail because `/api?health=1 must be proxied` under the current runtime regex `^/api(?:/|$)`. The failure must not be an import, dependency, syntax, target, or hook error. Preserve the raw RED log without replacing the first-pass Task 2 RED evidence.

- [ ] **Step 4: Commit only the query-boundary test**

Run:

```bash
git add -- vite.config.test.js
test "$(git diff --cached --name-only)" = "vite.config.test.js"
git diff --cached --check
git commit -m "test: cover Vite API query boundary"
```

Expected: one-file test commit. The branch intentionally remains RED until the next step changes the real configuration.

- [ ] **Step 5: Apply the final minimal proxy-key correction**

In `vite.config.js`, replace only the first-pass proxy key with this JavaScript source string:

```js
      '^/api(?:/|\\?|$)': {
```

The string value passed to Vite at runtime is `^/api(?:/|\?|$)`; `\?` in that runtime RegExp matches the literal query delimiter. Do not change target, `changeOrigin`, configure hook, backend, authentication, router, or production configuration.

Expected diff: only `'^/api(?:/|$)'` is removed and `'^/api(?:/|\\?|$)'` is added in `vite.config.js`.

- [ ] **Step 6: Verify targeted GREEN and all frontend gates**

Run:

```bash
node --test vite.config.test.js 2>&1 | tee /private/tmp/vite-api-route-fix-query-green.log
npm test 2>&1 | tee /private/tmp/vite-api-route-fix-query-full-test.log
npm run build 2>&1 | tee /private/tmp/vite-api-route-fix-query-build.log
git diff --check
```

Expected: targeted proxy tests pass with `/api?health=1` positive and all existing positives/negatives unchanged; full tests report 0 failures; build succeeds; diff check exits 0. Existing recorded build warnings may remain, but no new error is accepted.

- [ ] **Step 7: Commit only the final configuration correction**

Run:

```bash
git add -- vite.config.js
test "$(git diff --cached --name-only)" = "vite.config.js"
git diff --cached --check
git commit -m "fix: proxy exact API paths with queries"
```

Expected: one-file configuration commit; `git show --stat HEAD` names only `vite.config.js`, and the target/hook bytes remain identical to `717b278`.

- [ ] **Step 8: Require fresh specification and quality review before fixture work**

The PM specification reviewer and an independent quality reviewer perform a fresh review of the two new commits against specification `342342c`; they must not reuse the first-pass review result. They rerun the targeted test plus `npm test`, `npm run build`, and `git diff --check`, and verify the source/runtime escaping directly. Record their exact candidate SHAs and explicit `SPEC_PASS` and `QUALITY_PASS` results in `/private/tmp/vite-api-route-fix-query-review.txt`; this temporary file contains no secrets and is not committed.

Expected: both explicit results are PASS. Any `SPEC_FAIL` or `QUALITY_FAIL` stops execution before Task 4. Task 4 may begin only from the reviewed final query-aware candidate; the earlier `717b278` quality failure remains preserved as historical evidence.

### Task 4: Create a fresh disposable real FE+BE fixture

**Files:**
- Create outside repository: `/private/tmp/porsche-vite-api-route-fix-260904.XXXXXX/`
- Read backend: `/Users/xuzhihao/code/Porsche/.worktrees/admin-public-260903/`
- Read frontend: `/Users/xuzhihao/code/Porsche-Web/.worktrees/admin-public-260903/`

All Docker operations require the user's fixture authorization and exact identity checks. Use local images only; do not pull, connect to production, or load production data.

- [ ] **Step 1: Establish unique names, a private directory, and random credentials**

Run this in one shell with `umask 077`:

```bash
set -eu
umask 077
FE_REPO=/Users/xuzhihao/code/Porsche-Web/.worktrees/admin-public-260903
BE_REPO=/Users/xuzhihao/code/Porsche/.worktrees/admin-public-260903
CANDIDATE_SHORT=$(git -C "$FE_REPO" rev-parse --short=12 HEAD)
TASK_VALUE="vite-api-route-fix-260904-${CANDIDATE_SHORT}"
MYSQL_NAME="${TASK_VALUE}-mysql"
REDIS_NAME="${TASK_VALUE}-redis"
DB_NAME=porsche_vite_api_route_fix_260904_test
QA_PRIVATE_DIR=$(mktemp -d /private/tmp/porsche-vite-api-route-fix-260904.XXXXXX)
chmod 700 "$QA_PRIVATE_DIR"
printf '%s\n' "$QA_PRIVATE_DIR" > /private/tmp/porsche-vite-api-route-fix-260904.path
printf 'TASK_VALUE=%s\nMYSQL_NAME=%s\nREDIS_NAME=%s\nDB_NAME=%s\n' \
  "$TASK_VALUE" "$MYSQL_NAME" "$REDIS_NAME" "$DB_NAME" > "$QA_PRIVATE_DIR/lifecycle.env"
openssl rand -hex 32 > "$QA_PRIVATE_DIR/mysql-root-password"
openssl rand -hex 32 > "$QA_PRIVATE_DIR/redis-password"
openssl rand -hex 32 > "$QA_PRIVATE_DIR/jwt-secret"
openssl rand -hex 32 > "$QA_PRIVATE_DIR/auth-hmac"
openssl rand -hex 32 > "$QA_PRIVATE_DIR/admin-token"
openssl rand -hex 32 > "$QA_PRIVATE_DIR/metrics-token"
openssl rand -hex 24 > "$QA_PRIVATE_DIR/root-password"
printf 'username=route_fix_root\npassword=%s\n' "$(cat "$QA_PRIVATE_DIR/root-password")" > "$QA_PRIVATE_DIR/root-credentials"
printf '{"username":"route_fix_root","password":"%s"}\n' "$(cat "$QA_PRIVATE_DIR/root-password")" > "$QA_PRIVATE_DIR/root-login.json"
chmod 600 "$QA_PRIVATE_DIR"/* /private/tmp/porsche-vite-api-route-fix-260904.path
```

Expected: one new 0700 private directory; every file is 0600. No command prints credential contents.

- [ ] **Step 2: Prove names and task label are unused before creation**

Run:

```bash
QA_PRIVATE_DIR=$(cat /private/tmp/porsche-vite-api-route-fix-260904.path)
. "$QA_PRIVATE_DIR/lifecycle.env"
test -z "$(docker ps -a --filter "name=^/${MYSQL_NAME}$" --format '{{.ID}}')"
test -z "$(docker ps -a --filter "name=^/${REDIS_NAME}$" --format '{{.ID}}')"
test -z "$(docker ps -a --filter "label=codex.task=${TASK_VALUE}" --format '{{.ID}}')"
docker image inspect mysql:8.0 redis:7-alpine --format '{{.Id}} {{join .RepoTags ","}}' > "$QA_PRIVATE_DIR/image-precheck.txt"
```

Expected: all three collision checks exit 0; both image IDs are recorded. Any collision stops the task; do not take over or remove an existing resource.

- [ ] **Step 3: Start loopback-only MySQL and Redis without named volumes**

Run:

```bash
QA_PRIVATE_DIR=$(cat /private/tmp/porsche-vite-api-route-fix-260904.path)
. "$QA_PRIVATE_DIR/lifecycle.env"
{
  printf 'bind 0.0.0.0\nprotected-mode yes\nsave ""\nappendonly no\nrequirepass '
  cat "$QA_PRIVATE_DIR/redis-password"
  printf '\n'
} > "$QA_PRIVATE_DIR/redis.conf"
chmod 600 "$QA_PRIVATE_DIR/redis.conf"

docker run --detach --rm --pull=never \
  --name "$MYSQL_NAME" \
  --label "codex.task=${TASK_VALUE}" \
  --publish 127.0.0.1::3306 \
  --tmpfs /var/lib/mysql:rw,nosuid,nodev \
  --tmpfs /tmp:rw,nosuid,nodev \
  --mount "type=bind,src=${QA_PRIVATE_DIR}/mysql-root-password,dst=/run/secrets/mysql-root-password,readonly" \
  --env MYSQL_ROOT_PASSWORD_FILE=/run/secrets/mysql-root-password \
  mysql:8.0 > "$QA_PRIVATE_DIR/mysql.id"

docker run --detach --rm --pull=never \
  --name "$REDIS_NAME" \
  --label "codex.task=${TASK_VALUE}" \
  --publish 127.0.0.1::6379 \
  --tmpfs /data:rw,nosuid,nodev \
  --mount "type=bind,src=${QA_PRIVATE_DIR}/redis.conf,dst=/usr/local/etc/redis/redis.conf,readonly" \
  redis:7-alpine redis-server /usr/local/etc/redis/redis.conf > "$QA_PRIVATE_DIR/redis.id"
```

Expected: two container IDs are written privately. `docker inspect` shows loopback dynamic ports, AutoRemove true, only tmpfs plus the planned read-only bind, and no named volume.

- [ ] **Step 4: Wait with a finite bound and record dynamic ports**

Run:

```bash
QA_PRIVATE_DIR=$(cat /private/tmp/porsche-vite-api-route-fix-260904.path)
. "$QA_PRIVATE_DIR/lifecycle.env"
for attempt in $(seq 1 60); do
  docker exec "$MYSQL_NAME" sh -c 'mysqladmin ping -uroot -p"$(cat /run/secrets/mysql-root-password)" --silent' >/dev/null 2>&1 && break
  test "$attempt" -lt 60
  sleep 1
done
for attempt in $(seq 1 60); do
  REDIS_PASSWORD=$(cat "$QA_PRIVATE_DIR/redis-password")
  docker exec -e REDISCLI_AUTH="$REDIS_PASSWORD" "$REDIS_NAME" redis-cli ping 2>/dev/null | grep -qx PONG && { unset REDIS_PASSWORD; break; }
  unset REDIS_PASSWORD
  test "$attempt" -lt 60
  sleep 1
done
MYSQL_PORT=$(docker port "$MYSQL_NAME" 3306/tcp | sed 's/.*://')
REDIS_PORT=$(docker port "$REDIS_NAME" 6379/tcp | sed 's/.*://')
printf 'MYSQL_PORT=%s\nREDIS_PORT=%s\n' "$MYSQL_PORT" "$REDIS_PORT" > "$QA_PRIVATE_DIR/ports.env"
chmod 600 "$QA_PRIVATE_DIR/ports.env"
```

Expected: readiness completes within 60 seconds; both ports are numeric dynamic host ports. The Redis password is never printed.

- [ ] **Step 5: Create the exact test database and private backend environment**

Run:

```bash
QA_PRIVATE_DIR=$(cat /private/tmp/porsche-vite-api-route-fix-260904.path)
. "$QA_PRIVATE_DIR/lifecycle.env"
. "$QA_PRIVATE_DIR/ports.env"
docker exec "$MYSQL_NAME" sh -c 'mysql -uroot -p"$(cat /run/secrets/mysql-root-password)" -e "CREATE DATABASE porsche_vite_api_route_fix_260904_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"'

QA_PRIVATE_DIR="$QA_PRIVATE_DIR" MYSQL_PORT="$MYSQL_PORT" REDIS_PORT="$REDIS_PORT" DB_NAME="$DB_NAME" python3 - <<'PY'
import os, pathlib, shlex, urllib.parse
p = pathlib.Path(os.environ['QA_PRIVATE_DIR'])
def read(name): return (p / name).read_text().strip()
env = {
  'APP_ENV': 'development', 'HOST': '127.0.0.1', 'PORT': '8000',
  'ALLOWED_HOSTS': '127.0.0.1,localhost',
  'AUTH_TRUSTED_ORIGINS': 'http://127.0.0.1:15174',
  'DATABASE_URL': f"mysql://root:{urllib.parse.quote(read('mysql-root-password'), safe='')}@127.0.0.1:{os.environ['MYSQL_PORT']}/{os.environ['DB_NAME']}",
  'REDIS_URL': f"redis://:{urllib.parse.quote(read('redis-password'), safe='')}@127.0.0.1:{os.environ['REDIS_PORT']}/0",
  'SNOWFLAKE_NODE_ID': '904', 'UPSTREAM_REGION': 'cn',
  'JIEKOU_API_KEY': 'fixture-no-upstream-' + read('admin-token'),
  'JIEKOU_ALLOWED_MODELS': 'gpt-5.4-nano',
  'JWT_SECRET_KEY': read('jwt-secret'), 'AUTH_HMAC_KEY': read('auth-hmac'),
  'ADMIN_TOKEN': read('admin-token'), 'METRICS_TOKEN': read('metrics-token'),
}
(p / 'backend.env').write_text(''.join(f'{k}={shlex.quote(v)}\n' for k, v in env.items()))
PY
chmod 600 "$QA_PRIVATE_DIR/backend.env"
```

Expected: one empty exact test database exists; `backend.env` is 0600 and contains only disposable loopback connections and random credentials.

- [ ] **Step 6: Build current backend tools, migrate 0001–0004, and bootstrap one Root**

Run:

```bash
QA_PRIVATE_DIR=$(cat /private/tmp/porsche-vite-api-route-fix-260904.path)
BE_REPO=/Users/xuzhihao/code/Porsche/.worktrees/admin-public-260903
(
  cd "$BE_REPO"
  go build -o "$QA_PRIVATE_DIR/migrate" ./cmd/migrate
  go build -o "$QA_PRIVATE_DIR/bootstrap-root" ./cmd/bootstrap-root
  go build -o "$QA_PRIVATE_DIR/server" ./cmd/server
)
chmod 700 "$QA_PRIVATE_DIR/migrate" "$QA_PRIVATE_DIR/bootstrap-root" "$QA_PRIVATE_DIR/server"
(
  cd "$QA_PRIVATE_DIR"
  set -a
  . ./backend.env
  set +a
  ./migrate up 2>&1 | tee migration.log
  ./migrate status 2>&1 | tee migration-status.log
  ./bootstrap-root --credentials-file ./root-credentials 2>&1 | tee bootstrap.log
)
```

Expected: migrations 0001, 0002, 0003, and 0004 are applied with recorded checksums; bootstrap prints `Root bootstrap created`; no `.env` outside the private directory is read.

- [ ] **Step 7: Start persistent backend and frontend sessions**

Start backend with workdir set to the private directory:

```bash
set -a; . ./backend.env; set +a; exec ./server
```

Start frontend with workdir `/Users/xuzhihao/code/Porsche-Web/.worktrees/admin-public-260903`:

```bash
exec npm run dev -- --host 127.0.0.1 --port 15174 --strictPort
```

Expected: the execution tool returns two persistent session IDs. Record only session IDs, PIDs, `http://127.0.0.1:8000`, and `http://127.0.0.1:15174`; do not report credential values. `curl http://127.0.0.1:8000/health` and `curl http://127.0.0.1:15174/login` both return 200.

- [ ] **Step 8: Retain resources without a repository commit**

Record container IDs, names, images, label, ports, mounts, tmpfs, session IDs, and PIDs in the private directory. Do not create repository evidence or commit until the writer run has completed and outputs have been sanitized.

### Task 5: Run writer P02/R01 and regression acceptance

**Files:**
- Create outside repository: `$QA_PRIVATE_DIR/p02-r01-writer.mjs`
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/writer-results.json`
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/writer-report.md`

- [ ] **Step 1: Create a browser script that reads credentials only from the private directory**

Write `$QA_PRIVATE_DIR/p02-r01-writer.mjs` with Playwright imported from `/Users/xuzhihao/.codex/skills/playwright-skill/node_modules/playwright/index.js`. The script must:

```js
import fs from 'node:fs/promises'
import { chromium } from '/Users/xuzhihao/.codex/skills/playwright-skill/node_modules/playwright/index.js'

const privateDir = process.env.QA_PRIVATE_DIR
const credentials = JSON.parse(await fs.readFile(`${privateDir}/root-login.json`, 'utf8'))
const baseURL = 'http://127.0.0.1:15174'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ baseURL })
const page = await context.newPage()
const observed = []
page.on('response', response => {
  const url = new URL(response.url())
  if (url.origin === baseURL || url.origin === 'http://127.0.0.1:8000') {
    observed.push({ path: url.pathname, status: response.status(), resourceType: response.request().resourceType() })
  }
})
await page.route('**/api/v1/platform/models**', route => route.abort('blockedbyclient'))
await page.route('**/api/v1/platform/chat/**', route => { throw new Error(`model route forbidden: ${route.request().url()}`) })

await page.goto('/login')
await page.locator('.login-card input').nth(0).fill(credentials.username)
await page.locator('.login-card input').nth(1).fill(credentials.password)
await page.locator('.submit-btn').click()
await page.waitForURL(url => url.pathname !== '/login')

const apiKeysDocument = await page.goto('/api-keys', { waitUntil: 'domcontentloaded' })
if (apiKeysDocument.status() !== 200 || !(apiKeysDocument.headers()['content-type'] || '').includes('text/html')) throw new Error('api-keys document did not use SPA fallback')
await page.locator('.api-keys-page').waitFor({ state: 'visible' })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.locator('.api-keys-page').waitFor({ state: 'visible' })

await page.goto('/users')
await page.locator('.admin-page').waitFor({ state: 'visible' })
await page.goto('/profile')
await page.locator('.profile-page').waitFor({ state: 'visible' })

const publicProbe = await page.request.get('/api/public/__proxy_probe__')
if (publicProbe.status() !== 404 || (publicProbe.headers()['content-type'] || '').includes('text/html')) throw new Error('api/public probe did not reach backend')

const queryProbe = await page.request.get('/api?health=1')
if ((queryProbe.headers()['content-type'] || '').includes('text/html')) throw new Error('api query probe used SPA fallback')

await page.goto('/api-keys')
await page.locator('.user-trigger').click()
const logoutResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/logout')
await page.locator('.el-dropdown-menu:visible').getByText(/退出|Logout/, { exact: true }).click()
await page.locator('.el-message-box:visible').getByRole('button', { name: /确认|确定|Confirm|OK/ }).click()
const logoutResponse = await logoutResponsePromise
await page.waitForURL(url => url.pathname === '/login')
if (logoutResponse.status() !== 204) throw new Error(`logout status ${logoutResponse.status()}`)
if ((await context.cookies()).length !== 0) throw new Error('cookies remained after logout')
const refreshStatus = await page.evaluate(async () => (await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })).status)
if (refreshStatus !== 401) throw new Error(`refresh status ${refreshStatus}`)

await page.goto('/api-keys', { waitUntil: 'domcontentloaded' })
await page.waitForURL(url => url.pathname === '/login')
if (await page.locator('.api-keys-page, .main-layout, .token-list-card').count()) throw new Error('private DOM rendered after logout')

const result = {
  status: 'PASS', apiKeysDocument: 200, apiKeysHardReload: 'rendered',
  usersRegression: 'rendered', profileRegression: 'rendered',
  publicApiProxyProbe: 404, queryApiProxyProbe: queryProbe.status(),
  logout: 204, cookiesAfterLogout: 0,
  refreshAfterLogout: 401, postLogoutPath: '/login', privateDomAfterLogout: 0,
  modelOrSseInvoked: false, observed,
}
await fs.writeFile(`${privateDir}/writer-results.json`, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
await browser.close()
```

The implementation may adjust only locale-dependent logout/confirm selectors if the rendered locale differs; request paths, status assertions, route assertions, and private-DOM assertions remain unchanged.

- [ ] **Step 2: Run the writer script without printing credentials**

Run:

```bash
QA_PRIVATE_DIR=$(cat /private/tmp/porsche-vite-api-route-fix-260904.path)
QA_PRIVATE_DIR="$QA_PRIVATE_DIR" node "$QA_PRIVATE_DIR/p02-r01-writer.mjs"
python3 -m json.tool "$QA_PRIVATE_DIR/writer-results.json" >/dev/null
```

Expected: exit 0 and private result status `PASS`. No model or SSE endpoint reaches the backend; the platform-model request is deliberately blocked in the browser because model behavior is outside scope.

- [ ] **Step 3: Sanitize and archive writer evidence**

Create `docs/agents/validation/vite-api-route-proxy-fix-20260904/writer-results.json` by copying only the fixed boolean/status fields from the private JSON. Exclude cookies, headers, tokens, usernames, passwords, complete URLs with credentials, and response bodies. Create `writer-report.md` with:

- frontend/backend candidate SHAs;
- proxy test and full test/build/diff results;
- P02/R01 steps and PASS result;
- `/api/v1/**` and `/api/public/**` proxy evidence;
- `/api?health=1` reaches the backend rather than SPA fallback;
- `/api-keys` SPA fallback evidence;
- `/users` and `/profile` regression evidence;
- explicit no-model/no-SSE statement;
- exact resource identities without secrets;
- resources retained for PM and independent QA.

Expected: `rg -n '(Bearer |password["=:]|mysql://[^ ]+@|redis://[^ ]+@|Set-Cookie)' docs/agents/validation/vite-api-route-proxy-fix-20260904` returns no matches.

- [ ] **Step 4: Commit only writer evidence**

Run:

```bash
git add -- \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/writer-results.json \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/writer-report.md
printf '%s\n' \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/writer-report.md \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/writer-results.json > /private/tmp/vite-api-route-fix-expected-stage.txt
git diff --cached --name-only | sort > /private/tmp/vite-api-route-fix-actual-stage.txt
diff -u /private/tmp/vite-api-route-fix-expected-stage.txt /private/tmp/vite-api-route-fix-actual-stage.txt
git diff --cached --check
git commit -m "test: record Vite proxy route joint validation"
```

Expected: exactly two evidence files committed. Resources remain running.

### Task 6: Obtain PM spec review and independent QA

**Files:**
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/pm-review.md`
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/SECURITY_REPORT.md`

- [ ] **Step 1: PM reviews spec-to-diff alignment**

PM must verify:

- diff is limited to `vite.config.js` and `vite.config.test.js`;
- JavaScript source key is exactly `'^/api(?:/|\\?|$)'`, producing runtime RegExp text `^/api(?:/|\?|$)`;
- target, `changeOrigin`, and configure hook are unchanged;
- test imports the real config;
- test includes `/api?health=1` as a positive and retains `/api-keys`, `/api-admin`, and arbitrary `/api-*` document routes as negatives;
- no backend, auth, router, production, model, or SSE change exists;
- writer evidence matches the approved design.

Record `SPEC_PASS` or `SPEC_FAIL` in `pm-review.md`, with exact candidate SHAs and reviewed commands. `SPEC_FAIL` blocks status updates and cleanup remains pending while evidence is preserved.

- [ ] **Step 2: Independent QA reruns code gates**

Run independently:

```bash
node --test vite.config.test.js
npm test
npm run build
git diff --check
```

Expected: all exit 0; proxy test 2 pass/0 fail; full tests report 0 failed; build succeeds.

- [ ] **Step 3: Independent QA repeats P02/R01 in a fresh browser context**

QA uses the retained environment and private credential path, but creates a new browser context and a separate `$QA_PRIVATE_DIR/p02-r01-independent.mjs`. It repeats every assertion from Task 5 and additionally verifies the writer did not save secret material. It must not reuse writer cookies or browser storage.

Expected `SECURITY_REPORT.md` verdict: `PASS`; P02 and R01 local remediation both `PASS_LIMITED_SCOPE`; `/users` and `/profile` regressions pass; model/SSE remain not run; production HTTPS remains not run.

- [ ] **Step 4: Commit PM and independent QA evidence only after both pass**

Run:

```bash
git add -- \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/pm-review.md \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/SECURITY_REPORT.md
git diff --cached --name-only | sort > /private/tmp/vite-api-route-fix-review-stage.txt
printf '%s\n' \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/SECURITY_REPORT.md \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/pm-review.md | sort | diff -u - /private/tmp/vite-api-route-fix-review-stage.txt
git diff --cached --check
git commit -m "test: independently verify Vite proxy route fix"
```

Expected: exactly two review files committed. A failed review is archived but does not permit Task 7 status promotion; the coordinator decides a separate failure-evidence commit.

### Task 7: Update the acceptance state after real PASS only

**Files:**
- Modify: `docs/agents/validation/joint-acceptance-20260904/acceptance-matrix.json`
- Modify: `docs/agents/validation/prd-260903-confirmations.json`
- Modify: `progress.md`
- Modify: `feature_list.json`
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/remediation-report.md`

- [ ] **Step 1: Enforce the existing-dirty ownership gate**

Run:

```bash
test -z "$(git diff --cached --name-only)"
for path in \
  docs/agents/validation/joint-acceptance-20260904/acceptance-matrix.json \
  docs/agents/validation/prd-260903-confirmations.json \
  progress.md \
  feature_list.json; do
  test -z "$(git status --porcelain=v1 -- "$path")" || {
    echo "STOP: pre-existing dirty target $path"
    exit 1
  }
done
```

Expected: all target coordination files are clean because their prior owner has already committed or isolated earlier work. If any is dirty, stop; do not stage a mixed historical change.

- [ ] **Step 2: Write the remediation report**

`remediation-report.md` must state:

- original P02/R01 `FAIL_LOCAL_DEV_ROUTE` and immutable source evidence;
- implementation/test commit SHAs;
- PM `SPEC_PASS` and independent QA `PASS`;
- actual proxy matrix and browser results;
- logout 204, cookies empty, refresh 401 unchanged;
- `/users` and `/profile` regressions pass;
- no model/SSE, backend, production, or deployment work;
- resources retained pending exact cleanup;
- local result is limited scope and not full PRD or production acceptance.

- [ ] **Step 3: Update only P02/R01 and the aggregate counts**

In both machine matrices, change:

```json
{
  "P02": "PASS_LIMITED_SCOPE",
  "R01": "PASS_LIMITED_SCOPE"
}
```

Update the aggregate to exactly:

```json
{
  "total": 26,
  "PASS_LIMITED_SCOPE": 8,
  "FAIL_LOCAL_DEV_ROUTE": 0,
  "BLOCKED_NOT_IMPLEMENTED": 16,
  "BLOCKED_PRODUCT": 1,
  "BLOCKED_ENV": 1,
  "blocked_total": 18
}
```

Set the local overall status to `PARTIAL_ACCEPTANCE_8_LIMITED_18_BLOCKED`. Preserve A01/A02/A04/A13/V01/V02 as limited pass and preserve all 18 blocked statuses. Append a timeline entry; do not delete the historical 26/26 `NOT_RUN` or 6/2/18 failure records.

- [ ] **Step 4: Update project progress without marking `web-012` passing**

Append the new remediation evidence to `progress.md` and `feature_list.json`. Set:

```json
{
  "id": "web-012",
  "status": "in_progress",
  "phase": "joint_acceptance_partial_8_limited_18_blocked"
}
```

The note must say P02/R01 are local `PASS_LIMITED_SCOPE`, production HTTPS remains not run, and 18 items remain blocked. Do not alter `web-009` or any unrelated feature.

- [ ] **Step 5: Validate JSON, counts, hashes, and secrets**

Run:

```bash
python3 -m json.tool docs/agents/validation/joint-acceptance-20260904/acceptance-matrix.json >/dev/null
python3 -m json.tool docs/agents/validation/prd-260903-confirmations.json >/dev/null
python3 -m json.tool feature_list.json >/dev/null
python3 - <<'PY'
import json
from collections import Counter
m = json.load(open('docs/agents/validation/joint-acceptance-20260904/acceptance-matrix.json'))
c = Counter(item['status'] for item in m['items'])
assert c == Counter({'PASS_LIMITED_SCOPE': 8, 'BLOCKED_NOT_IMPLEMENTED': 16, 'BLOCKED_PRODUCT': 1, 'BLOCKED_ENV': 1})
assert m['summary']['blocked_total'] == 18
f = json.load(open('feature_list.json'))
web = next(item for item in f['features'] if item['id'] == 'web-012')
assert web['status'] == 'in_progress'
assert web['phase'] == 'joint_acceptance_partial_8_limited_18_blocked'
PY
rg -n '(Bearer |password["=:]|mysql://[^ ]+@|redis://[^ ]+@|Set-Cookie)' \
  docs/agents/validation/vite-api-route-proxy-fix-20260904 \
  docs/agents/validation/joint-acceptance-20260904/acceptance-matrix.json \
  docs/agents/validation/prd-260903-confirmations.json \
  progress.md feature_list.json && exit 1 || true
git diff --check
```

Expected: JSON and assertions pass; secret scan has no matches; diff check exits 0.

- [ ] **Step 6: Commit the exact acceptance update**

Run:

```bash
git add -- \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/remediation-report.md \
  docs/agents/validation/joint-acceptance-20260904/acceptance-matrix.json \
  docs/agents/validation/prd-260903-confirmations.json \
  progress.md \
  feature_list.json
printf '%s\n' \
  docs/agents/validation/joint-acceptance-20260904/acceptance-matrix.json \
  docs/agents/validation/prd-260903-confirmations.json \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/remediation-report.md \
  feature_list.json \
  progress.md | sort > /private/tmp/vite-api-route-fix-expected-acceptance-stage.txt
git diff --cached --name-only | sort > /private/tmp/vite-api-route-fix-actual-acceptance-stage.txt
diff -u /private/tmp/vite-api-route-fix-expected-acceptance-stage.txt /private/tmp/vite-api-route-fix-actual-acceptance-stage.txt
git diff --cached --check
git commit -m "docs: record Vite proxy route acceptance"
```

Expected: exactly five files committed. Overall PRD remains partial; no full-pass label is introduced.

### Task 8: Exact cleanup and independent cleanup review

**Files:**
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/cleanup-precheck.json`
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/cleanup-verification.json`
- Create: `docs/agents/validation/vite-api-route-proxy-fix-20260904/manifest.json`
- Modify: `docs/agents/validation/vite-api-route-proxy-fix-20260904/remediation-report.md`

- [ ] **Step 1: Stop only the recorded FE and BE sessions**

Send Ctrl-C only to the two session IDs recorded in Task 4. Confirm the recorded PIDs are absent and ports 15174 and 8000 have no listener:

```bash
lsof -nP -iTCP:15174 -iTCP:8000 -sTCP:LISTEN
```

Expected: exit 1 with no output. Record session IDs and absence results in `cleanup-precheck.json`.

- [ ] **Step 2: Precheck exact container identities before stopping**

Run:

```bash
QA_PRIVATE_DIR=$(cat /private/tmp/porsche-vite-api-route-fix-260904.path)
. "$QA_PRIVATE_DIR/lifecycle.env"
MYSQL_ID=$(cat "$QA_PRIVATE_DIR/mysql.id")
REDIS_ID=$(cat "$QA_PRIVATE_DIR/redis.id")
printf 'QA_PRIVATE_DIR=%s\nTASK_VALUE=%s\nMYSQL_NAME=%s\nREDIS_NAME=%s\nMYSQL_ID=%s\nREDIS_ID=%s\n' \
  "$QA_PRIVATE_DIR" "$TASK_VALUE" "$MYSQL_NAME" "$REDIS_NAME" "$MYSQL_ID" "$REDIS_ID" \
  > /private/tmp/porsche-vite-api-route-fix-cleanup.env
chmod 600 /private/tmp/porsche-vite-api-route-fix-cleanup.env
docker inspect "$MYSQL_ID" "$REDIS_ID" > "$QA_PRIVATE_DIR/cleanup-inspect.json"
test "$(docker ps -a --filter "label=codex.task=${TASK_VALUE}" --format '{{.ID}}' | wc -l | tr -d ' ')" = 2
```

Parse the inspect JSON and require exact full IDs, names, task label, recorded image IDs, loopback ports, tmpfs, AutoRemove true, no named volumes, and only the two planned read-only binds. Any mismatch stops cleanup; do not stop or take over a resource.

- [ ] **Step 3: Stop only the two exact IDs and delete only the private directory**

Run:

```bash
. /private/tmp/porsche-vite-api-route-fix-cleanup.env
docker stop "$MYSQL_ID" "$REDIS_ID"
rm -rf -- "$QA_PRIVATE_DIR"
```

Expected: Docker prints exactly the two recorded IDs. AutoRemove deletes both. No prune, volume removal, image removal, glob, or other container command is permitted.

- [ ] **Step 4: Verify zero residual resources**

Run:

```bash
. /private/tmp/porsche-vite-api-route-fix-cleanup.env
test ! -e "$QA_PRIVATE_DIR"
test -z "$(docker ps -a --filter "label=codex.task=${TASK_VALUE}" --format '{{.ID}}')"
test -z "$(docker ps -a --filter "name=^/${MYSQL_NAME}$" --format '{{.ID}}')"
test -z "$(docker ps -a --filter "name=^/${REDIS_NAME}$" --format '{{.ID}}')"
! docker inspect "$MYSQL_ID" "$REDIS_ID" >/dev/null 2>&1
! lsof -nP -iTCP:15174 -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1
rm -f -- /private/tmp/porsche-vite-api-route-fix-260904.path /private/tmp/porsche-vite-api-route-fix-cleanup.env
test ! -e /private/tmp/porsche-vite-api-route-fix-260904.path
test ! -e /private/tmp/porsche-vite-api-route-fix-cleanup.env
```

Expected: all checks exit 0 and both exact lifecycle pointer files are absent. Write only non-secret identities and zero-residual counts to `cleanup-verification.json`.

- [ ] **Step 5: Obtain independent cleanup review and finalize the manifest**

A reviewer independently verifies ID/name/label/port/private-path residuals are zero and checks no unrelated container or volume was touched. Append `cleanup: PASS` to `remediation-report.md`.

Create `manifest.json` containing candidate SHAs, code/test commits, writer/PM/QA results, 8/18 acceptance counts, cleanup evidence hashes, and artifact hashes. Exclude `manifest.json` from its own artifact map; store its SHA only in a separate printed result or an optional `manifest.sha256` that is itself excluded.

Expected: no recursive self-hash and no credential values.

- [ ] **Step 6: Run final repository gates**

Run:

```bash
python3 -m json.tool docs/agents/validation/vite-api-route-proxy-fix-20260904/cleanup-precheck.json >/dev/null
python3 -m json.tool docs/agents/validation/vite-api-route-proxy-fix-20260904/cleanup-verification.json >/dev/null
python3 -m json.tool docs/agents/validation/vite-api-route-proxy-fix-20260904/manifest.json >/dev/null
npm test
npm run build
git diff --check
rg -n '(Bearer |password["=:]|mysql://[^ ]+@|redis://[^ ]+@|Set-Cookie)' docs/agents/validation/vite-api-route-proxy-fix-20260904 && exit 1 || true
```

Expected: JSON parses; tests/build/diff pass; secret scan has no match.

- [ ] **Step 7: Commit exact cleanup evidence**

Run:

```bash
git add -- \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/cleanup-precheck.json \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/cleanup-verification.json \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/manifest.json \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/remediation-report.md
printf '%s\n' \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/cleanup-precheck.json \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/cleanup-verification.json \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/manifest.json \
  docs/agents/validation/vite-api-route-proxy-fix-20260904/remediation-report.md | sort > /private/tmp/vite-api-route-fix-expected-cleanup-stage.txt
git diff --cached --name-only | sort > /private/tmp/vite-api-route-fix-actual-cleanup-stage.txt
diff -u /private/tmp/vite-api-route-fix-expected-cleanup-stage.txt /private/tmp/vite-api-route-fix-actual-cleanup-stage.txt
git diff --cached --check
git commit -m "docs: archive Vite proxy route fixture cleanup"
```

Expected: exact cleanup evidence commit. Final state is local `PARTIAL_ACCEPTANCE_8_LIMITED_18_BLOCKED`, resources cleaned, `web-012` still `in_progress`, and production HTTPS still separately unverified.
