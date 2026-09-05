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

  assert.deepEqual(issue.request.example, backend.endpoints.issue.request_example)
  assert.deepEqual(issue.response.example, backend.endpoints.issue.response_example)
  assert.deepEqual(issue.headers, {
    request: backend.endpoints.issue.request_headers,
    response: backend.endpoints.issue.response_headers,
  })
  assert.equal(issue.response.status, backend.endpoints.issue.response_status)

  assert.deepEqual(execute.request.example, backend.endpoints.execute.request_example)
  assert.deepEqual(execute.response.example, backend.endpoints.execute.response_example)
  assert.deepEqual(execute.headers, {
    request: backend.endpoints.execute.request_headers,
    response: backend.endpoints.execute.response_headers,
  })
  assert.equal(execute.response.status, backend.endpoints.execute.response_status)

  assert.deepEqual(query.response.examples, backend.endpoints.query.response_examples)
  assert.deepEqual(query.headers, {
    request: backend.endpoints.query.request_headers,
    response: backend.endpoints.query.response_headers,
  })
  assert.equal(query.response.status, backend.endpoints.query.response_status)
  assert.deepEqual(query.response.statuses, backend.operation_statuses)
  assert.deepEqual(query.response.failure_codes, backend.failure_codes)

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
