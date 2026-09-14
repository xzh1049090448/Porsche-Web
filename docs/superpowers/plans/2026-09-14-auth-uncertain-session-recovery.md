# Auth Uncertain Session Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the login page safely recover unresolved login, refresh, and logout operations by obtaining authoritative results from the existing refresh/logout endpoints while preserving fail-closed cross-tab authentication.

**Architecture:** Add a repeatable browser-capability probe to the existing browser adapter, then replace the no-op `recover()` branch with a lock-scoped recovery state machine. The recovery manager receives un-intercepted refresh/logout transports, advances the shared epoch only after an authoritative result, publishes credentials only in the initiating tab, and exposes a non-sensitive reason code for the UI.

**Tech Stack:** Vue 3, Pinia, Element Plus, JavaScript ES modules, Axios, Node `node:test`, JSDOM, Vite 6, Web Locks, BroadcastChannel, localStorage.

---

## Scope and source of truth

- Worktree: `/Users/xuzhihao/code/Porsche-Web/.worktrees/auth-uncertain-recovery`
- Branch: `fix/auth-uncertain-recovery`
- Implementation base: `origin/main@72c4d8c182486cc440da02cfc137a2260d85b8c8`
- Approved design: `docs/superpowers/specs/2026-09-14-auth-uncertain-session-recovery-design.md`
- Frontend contract: `interface-contract.json` at `v1.0.0-p0` / `agreed_for_implementation`
- Read-only backend contract source: `/Users/xuzhihao/code/Porsche/.worktrees/platform-stream-terminal-compatibility/docs/agents/contracts`
- No backend business-code, contract, database, Redis, Cookie-attribute, CORS, dependency, build-configuration, deployment, or production mutation is in scope.

Expected final implementation paths:

- Modify `src/api/auth-browser.js`: repeatable capability probe and safe BroadcastChannel initialization.
- Modify `src/api/auth-test-browser.js`: deterministic probe/capability test fixture.
- Modify `src/api/auth-browser.test.js`: capability reason and recovery-after-storage tests.
- Modify `src/api/auth-session.js`: recovery classifier, state convergence, identity epoch handling, and observable issue code.
- Modify `src/api/auth-p0.test.js`: login/refresh/logout, legacy record, concurrency, and unsupported-operation recovery matrix.
- Modify `src/api/auth-refresh.js`: un-intercepted recovery transport factory.
- Modify `src/api/auth-refresh.test.js`: exact refresh/logout transport behavior.
- Modify `src/api/request.js`: inject recovery transport into the singleton manager.
- Modify `src/stores/user.js`: expose reactive `authIssue` only; do not duplicate recovery logic.
- Modify `src/components/AuthStatus.vue`: distinct capability/uncertain UI, loading, retry, and recovered event.
- Modify `src/views/Login.vue`: consume the recovered event and reuse `safeAuthRedirect`.
- Modify `src/views/Login.auth-status.test.js`: mounted UI recovery states and routing.
- Modify `progress.md` and `feature_list.json`: append bounded evidence without marking all of `web-009` complete.

## Task 1: Coordinator preflight, isolated setup, and review baseline

**Files:**

- Read: `AGENTS.md`
- Read: `progress.md`
- Read: `feature_list.json`
- Read: `docs/agents/orchestration.md`
- Read: `docs/agents/domain.md`
- Read: `docs/conventions/frontend-standards.md`
- Read: `docs/conventions/api-contract-standards.md`
- Read: `docs/conventions/database-standards.md`
- Read: `docs/superpowers/specs/2026-09-14-auth-uncertain-session-recovery-design.md`
- Create outside worktree: `/private/tmp/porsche-web-auth-uncertain-recovery-20260914/scope.json`
- Create outside worktree: `/private/tmp/porsche-web-auth-uncertain-recovery-20260914/baseline.json`

- [ ] **Step 1: Run the front-end coordinator Explorer**

The `front_end_project_coordinator` must return a read-only handoff containing repository/worktree/branch/HEAD, accepted design, exact files, contract status/hash, non-goals, risk classification `full`, TDD commands, and required `Developer -> Spec Review -> Quality/Test Gate` ordering. It must explicitly state that Porsche backend source remains read-only and that production actions are not authorized.

