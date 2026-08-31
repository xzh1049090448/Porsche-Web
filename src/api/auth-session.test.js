import test from 'node:test'
import assert from 'node:assert/strict'
import { authenticatedFetch, createAuthSessionManager, sessionRows, sessionUser } from './auth-session.js'
import { readFile } from 'node:fs/promises'

test('auth session remains in memory and never writes browser storage', () => {
  const writes = []
  const originalLocalStorage = globalThis.localStorage
  const originalSessionStorage = globalThis.sessionStorage
  globalThis.localStorage = { setItem: (...args) => writes.push(['local', ...args]) }
  globalThis.sessionStorage = { setItem: (...args) => writes.push(['session', ...args]) }

  try {
    const auth = createAuthSessionManager()
    auth.setSession({ accessToken: 'access-secret', user: { guid: '100', username: 'alice' } })
    assert.equal(auth.accessToken(), 'access-secret')
    assert.deepEqual(auth.user(), { guid: '100', username: 'alice' })
    assert.deepEqual(writes, [])
  } finally {
    globalThis.localStorage = originalLocalStorage
    globalThis.sessionStorage = originalSessionStorage
  }
})

test('concurrent unauthorized requests share one refresh and each retry once', async () => {
  let refreshes = 0
  let retries = 0
  const auth = createAuthSessionManager({
    refresh: async () => {
      refreshes += 1
      return { access_token: 'rotated-access', user: { guid: '100', username: 'alice' } }
    },
  })
  auth.setSession({ accessToken: 'expired', user: { guid: '100', username: 'alice' } })

  const retry = async (config) => {
    retries += 1
    assert.equal(config.headers.Authorization, 'Bearer rotated-access')
    return { ok: true }
  }
  const [first, second] = await Promise.all([
    auth.refreshAndRetry({ headers: {} }, retry),
    auth.refreshAndRetry({ headers: {} }, retry),
  ])

  assert.deepEqual(first, { ok: true })
  assert.deepEqual(second, { ok: true })
  assert.equal(refreshes, 1)
  assert.equal(retries, 2)
})

test('failed refresh clears only in-memory identity', async () => {
  const auth = createAuthSessionManager({ refresh: async () => { throw new Error('expired') } })
  auth.setSession({ accessToken: 'expired', user: { guid: '100', username: 'alice' } })

  await assert.rejects(auth.refreshAndRetry({ headers: {} }, async () => ({ ok: true })), /expired/)
  assert.equal(auth.accessToken(), null)
  assert.equal(auth.user(), null)
})

test('authenticated fetch shares one refresh, reinjects the rotated Bearer token, and retries each request once', async () => {
  let refreshes = 0
  const seenAuthorizations = []
  const auth = createAuthSessionManager({
    refresh: async () => ({ access_token: `fresh-${++refreshes}`, user: { guid: '100', username: 'alice', role: 1, status: 1 } }),
  })
  auth.setSession({ accessToken: 'expired', user: { guid: '100', username: 'alice', role: 1, status: 1 } })

  const fetchImpl = async (_url, init) => {
    const authorization = new Headers(init.headers).get('Authorization')
    seenAuthorizations.push(authorization)
    return new Response(null, { status: authorization === 'Bearer expired' ? 401 : 200 })
  }
  const [stream, exported, analytics] = await Promise.all([
    authenticatedFetch(auth, '/stream', { method: 'POST' }, { fetchImpl }),
    authenticatedFetch(auth, '/export', {}, { fetchImpl }),
    authenticatedFetch(auth, '/analytics', {}, { fetchImpl }),
  ])

  assert.equal(stream.status, 200)
  assert.equal(exported.status, 200)
  assert.equal(analytics.status, 200)
  assert.equal(refreshes, 1)
  assert.deepEqual(seenAuthorizations.sort(), ['Bearer expired', 'Bearer expired', 'Bearer expired', 'Bearer fresh-1', 'Bearer fresh-1', 'Bearer fresh-1'].sort())
})

