import test from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import { installAuthInterceptors } from './auth-request-policy.js'
import { createAuthSessionManager } from './auth-session.js'
import { createAdminUsersState } from './admin-users-state.js'
import { browserFixture } from './auth-test-browser.js'
import { readFile } from 'node:fs/promises'

function fixture(data, refresh, successData = { ok: true }) {
  let sends = 0; let unauthorized = 0
  const auth = createAuthSessionManager({ browser: browserFixture(), refresh })
  auth.setSession({ accessToken: 'old', user: { guid: '1' } })
  const request = axios.create({ adapter: async config => {
    sends++
    if (config.headers.Authorization === 'Bearer fresh') return { status: 200, data: successData, config, headers: {} }
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

test('opt-in projection response carries the retried request snapshot for fail-closed replacement', async () => {
  let refreshes = 0
  const revoked = { user: { guid: '1', username: 'alice', nickname: null, role: 'admin', status: 'active' } }
  const f = fixture({ detail: 'Token无效或已过期' }, async () => {
    refreshes++
    return { access_token: 'fresh', token_type: 'Bearer', expires_in: 300, user: { guid: '1', username: 'alice', nickname: null, role: 'admin', status: 'active', admin_permissions: ['users.read'], permissions_version: '1' } }
  }, revoked)
  f.auth.setSession({ accessToken: 'old', user: { guid: '1', username: 'alice', nickname: null, role: 'admin', status: 'active', admin_permissions: ['users.read'], permissions_version: '1' } })
  const admin = createAdminUsersState({ auth: f.auth, api: {} })
  admin.value.rows = [{ guid: '2' }]; admin.value.total = 1
  const response = await f.request.get('/api/v1/auth/self', { __authProjectionResponse: true })
  assert.deepEqual(response.data, revoked)
  assert.equal(response.authContext.generation, f.auth.capture().generation)
  f.auth.replacePermissionProjection(response.authContext, response.data.user)
  assert.equal(f.auth.user().admin_permissions, undefined)
  assert.deepEqual(admin.value.rows, [])
  assert.equal(refreshes, 1)
})

test('opt-in projection response is rejected after a later identity or permission change', async () => {
  const f = fixture({ detail: 'Token无效或已过期' }, async () => ({ access_token: 'fresh', token_type: 'Bearer', expires_in: 300, user: { guid: '1', username: null, nickname: null, role: 'user', status: 'active' } }))
  const response = await f.request.get('/api/v1/auth/self', { __authProjectionResponse: true })
  f.auth.replacePermissionProjection(f.auth.capture(), { admin_permissions: ['users.read'], permissions_version: '1' })
  assert.throws(() => f.auth.replacePermissionProjection(response.authContext, {}), /identity_changed/)
  const current = await f.request.get('/api/v1/auth/self', { __authProjectionResponse: true })
  f.auth.setSession({ accessToken: 'other', user: { guid: '2', username: 'bob', nickname: null, role: 'user', status: 'active' } })
  assert.throws(() => f.auth.replacePermissionProjection(current.authContext, {}), /identity_changed/)
})

test('the sensitive action transport shares request options and bearer acquisition without a response replay interceptor', async () => {
  const source = await readFile(new URL('./request.js', import.meta.url), 'utf8')
  assert.match(source, /adminActionTransport\s*=\s*axios\.create\(options\)/)
  assert.match(source, /installBearerInterceptor\(adminActionTransport,\s*authSession\)/)
  assert.doesNotMatch(source, /installAuthInterceptors\(adminActionTransport/)
})

test('only the exact user-delete operation Query GET may refresh once; action POSTs never replay', async () => {
  let refreshes = 0
  const f = fixture({ detail: 'Token无效或已过期' }, async () => {
    refreshes++
    return { access_token: 'fresh', token_type: 'Bearer', expires_in: 300, user: { guid: '1', username: null, nickname: null, role: 'admin', status: 'active' } }
  })
  assert.deepEqual(await f.request.get('/admin/v2/operations?scope=users.delete'), { ok: true })
  assert.equal(f.sends(), 2)
  assert.equal(refreshes, 1)

  for (const path of ['/admin/v2/action-verifications', '/admin/v2/users/2/actions']) {
    const post = fixture({ detail: 'Token无效或已过期' }, async () => { throw Error('must not refresh') })
    await assert.rejects(post.request.post(path, {}))
    assert.equal(post.sends(), 1)
  }
})