- [ ] **Step 2: Confirm the isolated starting point**

Run:

```bash
pwd
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git log --oneline -5
```

Expected: `pwd` is the scoped worktree, the worktree is clean, and HEAD contains only the approved spec/plan commits above `72c4d8c`; `origin/main` remains `72c4d8c` unless the coordinator explicitly rebases/merges and regenerates all baseline metadata before implementation.

- [ ] **Step 3: Install the locked dependencies and verify the unchanged baseline**

Run:

```bash
npm ci
node --test src/api/auth-browser.test.js src/api/auth-refresh.test.js src/api/auth-p0.test.js src/views/Login.auth-status.test.js
VITE_USE_MOCK=false npm run build
```

Expected: dependency installation uses `package-lock.json`; all selected existing tests pass; the production build and bundle checker pass with only already-recorded Vite/Rollup warnings. If the baseline fails, stop and report the failure before editing.

- [ ] **Step 4: Create the exact review scope outside the worktree**

Create `/private/tmp/porsche-web-auth-uncertain-recovery-20260914/scope.json` with exactly:

```json
{
  "paths": [
    "feature_list.json",
    "progress.md",
    "src/api/auth-browser.js",
    "src/api/auth-browser.test.js",
    "src/api/auth-p0.test.js",
    "src/api/auth-refresh.js",
    "src/api/auth-refresh.test.js",
    "src/api/auth-session.js",
    "src/api/auth-test-browser.js",
    "src/api/request.js",
    "src/components/AuthStatus.vue",
    "src/stores/user.js",
    "src/views/Login.auth-status.test.js",
    "src/views/Login.vue"
  ],
  "prefixes": []
}
```

- [ ] **Step 5: Generate the canonical baseline**

Run the repository helper and save its stdout bytes to the new external file without overwriting any existing object:

```bash
python3 docs/agents/review_snapshot.py baseline \
  --scope /private/tmp/porsche-web-auth-uncertain-recovery-20260914/scope.json \
  --contract interface-contract.json \
  --output -
```

Expected: canonical `review-baseline-v2` JSON on stdout. The authorized writer saves it as `/private/tmp/porsche-web-auth-uncertain-recovery-20260914/baseline.json`; any pre-existing target, symlink, hardlink, invalid contract, or scope error is a blocker.

## Task 2: Repeatable browser capability probe

**Files:**

- Modify: `src/api/auth-browser.test.js:7-31`
- Modify: `src/api/auth-browser.js:1-33`
- Modify: `src/api/auth-test-browser.js:1-14`

- [ ] **Step 1: Write failing capability tests**

Extend the environment fixture with configurable storage failures and listener removal. Add tests equivalent to:

```js
test('probe identifies each unavailable browser capability without authentication traffic', () => {
  const cases = [
    [env => { env.isSecureContext = false }, 'auth_insecure_context'],
    [env => { env.navigator = {} }, 'auth_web_locks_unavailable'],
    [env => { env.BroadcastChannel = null }, 'auth_broadcast_channel_unavailable'],
    [env => { env.localStorage.setItem = () => { throw Error('denied') } }, 'auth_storage_unavailable'],
  ]
  for (const [change, code] of cases) {
    const env = environment(); change(env)
    const browser = createBrowserAuthAdapter(env)
    assert.deepEqual(browser.probe(), { available: false, code })
  }
})

test('probe can recover storage and creates one channel without retaining its probe key', () => {
  const env = environment(); let denied = true
  const original = env.localStorage.setItem
  env.localStorage.setItem = (key, value) => {
    if (denied) throw Error('denied')
    original(key, value)
  }
  const browser = createBrowserAuthAdapter(env)
  assert.equal(browser.available, false)
  denied = false
  assert.deepEqual(browser.probe(), { available: true, code: null })
  assert.equal(browser.available, true)
  assert.equal(env.entries.has('porsche_auth_probe_v1'), false)
})
```

Update `browserFixture()` so it exposes `probe: () => ({ available: true, code: null })` while retaining the existing getter-compatible `available` behavior.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test src/api/auth-browser.test.js
```

Expected: FAIL because `probe()` and capability codes do not exist.

- [ ] **Step 3: Implement the minimal repeatable probe**

In `auth-browser.js`, introduce exact constants and a probe that updates adapter state:

```js
const PROBE_KEY = 'porsche_auth_probe_v1'

