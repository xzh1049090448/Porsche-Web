import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionRefresh } from './auth-refresh.js'
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
