import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdminUserActionsApi, mapAdminActionError } from './admin-user-actions.js'

const targetGuid = '123456789012345678'
const operationRef = 'op_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const ticket = 'av_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const idempotencyKey = 'ik_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

function fixture(overrides = {}) {
  const calls = []
  const api = createAdminUserActionsApi({
    post: async (url, body, config) => {
      calls.push({ method: 'post', url, body, config })
      if (url.endsWith('action-verifications')) return { ticket, expires_at: 1790000300000 }
      return { operation_ref: operationRef, user: { guid: targetGuid, status: 'deleted' } }
    },
    get: async (url, config) => {
      calls.push({ method: 'get', url, config })
      return { operation_ref: operationRef, scope: 'users.delete', status: 'processing', finished_at: null, failure_code: null }
    },
    ...overrides,
  })
  return { api, calls }
}

test('Issue uses the exact body and sends no action headers', async () => {
  const { api, calls } = fixture()
  assert.deepEqual(await api.issueUserDelete({ targetGuid, expectedAuthVersion: 7, reason: 'duplicate account', currentPassword: 'secret' }), { ticket, expiresAt: 1790000300000 })
  assert.deepEqual(calls, [{ method: 'post', url: '/admin/v2/action-verifications', body: { action: 'users.delete', intent: { target_guid: targetGuid, expected_auth_version: 7, reason: 'duplicate account' }, current_password: 'secret' }, config: undefined }])
})

test('Execute receives the caller key and sends exactly one ticket and key header', async () => {
  const { api, calls } = fixture()
  assert.deepEqual(await api.executeUserDelete({ targetGuid, expectedAuthVersion: 7, reason: 'duplicate account', ticket, idempotencyKey }), { operationRef, user: { guid: targetGuid, status: 'deleted' } })
  assert.deepEqual(calls[0], { method: 'post', url: `/admin/v2/users/${targetGuid}/actions`, body: { action: 'delete', expected_auth_version: 7, reason: 'duplicate account' }, config: { headers: { 'Idempotency-Key': idempotencyKey, 'X-Action-Ticket': ticket } } })
})

test('Query uses only the original key header and literal users.delete scope', async () => {
  const { api, calls } = fixture()
  assert.deepEqual(await api.queryUserDelete({ idempotencyKey }), { operationRef, scope: 'users.delete', status: 'processing', finishedAt: null, failureCode: null, retryAfter: null })
  assert.deepEqual(calls[0], { method: 'get', url: '/admin/v2/operations?scope=users.delete', config: { headers: { 'Idempotency-Key': idempotencyKey } } })
})

test('Issue and Execute never retry a 401 or ambiguous network failure', async () => {
  for (const failure of [
    { response: { status: 401, data: { detail: 'Token无效或已过期' } }, config: { data: 'secret' } },
    { message: 'socket failed', config: { data: 'secret' } },
  ]) {
    let attempts = 0
    const api = createAdminUserActionsApi({ post: async () => { attempts++; throw failure }, get: async () => { throw Error('unused') } })
    await assert.rejects(api.issueUserDelete({ targetGuid, expectedAuthVersion: 7, reason: 'private reason', currentPassword: 'private password' }))
    assert.equal(attempts, 1)
    await assert.rejects(api.executeUserDelete({ targetGuid, expectedAuthVersion: 7, reason: 'private reason', ticket, idempotencyKey }))
    assert.equal(attempts, 2)
  }
})

test('strictly validates exact Issue, Execute, and Query response keys', async () => {
  const validIssue = { ticket, expires_at: 1790000300000 }
  const validExecute = { operation_ref: operationRef, user: { guid: targetGuid, status: 'deleted' } }
  const validQuery = { operation_ref: operationRef, scope: 'users.delete', status: 'succeeded', finished_at: 1790000000000, failure_code: null }
  for (const response of [{ ...validIssue, extra: true }, { expires_at: validIssue.expires_at }, { ...validIssue, expires_at: 1.5 }]) {
    const api = createAdminUserActionsApi({ post: async () => response, get: async () => validQuery })
    await assert.rejects(api.issueUserDelete({ targetGuid, expectedAuthVersion: 7, reason: 'x', currentPassword: 'p' }), /invalid_action_response/)
  }
  for (const response of [{ ...validExecute, extra: true }, { ...validExecute, user: { ...validExecute.user, extra: true } }, { ...validExecute, user: { guid: '2', status: 'deleted' } }]) {
    const api = createAdminUserActionsApi({ post: async () => response, get: async () => validQuery })
    await assert.rejects(api.executeUserDelete({ targetGuid, expectedAuthVersion: 7, reason: 'x', ticket, idempotencyKey }), /invalid_action_response/)
  }
  for (const response of [{ ...validQuery, extra: true }, { ...validQuery, scope: 'other' }, { ...validQuery, status: 'processing', finished_at: 1 }]) {
    const api = createAdminUserActionsApi({ post: async () => validExecute, get: async () => response })
    await assert.rejects(api.queryUserDelete({ idempotencyKey }), /invalid_action_response/)
  }
})

