import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdminUserEditApi, mapAdminUserEditError, normalizeAdminUserEditRequest, patchAdminUserEdit } from './admin-user-edit.js'

const rawUser = Object.freeze({
  guid: '123456789012345678', username: 'alice', nickname: 'Alice', email: null, group: 'default',
  plan_type: 'free', role: 'user', status: 'active', auth_version: 7,
  created_at: '2026-09-08T00:00:00.000Z', last_login_at: null,
})
const headers = Object.freeze({ 'Cache-Control': 'no-store', 'X-Request-ID': 'req-a05' })
const failureCode = new Map([
  [400, 'invalid_admin_user_edit_request'], [401, 'authentication_invalid'], [403, 'user_edit_forbidden'],
  [404, 'user_not_found'], [409, 'auth_version_conflict'], [413, 'request_body_too_large'], [503, 'user_edit_dependency_unavailable'],
])
const failureEnvelope = (status, code = failureCode.get(status), overrides = {}) => ({
  response: {
    status,
    headers: overrides.headers ?? headers,
    data: overrides.body ?? { error: { code, message: '请求无法完成', kind: 'admin_user_edit_error', request_id: 'req-a05' } },
  },
})

test('normalizes only a nullable nickname and positive INT32 version for a canonical GUID', () => {
  assert.deepEqual(normalizeAdminUserEditRequest({ targetGuid: '123456789012345678', nickname: '  Alice  ', expectedAuthVersion: 7 }), {
    targetGuid: '123456789012345678', nickname: 'Alice', expectedAuthVersion: 7,
  })
  assert.deepEqual(normalizeAdminUserEditRequest({ targetGuid: '1', nickname: null, expectedAuthVersion: 2147483647 }), {
    targetGuid: '1', nickname: null, expectedAuthVersion: 2147483647,
  })
  for (const input of [
    { targetGuid: '01', nickname: 'Alice', expectedAuthVersion: 7 },
    { targetGuid: '9223372036854775808', nickname: 'Alice', expectedAuthVersion: 7 },
    { targetGuid: '1', nickname: '   ', expectedAuthVersion: 7 },
    { targetGuid: '1', nickname: 'x'.repeat(65), expectedAuthVersion: 7 },
    { targetGuid: '1', nickname: 'Alice', expectedAuthVersion: 0 },
    { targetGuid: '1', nickname: 'Alice', expectedAuthVersion: 1.5 },
    { targetGuid: '1', nickname: 'Alice', expectedAuthVersion: 2147483648 },
    { targetGuid: '1', nickname: 'Alice', expectedAuthVersion: 7, role: 'admin' },
  ]) assert.throws(() => normalizeAdminUserEditRequest(input), /invalid_admin_user_edit_request/)
})

test('PATCHes exactly the two frozen snake-case fields and validates the exact success DTO and headers', async () => {
  const calls = []
  const api = createAdminUserEditApi({ patch: async (...args) => {
    calls.push(args)
    return { data: rawUser, status: 200, headers }
  } })
  const user = await api.patchAdminUserEdit({ targetGuid: rawUser.guid, nickname: ' Alice ', expectedAuthVersion: 7 })
  assert.deepEqual(calls, [[`/admin/v2/users/${rawUser.guid}`, { nickname: 'Alice', expected_auth_version: 7 }, { headers: { 'Content-Type': 'application/json' } }]])
  assert.deepEqual(user, {
    guid: rawUser.guid, username: 'alice', nickname: 'Alice', email: null, group: 'default', planType: 'free', role: 'user',
    status: 'active', authVersion: 7, createdAt: rawUser.created_at, lastLoginAt: null,
  })

  const invalid = createAdminUserEditApi({ patch: async () => ({ data: { ...rawUser, body: 'unexpected' }, status: 200, headers }) })
  await assert.rejects(invalid.patchAdminUserEdit({ targetGuid: rawUser.guid, nickname: 'Alice', expectedAuthVersion: 7 }), /invalid_admin_user_edit_response/)
})

test('maps stable A05 failures without transport details and never replays a mutation', async () => {
  for (const [status, code] of [[400, 'invalid_request'], [401, 'authentication_failed'], [403, 'forbidden'], [404, 'not_found'], [409, 'auth_version_conflict'], [413, 'request_too_large'], [503, 'unavailable']]) {
    let calls = 0
    const api = createAdminUserEditApi({ patch: async () => {
      calls++
      throw failureEnvelope(status)
    } })
    await assert.rejects(api.patchAdminUserEdit({ targetGuid: rawUser.guid, nickname: null, expectedAuthVersion: 7 }), error => error.code === code && error.status === status && !('response' in error))
    assert.equal(calls, 1)
  }
  for (const error of [new Error('socket password=secret'), { code: 'ECONNABORTED', message: 'timeout' }]) {
    let calls = 0
    const api = createAdminUserEditApi({ patch: async () => { calls++; throw error } })
    await assert.rejects(api.patchAdminUserEdit({ targetGuid: rawUser.guid, nickname: 'Alice', expectedAuthVersion: 7 }), value => value.code === 'request_failed' && value.status === null && !value.message.includes('secret'))
    assert.equal(calls, 1)
  }
})

test('requires the exact frozen error envelope and never exposes transport details', () => {
  for (const error of [
    failureEnvelope(409, 'user_not_found'),
    failureEnvelope(503, undefined, { body: { error: { code: 'user_edit_dependency_unavailable', message: 'private message', kind: 'admin_user_edit_error', request_id: 'req-a05' } } }),
    failureEnvelope(403, undefined, { body: { error: { code: 'user_edit_forbidden', message: '请求无法完成', kind: 'wrong_kind', request_id: 'req-a05' } } }),
    failureEnvelope(400, undefined, { body: { error: { code: 'invalid_admin_user_edit_request', message: '请求无法完成', kind: 'admin_user_edit_error', request_id: 'different' } } }),
    failureEnvelope(404, undefined, { body: { error: { code: 'user_not_found', message: '请求无法完成', kind: 'admin_user_edit_error', request_id: 'req-a05', private: true } } }),
  ]) {
    const mapped = mapAdminUserEditError({ ...error, message: 'transport-private', config: { body: 'nickname-private' } })
    assert.equal(mapped.code, 'request_failed')
    assert.equal(mapped.message, '请求失败，请稍后重试')
    assert.doesNotMatch(JSON.stringify(mapped), /private|different|transport/)
  }
})

test('production transport sends exactly one PATCH through an injected authenticated fetch without replay', async () => {
  const calls = []
  const authenticatedFetch = async (...args) => {
    calls.push(args)
    return new Response(JSON.stringify(rawUser), { status: 200, headers })
  }
  await patchAdminUserEdit({ targetGuid: rawUser.guid, nickname: null, expectedAuthVersion: 7 }, { authenticatedFetch })
  assert.deepEqual(calls, [[`/admin/v2/users/${rawUser.guid}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: null, expected_auth_version: 7 }),
  }]])

  let failures = 0
  await assert.rejects(patchAdminUserEdit({ targetGuid: rawUser.guid, nickname: null, expectedAuthVersion: 7 }, {
    authenticatedFetch: async () => { failures++; throw failureEnvelope(401) },
  }), error => error.code === 'authentication_failed')
  assert.equal(failures, 1)
})
