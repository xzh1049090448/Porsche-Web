import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthSessionManager, authenticatedFetch, isSafeAuthRead } from './auth-session.js'

import { browserFixture } from './auth-test-browser.js'
const user = { guid: '100', username: 'alice', nickname: null, role: 'user', status: 'active' }
const session = { accessToken: 'old', user }
const refreshed = { access_token: 'fresh', token_type: 'Bearer', expires_in: 300, user }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const pendingRecord = (browser, kind, extra = {}) => browser.write({
  epoch: 'initial',
  pending: { operationId: `${kind}-pending`, kind, epoch: 'initial' },
  suppressed: true,
  ...extra,
})
const sharedBrowserTabs = (initialRecord) => {
  let record = structuredClone(initialRecord)
  let queue = Promise.resolve()
  let nextId = 0
  const tabs = new Set()
  const messages = []
  const createTab = () => {
    const subscribers = new Set()
    const tab = {
      get available() { return true },
      probe: () => ({ available: true, code: null }),
      read: () => structuredClone(record),
      write: next => { record = structuredClone(next) },
      lock: fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next },
      publish: message => {
        messages.push(structuredClone(message))
        for (const peer of tabs) {
          if (peer === tab) continue
          for (const subscriber of peer.subscribers) subscriber(structuredClone(message))
        }
      },
      subscribe: fn => { subscribers.add(fn); return () => subscribers.delete(fn) },
      id: () => `shared-operation-${++nextId}`,
      subscribers,
    }
    tabs.add(tab)
    return tab
  }
  return { createTab, messages, read: () => structuredClone(record) }
}

