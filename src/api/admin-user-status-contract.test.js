import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const frontendContractURL = new URL('../../docs/agents/contracts/admin-user-status-v1.json', import.meta.url)

test('A06 contract requires the explicit backend fixture path', () => {
  assert.ok(process.env.A06_BACKEND_CONTRACT, 'missing_A06_BACKEND_CONTRACT')
})

test('frontend A06 fixture is byte-equivalent to the frozen backend contract', async t => {
  const backendPath = process.env.A06_BACKEND_CONTRACT
  if (!backendPath) {
    t.skip('missing_A06_BACKEND_CONTRACT')
    return
  }
  const [frontendBytes, backendBytes] = await Promise.all([
    readFile(frontendContractURL),
    readFile(backendPath),
  ])
  assert.deepEqual(frontendBytes, backendBytes)
})

test('frozen A06 contract preserves the exact transition, response, error, and retry boundary', async () => {
  const contract = JSON.parse(await readFile(frontendContractURL, 'utf8'))
  assert.deepEqual(Object.keys(contract), ['contract', 'revision', 'status', 'design_source', 'endpoint', 'credential_semantics', 'audit', 'legacy_put', 'scope'])
  assert.equal(contract.contract, 'admin-user-status-v1')
  assert.equal(contract.revision, '2026-09-08-a06-v1')
  assert.equal(contract.status, 'AGREED_FOR_IMPLEMENTATION')
  assert.deepEqual(contract.endpoint, {
    method: 'PATCH',
    path: '/admin/v2/users/{guid}/status',
    path_guid: 'canonical positive decimal signed int64 string (1..9223372036854775807), no sign, whitespace, or leading zero',
    headers: {
      Authorization: 'required Bearer authentication under the existing mechanism',
      'Content-Type': 'application/json',
    },
    body_limit_bytes: 4096,
    strict_json: 'one JSON object; reject duplicate keys, case-folded duplicate keys, invalid UTF-8, trailing values, unknown fields, and oversized bodies before service invocation',
    body: {
      schema: {
        type: 'object', additionalProperties: false,
        required: ['status', 'reason', 'expected_auth_version'],
        properties: {
          status: { type: 'string', enum: ['active', 'disabled'] },
          reason: { type: ['string', 'null'], rule: 'disabled requires a trimmed 1..200 Unicode code-point string; active requires null' },
          expected_auth_version: { type: 'integer', rule: 'positive INT32 (1..2147483647)' },
        },
      },
    },
    transitions: {
      active_to_disabled: { capability: 'users.disable', auth_version_delta: 1, revoke_all_sessions: true },
      disabled_to_active: { capability: 'users.enable', auth_version_delta: 1, revoke_legacy_active_sessions: true, restore_sessions: false },
      same_state: { status: 409, code: 'user_status_conflict' },
    },
    response: {
      status: 200,
      dto: 'UserReadDTO',
      dto_keys: ['guid', 'username', 'nickname', 'email', 'group', 'plan_type', 'role', 'status', 'auth_version', 'created_at', 'last_login_at'],
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': 'required non-empty' },
    },
    errors: {
      400: ['invalid_admin_user_status_request'], 401: ['authentication_invalid'], 403: ['user_status_forbidden'],
      404: ['user_not_found'], 409: ['auth_version_conflict', 'user_status_conflict'], 413: ['request_body_too_large'],
      503: ['user_status_dependency_unavailable'],
    },
    retry: { patch: 'never', conflict_refresh_get_max: 1 },
  })
  assert.deepEqual(contract.legacy_put, {
    path: '/admin/users/{guid}', status_field: 'retired and rejected before every write, including mixed bodies',
    other_fields: 'unchanged and outside A06',
  })
  assert.deepEqual(contract.credential_semantics, {
    disable: 'old Access and Refresh sessions fail; Gateway rejects every Key while owner is disabled',
    enable: 'any legacy active session is revoked before activation and old sessions remain revoked; independently revoked or expired Keys remain unusable; otherwise Gateway evaluates current owner state and current Key state',
  })
})
