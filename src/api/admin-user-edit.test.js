import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createAdminUserEditApi, normalizeAdminUserEditRequest } from './admin-user-edit.js'

const rawUser = Object.freeze({
  guid: '123456789012345678', username: 'alice', nickname: 'Alice', email: null, group: 'default',
  plan_type: 'free', role: 'user', status: 'active', auth_version: 7,
  created_at: '2026-09-08T00:00:00.000Z', last_login_at: null,
})
const headers = Object.freeze({ 'Cache-Control': 'no-store', 'X-Request-ID': 'req-a05' })

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
      throw { response: { status, data: status === 409 ? { error: { code: 'auth_version_conflict' } } : {}, headers } }
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

test('production transport sends a native PATCH through the write-safe authenticated fetch path', () => {
  const source = readFileSync(new URL('./admin-user-edit.js', import.meta.url), 'utf8')
  assert.match(source, /authenticatedFetch/)
  assert.match(source, /method:\s*'PATCH'/)
  assert.doesNotMatch(source, /adminActionPost/)
})