test('POST generation 401 is returned once without refresh or clearing identity', async () => {
  let refreshes = 0; let requests = 0
  const auth = createAuthSessionManager({ browser: browserFixture(), refresh: async () => { refreshes++; return refreshed } })
  auth.setSession(session)
  const res = await authenticatedFetch(auth, '/api/v1/platform/chat/completions', { method: 'POST' }, { fetchImpl: async () => { requests++; return new Response(null, { status: 401 }) } })
  assert.equal(res.status, 401); assert.equal(requests, 1); assert.equal(refreshes, 0); assert.equal(auth.accessToken(), 'old')
})
test('only exact owner-bound generation GET is eligible for auth refresh', () => {
  const generation = '550e8400-e29b-41d4-a716-446655440000'
  const path = `/api/v1/platform/chat/generations/${generation}`
  assert.equal(isSafeAuthRead(path, 'GET'), true)
  assert.equal(isSafeAuthRead(`${path}/cancel`, 'GET'), false)
  assert.equal(isSafeAuthRead(path, 'POST'), false)
  assert.equal(isSafeAuthRead(`${path}/extra`, 'GET'), false)
  assert.equal(isSafeAuthRead('/api/v1/platform/chat/generations/', 'GET'), false)
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
test('logout uncertainty without a recovery callback remains persistent and does not restore identity', async () => {
  const browser = browserFixture(); const auth = createAuthSessionManager({ browser })
  auth.setSession(session)
  await assert.rejects(auth.logout(async () => { throw new TypeError('network failure') }))
  assert.equal(auth.accessToken(), null); assert.equal(auth.state(), 'uncertain')
  assert.equal(browser.read().pending.kind, 'logout')
  let refreshes = 0
  const reload = createAuthSessionManager({ browser, refresh: async () => { refreshes++; return refreshed } })
  assert.equal(await reload.ensureSession(), false); assert.equal(refreshes, 0)
  await assert.rejects(reload.recover())
  assert.equal(refreshes, 1)
  assert.equal(reload.authIssue(), 'auth_uncertain')
  assert.equal(browser.read().pending.kind, 'logout')
})

test('logout uncertainty refreshes only to complete logout and never publishes credentials', async () => {
  const browser = browserFixture(); pendingRecord(browser, 'logout')
  const original = browser.read(); const snapshots = []; let refreshes = 0; let logoutToken; let logouts = 0
  const auth = createAuthSessionManager({
    browser,
    refresh: async () => { refreshes++; return { ...refreshed, user: { ...user, private_note: 'secret' } } },
    recoverLogout: async token => { logouts++; logoutToken = token; return { status: 204 } },
  })
  auth.subscribe(snapshot => snapshots.push(structuredClone(snapshot)))

  assert.deepEqual(await auth.recover(), { state: 'anonymous' })
  const record = browser.read()
  assert.equal(refreshes, 1)
  assert.equal(logouts, 1)
  assert.equal(logoutToken, 'fresh')
  assert.equal(auth.state(), 'anonymous')
  assert.equal(auth.authIssue(), null)
  assert.equal(auth.accessToken(), null)
  assert.equal(auth.user(), null)
  assert.deepEqual(record, { epoch: record.epoch, pending: null, suppressed: false })
  assert.notEqual(record.epoch, original.epoch)
  assert.deepEqual(browser.messages, [{ type: 'invalidate', epoch: record.epoch }])
  assert.ok(snapshots.length > 0)
  assert.ok(snapshots.every(snapshot => snapshot.accessToken === null && snapshot.user === null))
})

test('legacy suppressed logout uncertainty settles anonymous on refresh 401 without logout', async () => {
  const browser = browserFixture()
  browser.write({ epoch: 'legacy-epoch', pending: null, suppressed: true })
  let refreshes = 0; let logouts = 0
  const auth = createAuthSessionManager({
    browser,
    refresh: async () => { refreshes++; throw { response: { status: 401 } } },
    recoverLogout: async () => { logouts++ },
  })

  assert.deepEqual(await auth.recover(), { state: 'anonymous' })
  const record = browser.read()
  assert.equal(refreshes, 1)
  assert.equal(logouts, 0)
  assert.deepEqual(record, { epoch: record.epoch, pending: null, suppressed: false })
  assert.notEqual(record.epoch, 'legacy-epoch')
  assert.equal(auth.state(), 'anonymous')
  assert.equal(auth.accessToken(), null)
  assert.equal(auth.user(), null)
})

test('non-session mutation uncertainty is unsupported without refresh or logout traffic', async () => {
  for (const kind of ['password', 'revoke-session', 'revoke-others', 'unknown']) {
    const browser = browserFixture()
    browser.write({
      epoch: 'unsupported-epoch',
      pending: { operationId: `${kind}-pending`, kind, epoch: 'unsupported-epoch' },
      suppressed: true,
    })
    const original = browser.read(); let refreshes = 0; let logouts = 0
    const auth = createAuthSessionManager({
      browser,
      refresh: async () => { refreshes++; return refreshed },
      recoverLogout: async () => { logouts++; return { status: 204 } },
    })
    await assert.rejects(auth.recover(), error => error.code === 'auth_recovery_unsupported', kind)
    assert.equal(refreshes, 0, kind)
    assert.equal(logouts, 0, kind)
    assert.deepEqual(browser.read(), original, kind)
  }
})

test('logout uncertainty refresh 401 settles anonymous without calling logout', async () => {
  const browser = browserFixture(); pendingRecord(browser, 'logout')
  let refreshes = 0; let logouts = 0
  const auth = createAuthSessionManager({
    browser,
    refresh: async () => { refreshes++; throw { status: 401 } },
    recoverLogout: async () => { logouts++; return { status: 204 } },
  })
  assert.deepEqual(await auth.recover(), { state: 'anonymous' })
  assert.equal(refreshes, 1)
  assert.equal(logouts, 0)
  assert.equal(auth.state(), 'anonymous')
  assert.equal(auth.accessToken(), null)
  assert.equal(auth.user(), null)
})

test('logout uncertainty retains its marker for refresh-success logout failures and invalid refresh', async () => {
  const logoutFailures = [
    ['missing callback', null],
    ['logout 401', async () => { throw { response: { status: 401 } } }],
    ['logout 403', async () => { throw { response: { status: 403 } } }],
    ['logout 422', async () => { throw { response: { status: 422 } } }],
    ['logout 408', async () => { throw { response: { status: 408 } } }],
    ['logout 500', async () => { throw { response: { status: 500 } } }],
    ['timeout', async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) }],
    ['cancel', async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }) }],
    ['network', async () => { throw new TypeError('network failure') }],
    ['status 200', async () => ({ status: 200 })],
    ['status 202', async () => ({ status: 202 })],
    ['status 401 response', async () => ({ status: 401 })],
    ['invalid result', async () => ({})],
  ]
  for (const [name, recoverLogout] of logoutFailures) {
    const browser = browserFixture(); pendingRecord(browser, 'logout')
    const original = browser.read(); let refreshes = 0; let logouts = 0
    const options = {
      browser,
      refresh: async () => { refreshes++; return refreshed },
      ...(recoverLogout ? { recoverLogout: async token => { logouts++; assert.equal(token, 'fresh'); return recoverLogout() } } : {}),
    }
    const auth = createAuthSessionManager(options)
    await assert.rejects(auth.recover(), undefined, name)
    assert.equal(refreshes, 1, name)
    assert.equal(logouts, recoverLogout ? 1 : 0, name)
    assert.deepEqual(browser.read(), original, name)
    assert.equal(auth.state(), 'uncertain', name)
    assert.equal(auth.authIssue(), 'auth_uncertain', name)
    assert.equal(auth.accessToken(), null, name)
    assert.equal(auth.user(), null, name)
    assert.deepEqual(browser.messages, [], name)
    assert.equal(await auth.ensureSession(), false, name)
    assert.equal(refreshes, 1, `${name} must not loop automatically`)
  }

  const browser = browserFixture(); pendingRecord(browser, 'logout')
  const original = browser.read(); let refreshes = 0; let logouts = 0
  const auth = createAuthSessionManager({
    browser,
    refresh: async () => { refreshes++; return {} },
    recoverLogout: async () => { logouts++; return { status: 204 } },
  })
  await assert.rejects(auth.recover(), error => error.code === 'auth_invalid_response')
  assert.equal(refreshes, 1)
  assert.equal(logouts, 0)
  assert.deepEqual(browser.read(), original)
})

