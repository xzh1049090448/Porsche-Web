import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionRecovery, createSessionRefresh } from './auth-refresh.js'
import { createAuthSessionManager } from './auth-session.js'
import { browserFixture } from './auth-test-browser.js'

test('Mock startup is anonymous with zero backend traffic and no pending pollution, then permits login', async () => {
  let calls = 0
  const browser = browserFixture()
  const auth = createAuthSessionManager({ browser, refresh: createSessionRefresh({ useMock: true, transport: { post: async () => { calls++; throw { response: { status: 503 } } } } }) })
  assert.equal(await auth.ensureSession(), false)
  assert.equal(auth.state(), 'anonymous')
  assert.equal(calls, 0)
  assert.equal(browser.read().pending, null)
  assert.equal(browser.read().suppressed, false)
  await auth.cookieOperation('login', async () => ({ access_token: 'mock-access', token_type: 'Bearer', expires_in: 300, user: { guid: '1', username: 'mock_user', nickname: null, role: 'user', status: 'active' } }), { identityChange: true })
  assert.equal(auth.state(), 'authenticated')
})

test('production refresh still uses the transport and preserves ambiguous failure suppression', async () => {
  let calls = 0
  const browser = browserFixture()
  const auth = createAuthSessionManager({ browser, refresh: createSessionRefresh({ useMock: false, transport: { post: async path => { calls++; assert.equal(path, '/api/v1/auth/refresh'); throw { response: { status: 503 } } } } }) })
  assert.equal(await auth.ensureSession(), false)
  assert.equal(calls, 1)
  assert.equal(auth.state(), 'uncertain')
  assert.ok(browser.read().pending)
  assert.equal(browser.read().suppressed, true)
})

test('recovery transport refreshes and logs out once with the supplied bearer', async () => {
  const calls = []
  const refreshed = {
    access_token: 'fresh', token_type: 'Bearer', expires_in: 300,
    user: { guid: '1', username: 'alice', nickname: null, role: 'user', status: 'active' },
  }
  const transport = {
    post: async (path, body, config) => {
      calls.push([path, body, config])
      return path === '/api/v1/auth/refresh'
        ? { data: refreshed, status: 200 }
        : { data: null, status: 204 }
    },
  }
  const recovery = createSessionRecovery({ useMock: false, transport })

  assert.deepEqual(await recovery.refresh(), refreshed)
  assert.deepEqual(await recovery.logout('temporary-access'), { status: 204 })
  assert.deepEqual(calls, [
    ['/api/v1/auth/refresh', undefined, undefined],
    ['/api/v1/auth/logout', undefined, { headers: { Authorization: 'Bearer temporary-access' } }],
  ])
})

test('mock recovery keeps synthetic refresh 401 and rejects logout without transport traffic', async () => {
  const calls = []
  const recovery = createSessionRecovery({
    useMock: true,
    transport: { post: async (...args) => { calls.push(args); return { status: 204 } } },
  })

  await assert.rejects(recovery.refresh(), error => error.response?.status === 401)
  await assert.rejects(recovery.logout('must-not-be-sent'), error => error.code === 'auth_recovery_unsupported')
  assert.deepEqual(calls, [])
})
