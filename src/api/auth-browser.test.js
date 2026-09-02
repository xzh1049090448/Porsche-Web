import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserAuthAdapter } from './auth-browser.js'
import { createAuthSessionManager } from './auth-session.js'
import { authErrorMessage } from './auth-errors.js'

function environment() {
  const entries = new Map([['llm_platform_token', 'old'], ['llm_platform_user', 'old'], ['llm_platform_theme', 'dark'], ['llm_platform_locale', 'en']])
  const messages = []; const locks = []
  return { entries, messages, locks, isSecureContext: true, crypto: { randomUUID: () => 'operation' },
    localStorage: { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) },
    navigator: { locks: { request: async (name, options, fn) => { locks.push([name, options]); return fn() } } },
    BroadcastChannel: class { postMessage(value) { messages.push(value) } addEventListener() {} },
  }
}
test('browser adapter cleans old credentials preserving preferences, and broadcasts only epoch', async () => {
  const env = environment(); const browser = createBrowserAuthAdapter(env)
  assert.equal(env.entries.has('llm_platform_token'), false)
  assert.equal(env.entries.get('llm_platform_theme'), 'dark')
  assert.equal(env.entries.get('llm_platform_locale'), 'en')
  browser.publish({ type: 'invalidate', epoch: 'new', accessToken: 'secret', profile: 'private', sid: 'secret' })
  assert.deepEqual(env.messages, [{ type: 'invalidate', epoch: 'new' }])
  await browser.lock(() => 1); assert.equal(env.locks[0][1].mode, 'exclusive')
})
test('missing WebLocks, BroadcastChannel or secure context blocks authentication', async () => {
  for (const change of [e => { e.navigator = {} }, e => { e.BroadcastChannel = null }, e => { e.isSecureContext = false }]) {
    const env = environment(); change(env); const auth = createAuthSessionManager({ browser: createBrowserAuthAdapter(env) })
    let sends = 0
    await assert.rejects(auth.cookieOperation('login', async () => { sends++ }))
    assert.equal(sends, 0); assert.equal(auth.state(), 'uncertain')
  }
})
test('error display supports nested errors and detail while ignoring HTML/text/Blob', () => {
  assert.equal(authErrorMessage({ response: { data: { error: { code: 'auth_invalid_credentials', message: '用户名或密码错误' } } } }), '用户名或密码错误')
  assert.equal(authErrorMessage({ response: { data: { detail: [{ msg: 'required' }] } } }), 'required')
  for (const data of ['<html>secret</html>', new Blob(['secret'])]) assert.doesNotMatch(authErrorMessage({ response: { data } }), /secret|html/)
})
