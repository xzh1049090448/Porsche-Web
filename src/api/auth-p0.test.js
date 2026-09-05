import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthSessionManager, authenticatedFetch } from './auth-session.js'

import { browserFixture } from './auth-test-browser.js'
const user = { guid: '100', username: 'alice', nickname: null, role: 'user', status: 'active' }
const session = { accessToken: 'old', user }
const refreshed = { access_token: 'fresh', token_type: 'Bearer', expires_in: 300, user }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('POST generation 401 is returned once without refresh or clearing identity', async () => {
  let refreshes = 0; let requests = 0
  const auth = createAuthSessionManager({ browser: browserFixture(), refresh: async () => { refreshes++; return refreshed } })
  auth.setSession(session)
  const res = await authenticatedFetch(auth, '/api/v1/platform/chat/completions', { method: 'POST' }, { fetchImpl: async () => { requests++; return new Response(null, { status: 401 }) } })
  assert.equal(res.status, 401); assert.equal(requests, 1); assert.equal(refreshes, 0); assert.equal(auth.accessToken(), 'old')
})
test('five safe GETs share refresh; delayed old-token 401 uses new generation', async () => {
  let refreshes = 0
  const auth = createAuthSessionManager({ browser: browserFixture(), refresh: async () => { refreshes++; return refreshed } })
  auth.setSession(session)
  const old = auth.capture()
  const send = config => config.headers.Authorization
  const responses = await Promise.all(Array.from({ length: 5 }, () => auth.refreshAndRetry({ url: '/api/v1/users/me', method: 'get', __authContext: old }, send)))
  assert.deepEqual(responses, Array(5).fill('Bearer fresh'))
  await auth.refreshAndRetry({ url: '/api/v1/users/me', method: 'get', __authContext: old }, send)
  assert.equal(refreshes, 1)
})
test('old response and old 401 cannot cross identity epochs', async () => {
  const auth = createAuthSessionManager({ browser: browserFixture(), refresh: async () => refreshed })
  auth.setSession(session)
  const wait = deferred()
  const pending = authenticatedFetch(auth, '/api/v1/users/me', {}, { fetchImpl: () => wait.promise })
  auth.setSession({ accessToken: 'bob', user: { guid: '200' } })
  wait.resolve(new Response('{}'))
  await assert.rejects(pending, /identity_changed/)
})
test('a same-identity refresh generation rejects a stale profile response', () => {
  const auth = createAuthSessionManager({ browser: browserFixture() })
  auth.setSession(session)
  const beforeRefresh = auth.capture()
  auth.setSession({ accessToken: 'new-access', user })
  assert.throws(() => auth.assertSnapshot(beforeRefresh), /identity_changed/)
})
test('fresh profile projection replaces prior capabilities and invalid source clears them', () => {
  const auth = createAuthSessionManager({ browser: browserFixture() })
  auth.setSession({ accessToken: 'old', user: { ...user, admin_permissions: ['users.read'], permissions_version: '1' } })
  auth.replacePermissionProjection(auth.capture(), { admin_permissions: ['users.audit.read'], permissions_version: '2' })
  assert.deepEqual(auth.user().admin_permissions, ['users.audit.read'])
  auth.replacePermissionProjection(auth.capture(), { admin_permissions: ['unknown'], permissions_version: '3' })
  assert.equal('admin_permissions' in auth.user(), false)
  assert.equal('permissions_version' in auth.user(), false)
})
test('an identical projection does not invalidate protected state, but a version change does', () => {
  const auth = createAuthSessionManager({ browser: browserFixture() })
  auth.setSession({ accessToken: 'old', user: { ...user, admin_permissions: ['users.read'], permissions_version: '1' } })
  let invalidations = 0
  auth.onSnapshotInvalidate(() => { invalidations++ })
  assert.equal(auth.replacePermissionProjection(auth.capture(), { admin_permissions: ['users.read'], permissions_version: '1' }), false)
  assert.equal(invalidations, 0)
  assert.equal(auth.replacePermissionProjection(auth.capture(), { admin_permissions: ['users.read'], permissions_version: '2' }), true)
  assert.equal(invalidations, 1)
})
test('a permission-only update does not make an expired access request skip its one refresh', async () => {
  let refreshes = 0; let calls = 0
  const auth = createAuthSessionManager({ browser: browserFixture(), refresh: async () => { refreshes++; return refreshed } })
  auth.setSession(session)
  const pending = authenticatedFetch(auth, '/api/v1/users/me', {}, { fetchImpl: async (_url, init) => {
    calls++
    return init.headers.get('Authorization') === 'Bearer fresh' ? new Response('{}') : new Response(JSON.stringify({ detail: 'Token无效或已过期' }), { status: 401 })
  } })
  auth.replacePermissionProjection(auth.capture(), { admin_permissions: ['users.read'], permissions_version: '1' })
  await pending
  assert.equal(refreshes, 1)
  assert.equal(calls, 2)
})
test('cookie operation rechecks shared epoch inside lock before sending', async () => {
  const browser = browserFixture(); const wait = deferred(); let sent = 0
  const auth = createAuthSessionManager({ browser })
  const blocker = browser.lock(() => wait.promise)
  const pending = auth.cookieOperation('login', async () => { sent++; return refreshed })
  browser.write({ epoch: 'other-tab', pending: null, suppressed: false }); wait.resolve(); await blocker
  await assert.rejects(pending, /identity_changed/); assert.equal(sent, 0)
})
test('capability and storage failure block cookie traffic', async () => {
  for (const browser of [{ available: false }, { ...browserFixture(), write: () => { throw Error('storage denied') } }]) {
    let sent = 0; const auth = createAuthSessionManager({ browser })
    await assert.rejects(auth.cookieOperation('login', async () => { sent++ }))
    assert.equal(sent, 0); assert.equal(auth.state(), 'uncertain')
  }
})
test('unknown logout is persistent and reload does not refresh or clear matching pending', async () => {
  const browser = browserFixture(); const auth = createAuthSessionManager({ browser })
  auth.setSession(session)
  await assert.rejects(auth.logout(async () => { throw new TypeError('network failure') }))
  assert.equal(auth.accessToken(), null); assert.equal(auth.state(), 'uncertain')
  assert.equal(browser.read().pending.kind, 'logout')
  let refreshes = 0
  const reload = createAuthSessionManager({ browser, refresh: async () => { refreshes++; return refreshed } })
  assert.equal(await reload.ensureSession(), false); assert.equal(refreshes, 0)
  await assert.rejects(reload.recover(), /uncertain/)
  assert.equal(browser.read().pending.kind, 'logout')
})
test('logout freezes old business immediately but waits for rotating refresh then uses its token once', async () => {
  const browser = browserFixture(); const wait = deferred(); let token
  const auth = createAuthSessionManager({ browser, refresh: () => wait.promise })
  auth.setSession(session)
  const refresh = auth.refreshAndRetry({ url: '/api/v1/users/me', method: 'get', __authContext: auth.capture() }, () => { throw Error('must not retry') }).catch(e => e)
  await new Promise(r => setTimeout(r, 0))
  const out = auth.logout(async access => { token = access })
  assert.equal(auth.accessToken(), null)
  wait.resolve(refreshed); await refresh; await out
  assert.equal(token, 'fresh'); assert.equal(auth.state(), 'anonymous')
})

