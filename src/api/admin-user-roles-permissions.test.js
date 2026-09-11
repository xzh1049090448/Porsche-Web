import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createRolePermissionApi,
  mapRolePermissionError,
  normalizeRolePermissionOverrides,
} from './admin-user-roles-permissions.js'

const TICKET = 'av_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const KEY = 'ik_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const OPERATION = 'op_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const headers = Object.freeze({ 'Cache-Control': 'no-store', 'X-Request-ID': 'req-a08' })

const base = Object.freeze({
  targetGuid: '9', expectedAuthVersion: 7, expectedPermissionsVersion: 3,
  catalogVersion: 1, reason: ' rotation ',
})
const overrides = Object.freeze([
  Object.freeze({ capability: 'public_content.edit', effect: 'inherit' }),
  Object.freeze({ capability: 'groups.read', effect: 'allow' }),
  Object.freeze({ capability: 'users.read', effect: 'deny' }),
])

const issueResult = () => ({ status: 201, headers, data: { ticket: TICKET, expires_at: 1790000300000 } })
const executeResult = (role, permissionsVersion = 4) => ({
  status: 200,
  headers,
  data: {
    operation_ref: OPERATION,
    target_guid: '9',
    resulting_auth_version: 8,
    resulting_permissions_version: permissionsVersion,
    resulting_role: role,
  },
})
const queryResult = (scope, role, state = 'succeeded') => ({
  status: 200,
  headers: state === 'processing' ? { ...headers, 'Retry-After': '7' } : headers,
  data: {
    operation_ref: OPERATION,
    scope,
    status: state,
    finished_at: state === 'succeeded' || state === 'failed' ? 1790000000000 : null,
    failure_code: state === 'failed' ? 'action_rejected' : null,
    target_guid: state === 'succeeded' ? '9' : null,
    resulting_auth_version: state === 'succeeded' ? 8 : null,
    resulting_permissions_version: state === 'succeeded' ? 4 : null,
    resulting_role: state === 'succeeded' ? role : null,
  },
})

test('sends exact Issue, role Execute, permission PATCH, and all three Query requests', async () => {
  const calls = []
  const api = createRolePermissionApi({
    post: async (...args) => {
      calls.push(['post', ...args])
      if (args[0] === '/admin/v2/action-verifications') return issueResult()
      return executeResult(args[1].action === 'demote' ? 'user' : 'admin')
    },
    patch: async (...args) => { calls.push(['patch', ...args]); return executeResult('admin') },
    get: async (...args) => {
      calls.push(['get', ...args])
      const scope = new URL(`https://local${args[0]}`).searchParams.get('scope')
      return queryResult(scope, scope === 'users.demote' ? 'user' : 'admin')
    },
  })

  const promote = { ...base, overrides, currentPassword: 'Root1!!' }
  const demote = { ...base, currentPassword: 'Root1!!' }
  const permission = { ...base, overrides, currentPassword: 'Root1!!' }
  const promoteTicket = await api.issuePromote(promote)
  const demoteTicket = await api.issueDemote(demote)
  const permissionTicket = await api.issuePermissionWrite(permission)
  await api.executePromote({ ...base, overrides, ticket: promoteTicket.ticket, idempotencyKey: KEY })
  await api.executeDemote({ ...base, ticket: demoteTicket.ticket, idempotencyKey: KEY })
  await api.executePermissionWrite({ ...base, overrides, ticket: permissionTicket.ticket, idempotencyKey: KEY })
  await api.query({ scope: 'users.promote', idempotencyKey: KEY })
  await api.query({ scope: 'users.demote', idempotencyKey: KEY })
  await api.query({ scope: 'users.permissions.write', idempotencyKey: KEY })

  const wireOverrides = [
    { capability: 'users.read', effect: 'deny' },
    { capability: 'groups.read', effect: 'allow' },
  ]
  assert.deepEqual(calls, [
    ['post', '/admin/v2/action-verifications', { action: 'users.promote', intent: { target_guid: '9', expected_auth_version: 7, expected_permissions_version: 3, catalog_version: 1, overrides: wireOverrides, reason: 'rotation' }, current_password: 'Root1!!' }],
    ['post', '/admin/v2/action-verifications', { action: 'users.demote', intent: { target_guid: '9', expected_auth_version: 7, expected_permissions_version: 3, catalog_version: 1, reason: 'rotation' }, current_password: 'Root1!!' }],
    ['post', '/admin/v2/action-verifications', { action: 'users.permissions.write', intent: { target_guid: '9', expected_auth_version: 7, expected_permissions_version: 3, catalog_version: 1, overrides: wireOverrides, reason: 'rotation' }, current_password: 'Root1!!' }],
    ['post', '/admin/v2/users/9/actions', { action: 'promote', expected_auth_version: 7, expected_permissions_version: 3, catalog_version: 1, overrides: wireOverrides, reason: 'rotation' }, { headers: { 'Idempotency-Key': KEY, 'X-Action-Ticket': TICKET } }],
    ['post', '/admin/v2/users/9/actions', { action: 'demote', expected_auth_version: 7, expected_permissions_version: 3, catalog_version: 1, reason: 'rotation' }, { headers: { 'Idempotency-Key': KEY, 'X-Action-Ticket': TICKET } }],
    ['patch', '/admin/v2/users/9/permissions', { expected_auth_version: 7, expected_permissions_version: 3, catalog_version: 1, overrides: wireOverrides, reason: 'rotation' }, { headers: { 'Idempotency-Key': KEY, 'X-Action-Ticket': TICKET } }],
    ['get', '/admin/v2/operations?scope=users.promote', { 'Idempotency-Key': KEY }],
    ['get', '/admin/v2/operations?scope=users.demote', { 'Idempotency-Key': KEY }],
    ['get', '/admin/v2/operations?scope=users.permissions.write', { 'Idempotency-Key': KEY }],
  ])
})

