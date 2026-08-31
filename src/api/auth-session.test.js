import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthSessionManager, sessionRows } from './auth-session.js'
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