test('403 and unknown 401 reads never refresh or invalidate memory', async () => {
  let refreshes = 0
  const auth = createAuthSessionManager({ browser: browserFixture(), refresh: () => { refreshes++ } }); auth.setSession(session)
  for (const [url, status] of [['/unknown', 401], ['/api/v1/users/me', 403], ['/api/v1/auth/login', 401]]) {
    const response = await authenticatedFetch(auth, url, {}, { fetchImpl: async () => new Response(null, { status }) })
    assert.equal(response.status, status); assert.equal(auth.accessToken(), 'old')
  }
  assert.equal(refreshes, 0)
})
test('download consumption is rejected when identity changes after headers', async () => {
  const auth = createAuthSessionManager({ browser: browserFixture() }); auth.setSession(session)
  const response = await authenticatedFetch(auth, '/api/v1/billing/analytics/export', {}, { fetchImpl: async () => new Response('private') })
  auth.clearSession()
  await assert.rejects(response.blob(), /identity_changed/)
})
test('credential 401 clears its pending operation without ending an existing session', async () => {
  const browser = browserFixture(); const auth = createAuthSessionManager({ browser }); auth.setSession(session)
  await assert.rejects(auth.cookieOperation('password', () => Promise.reject({ response: { status: 401 } })))
  assert.equal(auth.accessToken(), 'old'); assert.equal(browser.read().pending, null)
})
test('invalid cookie response is uncertain with durable pending, never silently resolved', async () => {
  const browser = browserFixture(); const auth = createAuthSessionManager({ browser })
  await assert.rejects(auth.cookieOperation('login', async () => ({})))
  assert.ok(browser.read().pending); assert.equal(browser.read().suppressed, true)
})