test('logout uncertainty retries only on a second explicit recover and can then converge', async () => {
  const browser = browserFixture(); pendingRecord(browser, 'logout')
  let refreshes = 0; let logouts = 0
  const auth = createAuthSessionManager({
    browser,
    refresh: async () => { refreshes++; return refreshed },
    recoverLogout: async () => ({ status: ++logouts === 1 ? 200 : 204 }),
  })

  await assert.rejects(auth.recover())
  assert.equal(refreshes, 1)
  assert.equal(logouts, 1)
  assert.deepEqual(await auth.recover(), { state: 'anonymous' })
  assert.equal(refreshes, 2)
  assert.equal(logouts, 2)
})

test('logout uncertainty fails closed when its durable record drifts or cannot settle', async () => {
  for (const failureMode of ['record-drift', 'read-failure', 'write-failure']) {
    const browser = browserFixture(); pendingRecord(browser, 'logout')
    const original = browser.read(); const read = browser.read; const write = browser.write
    let failRead = false
    if (failureMode === 'read-failure') browser.read = () => {
      if (failRead) { failRead = false; throw new Error('storage read denied') }
      return read()
    }
    if (failureMode === 'write-failure') browser.write = next => {
      if (next.pending === null) throw new Error('storage write denied')
      write(next)
    }
    const auth = createAuthSessionManager({
      browser,
      refresh: async () => refreshed,
      recoverLogout: async () => {
        if (failureMode === 'record-drift') write({ ...original, pending: { ...original.pending, operationId: 'other-operation' } })
        if (failureMode === 'read-failure') failRead = true
        return { status: 204 }
      },
    })
    await assert.rejects(auth.recover(), undefined, failureMode)
    assert.equal(auth.state(), 'uncertain', failureMode)
    assert.equal(auth.accessToken(), null, failureMode)
    assert.equal(auth.user(), null, failureMode)
    assert.deepEqual(browser.messages, [], failureMode)
    if (failureMode === 'record-drift') assert.equal(browser.read().pending.operationId, 'other-operation')
    else assert.deepEqual(browser.read(), original)
  }
})

