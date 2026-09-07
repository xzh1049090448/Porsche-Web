import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAdminUserCreateApi,
  mapAdminUserCreateError,
  normalizeAdminUserCreateRequest,
} from './admin-user-create.js'

const operationRef = `op_${'A'.repeat(43)}`
const ticket = `av_${'A'.repeat(43)}`
const idempotencyKey = `ik_${'A'.repeat(43)}`

const ordinaryRequest = () => Object.freeze({
  username: 'alice',
  nickname: 'Alice',
  password: 'Str0ng!Pass',
  role: 'user',
  group_guid: null,
  plan_type: 'free',
  permission_overrides: Object.freeze([]),
})

const adminRequest = () => Object.freeze({
  username: 'admin-alice',
  nickname: 'Admin Alice',
  password: 'Str0ng!Pass',
  role: 'admin',
  group_guid: '123456789012345678',
  plan_type: 'professional',
  permission_overrides: Object.freeze([
    Object.freeze({ capability: 'users.sessions.read', effect: 'allow' }),
    Object.freeze({ capability: 'users.plan.change', effect: 'deny' }),
  ]),
})

const userDto = (role = 'user') => ({
  guid: '123456789012345679',
  username: role === 'admin' ? 'admin-alice' : 'alice',
  nickname: role === 'admin' ? 'Admin Alice' : 'Alice',
  email: null,
  group: 'default',
  plan_type: role === 'admin' ? 'professional' : 'free',
  role,
  status: 'active',
  auth_version: 1,
  created_at: '2026-09-06T00:00:00.000Z',
  last_login_at: null,
})

const createBody = (role = 'user') => ({
  operation_ref: operationRef,
  user: userDto(role),
  permissions_version: role === 'admin' ? '1' : null,
})

const queryBody = (scope = 'users.create', status = 'processing') => ({
  operation_ref: operationRef,
  scope,
  status,
  finished_at: ['succeeded', 'failed'].includes(status) ? 1790000000000 : null,
  failure_code: status === 'failed' ? 'consumer_validation_failed' : null,
})

const metadata = (data, status, headers = {}) => ({
  data,
  status,
  headers: { 'cache-control': 'no-store', 'x-request-id': 'req-create', ...headers },
})

function fixture(overrides = {}) {
  const calls = []
  const api = createAdminUserCreateApi({
    post: async (url, body, config) => {
      calls.push({ method: 'post', url, body, config })
      if (url === '/admin/v2/action-verifications') return metadata({ ticket, expires_at: 1790000300000 }, 201)
      return metadata(createBody(body.role), 201)
    },
    get: async (url, headers) => {
      calls.push({ method: 'get', url, headers })
      const scope = url.endsWith('users.create_admin') ? 'users.create_admin' : 'users.create'
      return metadata(queryBody(scope), 200, { 'retry-after': '7' })
    },
    ...overrides,
  })
  return { api, calls }
}

test('normalizes one exact request while preserving password bytes and canonical override order', () => {
  const request = normalizeAdminUserCreateRequest({
    username: '  admin-alice  ',
    nickname: '  Admin Alice  ',
    password: ' Str0ng!Pass ',
    role: 'admin',
    groupGuid: '123456789012345678',
    planType: 'professional',
    permissionOverrides: [
      { capability: 'users.plan.change', effect: 'deny' },
      { capability: 'users.sessions.read', effect: 'allow' },
    ],
  })
  assert.deepEqual(request, {
    username: 'admin-alice', nickname: 'Admin Alice', password: ' Str0ng!Pass ', role: 'admin',
    group_guid: '123456789012345678', plan_type: 'professional',
    permission_overrides: [
      { capability: 'users.sessions.read', effect: 'allow' },
      { capability: 'users.plan.change', effect: 'deny' },
    ],
  })
  assert.equal(Object.isFrozen(request), true)
  assert.equal(Object.isFrozen(request.permission_overrides), true)
  assert.equal(Object.isFrozen(request.permission_overrides[0]), true)
  assert.deepEqual(normalizeAdminUserCreateRequest({ username: 'alice', nickname: 'Alice', password: 'Str0ng!Pass', role: 'user' }), ordinaryRequest())
})