function capabilityFailure(environment) {
  if (!environment.isSecureContext) return 'auth_insecure_context'
  if (typeof environment.navigator?.locks?.request !== 'function') return 'auth_web_locks_unavailable'
  if (typeof environment.BroadcastChannel !== 'function') return 'auth_broadcast_channel_unavailable'
  return null
}
```

Inside `createBrowserAuthAdapter`, keep `capability = { available: false, code: 'auth_storage_unavailable' }`, and implement:

```js
function probe() {
  const code = capabilityFailure(environment)
  if (code) return (capability = { available: false, code })
  try {
    storage = environment.localStorage
    storage.setItem(PROBE_KEY, '1')
    if (storage.getItem(PROBE_KEY) !== '1') throw Error('probe_not_persisted')
    storage.removeItem(PROBE_KEY)
    if (!channel) channel = new environment.BroadcastChannel(LOCK)
    return (capability = { available: true, code: null })
  } catch {
    try { storage?.removeItem(PROBE_KEY) } catch { /* keep unavailable */ }
    return (capability = { available: false, code: 'auth_storage_unavailable' })
  }
}
```

Keep a subscriber registry independent of channel construction so subscriptions created while storage is unavailable become active after a later successful probe:

```js
const subscribers = new Set()

function ensureChannel() {
  if (!channel) {
    channel = new environment.BroadcastChannel(LOCK)
    channel.addEventListener('message', event => {
      subscribers.forEach(fn => fn(event.data))
    })
  }
  return channel
}

function subscribe(fn) {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}
```

Use `ensureChannel()` from the successful probe. Call `probe()` once during construction, keep legacy credential removal inside a guarded storage block, and return:

```js
{
  get available() { return capability.available },
  capabilityCode: () => capability.code,
  probe,
  // existing id/read/write/lock/publish/subscribe methods
}
```

`publish()` must remain optional-safe when no channel exists. Do not create a second channel after repeated successful probes, and do not place a credential, account field, or random identity value in `PROBE_KEY`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --test src/api/auth-browser.test.js src/api/auth-refresh.test.js src/api/auth-p0.test.js
```

Expected: all selected tests pass; legacy credential cleanup and epoch-only broadcast assertions remain green.

- [ ] **Step 5: Commit the adapter unit**

```bash
git add src/api/auth-browser.js src/api/auth-browser.test.js src/api/auth-test-browser.js
git commit -m "fix(auth): make browser capability checks recoverable"
```

## Task 3: Recover login and refresh uncertainty

**Files:**

- Modify: `src/api/auth-p0.test.js:101-112,145-159`
- Modify: `src/api/auth-session.js:53-255`

- [ ] **Step 1: Replace the old no-recovery assertion with failing convergence tests**

Add a fixture helper:

```js
const pendingRecord = (browser, kind, extra = {}) => browser.write({
  epoch: 'initial',
  pending: { operationId: `${kind}-pending`, kind, epoch: 'initial' },
  suppressed: true,
  ...extra,
})
```

Add tests for both `login` and `refresh`:

```js
test('login and refresh uncertainty recover through one authoritative refresh', async () => {
  for (const kind of ['login', 'refresh']) {
    const browser = browserFixture(); pendingRecord(browser, kind)
    const auth = createAuthSessionManager({ browser, refresh: async () => refreshed })
    const result = await auth.recover()
    assert.equal(result.state, 'authenticated')
    assert.equal(auth.state(), 'authenticated')
    assert.equal(auth.accessToken(), 'fresh')
    assert.equal(browser.read().pending, null)
    assert.equal(browser.read().suppressed, false)
    assert.notEqual(browser.read().epoch, 'initial')
    assert.deepEqual(browser.messages, [{ type: 'invalidate', epoch: browser.read().epoch }])
  }
})

test('authoritative refresh 401 settles login uncertainty as anonymous', async () => {
  const browser = browserFixture(); pendingRecord(browser, 'login')
  const auth = createAuthSessionManager({
    browser,
    refresh: async () => { throw { response: { status: 401 } } },
  })
  assert.deepEqual(await auth.recover(), { state: 'anonymous' })
  assert.equal(auth.state(), 'anonymous')
  assert.equal(browser.read().pending, null)
})
```

