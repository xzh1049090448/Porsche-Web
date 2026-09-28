import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdminUserStatusApi, mapAdminUserStatusError, normalizeAdminUserStatusRequest, patchAdminUserStatus } from './admin-user-status.js'

const rawUser = Object.freeze({
  guid: '123456789012345678', username: 'alice', nickname: 'Alice', email: null, group: 'default',
  plan_type: 'free', role: 'user', status: 'disabled', auth_version: 8,
  created_at: '2026-09-08T00:00:00.000Z', last_login_at: null,
})
const headers = Object.freeze({ 'Cache-Control': 'no-store', 'X-Request-ID': 'req-a06' })
const failureCode = new Map([
  [400, 'invalid_admin_user_status_request'], [401, 'authentication_invalid'], [403, 'user_status_forbidden'],
  [404, 'user_not_found'], [413, 'request_body_too_large'], [503, 'user_status_dependency_unavailable'],
])
const failureEnvelope = (status, code = failureCode.get(status), overrides = {}) => ({
  response: {
    status,
    headers: overrides.headers ?? headers,
    data: overrides.body ?? { error: { code, message: '请求无法完成', kind: 'admin_user_status_error', request_id: 'req-a06' } },
  },
})

test('normalizes the exact transition body for a canonical GUID and positive INT32 version', () => {
  assert.deepEqual(normalizeAdminUserStatusRequest({ targetGuid: rawUser.guid, status: 'disabled', reason: '  安全 原因  ', expectedAuthVersion: 7 }), {
    targetGuid: rawUser.guid, status: 'disabled', reason: '安全 原因', expectedAuthVersion: 7,
  })
  assert.deepEqual(normalizeAdminUserStatusRequest({ targetGuid: '1', status: 'active', reason: null, expectedAuthVersion: 2147483647 }), {
    targetGuid: '1', status: 'active', reason: null, expectedAuthVersion: 2147483647,
  })
  assert.equal([...normalizeAdminUserStatusRequest({ targetGuid: '1', status: 'disabled', reason: '😀'.repeat(200), expectedAuthVersion: 1 }).reason].length, 200)
  for (const input of [
    { targetGuid: '01', status: 'disabled', reason: 'reason', expectedAuthVersion: 7 },
    { targetGuid: '9223372036854775808', status: 'disabled', reason: 'reason', expectedAuthVersion: 7 },
    { targetGuid: '1', status: 'deleted', reason: 'reason', expectedAuthVersion: 7 },
    { targetGuid: '1', status: 'disabled', reason: null, expectedAuthVersion: 7 },
    { targetGuid: '1', status: 'disabled', reason: '   ', expectedAuthVersion: 7 },
    { targetGuid: '1', status: 'disabled', reason: '😀'.repeat(201), expectedAuthVersion: 7 },
    { targetGuid: '1', status: 'disabled', reason: '\uD800', expectedAuthVersion: 7 },
    { targetGuid: '1', status: 'active', reason: '', expectedAuthVersion: 7 },
    { targetGuid: '1', status: 'active', reason: 'reason', expectedAuthVersion: 7 },
    { targetGuid: '1', status: 'active', reason: null, expectedAuthVersion: 0 },
    { targetGuid: '1', status: 'active', reason: null, expectedAuthVersion: 1.5 },
    { targetGuid: '1', status: 'active', reason: null, expectedAuthVersion: 2147483648 },
    { targetGuid: '1', status: 'active', reason: null, expectedAuthVersion: 7, role: 'admin' },
  ]) assert.throws(() => normalizeAdminUserStatusRequest(input), /invalid_admin_user_status_request/)
})