test('rejects unsafe or noncanonical create input before transport', async () => {
  for (const input of [
    { username: 'ab', password: 'Str0ng!Pass', role: 'user' },
    { username: 'alice', password: 'password', role: 'user' },
    { username: 'alice', password: 'Str0ng!Pass', role: 'root' },
    { username: 'alice', password: 'Str0ng!Pass', role: 'user', groupGuid: '01' },
    { username: 'alice', password: 'Str0ng!Pass', role: 'user', planType: 'paid' },
    { username: 'alice', password: 'Str0ng!Pass', role: 'user', permissionOverrides: [{ capability: 'users.read', effect: 'allow' }] },
    { username: 'admin-alice', password: 'Str0ng!Pass', role: 'admin', permissionOverrides: [{ capability: 'users.quota.adjust', effect: 'allow' }] },
    { username: 'admin-alice', password: 'Str0ng!Pass', role: 'admin', permissionOverrides: [{ capability: 'users.read', effect: 'allow' }, { capability: 'users.read', effect: 'deny' }] },
    { username: 'alice', password: 'Str0ng!Pass', role: 'user', amount: 100 },
  ]) assert.throws(() => normalizeAdminUserCreateRequest(input), /invalid_admin_user_create_request/)

  let transports = 0
  const api = createAdminUserCreateApi({ post: async () => { transports++ }, get: async () => { transports++ } })
  await assert.rejects(api.executeAdminUserCreate({ request: { ...ordinaryRequest(), extra: true }, idempotencyKey }), /invalid_admin_user_create_request/)
  await assert.rejects(api.queryAdminUserCreate({ scope: 'users.delete', idempotencyKey }), /invalid_admin_user_create_request/)
  assert.equal(transports, 0)
})

test('administrator verification sends the exact normalized intent and no action headers', async () => {
  const { api, calls } = fixture()
  const request = adminRequest()
  assert.deepEqual(await api.issueAdminUserCreateVerification({ request, currentPassword: 'Current!Pass9' }), { ticket, expiresAt: 1790000300000 })
  assert.deepEqual(calls, [{
    method: 'post', url: '/admin/v2/action-verifications',
    body: { action: 'users.create_admin', intent: request, current_password: 'Current!Pass9' },
    config: undefined,
  }])
  assert.equal(calls[0].body.intent, request)
})

test('ordinary create sends exactly one idempotency header and strict 201 maps the created user', async () => {
  const { api, calls } = fixture()
  const request = ordinaryRequest()
  assert.deepEqual(await api.executeAdminUserCreate({ request, idempotencyKey }), {
    operationRef,
    user: {
      guid: '123456789012345679', username: 'alice', nickname: 'Alice', email: null, group: 'default', planType: 'free',
      role: 'user', status: 'active', authVersion: 1, createdAt: '2026-09-06T00:00:00.000Z', lastLoginAt: null,
    },
    permissionsVersion: null,
  })
  assert.deepEqual(calls, [{ method: 'post', url: '/admin/v2/users', body: request, config: { headers: { 'Idempotency-Key': idempotencyKey } } }])
})

test('administrator create sends exactly one ticket and key header', async () => {
  const { api, calls } = fixture()
  const request = adminRequest()
  const result = await api.executeAdminUserCreate({ request, ticket, idempotencyKey })
  assert.equal(result.user.role, 'admin')
  assert.equal(result.permissionsVersion, '1')
  assert.deepEqual(calls, [{ method: 'post', url: '/admin/v2/users', body: request, config: { headers: { 'Idempotency-Key': idempotencyKey, 'X-Action-Ticket': ticket } } }])
})

test('query uses only the original key and one exact create scope', async () => {
  for (const scope of ['users.create', 'users.create_admin']) {
    const { api, calls } = fixture()
    assert.deepEqual(await api.queryAdminUserCreate({ scope, idempotencyKey }), {
      operationRef, scope, status: 'processing', finishedAt: null, failureCode: null, retryAfter: 7,
    })
    assert.deepEqual(calls, [{ method: 'get', url: `/admin/v2/operations?scope=${scope}`, headers: { 'Idempotency-Key': idempotencyKey } }])
  }
})

test('requires exact success status, security headers, and response DTOs', async () => {
  const request = ordinaryRequest()
  for (const result of [
    metadata(createBody(), 200),
    { data: createBody(), status: 201, headers: { 'x-request-id': 'req' } },
    { data: createBody(), status: 201, headers: { 'cache-control': 'no-store', 'x-request-id': '' } },
    metadata({ ...createBody(), password: 'private' }, 201),
    metadata({ ...createBody(), operation_ref: 'op_invalid' }, 201),
    metadata({ ...createBody(), user: { ...userDto(), internal_id: 7 } }, 201),
    metadata({ ...createBody(), user: { ...userDto(), role: 'admin' } }, 201),
    metadata({ ...createBody(), user: { ...userDto(), nickname: 'Different User' } }, 201),
    metadata({ ...createBody(), user: { ...userDto(), plan_type: 'professional' } }, 201),
    metadata({ ...createBody(), user: { ...userDto(), group: 'other' } }, 201),
    metadata({ ...createBody(), user: { ...userDto(), auth_version: 2 } }, 201),
    metadata({ ...createBody(), user: { ...userDto(), last_login_at: '2026-09-06T00:00:01Z' } }, 201),
    metadata({ ...createBody(), permissions_version: '1' }, 201),
  ]) {
    const api = createAdminUserCreateApi({ post: async () => result, get: async () => {} })
    await assert.rejects(api.executeAdminUserCreate({ request, idempotencyKey }), /invalid_admin_user_create_response/)
  }

  for (const result of [
    metadata({ ticket, expires_at: 1790000300000, extra: true }, 201),
    metadata({ ticket: 'av_invalid', expires_at: 1790000300000 }, 201),
    metadata({ ticket, expires_at: 0 }, 201),
  ]) {
    const api = createAdminUserCreateApi({ post: async () => result, get: async () => {} })
    await assert.rejects(api.issueAdminUserCreateVerification({ request: adminRequest(), currentPassword: 'Current!Pass9' }), /invalid_admin_user_create_response/)
  }
})