test('two managers recover logout once and both settle anonymous without credential publication', async () => {
  const shared = sharedBrowserTabs({
    epoch: 'logout-epoch',
    pending: { operationId: 'logout-pending', kind: 'logout', epoch: 'logout-epoch' },
    suppressed: true,
  })
  let refreshes = 0; let logouts = 0
  const makeManager = () => createAuthSessionManager({
    browser: shared.createTab(),
    refresh: async () => { refreshes++; return refreshed },
    recoverLogout: async token => { logouts++; assert.equal(token, 'fresh'); return { status: 204 } },
  })
  const first = makeManager(); const peer = makeManager()
  const firstSnapshots = []; const peerSnapshots = []
  first.subscribe(snapshot => firstSnapshots.push(structuredClone(snapshot)))
  peer.subscribe(snapshot => peerSnapshots.push(structuredClone(snapshot)))

  const firstRecovery = first.recover(); const peerRecovery = peer.recover()
  const [firstResult, peerResult] = await Promise.all([firstRecovery, peerRecovery])
  assert.deepEqual(firstResult, { state: 'anonymous' })
  assert.deepEqual(peerResult, { state: 'anonymous', settledElsewhere: true })
  assert.equal(refreshes, 1)
  assert.equal(logouts, 1)
  assert.equal(first.state(), 'anonymous')
  assert.equal(peer.state(), 'anonymous')
  assert.equal(first.authIssue(), null)
  assert.equal(peer.authIssue(), null)
  assert.equal(first.accessToken(), null)
  assert.equal(peer.accessToken(), null)
  assert.equal(first.user(), null)
  assert.equal(peer.user(), null)
  assert.ok(firstSnapshots.length > 0)
  assert.ok(peerSnapshots.length > 0)
  assert.ok([...firstSnapshots, ...peerSnapshots].every(snapshot => snapshot.accessToken === null && snapshot.user === null))
  assert.ok(shared.messages.every(message => !('accessToken' in message) && !('user' in message)))
  const record = shared.read()
  assert.deepEqual(record, { epoch: record.epoch, pending: null, suppressed: false })
  assert.deepEqual(shared.messages, [{ type: 'invalidate', epoch: record.epoch }])
})

test('login and refresh uncertainty recover through one authoritative refresh', async () => {
  for (const kind of ['login', 'refresh']) {
    const browser = browserFixture(); pendingRecord(browser, kind)
    let refreshes = 0; let snapshotInvalidations = 0
    const auth = createAuthSessionManager({ browser, refresh: async () => {
      refreshes++
      return { ...refreshed, user: { ...user, private_note: 'must-not-publish' } }
    } })
    assert.equal(auth.authIssue(), 'auth_uncertain')
    auth.onSnapshotInvalidate(() => { snapshotInvalidations++ })
    const snapshots = []; auth.subscribe(snapshot => snapshots.push(snapshot))
    assert.deepEqual(await auth.recover(), { state: 'authenticated' })
    const record = browser.read()
    assert.equal(refreshes, 1)
    assert.equal(auth.state(), 'authenticated')
    assert.equal(auth.authIssue(), null)
    assert.equal(auth.accessToken(), 'fresh')
    assert.deepEqual(auth.user(), user)
    assert.deepEqual(record, { epoch: record.epoch, pending: null, suppressed: false })
    assert.notEqual(record.epoch, 'initial')
    assert.equal(snapshotInvalidations, 1)
    assert.deepEqual(browser.messages, [{ type: 'invalidate', epoch: record.epoch }])
    assert.equal(snapshots.at(-1).issue, null)
  }
})

test('authoritative refresh 401 settles login uncertainty as anonymous', async () => {
  const browser = browserFixture(); pendingRecord(browser, 'login')
  const auth = createAuthSessionManager({
    browser,
    refresh: async () => { throw { response: { status: 401 } } },
  })
  assert.deepEqual(await auth.recover(), { state: 'anonymous' })
  const record = browser.read()
  assert.equal(auth.state(), 'anonymous')
  assert.equal(auth.authIssue(), null)
  assert.equal(auth.accessToken(), null)
  assert.equal(auth.user(), null)
  assert.deepEqual(record, { epoch: record.epoch, pending: null, suppressed: false })
  assert.notEqual(record.epoch, 'initial')
  assert.deepEqual(browser.messages, [{ type: 'invalidate', epoch: record.epoch }])
})

