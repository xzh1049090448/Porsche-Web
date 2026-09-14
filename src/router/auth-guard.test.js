import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createAuthSessionManager } from '../api/auth-session.js'
import { browserFixture } from '../api/auth-test-browser.js'
import { installAuthGuard } from './index.js'

const Stub = { template: '<main />' }

test('uncertain protected navigation and a concurrent login both remain fail-closed', async () => {
  const browser = browserFixture()
  browser.write({
    epoch: 'uncertain-epoch',
    pending: { operationId: 'login-pending', kind: 'login', epoch: 'uncertain-epoch' },
    suppressed: true,
  })
  const auth = createAuthSessionManager({ browser })
  browser.write({ epoch: 'uncertain-epoch', pending: null, suppressed: false })
  const store = {
    get isLoggedIn() { return Boolean(auth.accessToken() && auth.user()) },
    get user() { return auth.user() },
    ensureSession: () => auth.ensureSession(),
  }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/login', name: 'Login', component: Stub, meta: { guest: true } },
    { path: '/chat', name: 'Chat', component: Stub, meta: { requiresAuth: true } },
  ] })
  installAuthGuard(router, async () => store)
  let loginSends = 0
  const login = auth.cookieOperation('login', async () => {
    loginSends++
    return {
      access_token: 'must-not-publish', token_type: 'Bearer', expires_in: 300,
      user: { guid: '100', username: 'alice', nickname: null, role: 'user', status: 'active' },
    }
  })

  await assert.rejects(login, error => error.code === 'auth_uncertain')
  await router.push('/chat')
  await router.isReady()
  assert.equal(loginSends, 0)
  assert.equal(auth.state(), 'uncertain')
  assert.equal(auth.accessToken(), null)
  assert.equal(router.currentRoute.value.name, 'Login')
  assert.equal(router.currentRoute.value.query.redirect, '/chat')
})