test('copies and sorts overrides while omitting UI inherit', () => {
  const source = [
    { capability: 'public_content.edit', effect: 'inherit' },
    { capability: 'groups.read', effect: 'allow' },
    { capability: 'users.read', effect: 'deny' },
  ]
  const normalized = normalizeRolePermissionOverrides(source)
  source[1].effect = 'deny'
  source.push({ capability: 'users.edit', effect: 'allow' })
  assert.deepEqual(normalized, [
    { capability: 'users.read', effect: 'deny' },
    { capability: 'groups.read', effect: 'allow' },
  ])
  assert.equal(Object.isFrozen(normalized), true)
  assert.equal(normalized.every(Object.isFrozen), true)
})

test('rejects malformed, unavailable, duplicate, and ungrantable override input before transport', async () => {
  for (const value of [
    null,
    [{ capability: 'unknown', effect: 'allow' }],
    [{ capability: 'users.quota.adjust', effect: 'deny' }],
    [{ capability: 'users.promote', effect: 'allow' }],
    [{ capability: 'users.read', effect: 'allow' }, { capability: 'users.read', effect: 'deny' }],
    [{ capability: 'users.read', effect: 'ALLOW' }],
    [{ capability: 'users.read', effect: 'allow', extra: true }],
  ]) assert.throws(() => normalizeRolePermissionOverrides(value), /invalid_a08_request/)

  let calls = 0
  const api = createRolePermissionApi({ post: async () => { calls++ }, patch: async () => { calls++ }, get: async () => { calls++ } })
  const invalidInputs = [
    ['issuePromote', { targetGuid: base.targetGuid, expectedPermissionsVersion: 3, catalogVersion: 1, overrides, reason: 'rotation', currentPassword: 'Root1!!' }],
    ['issuePromote', { ...base, overrides, currentPassword: 'Root1!!', extra: true }],
    ['issuePromote', { ...base, targetGuid: '01', overrides, currentPassword: 'Root1!!' }],
    ['issuePromote', { ...base, expectedAuthVersion: 0, overrides, currentPassword: 'Root1!!' }],
    ['issuePromote', { ...base, expectedPermissionsVersion: -1, overrides, currentPassword: 'Root1!!' }],
    ['issuePromote', { ...base, catalogVersion: 0, overrides, currentPassword: 'Root1!!' }],
    ['issuePromote', { ...base, reason: '\uD800', overrides, currentPassword: 'Root1!!' }],
    ['issuePromote', { ...base, overrides, currentPassword: '' }],
    ['issueDemote', { ...base, expectedPermissionsVersion: 0, currentPassword: 'Root1!!' }],
    ['issueDemote', { ...base, overrides, currentPassword: 'Root1!!' }],
    ['executePromote', { ...base, overrides, ticket: 'bad', idempotencyKey: KEY }],
    ['executePermissionWrite', { ...base, overrides, ticket: TICKET, idempotencyKey: 'bad' }],
    ['executePermissionWrite', { ...base, expectedPermissionsVersion: 0, overrides, ticket: TICKET, idempotencyKey: KEY }],
    ['query', { scope: 'users.delete', idempotencyKey: KEY }],
  ]
  for (const [method, input] of invalidInputs) assert.throws(() => api[method](input), /invalid_a08_request/)
  assert.equal(calls, 0)

  const promoteWithoutPolicy = createRolePermissionApi({ post: async () => issueResult(), patch: async () => assert.fail('unexpected patch'), get: async () => assert.fail('unexpected get') })
  assert.equal((await promoteWithoutPolicy.issuePromote({ ...base, expectedPermissionsVersion: 0, overrides, currentPassword: 'Root1!!' })).ticket, TICKET)
})