test('uncertainty recovery failures preserve authoritative markers and publish no identity', async () => {
  const cases = [
    ['refresh 403', async () => { throw { response: { status: 403 } } }],
    ['refresh 408', async () => { throw { response: { status: 408 } } }],
    ['refresh 500', async () => { throw { response: { status: 500 } } }],
    ['network error', async () => { throw new TypeError('network failure') }],
    ['cancel error', async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }) }],
    ['invalid LoginResponse', async () => ({})],
  ]
  for (const [name, refresh] of cases) {
    const browser = browserFixture(); pendingRecord(browser, 'refresh')
    const original = browser.read(); let calls = 0
    const auth = createAuthSessionManager({ browser, refresh: async () => { calls++; return refresh() } })
    await assert.rejects(auth.recover(), name)
    assert.deepEqual(browser.read(), original, name)
    assert.equal(calls, 1, name)
    assert.equal(auth.state(), 'uncertain', name)
    assert.equal(auth.authIssue(), 'auth_uncertain', name)
    assert.equal(auth.accessToken(), null, name)
    assert.equal(auth.user(), null, name)
    assert.deepEqual(browser.messages, [], name)
    assert.equal(await auth.ensureSession(), false, name)
    assert.equal(calls, 1, `${name} must not retry automatically`)
  }
})

test('uncertainty recovery fails closed on durable-write failure and record or epoch drift', async () => {
  for (const drift of ['storage-write', 'record', 'epoch']) {
    const browser = browserFixture(); pendingRecord(browser, 'login')
    const original = browser.read(); const write = browser.write; let calls = 0
    if (drift === 'storage-write') {
      browser.write = next => {
        if (next.pending === null) throw new Error('storage denied')
        write(next)
      }
    }
    const auth = createAuthSessionManager({ browser, refresh: async () => {
      calls++
      if (drift === 'record') write({ ...original, pending: { ...original.pending, operationId: 'other-operation' } })
      if (drift === 'epoch') write({ epoch: 'other-epoch', pending: null, suppressed: false })
      return refreshed
    } })
    const error = await auth.recover().catch(value => value)
    if (drift === 'storage-write') assert.match(error.message, /storage denied/)
    else assert.equal(error.code, 'identity_changed')
    assert.equal(calls, 1)
    assert.equal(auth.state(), 'uncertain')
    assert.equal(auth.authIssue(), 'auth_uncertain')
    assert.equal(auth.accessToken(), null)
    assert.equal(auth.user(), null)
    assert.deepEqual(browser.messages, [])
    if (drift === 'storage-write') assert.deepEqual(browser.read(), original)
    if (drift === 'record') assert.equal(browser.read().pending.operationId, 'other-operation')
    if (drift === 'epoch') assert.deepEqual(browser.read(), { epoch: 'other-epoch', pending: null, suppressed: false })
  }
})

test('recover probes capability before network and reports changing issues while already uncertain', async () => {
  const base = browserFixture(); let available = false; let code = 'auth_storage_unavailable'; let calls = 0
  const browser = {
    ...base,
    get available() { return available },
    capabilityCode: () => code,
    probe: () => ({ available, code }),
  }
  const auth = createAuthSessionManager({ browser, refresh: async () => { calls++; return refreshed } })
  const snapshots = []; auth.subscribe(snapshot => snapshots.push(snapshot))
  await assert.rejects(auth.recover(), error => error.code === 'auth_storage_unavailable')
  code = 'auth_web_locks_unavailable'
  await assert.rejects(auth.recover(), error => error.code === 'auth_web_locks_unavailable')
  assert.equal(calls, 0)
  assert.equal(auth.authIssue(), 'auth_web_locks_unavailable')
  assert.equal(snapshots.at(-1).issue, 'auth_web_locks_unavailable')
  auth.setSession(session)
  assert.equal(auth.authIssue(), null)
  assert.equal(snapshots.at(-1).issue, null)
})

test('recovery lock failure remains uncertain with an observable issue', async () => {
  const base = browserFixture(); pendingRecord(base, 'login')
  const browser = { ...base, lock: async () => { throw new Error('lock denied') } }
  const auth = createAuthSessionManager({ browser, refresh: async () => assert.fail('must not refresh') })
  await assert.rejects(auth.recover(), /lock denied/)
  assert.equal(auth.state(), 'uncertain')
  assert.equal(auth.authIssue(), 'auth_uncertain')
})