test('definite rejected logout suppresses restore and freezes local identity', async () => {
  for (const status of [401, 403]) {
    const browser = browserFixture(); const auth = createAuthSessionManager({ browser }); auth.setSession(session)
    await assert.rejects(auth.logout(async () => { throw { response: { status } } }))
    assert.equal(auth.accessToken(), null); assert.equal(auth.state(), 'uncertain'); assert.equal(browser.read().suppressed, true)
    const reload = createAuthSessionManager({ browser, refresh: () => { throw Error('must not refresh') } })
    assert.equal(await reload.ensureSession(), false)
  }
})
test('other-tab identity-changing pending freezes protected responses', () => {
  const browser = browserFixture(); const auth = createAuthSessionManager({ browser }); auth.setSession(session)
  const context = auth.capture()
  browser.write({ epoch: 'initial', suppressed: false, pending: { operationId: 'other', kind: 'login', epoch: 'initial' } })
  assert.throws(() => auth.assertCurrent(context), /identity_changed/)
})

test('uncertain state is idempotent so rejected requests cannot trigger a remount loop', async () => {
  const browser = browserFixture(); const auth = createAuthSessionManager({ browser }); auth.setSession(session)
  await assert.rejects(auth.logout(async () => { throw { response: { status: 401 } } }))
  const context = auth.capture(); let invalidations = 0
  auth.onInvalidate(() => { invalidations++ })
  for (let i = 0; i < 5; i++) assert.throws(() => auth.assertCurrent(context))
  assert.equal(invalidations, 0)
})

test('five native bypass paths share in-memory Bearer and retain their response types', async () => {
  let refreshes = 0; const calls = []
  const auth = createAuthSessionManager({ browser: browserFixture(), refresh: async () => { refreshes++; return refreshed } }); auth.setSession(session)
  const paths = [
    ['/api/v1/platform/chat/completions', 'POST'], ['/api/v1/platform/chat/compare', 'POST'],
    ['/api/v1/conversations/900/export/markdown', 'GET'], ['/api/v1/billing/analytics/access', 'GET'], ['/api/v1/billing/analytics/export', 'GET'],
  ]
  const responses = await Promise.all(paths.map(([url, method]) => authenticatedFetch(auth, url, { method }, { fetchImpl: async (input, init) => {
    const bearer = init.headers.get('Authorization'); calls.push([input, init.method, bearer])
    if (bearer === 'Bearer old') return new Response(JSON.stringify({ detail: 'Token无效或已过期' }), { status: 401 })
    return new Response(input.endsWith('/access') ? '{"allowed":true}' : 'content')
  } })))
  assert.equal(refreshes, 1)
  assert.deepEqual(responses.slice(0, 2).map(response => response.status), [401, 401])
  assert.equal(calls.filter(([, method]) => method === 'POST').length, 2)
  assert.equal(await responses[2].text(), 'content')
  assert.deepEqual(await responses[3].json(), { allowed: true })
  assert.ok(await responses[4].blob() instanceof Blob)
})

test('a rejected initial login becomes anonymous and cannot trigger automatic restore', async () => {
  let refreshes = 0
  const browser = browserFixture()
  const auth = createAuthSessionManager({ browser, refresh: async () => { refreshes++; return refreshed } })
  assert.equal(auth.state(), 'initializing')
  await assert.rejects(auth.cookieOperation('login', async () => { throw { response: { status: 401 } } }))
  assert.equal(auth.state(), 'anonymous')
  assert.equal(browser.read().pending, null)
  assert.equal(browser.read().suppressed, false)
  assert.equal(await auth.ensureSession(), false)
  assert.equal(refreshes, 0)
})

test('a rejected login does not clear an already authenticated identity', async () => {
  const auth = createAuthSessionManager({ browser: browserFixture() })
  auth.setSession(session)
  await assert.rejects(auth.cookieOperation('login', async () => { throw { response: { status: 401 } } }))
  assert.equal(auth.state(), 'authenticated')
  assert.equal(auth.accessToken(), 'old')
  assert.deepEqual(auth.user(), user)
})
