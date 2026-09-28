import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const frontendContractURL = new URL('../../docs/agents/contracts/prd-260903-interface-draft.json', import.meta.url)
const backendContractRepositoryPath = 'docs/agents/contracts/admin-user-create-v1.json'

async function readJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function createInterface(document) {
  const matches = document.interfaces.filter(candidate => candidate.name === 'admin_user_create')
  assert.equal(matches.length, 1, 'frontend draft must contain exactly one admin_user_create interface')
  return matches[0]
}

test('A03 contract requires the explicit backend fixture path', () => {
  assert.ok(process.env.A03_BACKEND_CONTRACT, 'missing_A03_BACKEND_CONTRACT')
})

test('frontend A03 contract exactly matches the frozen backend create contract', async t => {
  const backendPath = process.env.A03_BACKEND_CONTRACT
  if (!backendPath) {
    t.skip('missing_A03_BACKEND_CONTRACT')
    return
  }
  const [frontend, backend] = await Promise.all([
    readJSON(frontendContractURL),
    readJSON(backendPath),
  ])
  const create = createInterface(frontend)
  assert.equal(backend.contract, 'admin-user-create-v1')
  assert.deepEqual({
    backend_contract: create.backend_contract,
    method: create.method,
    path: create.path,
    request_body_fields: create.request.body_fields,
    response_status: create.response.status,
    response_fields: create.response.fields,
    response_headers: create.response.headers,
    deleted_replay: { status: create.response.deleted_replay.status, code: create.response.deleted_replay.code },
    operation_scopes: create.operation_scopes,
    status: create.status,
  }, {
    backend_contract: { path: backendContractRepositoryPath, revision: backend.revision },
    method: backend.create.method,
    path: backend.create.path,
    request_body_fields: Object.keys(backend.create.request.body.schema.properties),
    response_status: backend.create.response.status,
    response_fields: Object.keys(backend.create.response.schema.properties),
    response_headers: backend.create.response.headers,
    deleted_replay: {
      status: backend.idempotency.same_scope_same_request.deleted_target.status,
      code: backend.idempotency.same_scope_same_request.deleted_target.code,
    },
    operation_scopes: backend.idempotency.operation_scopes,
    status: backend.status,
  })
})