test('authenticated fetch clears memory and redirects once when refresh fails without retrying the original request', async () => {
  let requests = 0
  let redirects = 0
  const auth = createAuthSessionManager({ refresh: async () => { throw new Error('expired') } })
  auth.setSession({ accessToken: 'expired', user: { guid: '100', username: 'alice' } })

  await assert.rejects(
    authenticatedFetch(auth, '/stream', {}, {
      fetchImpl: async () => { requests += 1; return new Response(null, { status: 401 }) },
      onUnauthorized: async () => { redirects += 1 },
    }),
    /expired/
  )
  assert.equal(requests, 1)
  assert.equal(redirects, 1)
  assert.equal(auth.accessToken(), null)
  assert.equal(auth.user(), null)
})

test('authenticated fetch never refreshes an auth endpoint or retries a second 401', async () => {
  let refreshes = 0
  let requests = 0
  let redirects = 0
  const auth = createAuthSessionManager({ refresh: async () => ({ access_token: `fresh-${++refreshes}`, user: { guid: '100' } }) })
  auth.setSession({ accessToken: 'expired', user: { guid: '100' } })

  const authResponse = await authenticatedFetch(auth, '/api/v1/auth/refresh', {}, {
    fetchImpl: async () => { requests += 1; return new Response(null, { status: 401 }) },
    onUnauthorized: async () => { redirects += 1 },
  })
  assert.equal(authResponse.status, 401)
  assert.equal(refreshes, 0)

  await assert.rejects(authenticatedFetch(auth, '/protected', {}, {
    fetchImpl: async () => { requests += 1; return new Response(null, { status: 401 }) },
    onUnauthorized: async () => { redirects += 1 },
  }), /unauthorized/)
  assert.equal(refreshes, 1)
  assert.equal(requests, 3)
  assert.equal(redirects, 1)
})

test('session user whitelist excludes server-only and unexpected fields', () => {
  assert.deepEqual(sessionUser({
    guid: '100', username: 'alice', nickname: 'Alice', role: 1, status: 1,
    password_hash: 'must-not-leak', phone: 'must-not-leak', is_admin: true, id: 7,
  }), { guid: '100', username: 'alice', nickname: 'Alice', role: 1, status: 1 })
})

test('SSE, conversation export, and analytics native requests use the shared authenticated fetch path', async () => {
  const [platform, conversations, analytics] = await Promise.all([
    readFile(new URL('./platform.js', import.meta.url), 'utf8'),
    readFile(new URL('./conversations.js', import.meta.url), 'utf8'),
    readFile(new URL('./modelAnalytics.js', import.meta.url), 'utf8'),
  ])

  assert.equal((platform.match(/authenticatedFetch\(/g) || []).length, 2)
  assert.match(platform, /chat\/completions/)
  assert.match(platform, /chat\/compare/)
  assert.match(conversations, /authenticatedFetch\(/)
  assert.match(conversations, /export\/markdown/)
  assert.equal((analytics.match(/authenticatedFetch\(/g) || []).length, 2)
  assert.match(analytics, /\/access/)
  assert.match(analytics, /\/export/)
  for (const source of [platform, conversations, analytics]) {
    assert.doesNotMatch(source, /getAuthToken\(/)
  }
})

test('session rows expose only the browser-safe DTO fields', () => {
  assert.deepEqual(sessionRows([{
    guid: '900', login_method: 'password', ip: '203.0.113.8', user_agent: 'Browser',
    created_at: '2026-08-28T00:00:00Z', last_active_at: '2026-08-28T00:01:00Z',
    expires_at: '2026-09-28T00:00:00Z', current: true, sid: 'must-not-leak', refresh_token: 'must-not-leak', id: 7,
  }]), [{
    guid: '900', loginMethod: 'password', ip: '203.0.113.8', userAgent: 'Browser',
    createdAt: '2026-08-28T00:00:00Z', lastActiveAt: '2026-08-28T00:01:00Z',
    expiresAt: '2026-09-28T00:00:00Z', current: true,
  }])
})

test('auth API only calls the username and revocable-session contract', async () => {
  const source = await readFile(new URL('./auth.js', import.meta.url), 'utf8')
  assert.match(source, /\/register/)
  assert.match(source, /\/login/)
  assert.match(source, /\/refresh/)
  assert.match(source, /\/logout/)
  assert.match(source, /\/sessions/)
  assert.doesNotMatch(source, /send-code|login\/password|login\/code|localStorage|sessionStorage|porsche_refresh/)
})