Add table-driven assertions that `403`, `408`, `500`, network errors, invalid `LoginResponse`, storage-write failure, and record/epoch drift reject while retaining the original pending record and publishing no user/token.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test --test-name-pattern="uncertainty recover|refresh 401|invalid cookie response|unknown logout" src/api/auth-p0.test.js
```

Expected: the new recovery tests fail because the current `recover()` always throws `auth_uncertain`; existing persistence tests still pass.

- [ ] **Step 3: Add observable issue state and explicit settlement helpers**

In `createAuthSessionManager`, add:

```js
let issue = null
let recoveryPromise = null
const notify = () => listeners.forEach(fn => fn({
  accessToken: accessToken(), user, state, issue, epoch, generation, permissionRevision,
}))
const authIssue = () => issue
```

Use settlement helpers that can leave `uncertain` instead of relying on the current early-returning `clearSession()`:

```js
function settleAnonymous(nextEpoch) {
  access = null; user = null; state = 'anonymous'; issue = null
  epoch = sharedEpoch = nextEpoch
  generation++; permissionRevision++
  snapshotInvalidators.forEach(fn => fn())
  notify()
}

function settleAuthenticated(data, nextEpoch) {
  access = data.access_token
  user = sessionUser(data.user)
  state = 'authenticated'; issue = null
  epoch = sharedEpoch = nextEpoch
  generation++; permissionRevision++
  snapshotInvalidators.forEach(fn => fn())
  notify()
}
```

Make `uncertain(code = 'auth_uncertain')` store the code even when already uncertain, and include `authIssue` in the returned manager API. Clear `issue` in normal successful `setSession()` and non-uncertain `clearSession()` paths.

- [ ] **Step 4: Implement lock-scoped login/refresh recovery**

Add exact predicates:

```js
const responseStatus = error => error?.response?.status ?? error?.status
const isDefiniteRefreshAnonymous = error => responseStatus(error) === 401
const recoverableKinds = new Set(['login', 'refresh', 'logout'])
```

Replace `recover()` with a single-flight wrapper over `recoverLocked()`:

```js
async function recover() {
  if (!recoveryPromise) {
    recoveryPromise = recoverLocked().finally(() => { recoveryPromise = null })
  }
  return recoveryPromise
}
```

`recoverLocked()` must:

1. call `browser.probe()` and throw its exact capability code without network when unavailable;
2. acquire `browser.lock()` and re-read the record;
3. if the record epoch differs from `sharedEpoch` and is already clean, adopt that epoch, call `settleAnonymous()`, and return `{ state: 'anonymous', settledElsewhere: true }`;
4. classify clean-record + prior capability issue as `refresh`, or use the pending kind;
5. reject malformed/unsupported records as `auth_recovery_unsupported` with zero network;
6. call injected `refresh()` exactly once;
7. on valid `200 LoginResponse`, verify the original record still matches, write `{ epoch: nextEpoch, pending: null, suppressed: false }`, publish only the new epoch, and call `settleAuthenticated()`;
8. on refresh `401`, perform the same durable settlement but call `settleAnonymous()`;
9. on any other outcome, keep the original record, set the issue, and rethrow.

Return values are exactly `{ state: 'authenticated' }`, `{ state: 'anonymous' }`, or `{ state: 'anonymous', settledElsewhere: true }`.

- [ ] **Step 5: Run focused and regression tests**

Run:

```bash
node --test src/api/auth-p0.test.js src/api/auth-browser.test.js src/api/auth-refresh.test.js
```

Expected: all selected tests pass; POST business requests remain non-replayed, normal refresh single-flight still passes, and invalid response tests remain fail closed.

- [ ] **Step 6: Commit the login/refresh recovery unit**

```bash
git add src/api/auth-session.js src/api/auth-p0.test.js
git commit -m "fix(auth): recover unresolved login sessions"
```

## Task 4: Complete logout recovery and cross-tab boundaries

**Files:**

- Modify: `src/api/auth-p0.test.js`
- Modify: `src/api/auth-session.js`

- [ ] **Step 1: Write failing logout, legacy, unsupported, and concurrency tests**

Add these behavioral cases:

```js
test('logout uncertainty refreshes then logs out without publishing temporary identity', async () => {
  const browser = browserFixture(); pendingRecord(browser, 'logout')
  const snapshots = []; let logoutToken
  const auth = createAuthSessionManager({
    browser,
    refresh: async () => refreshed,
    recoverLogout: async token => { logoutToken = token; return { status: 204 } },
  })
  auth.subscribe(value => snapshots.push(value))
  assert.deepEqual(await auth.recover(), { state: 'anonymous' })
  assert.equal(logoutToken, 'fresh')
  assert.equal(auth.state(), 'anonymous')
  assert.equal(snapshots.some(value => value.user || value.accessToken), false)
})