test('a restored capability recovers a clean uncertain record as refresh', async () => {
  const base = browserFixture(); let available = false; let calls = 0
  const browser = {
    ...base,
    get available() { return available },
    capabilityCode: () => available ? null : 'auth_storage_unavailable',
    probe: () => { available = true; return { available: true, code: null } },
  }
  const auth = createAuthSessionManager({ browser, refresh: async () => { calls++; return refreshed } })
  assert.equal(auth.authIssue(), 'auth_storage_unavailable')
  assert.deepEqual(await auth.recover(), { state: 'authenticated' })
  assert.equal(calls, 1)
})

test('recovery adopts a clean epoch already settled by another tab without network', async () => {
  const browser = browserFixture(); pendingRecord(browser, 'refresh')
  let calls = 0
  const auth = createAuthSessionManager({ browser, refresh: async () => { calls++ } })
  browser.write({ epoch: 'settled-elsewhere', pending: null, suppressed: false })
  assert.deepEqual(await auth.recover(), { state: 'anonymous', settledElsewhere: true })
  assert.equal(auth.state(), 'anonymous')
  assert.equal(auth.capture().epoch, 'settled-elsewhere')
  assert.equal(calls, 0)
  assert.deepEqual(browser.messages, [])
})

test('concurrent uncertainty recovery is single-flight', async () => {
  const browser = browserFixture(); pendingRecord(browser, 'login')
  const wait = deferred(); let calls = 0
  const auth = createAuthSessionManager({ browser, refresh: () => { calls++; return wait.promise } })
  const first = auth.recover(); const second = auth.recover()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls, 1)
  wait.resolve(refreshed)
  assert.deepEqual(await Promise.all([first, second]), [{ state: 'authenticated' }, { state: 'authenticated' }])
  assert.equal(calls, 1)
})

test('prompt cross-tab invalidate preserves settled-elsewhere recovery', async () => {
  const shared = sharedBrowserTabs({
    epoch: 'unresolved-epoch',
    pending: { operationId: 'login-pending', kind: 'login', epoch: 'unresolved-epoch' },
    suppressed: true,
  })
  const firstBrowser = shared.createTab(); const peerBrowser = shared.createTab(); let refreshes = 0
  const first = createAuthSessionManager({ browser: firstBrowser, refresh: async () => { refreshes++; return refreshed } })
  const peer = createAuthSessionManager({ browser: peerBrowser, refresh: async () => { refreshes++; return refreshed } })
  const firstRecovery = first.recover(); const peerRecovery = peer.recover()
  assert.deepEqual(await firstRecovery, { state: 'authenticated' })
  assert.deepEqual(await peerRecovery, { state: 'anonymous', settledElsewhere: true })
  assert.equal(refreshes, 1)
  assert.equal(first.state(), 'authenticated')
  assert.equal(first.accessToken(), 'fresh')
  assert.deepEqual(first.user(), user)
  assert.equal(peer.state(), 'anonymous')
  assert.equal(peer.authIssue(), null)
  assert.equal(peer.accessToken(), null)
  assert.equal(peer.user(), null)
  const record = shared.read()
  assert.deepEqual(record, { epoch: record.epoch, pending: null, suppressed: false })
  assert.notEqual(record.epoch, 'unresolved-epoch')
  assert.deepEqual(shared.messages, [{ type: 'invalidate', epoch: record.epoch }])
})

