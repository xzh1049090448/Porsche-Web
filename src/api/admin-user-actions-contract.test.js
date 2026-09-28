import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const frontendContractURL = new URL('../../docs/agents/contracts/prd-260903-interface-draft.json', import.meta.url)

async function readJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function interfaceByName(document, name) {
  const entry = document.interfaces.find(candidate => candidate.name === name)
  assert.ok(entry, `missing_frontend_interface:${name}`)
  return entry
}

function backendPath(path) {
  return path.replaceAll('{guid}', ':guid')
}

function normalizedIssue(entry, replay) {
  return {
    method: entry.method,
    path: backendPath(entry.path),
    request_headers: entry.headers.request,
    response_headers: entry.headers.response,
    body_limit_bytes: entry.request.body_limit_bytes,
    body_rule: entry.request.body_rule,
    field_rules: entry.request.field_rules,
    request_example: entry.request.example,
    response_status: entry.response.status,
    response_example: entry.response.example,
    ticket_ttl_seconds: entry.response.ticket_ttl_seconds,
    post_replay_count: replay,
  }
}

function normalizedExecute(entry, replay) {
  return {
    method: entry.method,
    path: backendPath(entry.path),
    request_headers: entry.headers.request,
    response_headers: entry.headers.response,
    body_limit_bytes: entry.request.body_limit_bytes,
    body_rule: entry.request.body_rule,
    field_rules: entry.request.field_rules,
    request_example: entry.request.example,
    response_status: entry.response.status,
    response_example: entry.response.example,
    success_semantics: entry.response.success_semantics,
    processing_response_allowed: entry.response.processing_allowed,
    post_replay_count: replay,
  }
}

function normalizedQuery(entry, replay) {
  return {
    method: entry.method,
    path: backendPath(entry.path),
    request_headers: entry.headers.request,
    response_headers: entry.headers.response,
    query_rule: entry.request.query_rule,
    response_status: entry.response.status,
    response_examples: entry.response.examples,
    get_replay_after_refresh: replay,
    requires_exact_adapter: entry.request.requires_exact_adapter,
    requires_original_scope_key: entry.request.requires_original_scope_key,
    triggers_callback: entry.request.triggers_callback,
    consumes_begin_rate_limit: entry.request.consumes_begin_rate_limit,
  }
}

function normalizedLegacy(entry) {
  return {
    method: entry.method,
    path: backendPath(entry.path),
    request_headers: entry.headers.request,
    response_headers: entry.headers.response,
    response_status: entry.response.status,
    response_example: entry.response.example,
    target_lookup: entry.request.target_lookup,
    database_or_redis_write: entry.request.database_or_redis_write,
  }
}

test('A14 contract requires the explicit backend contract path', async () => {
  const path = process.env.A14_BACKEND_CONTRACT
  assert.ok(path, 'missing_A14_BACKEND_CONTRACT')
})

test('frontend A14 contract exactly matches the frozen backend contract', async t => {
  const backendPath = process.env.A14_BACKEND_CONTRACT
  if (!backendPath) {
    t.skip('missing_A14_BACKEND_CONTRACT')
    return
  }

  const [frontend, backend] = await Promise.all([
    readJSON(frontendContractURL),
    readJSON(backendPath),
  ])
  const issue = interfaceByName(frontend, 'action_verification')
  const execute = interfaceByName(frontend, 'admin_user_action')
  const query = interfaceByName(frontend, 'operation_query')
  const legacy = interfaceByName(frontend, 'legacy_admin_user_delete')

  assert.deepEqual(normalizedIssue(issue, frontend.common.a14_replay_limits.issue_post), backend.endpoints.issue)
  assert.deepEqual(normalizedExecute(execute, frontend.common.a14_replay_limits.execute_post), backend.endpoints.execute)
  assert.deepEqual(normalizedQuery(query, frontend.common.a14_replay_limits.query_get_after_refresh), backend.endpoints.query)
  assert.deepEqual(normalizedLegacy(legacy), backend.endpoints.legacy_delete)
  assert.deepEqual(query.response.statuses, backend.operation_statuses)
  assert.deepEqual(query.response.failure_codes, backend.failure_codes)

  assert.deepEqual(frontend.common.a14_v2_user_read, backend.v2_user_read)
  assert.deepEqual(frontend.security_notes.a14_users_delete, backend.security_properties)
  assert.deepEqual(frontend.common.a14_replay_limits, {
    issue_post: backend.endpoints.issue.post_replay_count,
    execute_post: backend.endpoints.execute.post_replay_count,
    query_get_after_refresh: backend.endpoints.query.get_replay_after_refresh,
  })
  assert.deepEqual(frontend.common.a14_error_contract, backend.error_contract)
  assert.equal(legacy.response.status, backend.endpoints.legacy_delete.response_status)
  assert.deepEqual(legacy.response.example, backend.endpoints.legacy_delete.response_example)
  assert.deepEqual(legacy.headers, {
    request: backend.endpoints.legacy_delete.request_headers,
    response: backend.endpoints.legacy_delete.response_headers,
  })

  const listFields = interfaceByName(frontend, 'admin_users_list').response.item.exact_fields
  const detailFields = interfaceByName(frontend, 'admin_user_detail').response.exact_fields
  assert.ok(listFields.includes('auth_version'))
  assert.ok(detailFields.includes('auth_version'))
  for (const entry of [issue, execute, query, legacy]) {
    assert.equal(entry.status, 'AGREED_FOR_IMPLEMENTATION')
  }
})