test('rejects unsafe operation envelopes and Retry-After combinations', async () => {
  const valid = queryBody('users.create')
  for (const result of [
    metadata({ ...valid, extra: true }, 200, { 'retry-after': '7' }),
    metadata({ ...valid, scope: 'users.create_admin' }, 200, { 'retry-after': '7' }),
    metadata({ ...valid, status: 'processing', finished_at: 1 }, 200, { 'retry-after': '7' }),
    metadata(valid, 200),
    metadata(valid, 200, { 'retry-after': '31' }),
    metadata(queryBody('users.create', 'succeeded'), 200, { 'retry-after': '1' }),
  ]) {
    const api = createAdminUserCreateApi({ post: async () => {}, get: async () => result })
    await assert.rejects(api.queryAdminUserCreate({ scope: 'users.create', idempotencyKey }), /invalid_admin_user_create_response/)
  }
})

test('maps established action errors plus A03 codes without transport details', () => {
  for (const [status, code] of [
    [400, 'invalid_admin_user_create_request'], [403, 'action_operation_rejected'], [404, 'action_group_not_found'],
    [409, 'username_conflict'], [409, 'idempotency_conflict'], [409, 'policy_version_conflict'],
    [422, 'action_inactive'], [429, 'action_rate_limited'], [503, 'action_dependency_unavailable'],
  ]) {
    const headers = { 'cache-control': 'no-store', 'x-request-id': 'req-error' }
    if (status === 429) headers['retry-after'] = '9'
    const mapped = mapAdminUserCreateError({
      message: 'dependency-private', config: { data: 'password-private' },
      response: { status, headers, data: { error: { code, message: '请求无法完成', type: 'admin_action_error', request_id: 'req-error' } } },
    })
    assert.equal(mapped.code, code)
    assert.equal(mapped.retryAfter, status === 429 ? 9 : null)
    assert.deepEqual(Object.keys(mapped).sort(), ['code', 'message', 'operationRef', 'retryAfter', 'status'])
    assert.doesNotMatch(JSON.stringify(mapped), /private|req-error/)
  }
})

test('commit unknown requires one opaque operation ref and unsafe errors become generic', () => {
  const valid = mapAdminUserCreateError({ response: {
    status: 503,
    headers: { 'cache-control': 'no-store', 'x-request-id': 'req-error' },
    data: { error: { code: 'operation_commit_unknown', message: '请求无法完成', type: 'admin_action_error', request_id: 'req-error', operation_ref: operationRef } },
  } })
  assert.deepEqual(valid, { code: 'operation_commit_unknown', message: '请求无法完成', status: 503, operationRef, retryAfter: null })

  const unsafe = [
    { status: 409, headers: { 'cache-control': 'no-store', 'x-request-id': 'req-error' }, data: { error: { code: 'username_conflict', message: '请求无法完成', type: 'admin_action_error', request_id: 'req-error', owner_guid: '7' } } },
    { status: 503, headers: { 'cache-control': 'no-store', 'x-request-id': 'req-error' }, data: { error: { code: 'operation_commit_unknown', message: '请求无法完成', type: 'admin_action_error', request_id: 'req-error' } } },
    { status: 409, headers: { 'cache-control': 'private', 'x-request-id': 'req-error' }, data: { error: { code: 'username_conflict', message: '请求无法完成', type: 'admin_action_error', request_id: 'req-error' } } },
    { status: 409, headers: { 'cache-control': 'no-store', 'x-request-id': 'different' }, data: { error: { code: 'username_conflict', message: '请求无法完成', type: 'admin_action_error', request_id: 'req-error' } } },
  ]
  for (const response of unsafe) {
    assert.deepEqual(mapAdminUserCreateError({ response, config: { data: 'private' } }), {
      code: 'request_failed', message: '请求失败，请稍后重试', status: response.status, operationRef: null, retryAfter: null,
    })
  }
})

test('POSTs are attempted once and transport errors cannot impersonate response validation', async () => {
  let attempts = 0
  const raw = Object.assign(new Error('invalid_admin_user_create_response'), { config: { data: 'private-body' } })
  const api = createAdminUserCreateApi({ post: async () => { attempts++; throw raw }, get: async () => { throw raw } })
  const failure = await api.executeAdminUserCreate({ request: ordinaryRequest(), idempotencyKey }).catch(error => error)
  assert.equal(attempts, 1)
  assert.deepEqual(failure, { code: 'request_failed', message: '请求失败，请稍后重试', status: null, operationRef: null, retryAfter: null })
})