test('requires exact success metadata, stable results, scope role, and version advances', async () => {
  const input = { ...base, overrides, ticket: TICKET, idempotencyKey: KEY }
  for (const result of [
    { ...executeResult('admin'), headers: { ...headers, 'Cache-Control': 'private' } },
    { ...executeResult('admin'), headers: { 'Cache-Control': 'no-store', 'X-Request-ID': ' ' } },
    { ...executeResult('admin'), headers: { ...headers, 'Retry-After': '1' } },
    { ...executeResult('admin'), data: { ...executeResult('admin').data, private: true } },
    { ...executeResult('user') },
    { ...executeResult('admin'), data: { ...executeResult('admin').data, resulting_auth_version: 9 } },
    { ...executeResult('admin'), data: { ...executeResult('admin').data, resulting_permissions_version: 5 } },
  ]) {
    const api = createRolePermissionApi({ post: async () => result, patch: async () => result, get: async () => assert.fail('unexpected get') })
    await assert.rejects(() => api.executePromote(input), /invalid_a08_response/)
  }

  for (const result of [
    { ...issueResult(), status: 200 },
    { ...issueResult(), data: { ...issueResult().data, extra: true } },
    { ...issueResult(), data: { ticket: 'bad', expires_at: 1790000300000 } },
  ]) {
    const api = createRolePermissionApi({ post: async () => result, patch: async () => assert.fail('unexpected patch'), get: async () => assert.fail('unexpected get') })
    await assert.rejects(() => api.issueDemote({ ...base, currentPassword: 'Root1!!' }), /invalid_a08_response/)
  }
})

test('validates every operation state and Retry-After without accepting stale scope results', async () => {
  const run = result => createRolePermissionApi({
    post: async () => assert.fail('unexpected post'), patch: async () => assert.fail('unexpected patch'), get: async () => result,
  }).query({ scope: 'users.promote', idempotencyKey: KEY })
  assert.equal((await run(queryResult('users.promote', 'admin', 'processing'))).retryAfter, 7)
  assert.equal((await run(queryResult('users.promote', 'admin', 'succeeded'))).resultingRole, 'admin')
  assert.equal((await run(queryResult('users.promote', 'admin', 'failed'))).failureCode, 'action_rejected')
  assert.equal((await run(queryResult('users.promote', 'admin', 'pending_recovery'))).status, 'pending_recovery')
  for (const result of [
    queryResult('users.demote', 'user', 'succeeded'),
    { ...queryResult('users.promote', 'admin', 'processing'), headers },
    { ...queryResult('users.promote', 'admin', 'processing'), headers: { ...headers, 'Retry-After': '0' } },
    { ...queryResult('users.promote', 'admin', 'succeeded'), headers: { ...headers, 'Retry-After': '1' } },
    { ...queryResult('users.promote', 'admin', 'failed'), data: { ...queryResult('users.promote', 'admin', 'failed').data, failure_code: 'invented' } },
    { ...queryResult('users.promote', 'admin', 'pending_recovery'), data: { ...queryResult('users.promote', 'admin', 'pending_recovery').data, target_guid: '9' } },
  ]) await assert.rejects(() => run(result), /invalid_a08_response/)
})

const errorEnvelope = (status, code, extra = {}) => ({
  response: {
    status,
    headers: extra.headers ?? headers,
    data: extra.data ?? { error: { code, message: '请求无法完成', type: 'admin_action_error', request_id: 'req-a08', ...(extra.operationRef ? { operation_ref: extra.operationRef } : {}) } },
  },
})

