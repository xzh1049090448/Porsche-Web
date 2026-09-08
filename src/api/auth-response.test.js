import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthSessionManager } from './auth-session.js'
import { browserFixture } from './auth-test-browser.js'

const valid = () => ({ access_token: 'access', token_type: 'Bearer', expires_in: 300, user: { guid: '100', username: 'alice', nickname: null, role: 'user', status: 'active' } })
test('login and refresh validate the complete response before resolving their pending marker', async () => {
  const malformed = [
    () => ({ access_token: 'x', user: {} }),
    value => ({ ...value, access_token: 5 }), value => ({ ...value, access_token: ' ' }),
    value => ({ ...value, token_type: 'Basic' }), value => ({ ...value, expires_in: 0 }), value => ({ ...value, expires_in: 1.5 }),
    value => ({ ...value, user: { ...value.user, guid: 100 } }), value => ({ ...value, user: { ...value.user, guid: '0' } }),
    value => ({ ...value, user: { ...value.user, username: undefined } }), value => ({ ...value, user: { ...value.user, nickname: 5 } }),
    value => ({ ...value, user: { ...value.user, role: 1 } }), value => ({ ...value, user: { ...value.user, status: 1 } }),
  ]
  for (const kind of ['login', 'refresh']) for (const mutate of malformed) {
    const browser = browserFixture(); const auth = createAuthSessionManager({ browser })
    await assert.rejects(auth.cookieOperation(kind, async () => mutate(valid())), /auth_invalid_response/)
    assert.equal(auth.state(), 'uncertain'); assert.equal(auth.accessToken(), null)
    assert.equal(browser.read().pending.kind, kind); assert.equal(browser.read().suppressed, true)
  }
})
test('documented nullable display fields are valid without weakening the identity DTO', async () => {
  const auth = createAuthSessionManager({ browser: browserFixture() })
  const response = valid(); response.user.username = null
  await auth.cookieOperation('login', async () => response)
  assert.equal(auth.state(), 'authenticated'); assert.equal(auth.user().guid, '100')
})
