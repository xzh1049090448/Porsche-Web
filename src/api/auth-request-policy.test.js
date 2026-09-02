import test from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import { installAuthInterceptors } from './auth-request-policy.js'
import { createAuthSessionManager } from './auth-session.js'
import { browserFixture } from './auth-test-browser.js'

function fixture(data, refresh) {
  let sends = 0; let unauthorized = 0
  const auth = createAuthSessionManager({ browser: browserFixture(), refresh })
  auth.setSession({ accessToken: 'old', user: { guid: '1' } })
  const request = axios.create({ adapter: async config => {
    sends++
    if (config.headers.Authorization === 'Bearer fresh') return { status: 200, data: { ok: true }, config, headers: {} }
    throw Object.assign(new Error('unauthorized'), { config, response: { status: 401, data, config } })
  } })
  installAuthInterceptors(request, auth, { onUnauthorized: () => { unauthorized++ } })
  return { request, auth, sends: () => sends, unauthorized: () => unauthorized }
}
test('Axios middleware detail 401 recovers exactly once; nested business and unknown 401 never replay', async () => {
  for (const data of [{ detail: 'Token无效或已过期' }, { error: { code: 'auth_request_failed', message: 'bad password' } }, { detail: 'unknown' }]) {
    let refreshes = 0
    const f = fixture(data, async () => { refreshes++; return { access_token: 'fresh', token_type: 'Bearer', expires_in: 300, user: { guid: '1', username: null, nickname: null, role: 'user', status: 'active' } } })
    if (data.detail === 'Token无效或已过期') { assert.deepEqual(await f.request.get('/api/v1/users/me'), { ok: true }); assert.equal(refreshes, 1) }
    else { await assert.rejects(f.request.get('/api/v1/users/me')); assert.equal(refreshes, 0); assert.equal(f.auth.accessToken(), 'old') }
  }
})
test('Axios refresh 503 remains uncertain without unauthorized callback', async () => {
  const f = fixture({ detail: 'Token无效或已过期' }, async () => { throw { response: { status: 503 } } })
  await assert.rejects(f.request.get('/api/v1/users/me'))
  assert.equal(f.auth.state(), 'uncertain'); assert.equal(f.unauthorized(), 0); assert.equal(f.sends(), 1)
})