test('legacy suppressed-only logout record is recoverable', async () => {
  const browser = browserFixture()
  browser.write({ epoch: 'initial', pending: null, suppressed: true })
  const auth = createAuthSessionManager({
    browser,
    refresh: async () => { throw { response: { status: 401 } } },
  })
  assert.deepEqual(await auth.recover(), { state: 'anonymous' })
  assert.equal(browser.read().suppressed, false)
})

test('non-session mutation uncertainty is never probed or replayed', async () => {
  for (const kind of ['password', 'revoke-session', 'revoke-others', 'unknown']) {
    const browser = browserFixture(); pendingRecord(browser, kind)
    let refreshes = 0; let logouts = 0
    const auth = createAuthSessionManager({
      browser,
      refresh: async () => { refreshes++ },
      recoverLogout: async () => { logouts++ },
    })
    await assert.rejects(auth.recover(), error => error.code === 'auth_recovery_unsupported')
    assert.equal(refreshes, 0); assert.equal(logouts, 0)
  }
})
```

Also cover refresh `401` -> anonymous with zero logout; refresh `200` + logout `401/403/500/network` -> remains uncertain; invalid logout status -> uncertain; a second explicit attempt can converge; and two managers sharing one queued browser fixture produce only one recovery network sequence, with the second manager observing the new epoch and settling anonymous without receiving credentials.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test --test-name-pattern="logout uncertainty|legacy suppressed|non-session mutation|two.*recover" src/api/auth-p0.test.js
```

Expected: FAIL until logout classification and `recoverLogout` are implemented.

- [ ] **Step 3: Implement logout classification and convergence**

Extend manager injection to:

```js
export function createAuthSessionManager({ refresh, recoverLogout, browser } = {}) {
```

Classify exact `{ pending: null, suppressed: true }` as `legacy-logout`. After a valid refresh response for `logout` or `legacy-logout`, call:

```js
const logoutResult = await recoverLogout?.(data.access_token)
if (logoutResult?.status !== 204) throw failure('auth_logout_unconfirmed')
```

Only logout `204` may clear the marker and settle anonymous. A thrown `401`, `403`, other `4xx`, `5xx`, timeout, cancellation, network error, absent action, or non-204 result preserves the original marker and issue. Never call `settleAuthenticated()` on the logout branch.

On refresh `401`, settle anonymous without calling `recoverLogout`. Before each durable write, re-read and match `epoch`, pending `operationId`/kind when present, and suppressed shape. A mismatching record fails as `identity_changed` and publishes no credentials.

- [ ] **Step 4: Run the complete authentication state tests**

Run:

```bash
node --test src/api/auth-p0.test.js src/api/auth-session.test.js src/api/auth-response.test.js src/api/auth-request-policy.test.js src/api/auth-browser.test.js src/api/auth-refresh.test.js
```

Expected: all selected tests pass with zero skips; existing logout freeze, identity epoch, 401 non-replay, response validation, and sensitive-field assertions remain green.

- [ ] **Step 5: Commit the logout recovery unit**

```bash
git add src/api/auth-session.js src/api/auth-p0.test.js
git commit -m "fix(auth): finish unresolved logout recovery"
```

## Task 5: Wire production transport and recovery UI

**Files:**

- Modify: `src/api/auth-refresh.test.js`
- Modify: `src/api/auth-refresh.js`
- Modify: `src/api/request.js`
- Modify: `src/stores/user.js`
- Modify: `src/components/AuthStatus.vue`
- Modify: `src/views/Login.vue`
- Modify: `src/views/Login.auth-status.test.js`