test('runtime login and refresh uncertainty retain settled-elsewhere evidence', async () => {
  for (const kind of ['login', 'refresh']) {
    const shared = sharedBrowserTabs({ epoch: 'clean-epoch', pending: null, suppressed: false })
    const firstBrowser = shared.createTab(); let originalCalls = 0; let recoveryCalls = 0
    const first = createAuthSessionManager({ browser: firstBrowser, refresh: async () => { recoveryCalls++; return refreshed } })
    await assert.rejects(first.cookieOperation(kind, async () => {
      originalCalls++
      throw new TypeError('network failure')
    }), /network failure/)
    assert.equal(first.state(), 'uncertain')
    assert.equal(shared.read().pending.kind, kind)

    const peerBrowser = shared.createTab()
    const peer = createAuthSessionManager({ browser: peerBrowser, refresh: async () => { recoveryCalls++; return refreshed } })
    assert.deepEqual(await peer.recover(), { state: 'authenticated' })
    assert.equal(first.state(), 'uncertain')
    assert.deepEqual(await first.recover(), { state: 'anonymous', settledElsewhere: true })
    assert.equal(originalCalls, 1)
    assert.equal(recoveryCalls, 1)
    assert.equal(peer.state(), 'authenticated')
    assert.equal(peer.accessToken(), 'fresh')
    assert.equal(first.state(), 'anonymous')
    assert.equal(first.authIssue(), null)
    assert.equal(first.accessToken(), null)
    assert.equal(first.user(), null)
    const record = shared.read()
    assert.deepEqual(record, { epoch: record.epoch, pending: null, suppressed: false })
    assert.deepEqual(shared.messages, [{ type: 'invalidate', epoch: record.epoch }])
  }
})

test('pending epoch survives a transient post-request read failure', async () => {
  for (const kind of ['login', 'refresh']) {
    const shared = sharedBrowserTabs({ epoch: 'clean-epoch', pending: null, suppressed: false })
    const firstBrowser = shared.createTab(); const read = firstBrowser.read
    let failNextRead = false; let originalCalls = 0; let recoveryCalls = 0
    firstBrowser.read = () => {
      if (failNextRead) { failNextRead = false; throw new Error('transient storage read failure') }
      return read()
    }
    const first = createAuthSessionManager({ browser: firstBrowser, refresh: async () => { recoveryCalls++; return refreshed } })
    await assert.rejects(first.cookieOperation(kind, async () => {
      originalCalls++
      failNextRead = true
      throw new TypeError('ambiguous request failure')
    }), /transient storage read failure/)
    assert.equal(first.state(), 'uncertain')
    assert.equal(shared.read().pending.kind, kind)
    assert.equal(shared.read().suppressed, false)

    const peer = createAuthSessionManager({
      browser: shared.createTab(),
      refresh: async () => { recoveryCalls++; return refreshed },
    })
    assert.deepEqual(await peer.recover(), { state: 'authenticated' })
    assert.deepEqual(await first.recover(), { state: 'anonymous', settledElsewhere: true })
    assert.equal(originalCalls, 1)
    assert.equal(recoveryCalls, 1)
    assert.equal(first.state(), 'anonymous')
    assert.equal(first.authIssue(), null)
    assert.equal(first.accessToken(), null)
    assert.equal(first.user(), null)
    const record = shared.read()
    assert.deepEqual(record, { epoch: record.epoch, pending: null, suppressed: false })
    assert.deepEqual(shared.messages, [{ type: 'invalidate', epoch: record.epoch }])
  }
})

test('runtime unsupported operation markers never use refresh recovery', async () => {
  for (const kind of ['password', 'revoke-session']) {
    const browser = browserFixture(); let refreshes = 0
    const auth = createAuthSessionManager({ browser, refresh: async () => { refreshes++; return refreshed } })
    await assert.rejects(auth.cookieOperation(kind, async () => { throw new TypeError('network failure') }), /network failure/)
    await assert.rejects(auth.recover(), error => error.code === 'auth_recovery_unsupported')
    assert.equal(browser.read().pending.kind, kind)
    assert.equal(auth.state(), 'uncertain')
    assert.equal(auth.accessToken(), null)
    assert.equal(auth.user(), null)
    assert.equal(refreshes, 0)
  }
})

test('malformed uncertainty records are unsupported without network', async () => {
  const browser = browserFixture()
  browser.write({ epoch: 'initial', pending: { operationId: 'bad', kind: 'login', epoch: 'other' }, suppressed: true })
  let calls = 0; let logouts = 0
  const auth = createAuthSessionManager({
    browser,
    refresh: async () => { calls++ },
    recoverLogout: async () => { logouts++ },
  })
  await assert.rejects(auth.recover(), error => error.code === 'auth_recovery_unsupported')
  assert.equal(calls, 0)
  assert.equal(logouts, 0)
  assert.equal(auth.authIssue(), 'auth_recovery_unsupported')
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