test('maps failures to five public fields without retaining secrets or transport internals', () => {
  const password = 'password-private'; const reason = 'reason-private'; const key = 'key-private'; const raw = 'raw-body-private'
  const mapped = mapAdminActionError({
    message: raw,
    config: { data: JSON.stringify({ password, reason, key }) },
    response: {
      status: 503,
      headers: {},
      data: { error: { code: 'operation_commit_unknown', message: '请求无法完成', type: 'admin_action_error', request_id: 'req-public', operation_ref: operationRef } },
    },
  })
  assert.deepEqual(Object.keys(mapped).sort(), ['code', 'message', 'operationRef', 'retryAfter', 'status'])
  assert.deepEqual(mapped, { code: 'operation_commit_unknown', message: '请求无法完成', status: 503, operationRef, retryAfter: null })
  const serialized = JSON.stringify(mapped)
  for (const secret of [password, reason, key, raw, 'req-public']) assert.doesNotMatch(serialized, new RegExp(secret))
})

test('only a valid 429 Retry-After enters the public error and invalid envelopes stay generic', () => {
  assert.deepEqual(mapAdminActionError({ response: { status: 429, headers: { 'retry-after': '12' }, data: { error: { code: 'action_rate_limited', message: '请求无法完成', type: 'admin_action_error', request_id: 'req-1' } } } }), { code: 'action_rate_limited', message: '请求无法完成', status: 429, operationRef: null, retryAfter: 12 })
  assert.deepEqual(mapAdminActionError({ response: { status: 500, data: '<html>secret</html>' }, config: { raw: true } }), { code: 'request_failed', message: '请求失败，请稍后重试', status: 500, operationRef: null, retryAfter: null })
  const rateBody = { error: { code: 'action_rate_limited', message: '请求无法完成', type: 'admin_action_error', request_id: 'req-1' } }
  assert.equal(mapAdminActionError({ response: { status: 429, headers: {}, data: rateBody } }).code, 'request_failed')
  assert.equal(mapAdminActionError({ response: { status: 429, headers: { 'retry-after': '0' }, data: rateBody } }).code, 'request_failed')
  const unavailable = { error: { code: 'action_dependency_unavailable', message: '请求无法完成', type: 'admin_action_error', request_id: 'req-2' } }
  assert.equal(mapAdminActionError({ response: { status: 503, headers: { 'retry-after': '1' }, data: unavailable } }).code, 'request_failed')
  assert.equal(mapAdminActionError({ response: { status: 503, headers: {}, data: { ...unavailable, extra: true } } }).code, 'request_failed')
})

test('Query exposes only a bounded processing Retry-After value', async () => {
  const body = { operation_ref: operationRef, scope: 'users.delete', status: 'processing', finished_at: null, failure_code: null }
  const api = createAdminUserActionsApi({ post: async () => {}, get: async () => ({ data: body, headers: { 'retry-after': '7' } }) })
  assert.equal((await api.queryUserDelete({ idempotencyKey })).retryAfter, 7)
  const invalid = createAdminUserActionsApi({ post: async () => {}, get: async () => ({ data: body, headers: { 'retry-after': '31' } }) })
  await assert.rejects(invalid.queryUserDelete({ idempotencyKey }), /invalid_action_response/)
})

test('rejects noncanonical caller headers and invalid Unicode reasons before transport', async () => {
  let calls = 0
  const api = createAdminUserActionsApi({ post: async () => { calls++ }, get: async () => { calls++ } })
  for (const bad of ['caller-key', 'ik_' + 'A'.repeat(42) + 'B', idempotencyKey + ' ']) {
    await assert.rejects(api.queryUserDelete({ idempotencyKey: bad }), /invalid_action_request/)
  }
  await assert.rejects(api.executeUserDelete({ targetGuid, expectedAuthVersion: 7, reason: 'reason', ticket: 'ticket', idempotencyKey }), /invalid_action_request/)
  await assert.rejects(api.issueUserDelete({ targetGuid, expectedAuthVersion: 7, reason: '\uD83D', currentPassword: 'password' }), /invalid_action_request/)
  assert.equal(calls, 0)
})

test('a transport error cannot impersonate an internal response-validation failure', async () => {
  const raw = Object.assign(new Error('invalid_action_response'), { config: { data: 'private-body' } })
  const api = createAdminUserActionsApi({ post: async () => { throw raw }, get: async () => { throw raw } })
  const failure = await api.issueUserDelete({ targetGuid, expectedAuthVersion: 7, reason: 'reason', currentPassword: 'password' }).catch(error => error)
  assert.deepEqual(failure, { code: 'request_failed', message: '请求失败，请稍后重试', status: null, operationRef: null, retryAfter: null })
})