test('PATCHes exactly three frozen snake-case fields and validates the exact success DTO and headers', async () => {
  const calls = []
  const api = createAdminUserStatusApi({ patch: async (...args) => {
    calls.push(args)
    return { data: rawUser, status: 200, headers }
  } })
  const user = await api.patchAdminUserStatus({ targetGuid: rawUser.guid, status: 'disabled', reason: ' reason ', expectedAuthVersion: 7 })
  assert.deepEqual(calls, [[`/admin/v2/users/${rawUser.guid}/status`, {
    status: 'disabled', reason: 'reason', expected_auth_version: 7,
  }, { headers: { 'Content-Type': 'application/json' } }]])
  assert.deepEqual(user, {
    guid: rawUser.guid, username: 'alice', nickname: 'Alice', email: null, group: 'default', planType: 'free', role: 'user',
    status: 'disabled', authVersion: 8, createdAt: rawUser.created_at, lastLoginAt: null,
  })

  for (const result of [
    { data: { ...rawUser, private: true }, status: 200, headers },
    { data: rawUser, status: 200, headers: { ...headers, 'Cache-Control': 'private' } },
    { data: rawUser, status: 200, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': ' ' } },
  ]) {
    const invalid = createAdminUserStatusApi({ patch: async () => result })
    await assert.rejects(invalid.patchAdminUserStatus({ targetGuid: rawUser.guid, status: 'disabled', reason: 'reason', expectedAuthVersion: 7 }), /invalid_admin_user_status_response/)
  }
  const wrongStatus = createAdminUserStatusApi({ patch: async () => ({ data: rawUser, status: 201, headers }) })
  await assert.rejects(wrongStatus.patchAdminUserStatus({ targetGuid: rawUser.guid, status: 'disabled', reason: 'reason', expectedAuthVersion: 7 }), error => error.code === 'request_failed')
})

test('maps every frozen safe failure and distinguishes both 409 codes without transport details', async () => {
  const cases = [
    [400, 'invalid_admin_user_status_request', 'invalid_request'], [401, 'authentication_invalid', 'authentication_failed'],
    [403, 'user_status_forbidden', 'forbidden'], [404, 'user_not_found', 'not_found'],
    [409, 'auth_version_conflict', 'auth_version_conflict'], [409, 'user_status_conflict', 'user_status_conflict'],
    [413, 'request_body_too_large', 'request_too_large'], [503, 'user_status_dependency_unavailable', 'unavailable'],
  ]
  for (const [status, wireCode, code] of cases) {
    let calls = 0
    const api = createAdminUserStatusApi({ patch: async () => { calls++; return failureEnvelope(status, wireCode).response } })
    await assert.rejects(api.patchAdminUserStatus({ targetGuid: rawUser.guid, status: 'active', reason: null, expectedAuthVersion: 8 }), error => {
      assert.equal(error.code, code)
      assert.equal(error.status, status)
      assert.equal('response' in error, false)
      assert.doesNotMatch(JSON.stringify(error), /request_id|transport|private/)
      return true
    })
    assert.equal(calls, 1)
  }
})

test('requires the exact safe envelope and makes network, timeout, and malformed envelopes generic', async () => {
  for (const error of [
    failureEnvelope(409, 'user_not_found'),
    failureEnvelope(503, undefined, { body: { error: { code: 'user_status_dependency_unavailable', message: 'private', kind: 'admin_user_status_error', request_id: 'req-a06' } } }),
    failureEnvelope(403, undefined, { body: { error: { code: 'user_status_forbidden', message: '请求无法完成', kind: 'wrong', request_id: 'req-a06' } } }),
    failureEnvelope(400, undefined, { body: { error: { code: 'invalid_admin_user_status_request', message: '请求无法完成', kind: 'admin_user_status_error', request_id: 'different' } } }),
    failureEnvelope(404, undefined, { body: { error: { code: 'user_not_found', message: '请求无法完成', kind: 'admin_user_status_error', request_id: 'req-a06', private: true } } }),
  ]) {
    const mapped = mapAdminUserStatusError({ ...error, message: 'transport-private', config: { body: 'reason-private' } })
    assert.equal(mapped.code, 'request_failed')
    assert.equal(mapped.message, '请求失败，请稍后重试')
    assert.doesNotMatch(JSON.stringify(mapped), /private|different|transport|reason/)
  }
  for (const source of [new Error('network reason=private'), { code: 'ECONNABORTED', message: 'timeout private' }]) {
    let calls = 0
    const api = createAdminUserStatusApi({ patch: async () => { calls++; throw source } })
    await assert.rejects(api.patchAdminUserStatus({ targetGuid: rawUser.guid, status: 'active', reason: null, expectedAuthVersion: 8 }), error => error.code === 'request_failed' && error.status === null && !JSON.stringify(error).includes('private'))
    assert.equal(calls, 1)
  }
})

test('production transport sends exactly one PATCH through authenticated fetch and never replays 401 or 503', async () => {
  const calls = []
  const authenticatedFetch = async (...args) => {
    calls.push(args)
    return new Response(JSON.stringify(rawUser), { status: 200, headers })
  }
  await patchAdminUserStatus({ targetGuid: rawUser.guid, status: 'disabled', reason: 'reason', expectedAuthVersion: 7 }, { authenticatedFetch })
  assert.deepEqual(calls, [[`/admin/v2/users/${rawUser.guid}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'disabled', reason: 'reason', expected_auth_version: 7 }),
  }]])

  for (const status of [401, 503]) {
    let failures = 0
    const code = failureCode.get(status)
    await assert.rejects(patchAdminUserStatus({ targetGuid: rawUser.guid, status: 'active', reason: null, expectedAuthVersion: 8 }, {
      authenticatedFetch: async () => {
        failures++
        return new Response(JSON.stringify(failureEnvelope(status, code).response.data), { status, headers })
      },
    }))
    assert.equal(failures, 1)
  }
})