- [ ] **Step 1: Write failing transport tests**

Add a factory test requiring exact, un-intercepted paths and headers:

```js
test('recovery transport refreshes and logs out once with the supplied bearer', async () => {
  const calls = []
  const transport = {
    post: async (path, body, config) => {
      calls.push([path, body, config])
      return path.endsWith('/refresh')
        ? { data: refreshed, status: 200 }
        : { data: null, status: 204 }
    },
  }
  const recovery = createSessionRecovery({ useMock: false, transport })
  assert.deepEqual(await recovery.refresh(), refreshed)
  assert.deepEqual(await recovery.logout('temporary-access'), { status: 204 })
  assert.equal(calls[1][2].headers.Authorization, 'Bearer temporary-access')
})
```

Add a mock test asserting refresh returns the existing synthetic 401 and logout throws if unexpectedly invoked, with zero transport calls.

- [ ] **Step 2: Run the transport tests and verify RED**

Run:

```bash
node --test src/api/auth-refresh.test.js
```

Expected: FAIL because `createSessionRecovery` does not exist.

- [ ] **Step 3: Implement and inject the un-intercepted recovery transport**

In `auth-refresh.js`, export:

```js
export function createSessionRecovery({ useMock, transport }) {
  const refresh = createSessionRefresh({ useMock, transport })
  return {
    refresh,
    async logout(accessToken) {
      if (useMock) throw Object.assign(new Error('Mock logout recovery is unavailable'), { code: 'auth_recovery_unsupported' })
      const response = await transport.post('/api/v1/auth/logout', undefined, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return { status: response.status }
    },
  }
}
```

In `request.js`, construct it once from `authTransport` and inject both functions:

```js
const sessionRecovery = createSessionRecovery({ useMock: USE_MOCK, transport: authTransport })
export const authSession = createAuthSessionManager({
  browser: createBrowserAuthAdapter(),
  refresh: sessionRecovery.refresh,
  recoverLogout: sessionRecovery.logout,
})
```

Do not import `auth.js` into `request.js`, do not route through normal Axios response interceptors, and do not change ordinary login/logout exports.

- [ ] **Step 4: Write failing mounted UI tests**

Refactor the existing SFC harness to accept `authIssue`, a deferred `recover()`, and emitted results. Cover:

```js
store.authState = 'uncertain'
store.authIssue = 'auth_storage_unavailable'
assert.match(wrapper.text(), /当前浏览器环境不支持安全认证/)

store.authIssue = 'auth_uncertain'
assert.match(wrapper.text(), /上一次认证请求结果尚未确认/)
await recoverButton.trigger('click')
assert.equal(recoverButton.attributes('disabled') !== undefined, true)

resolveRecover({ state: 'anonymous' })
await flush()
assert.equal(store.authState, 'anonymous')
assert.equal(wrapper.find('[role="alert"]').exists(), false)
```

Add an authenticated-result case asserting `Login.vue` receives `@recovered`, calls `safeAuthRedirect(route.query.redirect, '/chat')`, and performs one `router.replace`; an anonymous result must not navigate. Add unsupported and retryable failure text assertions without exposing raw error bodies.

- [ ] **Step 5: Run the mounted tests and verify RED**

Run:

```bash
node --test src/views/Login.auth-status.test.js
```

Expected: FAIL because the current component has one generic warning, no loading state, no event, and no reactive issue code.

- [ ] **Step 6: Implement the minimal reactive UI wiring**

In `user.js`, initialize and subscribe to `authIssue`:

```js
const authIssue = ref(authSession.authIssue())
authSession.subscribe(next => {
  token.value = next.accessToken
  authUser.value = next.user
  authState.value = next.state
  authIssue.value = next.issue
  // retain existing epoch/permission updates
})
```

Return `authIssue` from the store. In `AuthStatus.vue`, keep local `checking` and `resultCode`, define `recovered`, and render capability vs uncertain messages from a fixed safe mapping. The recovery handler must be:

```js
const emit = defineEmits(['recovered'])
async function recover() {
  if (checking.value) return
  checking.value = true
  resultCode.value = null
  try {
    const result = await authSession.recover()
    emit('recovered', result)
  } catch (error) {
    resultCode.value = [
      'auth_recovery_unsupported',
      'auth_capability_unavailable',
      'auth_insecure_context',
      'auth_web_locks_unavailable',
      'auth_broadcast_channel_unavailable',
      'auth_storage_unavailable',
    ].includes(error?.code) ? error.code : 'auth_uncertain'
  } finally {
    checking.value = false
  }
}
```

Bind `:loading="checking"` and `:disabled="checking"`. In `Login.vue`, use:

```vue
<AuthStatus @recovered="handleRecovered" />
```

```js
function handleRecovered(result) {
  if (result?.state === 'authenticated') {
    router.replace(safeAuthRedirect(route.query.redirect, '/chat'))
  }
}
```

Add one shared guard for both authentication entry points:

```js
const authBlocked = computed(() => userStore.authState === 'uncertain')

async function submitLogin() {
  if (authBlocked.value) return
  // retain the existing validated login flow
}
```

Bind the submit button with `:disabled="authBlocked"` in addition to its existing loading state. Bind the registration text button with `:disabled="authBlocked"`, and guard its click handler before routing. Do not clear or persist either form field. `MainLayout.vue` requires no change because it can ignore the event.

- [ ] **Step 7: Run focused UI and request tests**

Run:

```bash
node --test src/api/auth-refresh.test.js src/api/auth-p0.test.js src/views/Login.auth-status.test.js src/router/auth-guard.test.js
```

Expected: all selected tests pass; authenticated recovery navigates once, anonymous recovery unlocks without navigation, retryable failures stay visible, and the safe redirect tests remain green.

- [ ] **Step 8: Commit the production wiring and UI**

```bash
git add src/api/auth-refresh.js src/api/auth-refresh.test.js src/api/request.js src/stores/user.js src/components/AuthStatus.vue src/views/Login.vue src/views/Login.auth-status.test.js
git commit -m "fix(auth): expose safe session recovery on login"
```

## Task 6: Full verification, browser acceptance, evidence, and independent gates

**Files:**

- Modify: `progress.md`
- Modify: `feature_list.json`
- Read-only verify: all scoped implementation and test files
- Create outside worktree: `/private/tmp/porsche-web-auth-uncertain-recovery-20260914/snapshot-spec.json`
- Create outside worktree: `/private/tmp/porsche-web-auth-uncertain-recovery-20260914/snapshot-quality.json`

- [ ] **Step 1: Run the complete test suite with all authoritative contracts explicitly provided**

Run as one environment-scoped command:

```bash
BACKEND_CONTRACT_DIR=/Users/xuzhihao/code/Porsche/.worktrees/platform-stream-terminal-compatibility/docs/agents/contracts \
A03_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-stream-terminal-compatibility/docs/agents/contracts/admin-user-create-v1.json \
A05_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-stream-terminal-compatibility/docs/agents/contracts/admin-user-edit-v1.json \
A06_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-stream-terminal-compatibility/docs/agents/contracts/admin-user-status-v1.json \
A08_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-stream-terminal-compatibility/docs/agents/contracts/admin-user-roles-permissions-v1.json \
A14_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-stream-terminal-compatibility/docs/agents/contracts/admin-action-future-contract.json \
PUBLIC_PRICING_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-stream-terminal-compatibility/docs/agents/contracts/public-content-pricing-v1.json \
npm test
```

Expected: every test passes with zero contract-path skips. `BACKEND_CONTRACT_DIR` is informational for the evidence record; the six explicit variables are authoritative.

- [ ] **Step 2: Run production build and static safety checks**

Run:

