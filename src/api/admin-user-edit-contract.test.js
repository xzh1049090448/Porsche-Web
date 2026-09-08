import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const frontendContracts = [
  ['draft', new URL('../../docs/agents/contracts/prd-260903-interface-draft.json', import.meta.url)],
  ['root', new URL('../../interface-contract.json', import.meta.url)],
]
const backendContractRepositoryPath = 'docs/agents/contracts/admin-user-edit-v1.json'

async function readJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function editInterface(document, label) {
  const matches = document.interfaces.filter(candidate => candidate.name === 'admin_user_patch')
  assert.equal(matches.length, 1, `${label} contract must contain exactly one admin_user_patch interface`)
  return matches[0]
}

function normalizedFrontend(entry) {
  return {
    method: entry.method,
    path: entry.path,
    request: {
      headers: entry.request.headers,
      path_guid: entry.request.path_guid,
      keys: Object.keys(entry.request.body.schema.properties),
      schema: entry.request.body.schema,
      forbidden_field_policy: entry.request.body.forbidden_field_policy,
      body_limit_bytes: entry.request.body_limit_bytes,
      strict_json: entry.request.strict_json,
    },
    response: {
      status: entry.response.status,
      dto: entry.response.dto,
      dto_keys: entry.response.dto_keys,
      headers: entry.response.headers,
    },
    errors: entry.errors,
    capability: entry.capability,
    retry: entry.retry,
    legacy_put: entry.legacy_put,
  }
}

function normalizedBackend(contract) {
  return {
    method: contract.edit.method,
    path: contract.edit.path,
    request: {
      headers: contract.edit.request.headers,
      path_guid: contract.edit.request.path_guid,
      keys: Object.keys(contract.edit.request.body.schema.properties),
      schema: contract.edit.request.body.schema,
      forbidden_field_policy: contract.edit.request.body.forbidden_field_policy,
      body_limit_bytes: contract.edit.request.body_limit_bytes,
      strict_json: contract.edit.request.strict_json,
    },
    response: {
      status: contract.edit.response.status,
      dto: contract.edit.response.dto,
      dto_keys: contract.edit.response.dto_keys,
      headers: contract.edit.response.headers,
    },
    errors: contract.edit.errors,
    capability: contract.edit.capability,
    retry: contract.edit.retry,
    legacy_put: contract.edit.legacy_put,
  }
}

test('A05 contract requires the explicit backend contract path', () => {
  assert.ok(process.env.A05_BACKEND_CONTRACT, 'missing_A05_BACKEND_CONTRACT')
})

test('frontend A05 contracts exactly match the frozen backend nickname edit contract', async t => {
  const backendPath = process.env.A05_BACKEND_CONTRACT
  if (!backendPath) {
    t.skip('missing_A05_BACKEND_CONTRACT')
    return
  }

  const frontendDocuments = await Promise.all(frontendContracts.map(async ([label, path]) => [label, await readJSON(path)]))
  const entries = frontendDocuments.map(([label, document]) => [label, editInterface(document, label)])
  const backend = await readJSON(backendPath)

  assert.equal(backend.contract, 'admin-user-edit-v1')
  assert.equal(backend.revision, '2026-09-08-a05-v1')
  assert.equal(backend.status, 'AGREED_FOR_IMPLEMENTATION')
  for (const [label, entry] of entries) {
    assert.deepEqual(entry.backend_contract, {
      path: backendContractRepositoryPath,
      revision: backend.revision,
    }, `${label} backend contract reference`)
    assert.deepEqual(normalizedFrontend(entry), normalizedBackend(backend), `${label} A05 contract equality`)
    assert.equal(entry.status, backend.status, `${label} status`)
  }
})
