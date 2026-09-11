import test from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import { installAuthInterceptors } from './auth-request-policy.js'
import { createAuthSessionManager, isSafeAuthRead } from './auth-session.js'
import { createAdminUsersState } from './admin-users-state.js'
import { browserFixture } from './auth-test-browser.js'

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

test('only the two exact operation Query GETs may refresh once; action POSTs never replay', async () => {
  for (const scope of ['users.delete','users.reset_password']) {
    let refreshes = 0
    const f = fixture({ detail: 'Token无效或已过期' }, async () => {
      refreshes++
      return { access_token: 'fresh', token_type: 'Bearer', expires_in: 300, user: { guid: '1', username: null, nickname: null, role:'admin', status:'active' } }
    })
    assert.deepEqual(await f.request.get(`/admin/v2/operations?scope=${scope}`), { ok: true })
    assert.equal(f.sends(),2)
    assert.equal(refreshes,1)
  }

  for (const path of ['/admin/v2/action-verifications', '/admin/v2/users/2/actions']) {
    const post = fixture({ detail: 'Token无效或已过期' }, async () => { throw Error('must not refresh') })
    await assert.rejects(post.request.post(path, {}))
    assert.equal(post.sends(), 1)
  }
})

test('production reset operation Query preserves its key and retries one recoverable 401', async () => {
  const { createAdminActionRequest } = await import('./request.js')
  let refreshes=0
  const auth=createAuthSessionManager({browser:browserFixture(),refresh:async()=>{refreshes++;return{access_token:'fresh',token_type:'Bearer',expires_in:300,user:{guid:'1',username:null,nickname:null,role:'admin',status:'active'}}}})
  auth.setSession({accessToken:'old',user:{guid:'1'}})
  const key='ik_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',fetches=[]
  const actions=createAdminActionRequest({auth,baseURL:'https://api.example',fetchImpl:async(url,init)=>{fetches.push({url,authorization:init.headers.get('Authorization'),key:init.headers.get('Idempotency-Key')});if(fetches.length===1)return new Response(JSON.stringify({detail:'Token无效或已过期'}),{status:401,headers:{'Content-Type':'application/json'}});return new Response(JSON.stringify({operation_ref:'op_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',scope:'users.reset_password',status:'processing',finished_at:null,failure_code:null,target_guid:null,resulting_auth_version:null}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Request-ID':'req-reset','Retry-After':'7'}})}})
  const response=await actions.query('/admin/v2/operations?scope=users.reset_password',{'Idempotency-Key':key})
  assert.equal(response.status,200)
  assert.deepEqual(fetches,[
    {url:'https://api.example/admin/v2/operations?scope=users.reset_password',authorization:'Bearer old',key},
    {url:'https://api.example/admin/v2/operations?scope=users.reset_password',authorization:'Bearer fresh',key},
  ])
  assert.equal(refreshes,1)
})

test('production action request wiring preserves Query headers and refreshes only its GET', async () => {
  const { createAdminActionRequest } = await import('./request.js')
  let refreshes = 0
  const auth = createAuthSessionManager({ browser: browserFixture(), refresh: async () => {
    refreshes++
    return { access_token: 'fresh', token_type: 'Bearer', expires_in: 300, user: { guid: '1', username: null, nickname: null, role: 'admin', status: 'active' } }
  } })
  auth.setSession({ accessToken: 'old', user: { guid: '1' } })
  const fetches = []
  const fetchImpl = async (url, init) => {
    fetches.push({ url, authorization: init.headers.get('Authorization'), key: init.headers.get('Idempotency-Key') })
    if (fetches.length === 1) return new Response(JSON.stringify({ detail: 'Token无效或已过期' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ operation_ref: 'op_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', scope: 'users.delete', status: 'processing', finished_at: null, failure_code: null }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-ID': 'req-query', 'Retry-After': '7' } })
  }
  let posts = 0; let postAuthorization
  const actions = createAdminActionRequest({ auth, baseURL: 'https://api.example', fetchImpl, axiosOptions: { adapter: async config => {
    posts++; postAuthorization = config.headers.Authorization
    throw Object.assign(new Error('unauthorized'), { config, response: { status: 401, data: { detail: 'Token无效或已过期' }, headers: {}, config } })
  } } })
  const key = 'ik_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const query = await actions.query('/admin/v2/operations?scope=users.delete', { 'Idempotency-Key': key })
  assert.equal(query.status, 200)
  assert.deepEqual(fetches, [
    { url: 'https://api.example/admin/v2/operations?scope=users.delete', authorization: 'Bearer old', key },
    { url: 'https://api.example/admin/v2/operations?scope=users.delete', authorization: 'Bearer fresh', key },
  ])
  assert.equal(refreshes, 1)
  await assert.rejects(actions.post('/admin/v2/action-verifications', {}, undefined))
  assert.equal(posts, 1)
  assert.equal(postAuthorization, 'Bearer fresh')
  assert.equal(refreshes, 1)

  const success = createAdminActionRequest({ auth, axiosOptions: { adapter: async config => ({
    status: 201,
    data: { ticket: 'av_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', expires_at: 1790000300000 },
    headers: { 'cache-control': 'no-store', 'x-request-id': 'req-issue' },
    config,
  }) } })
  const issued = await success.post('/admin/v2/action-verifications', {}, undefined)
  assert.equal(issued.status, 201)
  assert.equal(issued.headers.get('cache-control'), 'no-store')
  assert.equal(issued.headers.get('x-request-id'), 'req-issue')
})

test('production operation Query wiring never refreshes nonexact URLs', async () => {
  const { createAdminActionRequest } = await import('./request.js')
  const key = 'ik_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const invalidURLs = [
    '/admin/v2/operations',
    '/admin/v2/operations?scope=other',
    '/admin/v2/operations?scope=users.delete&extra=1',
    '/admin/v2/operations?scope=users.delete&scope=users.delete',
    '/admin/v2/operations?extra=1&scope=users.delete',
    '/admin/v2/operations?scope=users%2Edelete',
    '/admin/v2/operations?scope=users.delete%23fragment',
    '/admin/v2/operations?scope=users.delete&',
    '/admin/v2/operations?scope=users.reset_password&extra=1',
    '/admin/v2/operations?scope=users%2Ereset_password',
    '/admin/v2/operations?scope=users.reset_password&',
  ]
  for (const path of invalidURLs) {
    let refreshes = 0; let fetches = 0
    const auth = createAuthSessionManager({ browser: browserFixture(), refresh: async () => { refreshes++; throw Error('must not refresh') } })
    auth.setSession({ accessToken: 'old', user: { guid: '1' } })
    const actions = createAdminActionRequest({ auth, baseURL: 'https://api.example', fetchImpl: async () => {
      fetches++
      return new Response(JSON.stringify({ detail: 'Token无效或已过期' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    } })
    await assert.rejects(actions.query(path, { 'Idempotency-Key': key }))
    assert.equal(fetches, 1, path)
    assert.equal(refreshes, 0, path)
  }
  assert.equal(isSafeAuthRead('/admin/v2/operations?scope=users.delete#client-only'), true)
  assert.equal(isSafeAuthRead('/admin/v2/operations?scope=users.reset_password#client-only'), true)
})