```bash
VITE_USE_MOCK=false npm run build
node scripts/check-production-bundle.mjs
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: build and bundle sentinel pass; no credential/mock fixture enters `dist`; diff check is clean; only intended scoped files differ.

- [ ] **Step 3: Execute visible two-tab browser acceptance against a synthetic same-origin backend**

Use the existing production preview/browser harness pattern and the `playwright-skill` instructions. The synthetic backend must intercept all auth requests and must not contact production. Execute these exact scenarios in two real Chromium pages sharing one context:

1. pending login + refresh `200`: exactly one recovery refresh, initiating page authenticated and safely redirected, peer page anonymous/unlocked, no token/user in localStorage or BroadcastChannel.
2. pending login + refresh `401`: both pages anonymous/unlocked, zero logout.
3. pending logout + refresh `200` + logout `204`: exactly one refresh then one logout, no transient private DOM.
4. legacy suppressed-only + refresh `401`: anonymous/unlocked, zero logout.
5. refresh `500` and logout `500`: warning remains, record remains, no automatic retry.
6. password pending: unsupported warning and zero network.
7. storage denial: capability warning and zero network; restore storage, click again, and converge.

Save only request method/path/status/count, final route, safe DOM assertions, epoch-change count, and boolean storage-field checks. Never save form passwords, Authorization values, Cookies, SID, user payloads, or response bodies.

- [ ] **Step 4: Append bounded evidence without widening status**

Prepend a dated entry to `progress.md` containing final frontend revision, contract version/hash, focused/full test counts, build result, browser scenario counts, review snapshot ID, and explicit non-goals. In `feature_list.json`, append the same evidence to `web-009` but keep its overall status `blocked` unless every older production/M3 blocker has independently closed.

Validate JSON and prose:

```bash
node -e "JSON.parse(require('node:fs').readFileSync('feature_list.json', 'utf8')); console.log('feature_list_json_ok')"
rg -n "auth uncertain|认证未决|web-009" progress.md feature_list.json
git diff --check
```

Expected: JSON parses, bounded evidence is discoverable, and no historical failure/skip record is overwritten.

- [ ] **Step 5: Commit the evidence update**

```bash
git add progress.md feature_list.json
git commit -m "docs(auth): record uncertain recovery verification"
```

- [ ] **Step 6: Generate and verify the Spec Review snapshot**

Generate a fresh snapshot using the external baseline and exact scope:

```bash
python3 docs/agents/review_snapshot.py snapshot \
  --scope /private/tmp/porsche-web-auth-uncertain-recovery-20260914/scope.json \
  --baseline /private/tmp/porsche-web-auth-uncertain-recovery-20260914/baseline.json \
  --contract interface-contract.json \
  --output -
```

Save stdout exclusively to `/private/tmp/porsche-web-auth-uncertain-recovery-20260914/snapshot-spec.json`. Dispatch `front_end_spec_compliance_reviewer` read-only with the approved design, exact final revision, contract version/hash, baseline, snapshot, full diffs, tests, and browser evidence. Reviewer runs:

```bash
python3 docs/agents/review_snapshot.py verify \
  --scope /private/tmp/porsche-web-auth-uncertain-recovery-20260914/scope.json \
  --baseline /private/tmp/porsche-web-auth-uncertain-recovery-20260914/baseline.json \
  --snapshot /private/tmp/porsche-web-auth-uncertain-recovery-20260914/snapshot-spec.json \
  --contract interface-contract.json
```

Expected: helper prints the snapshot ID and reviewer returns `SPEC_PASS`. Any requested code, test, evidence, or document change invalidates this snapshot and requires Developer rework plus a new snapshot.

- [ ] **Step 7: Run the final Quality/Test Gate on the same unchanged snapshot**

Only after traceable `SPEC_PASS`, dispatch `front_end_quality_gate` read-only with the same final revision and snapshot. It independently reruns focused tests, full `npm test` with the six contract variables, production build/bundle checks, diff checks, and adversarial storage/epoch/concurrency inspection. It must execute `review_snapshot.py verify` against the same files and return `QUALITY_PASS` or a bounded failure report.

If Quality requests any change, return to the original Developer, create a fresh snapshot, rerun Spec Review, then rerun Quality. Do not patch directly in a reviewer role.

- [ ] **Step 8: Final coordinator handoff**

The coordinator reports:

- final branch and revision;
- exact diff and commit list;
- review snapshot ID and interface-contract hash/version/status;
- focused/full/build/browser results and any skips;
- that Porsche backend code was unchanged;
- that no push, merge, deployment, production login, session revocation, or site-storage deletion occurred;
- remaining production/public-HTTPS acceptance and release authorization boundaries.

Do not call the fix production-complete until an independently authorized deployment and live acceptance verify the deployed asset revision and the real login/refresh/logout recovery matrix.