test('maps only exact safe errors and never exposes transport or secret values', () => {
  assert.equal(mapRolePermissionError({ response: { status: 401, headers, data: { detail: '未登录' } } }).code, 'authentication_failed')
  for (const invalidHeaders of [
    { 'X-Request-ID': 'req-a08' },
    { 'Cache-Control': 'private', 'X-Request-ID': 'req-a08' },
    { 'Cache-Control': 'no-store' },
    { 'Cache-Control': 'no-store', 'X-Request-ID': ' ' },
    { ...headers, 'Retry-After': '1' },
  ]) {
    assert.equal(mapRolePermissionError({ response: { status: 401, headers: invalidHeaders, data: { detail: '未登录' } } }).code, 'request_failed')
  }
  assert.equal(mapRolePermissionError(errorEnvelope(409, 'policy_version_conflict')).code, 'policy_version_conflict')
  assert.equal(mapRolePermissionError(errorEnvelope(503, 'operation_commit_unknown', { operationRef: OPERATION })).operationRef, OPERATION)
  assert.equal(mapRolePermissionError(errorEnvelope(429, 'action_rate_limited', { headers: { ...headers, 'Retry-After': '3' } })).retryAfter, 3)
  for (const error of [
    errorEnvelope(409, 'action_dependency_unavailable'),
    errorEnvelope(503, 'operation_commit_unknown'),
    errorEnvelope(503, 'action_dependency_unavailable', { headers: { ...headers, 'Retry-After': '1' } }),
    errorEnvelope(429, 'action_rate_limited'),
    errorEnvelope(403, 'action_operation_rejected', { data: { error: { code: 'action_operation_rejected', message: '请求无法完成', type: 'admin_action_error', request_id: 'wrong' } } }),
    errorEnvelope(403, 'action_operation_rejected', { data: { error: { code: 'action_operation_rejected', message: '请求无法完成', type: 'admin_action_error', request_id: 'req-a08', ticket: TICKET } } }),
    { message: `network ${TICKET} ${KEY}`, config: { data: 'private' } },
  ]) {
    const mapped = mapRolePermissionError(error)
    assert.equal(mapped.code, 'request_failed')
    assert.doesNotMatch(JSON.stringify(mapped), /av_|ik_|private|wrong/)
  }
})

test('transport errors cannot impersonate internal request or response validation failures', async () => {
  for (const message of ['invalid_a08_request', 'invalid_a08_response']) {
    const api = createRolePermissionApi({
      post: async () => { throw Object.assign(new Error(message), { private: TICKET }) },
      patch: async () => assert.fail('unexpected patch'),
      get: async () => assert.fail('unexpected get'),
    })
    await assert.rejects(() => api.issueDemote({ ...base, currentPassword: 'Root1!!' }), error => {
      assert.equal(error.code, 'request_failed')
      assert.doesNotMatch(JSON.stringify(error), /av_|private/)
      return true
    })
  }
})

test('production action transport exposes a no-replay PATCH alongside POST and Query', async () => {
  const { createAdminActionRequest } = await import('./request.js')
  const calls = []
  const auth = {
    capture: () => Object.freeze({ generation: 1 }), assertCurrent: () => {}, accessToken: () => 'access-token',
  }
  const actions = createAdminActionRequest({ auth, axiosOptions: { adapter: async config => {
    calls.push({ method: config.method, url: config.url, body: JSON.parse(config.data), key: config.headers['Idempotency-Key'], ticket: config.headers['X-Action-Ticket'] })
    return { status: 200, data: executeResult('admin').data, headers, config }
  } } })
  const response = await actions.patch('/admin/v2/users/9/permissions', { expected_auth_version: 7 }, { headers: { 'Idempotency-Key': KEY, 'X-Action-Ticket': TICKET } })
  assert.equal(response.status, 200)
  assert.deepEqual(calls, [{ method: 'patch', url: '/admin/v2/users/9/permissions', body: { expected_auth_version: 7 }, key: KEY, ticket: TICKET }])

  let attempts = 0
  const rejected = createAdminActionRequest({ auth, axiosOptions: { adapter: async config => {
    attempts++
    const error = new Error('unauthorized')
    error.config = config
    error.response = { status: 401, data: { detail: 'Token无效或已过期' }, headers: {}, config }
    throw error
  } } })
  await assert.rejects(() => rejected.patch('/admin/v2/users/9/permissions', {}, {}), error => error.response?.status === 401)
  assert.equal(attempts, 1)
})
