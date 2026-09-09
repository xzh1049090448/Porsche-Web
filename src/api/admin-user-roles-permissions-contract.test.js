import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const frontendContractURL = new URL('../../docs/agents/contracts/admin-user-roles-permissions-v1.json', import.meta.url)
const SCOPES = ['users.promote', 'users.demote', 'users.permissions.write']
const STABLE_RESULT_KEYS = [
  'operation_ref',
  'target_guid',
  'resulting_auth_version',
  'resulting_permissions_version',
  'resulting_role',
]

async function readContract(path) {
  const bytes = await readFile(path)
  return { bytes, document: JSON.parse(bytes.toString('utf8')) }
}

test('A08 contract requires the explicit authoritative backend path', () => {
  assert.ok(process.env.A08_BACKEND_CONTRACT, 'missing_A08_BACKEND_CONTRACT')
})

test('A08 frontend contract is byte-identical to the backend contract', async t => {
  const backendPath = process.env.A08_BACKEND_CONTRACT
  if (!backendPath) {
    t.skip('missing_A08_BACKEND_CONTRACT')
    return
  }

  const [frontend, backend] = await Promise.all([
    readContract(frontendContractURL),
    readContract(backendPath),
  ])
  assert.deepEqual(frontend.bytes, backend.bytes)

  const contract = frontend.document
  assert.equal(contract.contract, 'admin-user-roles-permissions-v1')
  assert.equal(contract.revision, '2026-09-09-a08-v1')
  assert.equal(contract.status, 'AGREED_FOR_IMPLEMENTATION')
  assert.deepEqual(Object.keys(contract.actions), SCOPES)
  assert.equal(contract.common.body_limit_bytes, 4096)
  assert.match(contract.common.strict_json, /reject unknown, duplicate, case-folded duplicate, invalid UTF-8, trailing fields, and oversized bodies/)
  assert.deepEqual(contract.common.response_headers, {
    'Cache-Control': 'no-store',
    'X-Request-ID': 'required non-empty; error body request_id equals this header',
  })

  const executeMethods = {
    'users.promote': 'POST',
    'users.demote': 'POST',
    'users.permissions.write': 'PATCH',
  }
  const executePaths = {
    'users.promote': '/admin/v2/users/{guid}/actions',
    'users.demote': '/admin/v2/users/{guid}/actions',
    'users.permissions.write': '/admin/v2/users/{guid}/permissions',
  }
  const issueIntentFields = {
    'users.promote': ['target_guid', 'expected_auth_version', 'expected_permissions_version', 'catalog_version', 'overrides', 'reason'],
    'users.demote': ['target_guid', 'expected_auth_version', 'expected_permissions_version', 'catalog_version', 'reason'],
    'users.permissions.write': ['target_guid', 'expected_auth_version', 'expected_permissions_version', 'catalog_version', 'overrides', 'reason'],
  }
  const executeFields = {
    'users.promote': ['action', 'expected_auth_version', 'expected_permissions_version', 'catalog_version', 'overrides', 'reason'],
    'users.demote': ['action', 'expected_auth_version', 'expected_permissions_version', 'catalog_version', 'reason'],
    'users.permissions.write': ['expected_auth_version', 'expected_permissions_version', 'catalog_version', 'overrides', 'reason'],
  }
  const executeActionLiterals = {
    'users.promote': 'promote',
    'users.demote': 'demote',
    'users.permissions.write': 'field absent; method and path select users.permissions.write',
  }
  for (const scope of SCOPES) {
    const action = contract.actions[scope]
    assert.equal(action.scope, scope)

    assert.equal(action.issue.method, 'POST')
    assert.equal(action.issue.path, '/admin/v2/action-verifications')
    assert.deepEqual(action.issue.forbidden_headers, ['Idempotency-Key', 'X-Action-Ticket'])
    assert.equal(action.issue.body.type, 'object')
    assert.equal(action.issue.body.additionalProperties, false)
    assert.deepEqual(action.issue.body.required, ['action', 'intent', 'current_password'])
    assert.deepEqual(action.issue.body.allowed, ['action', 'intent', 'current_password'])
    assert.equal(action.issue.body.action_literal, scope)
    assert.equal(action.issue.body.intent_additionalProperties, false)
    assert.deepEqual(action.issue.body.intent_required, issueIntentFields[scope])
    assert.deepEqual(action.issue.body.intent_allowed, issueIntentFields[scope])
    assert.match(action.issue.body.current_password, /independent owned UTF-8 bytes, cleared on every exit/)
    assert.equal(action.issue.response_status, 201)
    assert.deepEqual(action.issue.response_keys, ['ticket', 'expires_at'])
    assert.equal(action.issue.ticket_ttl_seconds, 300)

    assert.equal(action.execute.method, executeMethods[scope])
    assert.equal(action.execute.path, executePaths[scope])
    assert.deepEqual(action.execute.required_headers, ['Idempotency-Key', 'X-Action-Ticket'])
    assert.deepEqual(action.execute.header_rules, {
      'Idempotency-Key': 'exactly one unique original value',
      'X-Action-Ticket': `exactly one valid ${scope} ticket bound to the path target and complete canonical intent`,
    })
    assert.equal(action.execute.body.type, 'object')
    assert.equal(action.execute.body.additionalProperties, false)
    assert.deepEqual(action.execute.body.required, executeFields[scope])
    assert.deepEqual(action.execute.body.allowed, executeFields[scope])
    assert.equal(action.execute.body.action_literal, executeActionLiterals[scope])
    assert.equal(action.execute.body.path_supplies_target_guid, true)
    assert.equal(action.execute.response_status, 200)
    assert.deepEqual(action.execute.response_keys, STABLE_RESULT_KEYS)
    assert.equal(action.execute.success_rule, 'committed terminal result only; operation_commit_unknown is an error carrying operation_ref')
    assert.equal(action.execute.processing_success_response, false)

    assert.equal(action.query.method, 'GET')
    assert.equal(action.query.path, '/admin/v2/operations')
    assert.equal(action.query.exact_scope, scope)
    assert.equal(action.query.query_rule, `accept exactly scope=${scope} and no other query parameters`)
    assert.deepEqual(action.query.required_headers, ['Idempotency-Key'])
    assert.deepEqual(action.query.forbidden_headers, ['X-Action-Ticket'])
    assert.match(action.query.original_key_rule, /original mutation key/)
    assert.equal(action.query.response_status, 200)
  }

  assert.deepEqual(contract.stable_result.exact_keys, STABLE_RESULT_KEYS)
  assert.deepEqual(contract.stable_result.schema, {
    operation_ref: 'valid opaque op_ value',
    target_guid: 'canonical path target GUID string',
    resulting_auth_version: 'positive INT32 equal to the single committed auth-version advance',
    resulting_permissions_version: 'positive INT64 equal to the single committed policy-head advance',
    resulting_role: 'user or admin as fixed by the exact scope',
  })
  assert.deepEqual(contract.stable_result.role_by_scope, {
    'users.promote': 'admin',
    'users.demote': 'user',
    'users.permissions.write': 'admin',
  })
  assert.match(contract.stable_result.storage_and_replay, /replay those stored values; never project the current user row/)
  assert.deepEqual(contract.operation_query.statuses, ['processing', 'succeeded', 'failed', 'pending_recovery'])
  assert.deepEqual(contract.operation_query.response_keys, [
    'operation_ref',
    'scope',
    'status',
    'finished_at',
    'failure_code',
    ...STABLE_RESULT_KEYS.slice(1),
  ])
  assert.equal(contract.operation_query.nullable_result_rule, 'all four nullable result keys are always present; succeeded uses the stored stable result and processing, failed, and pending_recovery use null for every result key')
  assert.deepEqual(contract.operation_query.state_rules, {
    processing: {
      finished_at: null,
      failure_code: null,
      result_keys: 'all present and null',
      'Retry-After': 'required integer seconds 1..30',
    },
    succeeded: {
      finished_at: 'positive Unix milliseconds',
      failure_code: null,
      result_keys: 'all present from stored stable result',
      'Retry-After': 'forbidden',
    },
    failed: {
      finished_at: 'positive Unix milliseconds',
      failure_code: 'one operation_failure_codes value',
      result_keys: 'all present and null',
      'Retry-After': 'forbidden',
    },
    pending_recovery: {
      finished_at: null,
      failure_code: null,
      result_keys: 'all present and null',
      'Retry-After': 'forbidden',
    },
  })
  assert.equal(contract.operation_query.retry_after, 'processing only; integer seconds 1..30')
  assert.equal(contract.operation_query.visibility, 'only the originating actor, current originating logical session, exact scope, and original key can query; hidden or unverifiable combinations return 404 and expired or tombstoned results return 410')
  assert.equal(contract.operation_query.refresh, 'a succeeded query authorizes one owned target detail and permissions refresh; query never triggers mutation callbacks or consumes begin rate limit')

  assert.deepEqual(contract.errors.authentication_401, {
    exact_body_keys: ['detail'],
    additionalProperties: false,
    details: ['未登录', 'Token无效或已过期'],
  })
  assert.deepEqual(contract.errors.envelope, {
    exact_body_keys: ['error'],
    base_error: {
      exact_keys: ['code', 'message', 'type', 'request_id'],
      additionalProperties: false,
      message: '请求无法完成',
      type: 'admin_action_error',
    },
    operation_commit_unknown_error: {
      exact_keys: ['code', 'message', 'type', 'request_id', 'operation_ref'],
      required: ['code', 'message', 'type', 'request_id', 'operation_ref'],
      additionalProperties: false,
      code: 'operation_commit_unknown',
      message: '请求无法完成',
      type: 'admin_action_error',
      operation_ref: 'required valid opaque op_ value',
    },
  })
  assert.deepEqual(contract.errors.status_code_allowlist, {
    400: ['invalid_admin_action_request'],
    403: ['action_verification_rejected', 'action_operation_rejected'],
    404: ['action_target_not_found', 'action_operation_not_found'],
    409: ['action_verification_conflict', 'idempotency_conflict', 'idempotency_cross_session', 'action_rejected', 'target_version_conflict', 'policy_version_conflict', 'target_state_conflict', 'consumer_validation_failed'],
    410: ['operation_expired'],
    413: ['request_body_too_large'],
    422: ['action_inactive'],
    429: ['action_rate_limited'],
    503: ['action_dependency_unavailable', 'operation_commit_unknown'],
  })
  assert.deepEqual(contract.errors.operation_failure_codes, [
    'action_rejected',
    'target_version_conflict',
    'policy_version_conflict',
    'target_state_conflict',
    'consumer_validation_failed',
  ])
  assert.deepEqual(contract.errors.header_rules, {
    matched: 'Cache-Control no-store and nonempty X-Request-ID; admin_action_error request_id equals X-Request-ID',
    'Retry-After': 'required only for action_rate_limited and processing query; forbidden otherwise',
    operation_ref: 'present only in operation_commit_unknown error',
  })

  assert.deepEqual(contract.frontend_security.memory_only, ['current_password', 'ticket', 'idempotency_key', 'unknown_state'])
  assert.deepEqual(contract.frontend_security.prohibited_values, ['current_password', 'ticket', 'idempotency_key', 'password_material', 'HMAC_input'])
  assert.deepEqual(contract.frontend_security.secret_prohibitions, [
    'responses',
    'audit_detail',
    'outbox_payload',
    'URL',
    'localStorage',
    'sessionStorage',
    'analytics',
    'ordinary_logs',
  ])
  assert.equal(contract.frontend_security.mutation_auto_replay_count, 0)
  assert.match(contract.frontend_security.ownership, /clears current password, ticket, key, and unknown-state ownership/)
  assert.deepEqual(contract.errors.prohibited_fields, ['ticket', 'idempotency_key', 'current_password', 'password_material', 'HMAC_input', 'digest', 'dependency_raw_text'])

  assert.match(contract.common.overrides, /wire effect is allow or deny only/)
  assert.match(contract.common.overrides, /UI inherit is represented by omitting the capability/)
  assert.match(contract.common.overrides, /reject explicit inherit/)
  assert.deepEqual(contract.actions['users.demote'].issue.body.intent_forbidden, ['overrides'])
  assert.deepEqual(contract.actions['users.demote'].execute.body.forbidden, ['overrides'])
  assert.equal(contract.actions['users.permissions.write'].execute.body.action_literal, 'field absent; method and path select users.permissions.write')
})
